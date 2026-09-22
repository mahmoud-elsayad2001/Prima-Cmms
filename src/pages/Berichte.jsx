import { useEffect, useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ComposedChart, Line, Legend, Cell
} from 'recharts'
import { Download } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fmtDate, fmtHours, STATUS, PRIORITY, effektiveAusfallzeit } from '../lib/domain'
import { exportCsv } from '../lib/csv'
import { Spinner, Empty, Kennzahl, Fehler } from '../components/ui'

const FARBEN = { ink: '#0E1A24', signal: '#F2A007', stop: '#C0392B', run: '#1F6FEB', done: '#0F7A5A', steel: '#5A6B7A' }

export default function Berichte() {
  const [orders, setOrders] = useState(null)
  const [fehler, setFehler] = useState(null)
  const [zeitraum, setZeitraum] = useState('3m')
  const [abteilung, setAbteilung] = useState('')

  useEffect(() => {
    supabase.from('work_orders')
      .select('*, machines(name), rooms(name,department_id,departments(name))')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => { if (error) setFehler(error.message); setOrders(data ?? []) })
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
      const e = map.get(k) || { name: k, stunden: 0, ungeplant: 0, gesamt: 0 }
      e.stunden += effektiveAusfallzeit(o)
      e.gesamt += 1
      if (o.kind === 'unplanmaessig') e.ungeplant += 1
      map.set(k, e)
    })
    return [...map.values()].sort((a, b) => b.stunden - a.stunden)
  }, [basis])

  const proAbteilung = useMemo(() => {
    const map = new Map()
    basis.forEach((o) => {
      const k = o.rooms?.departments?.name || 'Ohne Zuordnung'
      map.set(k, (map.get(k) || 0) + effektiveAusfallzeit(o))
    })
    return [...map.entries()].map(([name, stunden]) => ({ name, stunden })).sort((a, b) => b.stunden - a.stunden)
  }, [basis])

  const pareto = useMemo(() => {
    const map = new Map()
    basis.filter((o) => o.kind === 'unplanmaessig').forEach((o) => {
      const k = o.failure_cause || 'Ohne Angabe'
      map.set(k, (map.get(k) || 0) + 1)
    })
    const liste = [...map.entries()].map(([ursache, anzahl]) => ({ ursache, anzahl })).sort((a, b) => b.anzahl - a.anzahl)
    const gesamt = liste.reduce((s, e) => s + e.anzahl, 0) || 1
    let kum = 0
    return liste.map((e) => { kum += e.anzahl; return { ...e, kumuliert: Math.round((kum / gesamt) * 100) } })
  }, [basis])

  const topUngeplant = useMemo(
    () => [...proMaschine].sort((a, b) => b.ungeplant - a.ungeplant).filter((m) => m.ungeplant > 0).slice(0, 8),
    [proMaschine])

  if (!orders) return <Spinner text="Auswertung wird erstellt" />

  const gesamtStunden = basis.reduce((s, o) => s + effektiveAusfallzeit(o), 0)
  const ungeplant = basis.filter((o) => o.kind === 'unplanmaessig').length
  const quote = basis.length ? Math.round((ungeplant / basis.length) * 100) : 0

  function csvAuftraege() {
    exportCsv(`monatsbericht-${new Date().toISOString().slice(0, 7)}`, basis.map((o) => ({
      Auftragsnummer: o.order_no,
      Art: o.kind === 'planmaessig' ? 'Planmäßig' : 'Unplanmäßig',
      Titel: o.title,
      Maschine: o.machines?.name || '',
      Abteilung: o.rooms?.departments?.name,
      Raum: o.rooms?.name,
            Status: STATUS[o.status].label,
      Priorität: PRIORITY[o.priority].label,
      Fehlerursache: o.failure_cause || 'Ohne Angabe',
      'Ausfallzeit (h)': String(o.downtime_hours).replace('.', ','),
      Reparaturdatum: o.repair_date || '',
      'Getauschte Ersatzteile': (o.replaced_parts || []).join(' | ')
    })))
  }

  function csvAuswertung() {
    exportCsv(`ausfallzeiten-${new Date().toISOString().slice(0, 10)}`, proMaschine.map((m) => ({
      Maschine: m.name,
      'Ausfallzeit (h)': String(m.stunden.toFixed(1)).replace('.', ','),
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
        <Kennzahl wert={fmtHours(gesamtStunden)} label="Ausfallzeit gesamt" />
        <Kennzahl wert={basis.length} label="Aufträge im Zeitraum" />
        <Kennzahl wert={ungeplant} label="Ungeplante Eingriffe" ton="text-stop" />
        <Kennzahl wert={`${quote} %`} label="Anteil ungeplant" />
      </div>

      {basis.length === 0 ? (
        <Empty title="Keine Daten im gewählten Zeitraum" hint="Zeitraum erweitern oder Abteilungsfilter zurücksetzen." />
      ) : (
        <>
          <Diagramm titel="Ausfallzeiten nach Maschine (Stunden)">
            <ResponsiveContainer width="100%" height={Math.max(240, proMaschine.slice(0, 10).length * 38)}>
              <BarChart data={proMaschine.slice(0, 10)} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid horizontal={false} stroke="#0E1A2410" />
                <XAxis type="number" tick={{ fontSize: 12, fill: FARBEN.steel }} />
                <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12, fill: FARBEN.ink }} />
                <Tooltip formatter={(v) => fmtHours(v)} cursor={{ fill: '#0E1A2408' }} />
                <Bar dataKey="stunden" name="Ausfallzeit" fill={FARBEN.ink} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Diagramm>

          <Diagramm titel="Ausfallzeiten nach Abteilung (Stunden)">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={proAbteilung} margin={{ left: 0, right: 8 }}>
                <CartesianGrid vertical={false} stroke="#0E1A2410" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: FARBEN.ink }} />
                <YAxis tick={{ fontSize: 12, fill: FARBEN.steel }} />
                <Tooltip formatter={(v) => fmtHours(v)} cursor={{ fill: '#0E1A2408' }} />
                <Bar dataKey="stunden" name="Ausfallzeit" fill={FARBEN.signal} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Diagramm>

          <Diagramm titel="Häufigste Fehlerursachen (Pareto)">
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={pareto} margin={{ left: 0, right: 8, bottom: 40 }}>
                <CartesianGrid vertical={false} stroke="#0E1A2410" />
                <XAxis dataKey="ursache" angle={-35} textAnchor="end" interval={0}
                       height={70} tick={{ fontSize: 11, fill: FARBEN.ink }} />
                <YAxis yAxisId="l" tick={{ fontSize: 12, fill: FARBEN.steel }} allowDecimals={false} />
                <YAxis yAxisId="r" orientation="right" unit="%" domain={[0, 100]} tick={{ fontSize: 12, fill: FARBEN.steel }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="l" dataKey="anzahl" name="Störungen" fill={FARBEN.stop} radius={[4, 4, 0, 0]} />
                <Line yAxisId="r" type="monotone" dataKey="kumuliert" name="Kumuliert %" stroke={FARBEN.ink} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
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
                        <td className="num px-4 py-2.5 text-right">{fmtHours(m.stunden)}</td>
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

function Diagramm({ titel, children }) {
  return (
    <section className="card p-4">
      <h2 className="mb-3 font-semibold">{titel}</h2>
      {children}
    </section>
  )
}
