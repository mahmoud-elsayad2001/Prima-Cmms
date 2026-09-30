import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Timer, ArrowLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fmtDateTime, fmtHours, effektiveAusfallzeit, grundText } from '../lib/domain'
import { fehlerText } from '../lib/fehler'
import { exportCsv } from '../lib/csv'
import { Spinner, Empty, Fehler, Kennzahl } from '../components/ui'

export default function Ausfaelle() {
  const navigate = useNavigate()
  const [zeilen, setZeilen] = useState(null)
  const [fehler, setFehler] = useState(null)
  const [nurLaufend, setNurLaufend] = useState(false)

  useEffect(() => {
    supabase.from('v_downtime').select('*').order('downtime_start', { ascending: false })
      .then(({ data, error }) => { if (error) setFehler(fehlerText(error)); setZeilen(data ?? []) })
  }, [])

  const laeuft = (z) => z.machine_status === 'stillstand' && z.status !== 'abgeschlossen'

  const gefiltert = useMemo(
    () => (zeilen ?? []).filter((z) => !nurLaufend || laeuft(z)),
    [zeilen, nurLaufend])

  const proObjekt = useMemo(() => {
    const map = new Map()
    ;(zeilen ?? []).forEach((z) => {
      const k = z.machine_name || `${z.room_name} (Raum)`
      const e = map.get(k) || { name: k, stunden: 0, anzahl: 0 }
      e.stunden += effektiveAusfallzeit(z); e.anzahl += 1
      map.set(k, e)
    })
    return [...map.values()].sort((a, b) => b.stunden - a.stunden)
  }, [zeilen])

  if (!zeilen) return fehler ? <Fehler text={fehler} /> : <Spinner text="Ausfälle werden geladen" />

  const gesamt = zeilen.reduce((s, z) => s + effektiveAusfallzeit(z), 0)
  const aktuell = zeilen.filter(laeuft).length

  function csv() {
    exportCsv(`ausfallzeiten-${new Date().toISOString().slice(0, 10)}`, gefiltert.map((z) => ({
      Auftragsnummer: z.order_no,
      Maschine: z.machine_name || '',
      Abteilung: z.department_name,
      Raum: z.room_name,
      'Grund der Störung': grundText(z),
      Beginn: fmtDateTime(z.downtime_start),
      Ende: z.downtime_end ? fmtDateTime(z.downtime_end) : 'läuft',
      'Dauer (Min.)': String(Math.round(effektiveAusfallzeit(z) * 600) / 10).replace('.', ',')
    })))
  }

  return (
    <div className="space-y-5">
      <button onClick={() => navigate('/')} className="flex items-center gap-1 text-sm font-medium text-steel">
        <ArrowLeft className="h-4 w-4" /> Zur Übersicht
      </button>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Maschinenausfälle</h1>
        <button onClick={csv} disabled={!gefiltert.length} className="btn-ghost !min-h-[42px] text-[13px]">
          <Download className="h-4 w-4" /> CSV
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Kennzahl wert={fmtHours(gesamt)} label="Ausfallzeit gesamt" ton="text-stop" />
        <Kennzahl wert={zeilen.length} label="Erfasste Ausfälle" />
        <Kennzahl wert={aktuell} label="Aktuell im Stillstand" ton={aktuell ? 'text-stop' : 'text-ink'} />
      </div>

      <button onClick={() => setNurLaufend(!nurLaufend)}
              className={`min-h-[44px] w-full rounded-card text-sm font-semibold
                          ${nurLaufend ? 'bg-stop text-white' : 'border border-black/10 bg-white text-steel'}`}>
        {nurLaufend ? 'Alle Ausfälle anzeigen' : 'Nur laufende Stillstände'}
      </button>

      <Fehler text={fehler} />

      {proObjekt.length > 0 && (
        <section className="card">
          <header className="border-b border-black/10 px-4 py-3"><h2 className="font-semibold">Summe je Objekt</h2></header>
          <ul className="divide-y divide-black/[0.06]">
            {proObjekt.map((m) => (
              <li key={m.name} className="flex items-center justify-between px-4 py-2.5">
                <span className="font-medium">{m.name}</span>
                <span className="text-right">
                  <span className="num block font-semibold">{fmtHours(m.stunden)}</span>
                  <span className="num block text-[12px] text-steel">{m.anzahl} {m.anzahl === 1 ? 'Ausfall' : 'Ausfälle'}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {gefiltert.length === 0 ? (
        <Empty title="Keine Ausfälle erfasst" hint="Sobald eine Störung mit Stillstand gemeldet wird, erscheint sie hier." />
      ) : (
        <ul className="space-y-2">
          {gefiltert.map((z) => (
            <li key={z.id}>
              <button onClick={() => navigate(`/auftraege/${z.id}`)}
                      className="card w-full p-4 text-left hover:border-ink/20">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{z.machine_name || z.room_name}</p>
                    <p className="text-[13px] text-steel">{z.department_name} · {z.room_name}</p>
                    <p className="mt-1 text-[13px]">{grundText(z)}</p>
                    <p className="text-[12px] text-steel">
                      {fmtDateTime(z.downtime_start)} bis {z.downtime_end ? fmtDateTime(z.downtime_end) : 'jetzt'}
                    </p>
                  </div>
                  <span className={`num shrink-0 text-right text-lg font-bold ${laeuft(z) ? 'text-stop' : 'text-ink'}`}>
                    {fmtHours(effektiveAusfallzeit(z))}
                    {laeuft(z) && (
                      <span className="block text-[11px] font-semibold">
                        <Timer className="mr-0.5 inline h-3 w-3" />läuft
                      </span>
                    )}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
