import { useEffect, useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ComposedChart, Line, Legend, LabelList, PieChart, Pie, Cell
} from 'recharts'
import { Download } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  fmtDate, fmtDauer, STATUS, PRIORITY, ausfallSekunden, arbeitsSekunden, chartEinheit,
  grundLabel, grundText, median
} from '../lib/domain'
import { fehlerText } from '../lib/fehler'
import { exportCsv } from '../lib/csv'
import { Spinner, Empty, Kennzahl, Fehler } from '../components/ui'

const FARBEN = { ink: '#0E1A24', signal: '#F2A007', stop: '#C0392B', run: '#1F6FEB', done: '#0F7A5A', steel: '#5A6B7A' }
const PALETTE = ['#C0392B', '#1F6FEB', '#F2A007', '#0F7A5A', '#8E44AD', '#16A085', '#0E1A24', '#D35400']
const GRAU = '#9AA5B1'

const kuerzen = (t, n = 18) => (t && t.length > n ? `${t.slice(0, n - 1)}…` : t)

export default function Berichte() {
  const [orders, setOrders] = useState(null)
  const [fehler, setFehler] = useState(null)
  const [zeitraum, setZeitraum] = useState('3m')
  const [abteilung, setAbteilung] = useState('')

  useEffect(() => {
    supabase.from('work_orders')
      .select('*, machines(name), rooms(name,departments(name))')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => { if (error) setFehler(fehlerText(error)); setOrders(data ?? []) })
  }, [])

  const abteilungen = useMemo(
    () => [...new Set((orders ?? []).map((o) => o.rooms?.departments?.name).filter(Boolean))].sort(), [orders])

  const basis = useMemo(() => {
    if (!orders) return []
    const grenze = new Date()
    const monate = { '1m': 1, '3m': 3, '12m': 12, alle: 999 }[zeitraum]
    grenze.setMonth(grenze.getMonth() - monate)
    return orders.filter((o) => {
      if (zeitraum !== 'alle' && new Date(o.repair_date || o.created_at) < grenze) return false
      if (abteilung && o.rooms?.departments?.name !== abteilung) return false
      return true
    })
  }, [orders, zeitraum, abteilung])

  const proMaschine = useMemo(() => {
    const map = new Map()
    basis.forEach((o) => {
      const k = o.machines?.name || `${o.rooms?.name} (Raum)`
      const e = map.get(k) || { name: k, sekunden: 0, ungeplant: 0, gesamt: 0 }
      e.sekunden += ausfallSekunden(o)
      e.gesamt += 1
      if (o.kind === 'unplanmaessig') e.ungeplant += 1
      map.set(k, e)
    })
    return [...map.values()]
  }, [basis])

  const ausfallMaschine = useMemo(
    () => proMaschine.filter((m) => m.sekunden > 0).sort((a, b) => b.sekunden - a.sekunden).slice(0, 10), [proMaschine])

  const ausfallAbteilung = useMemo(() => {
    const map = new Map()
    basis.forEach((o) => {
      const k = o.rooms?.departments?.name || 'Ohne Zuordnung'
      map.set(k, (map.get(k) || 0) + ausfallSekunden(o))
    })
    return [...map.entries()].map(([name, sekunden]) => ({ name, sekunden }))
      .filter((a) => a.sekunden > 0).sort((a, b) => b.sekunden - a.sekunden)
  }, [basis])

  const ursachen = useMemo(() => {
    const map = new Map()
    basis.filter((o) => o.kind === 'unplanmaessig').forEach((o) => {
      const k = o.fault_cause || 'ohne'
      const e = map.get(k) || { key: k, label: grundLabel(o.fault_cause), anzahl: 0, sekunden: 0 }
      e.anzahl += 1; e.sekunden += ausfallSekunden(o)
      map.set(k, e)
    })
    const liste = [...map.values()].sort((a, b) => b.anzahl - a.anzahl)
    const gesamt = liste.reduce((s, e) => s + e.anzahl, 0) || 1
    let kum = 0
    return liste.map((e, i) => {
      kum += e.anzahl
      return {
        ...e, anteil: Math.round((e.anzahl / gesamt) * 100), kumuliert: Math.round((kum / gesamt) * 100),
        farbe: e.key === 'ohne' ? GRAU : PALETTE[i % PALETTE.length]
      }
    })
  }, [basis])

  const topUngeplant = useMemo(
    () => [...proMaschine].sort((a, b) => b.ungeplant - a.ungeplant).filter((m) => m.ungeplant > 0).slice(0, 8),
    [proMaschine])

  if (!orders) return fehler ? <Fehler text={fehler} /> : <Spinner text="Auswertung wird erstellt" />

  const gesamtSek = basis.reduce((s, o) => s + ausfallSekunden(o), 0)
  const ungeplant = basis.filter((o) => o.kind === 'unplanmaessig')
  const reparaturen = ungeplant.map((o) => arbeitsSekunden(o)).filter((s) => s > 0)
  const stoerungenMitUrsache = ursachen.reduce((s, e) => s + e.anzahl, 0)

  const min = (sek) => String(Math.round((sek / 60) * 10) / 10).replace('.', ',')

  function csvAuftraege() {
    exportCsv(`monatsbericht-${new Date().toISOString().slice(0, 7)}`, basis.map((o) => ({
      Auftragsnummer: o.order_no,
      Art: o.kind === 'planmaessig' ? 'Planmäßig' : 'Unplanmäßig',
      Bezeichnung: o.title,
      Maschine: o.machines?.name || '',
      Abteilung: o.rooms?.departments?.name,
      Raum: o.rooms?.name,
      Status: STATUS[o.status].label,
      Priorität: PRIORITY[o.priority].label,
      'Grund der Störung': o.kind === 'unplanmaessig' ? grundText(o) : '',
      'Ausfallzeit (Min.)': min(ausfallSekunden(o)),
      'Reparaturdauer (Min.)': min(arbeitsSekunden(o)),
      Reparaturdatum: o.repair_date || '',
      'Getauschte Ersatzteile': (o.replaced_parts || []).join(' | ')
    })))
  }

  function csvAuswertung() {
    exportCsv(`ausfallzeiten-${new Date().toISOString().slice(0, 10)}`, proMaschine
      .sort((a, b) => b.sekunden - a.sekunden).map((m) => ({
        Maschine: m.name,
        'Ausfallzeit (Min.)': min(m.sekunden),
        'Ungeplante Ausfälle': m.ungeplant,
        'Aufträge gesamt': m.gesamt
      })))
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Berichte</h1>
        <div className="flex gap-2">
          <button onClick={csvAuswertung} className="btn-ghost !min-h-[42px] text-[13px]">
            <Download className="h-4 w-4" /> Auswertung
          </button>
          <button onClick={csvAuftraege} className="btn-ghost !min-h-[42px] text-[13px]">
            <Download className="h-4 w-4" /> Aufträge
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        <select className="field flex-1" value={zeitraum} onChange={(e) => setZeitraum(e.target.value)} aria-label="Zeitraum">
          <option value="1m">Letzter Monat</option>
          <option value="3m">Letzte 3 Monate</option>
          <option value="12m">Letzte 12 Monate</option>
          <option value="alle">Gesamter Zeitraum</option>
        </select>
        <select className="field flex-1" value={abteilung} onChange={(e) => setAbteilung(e.target.value)} aria-label="Abteilung">
          <option value="">Alle Abteilungen</option>
          {abteilungen.map((a) => <option key={a}>{a}</option>)}
        </select>
      </div>

      <Fehler text={fehler} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kennzahl wert={fmtDauer(gesamtSek)} label="Ausfallzeit gesamt" />
        <Kennzahl wert={basis.length} label="Aufträge im Zeitraum" />
        <Kennzahl wert={ungeplant.length} label="Ungeplante Eingriffe" ton="text-stop" />
        <Kennzahl wert={reparaturen.length ? fmtDauer(median(reparaturen)) : '–'} label="Reparaturdauer (Median)" />
      </div>

      {basis.length === 0 ? (
        <Empty title="Keine Daten im gewählten Zeitraum" hint="Zeitraum erweitern oder Abteilungsfilter zurücksetzen." />
      ) : (
        <>
          <Diagramm titel="Ausfallzeiten nach Maschine">
            {ausfallMaschine.length === 0
              ? <Leer />
              : <DauerBalken daten={ausfallMaschine} horizontal farbe={FARBEN.ink} />}
          </Diagramm>

          <Diagramm titel="Ausfallzeiten nach Abteilung">
            {ausfallAbteilung.length === 0
              ? <Leer />
              : <DauerBalken daten={ausfallAbteilung} farbe={FARBEN.signal} />}
          </Diagramm>

          <Diagramm titel={`Störungsursachen · Anteile (${stoerungenMitUrsache} ${stoerungenMitUrsache === 1 ? 'Störung' : 'Störungen'})`}>
            {ursachen.length === 0 ? (
              <p className="text-sm text-steel">Im Zeitraum wurde keine Störung erfasst.</p>
            ) : (
              <div className="grid items-center gap-4 md:grid-cols-2">
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={ursachen} dataKey="anzahl" nameKey="label" innerRadius={55} outerRadius={95}
                         paddingAngle={2} stroke="#fff">
                      {ursachen.map((u) => <Cell key={u.key} fill={u.farbe} />)}
                    </Pie>
                    <Tooltip formatter={(v, n, p) => [`${v} (${p.payload.anteil} %)`, n]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="overflow-x-auto">
                  <table className="w-full text-[14px]">
                    <thead>
                      <tr className="border-b border-black/[0.08] text-left text-[12px] text-steel">
                        <th className="py-2 pr-2 font-semibold">Grund</th>
                        <th className="px-2 py-2 text-right font-semibold">Anzahl</th>
                        <th className="px-2 py-2 text-right font-semibold">Anteil</th>
                        <th className="py-2 pl-2 text-right font-semibold">Ausfall</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/[0.06]">
                      {ursachen.map((u) => (
                        <tr key={u.key}>
                          <td className="py-2 pr-2">
                            <span className="mr-2 inline-block h-3 w-3 rounded-sm align-middle" style={{ background: u.farbe }} />
                            <span className="font-medium">{u.label}</span>
                          </td>
                          <td className="num px-2 py-2 text-right font-semibold">{u.anzahl}</td>
                          <td className="num px-2 py-2 text-right text-steel">{u.anteil} %</td>
                          <td className="num py-2 pl-2 text-right text-steel">{u.sekunden > 0 ? fmtDauer(u.sekunden) : '–'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Diagramm>

          <Diagramm titel="Häufigste Fehlerursachen (Pareto)">
            {ursachen.length === 0 ? (
              <p className="text-sm text-steel">Im Zeitraum wurde keine Störung erfasst.</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={ursachen} margin={{ left: 0, right: 8, bottom: 40 }}>
                  <CartesianGrid vertical={false} stroke="#0E1A2410" />
                  <XAxis dataKey="label" angle={-35} textAnchor="end" interval={0} height={70}
                         tick={{ fontSize: 11, fill: FARBEN.ink }} />
                  <YAxis yAxisId="l" allowDecimals={false} tick={{ fontSize: 12, fill: FARBEN.steel }} />
                  <YAxis yAxisId="r" orientation="right" unit=" %" domain={[0, 100]} tick={{ fontSize: 12, fill: FARBEN.steel }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="l" dataKey="anzahl" name="Störungen" fill={FARBEN.stop} radius={[4, 4, 0, 0]} minPointSize={3} />
                  <Line yAxisId="r" type="monotone" dataKey="kumuliert" name="Kumuliert %" stroke={FARBEN.ink} strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </Diagramm>

          <section className="card">
            <header className="border-b border-black/10 px-4 py-3">
              <h2 className="font-semibold">Maschinen mit den meisten ungeplanten Ausfällen</h2>
            </header>
            {topUngeplant.length === 0 ? (
              <p className="p-4 text-sm text-steel">Im Zeitraum wurde keine Störung erfasst.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[14px]">
                  <thead>
                    <tr className="border-b border-black/[0.08] text-left text-[12px] text-steel">
                      <th className="px-4 py-2 font-semibold">Maschine</th>
                      <th className="px-4 py-2 text-right font-semibold">Ungeplant</th>
                      <th className="px-4 py-2 text-right font-semibold">Ausfallzeit</th>
                      <th className="px-4 py-2 text-right font-semibold">Aufträge</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.06]">
                    {topUngeplant.map((m) => (
                      <tr key={m.name}>
                        <td className="px-4 py-2.5 font-medium">{m.name}</td>
                        <td className="num px-4 py-2.5 text-right font-semibold text-stop">{m.ungeplant}</td>
                        <td className="num px-4 py-2.5 text-right">{m.sekunden > 0 ? fmtDauer(m.sekunden) : '–'}</td>
                        <td className="num px-4 py-2.5 text-right text-steel">{m.gesamt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

/**
 * Balkendiagramm für Zeitdauern. Die Achse wechselt je nach Größenordnung zwischen
 * Minuten und Stunden, jeder Balken hat ein Mindestmaß und trägt seine genaue Dauer als Beschriftung.
 */
function DauerBalken({ daten, horizontal = false, farbe }) {
  const einheit = chartEinheit(Math.max(0, ...daten.map((d) => d.sekunden)))
  const punkte = daten.map((d) => ({ ...d, wert: d.sekunden / einheit.teiler }))
  const domain = [0, (max) => (einheit.key === 'min'
    ? Math.max(1, Math.ceil(max * 1.15))
    : Math.max(1, Math.ceil(max * 1.15 * 2) / 2))]
  const unit = ` ${einheit.kurz}`
  const tooltip = (v, n, p) => [fmtDauer(p.payload.sekunden), 'Ausfallzeit']
  const beschriftung = { fontSize: 11, fill: FARBEN.ink }

  if (horizontal) {
    return (
      <>
        <ResponsiveContainer width="100%" height={Math.max(200, punkte.length * 42)}>
          <BarChart data={punkte} layout="vertical" margin={{ left: 4, right: 78 }}>
            <CartesianGrid horizontal={false} stroke="#0E1A2410" />
            <XAxis type="number" domain={domain} allowDecimals={einheit.key !== 'min'} unit={unit}
                   tick={{ fontSize: 12, fill: FARBEN.steel }} />
            <YAxis type="category" dataKey="name" width={130} tickFormatter={(v) => kuerzen(v)}
                   tick={{ fontSize: 12, fill: FARBEN.ink }} />
            <Tooltip formatter={tooltip} cursor={{ fill: '#0E1A2408' }} />
            <Bar dataKey="wert" fill={farbe} radius={[0, 4, 4, 0]} minPointSize={4}>
              <LabelList dataKey="sekunden" position="right" formatter={fmtDauer} style={beschriftung} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <p className="mt-1 text-[12px] text-steel">Achse in {einheit.key === 'min' ? 'Minuten' : 'Stunden'}</p>
      </>
    )
  }
  return (
    <>
      <ResponsiveContainer width="100%" height={270}>
        <BarChart data={punkte} margin={{ left: 0, right: 8, top: 22 }}>
          <CartesianGrid vertical={false} stroke="#0E1A2410" />
          <XAxis dataKey="name" tickFormatter={(v) => kuerzen(v, 14)} tick={{ fontSize: 12, fill: FARBEN.ink }} />
          <YAxis domain={domain} allowDecimals={einheit.key !== 'min'} unit={unit} width={64}
                 tick={{ fontSize: 12, fill: FARBEN.steel }} />
          <Tooltip formatter={tooltip} cursor={{ fill: '#0E1A2408' }} />
          <Bar dataKey="wert" fill={farbe} radius={[4, 4, 0, 0]} minPointSize={4}>
            <LabelList dataKey="sekunden" position="top" formatter={fmtDauer} style={beschriftung} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="mt-1 text-[12px] text-steel">Achse in {einheit.key === 'min' ? 'Minuten' : 'Stunden'}</p>
    </>
  )
}

const Leer = () => <p className="text-sm text-steel">Im Zeitraum wurde kein Stillstand erfasst.</p>

function Diagramm({ titel, children }) {
  return (
    <section className="card p-4">
      <h2 className="mb-3 font-semibold">{titel}</h2>
      {children}
    </section>
  )
}
