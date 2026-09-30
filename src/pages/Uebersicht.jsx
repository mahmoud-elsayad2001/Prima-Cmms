import { useEffect, useState, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, CalendarClock, ClipboardCheck, Wrench, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { fmtDate, fmtHours, effektiveAusfallzeit } from '../lib/domain'
import { fehlerText } from '../lib/fehler'
import { pruefeFaelligeWartungen } from '../lib/wartung'
import { Spinner, Fehler, PriorityBadge } from '../components/ui'
import { InstallButton } from '../components/install'

export default function Uebersicht() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [daten, setDaten] = useState(null)
  const [fehler, setFehler] = useState(null)

  const laden = useCallback(async () => {
    setFehler(null)
    await pruefeFaelligeWartungen()   // fällige Zyklen still im Hintergrund als Aufträge anlegen
    const { data, error } = await supabase.from('work_orders')
      .select('*, machines(name), rooms(name,departments(name))')
      .order('created_at', { ascending: false })
    if (error) return setFehler(fehlerText(error))
    const alle = data ?? []
    setDaten({
      offen: alle.filter((x) => x.status === 'offen'),
      laufend: alle.filter((x) => x.status === 'in_bearbeitung'),
      abnahme: alle.filter((x) => x.status === 'fertig_zur_abnahme'),
      ausfallGesamt: alle.reduce((s, x) => s + effektiveAusfallzeit(x), 0)
    })
  }, [])
  useEffect(() => { laden() }, [laden])

  if (!daten) return fehler ? <Fehler text={fehler} /> : <Spinner text="Anlagenstatus wird geladen" />

  const offenPlan   = daten.offen.filter((o) => o.kind === 'planmaessig')
  const offenUnplan = daten.offen.filter((o) => o.kind === 'unplanmaessig')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Guten Tag, {profile?.full_name?.split(' ')[0] || 'willkommen'}</h1>
        <p className="text-sm text-steel">Stand {fmtDate(new Date())}</p>
      </div>

      <div className="sm:hidden"><InstallButton /></div>
      <Fehler text={fehler} />

      {/* Klickbare Kacheln – jede führt in genau ihre gefilterte Ansicht */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kachel wert={daten.offen.length} label="Offen" ton="text-ink" icon={AlertTriangle}
                onClick={() => navigate('/auftraege?tab=offen')} />
        <Kachel wert={daten.laufend.length} label="In Bearbeitung" ton="text-run" icon={Wrench}
                onClick={() => navigate('/auftraege?tab=bearbeitung')} />
        <Kachel wert={daten.abnahme.length} label="Fertig zur Abnahme" ton="text-[#8a5c00]" icon={ClipboardCheck}
                onClick={() => navigate('/auftraege?tab=abnahme')} />
        <Kachel wert={fmtHours(daten.ausfallGesamt)} label="Ausfallzeit gesamt" ton="text-stop" icon={CalendarClock}
                onClick={() => navigate('/ausfaelle')} />
      </div>

      {/* Offene Aufträge, klar getrennt */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Liste titel="Unplanmäßige Aufträge" auftraege={offenUnplan} leer="Keine offene Störung."
               ziel="/auftraege?tab=stoerungen" navigate={navigate} />
        <Liste titel="Planmäßige Aufträge" auftraege={offenPlan} leer="Keine offene Wartung."
               ziel="/auftraege?tab=wartungen" navigate={navigate} />
      </div>
    </div>
  )
}

function Kachel({ wert, label, ton, icon: Icon, onClick }) {
  return (
    <button onClick={onClick}
            className="card p-4 text-left transition-colors hover:border-ink/25">
      <div className="flex items-start justify-between">
        <p className={`num text-3xl font-bold ${ton}`}>{wert}</p>
        <Icon className="h-5 w-5 text-steel" />
      </div>
      <p className="mt-1 flex items-center gap-1 text-[13px] text-steel">
        {label} <ChevronRight className="h-3.5 w-3.5" />
      </p>
    </button>
  )
}

function Liste({ titel, auftraege, leer, ziel, navigate }) {
  return (
    <section className="card">
      <header className="flex items-center justify-between border-b border-black/10 px-4 py-3">
        <h2 className="font-semibold">{titel}</h2>
        <Link to={ziel} className="text-[13px] font-semibold text-run">Alle anzeigen</Link>
      </header>
      {auftraege.length === 0 ? (
        <p className="p-4 text-sm text-steel">{leer}</p>
      ) : (
        <ul className="divide-y divide-black/[0.06]">
          {auftraege.slice(0, 5).map((o) => (
            <li key={o.id}>
              <button onClick={() => navigate(`/auftraege/${o.id}`)} className="w-full px-4 py-3 text-left hover:bg-hall">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="num text-[12px] text-steel">#{o.order_no}</span>
                  <PriorityBadge priority={o.priority} />
                  {o.machine_status === 'stillstand' && (
                    <span className="rounded bg-stop/10 px-2 py-0.5 text-[12px] font-semibold text-stop">Stillstand</span>
                  )}
                  {o.rejected_count > 0 && (
                    <span className="rounded bg-stop/10 px-2 py-0.5 text-[12px] font-semibold text-stop">beanstandet</span>
                  )}
                </div>
                <p className="mt-0.5 font-medium">{o.title}</p>
                <p className="text-[13px] text-steel">
                  {o.rooms?.departments?.name} · {o.rooms?.name}{o.machines?.name ? ` · ${o.machines.name}` : ''}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
