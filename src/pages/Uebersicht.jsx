import { useEffect, useState, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, CalendarClock, ClipboardCheck, Timer, RefreshCw, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { fmtDate, fmtHours, isOverdue, effektiveAusfallzeit } from '../lib/domain'
import { Spinner, Fehler, StatusBadge, PriorityBadge } from '../components/ui'
import { InstallButton } from '../components/install'

export default function Uebersicht() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [daten, setDaten] = useState(null)
  const [fehler, setFehler] = useState(null)
  const [busy, setBusy] = useState(false)

  const laden = useCallback(async () => {
    setFehler(null)
    const [o, f] = await Promise.all([
      supabase.from('work_orders')
        .select('id,order_no,title,kind,status,priority,downtime_hours,machine_status,downtime_start,created_at,due_date,rejected_count,machines(name),rooms(name,departments(name))')
        .order('created_at', { ascending: false }),
      supabase.from('machines_due').select('id,name,room_name,department_name,next_due,cycle').eq('active', true)
    ])
    if (o.error) return setFehler(o.error.message)
    const alle = o.data ?? []
    setDaten({
      alle,
      offen: alle.filter((x) => x.status === 'offen'),
      laufend: alle.filter((x) => x.status === 'in_bearbeitung'),
      abnahme: alle.filter((x) => x.status === 'fertig_zur_abnahme'),
      ausfallGesamt: alle.reduce((s, x) => s + effektiveAusfallzeit(x), 0),
      faellig: (f.data ?? []).filter((m) => m.next_due)
        .sort((a, b) => a.next_due.localeCompare(b.next_due)).slice(0, 6)
    })
  }, [])
  useEffect(() => { laden() }, [laden])

  async function wartungenErzeugen() {
    setBusy(true); setFehler(null)
    const { data, error } = await supabase.rpc('generate_due_maintenance')
    setBusy(false)
    if (error) return setFehler(error.message)
    await laden()
    alert(data > 0 ? `${data} Wartungsauftrag/-aufträge angelegt.` : 'Keine neuen Wartungen fällig.')
  }

  if (!daten) return <Spinner text="Anlagenstatus wird geladen" />

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

      {/* Klickbare Kacheln */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kachel wert={daten.offen.length} label="Offen" ton="text-ink" icon={AlertTriangle}
                onClick={() => navigate('/auftraege?tab=unplanmaessig&status=offen')} />
        <Kachel wert={daten.laufend.length} label="In Bearbeitung" ton="text-run" icon={Timer}
                onClick={() => navigate('/auftraege?tab=unplanmaessig&status=in_bearbeitung')} />
        <Kachel wert={daten.abnahme.length} label="Fertig zur Abnahme" ton="text-[#8a5c00]" icon={ClipboardCheck}
                onClick={() => navigate('/qm')} />
        <Kachel wert={fmtHours(daten.ausfallGesamt)} label="Ausfallstunden gesamt" ton="text-stop" icon={CalendarClock}
                onClick={() => navigate('/ausfaelle')} />
      </div>

      {/* Offene Aufträge, klar getrennt */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Liste titel="Unplanmäßige Aufträge" auftraege={offenUnplan}
               leer="Keine offene Störung." ziel="/auftraege?tab=unplanmaessig" navigate={navigate} />
        <Liste titel="Planmäßige Aufträge" auftraege={offenPlan}
               leer="Keine offene Wartung." ziel="/auftraege?tab=planmaessig" navigate={navigate} />
      </div>

      <section className="card">
        <header className="flex items-center justify-between border-b border-black/10 px-4 py-3">
          <h2 className="font-semibold">Anstehende Wartungszyklen</h2>
          <button onClick={wartungenErzeugen} disabled={busy} className="btn-ghost !min-h-[40px] text-[13px]">
            <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /> Aufträge erzeugen
          </button>
        </header>
        {daten.faellig.length === 0 ? (
          <p className="p-4 text-sm text-steel">Keine Maschine mit hinterlegtem Zyklus.</p>
        ) : (
          <ul className="divide-y divide-black/[0.06]">
            {daten.faellig.map((m) => (
              <li key={m.id}>
                <Link to={`/maschinen/${m.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-hall">
                  <span className={`h-9 w-1.5 shrink-0 rounded-full ${isOverdue(m.next_due) ? 'bg-stop' : 'bg-signal'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{m.name}</span>
                    <span className="block text-[13px] text-steel">{m.department_name} · {m.room_name}</span>
                  </span>
                  <span className={`num shrink-0 text-right text-[13px] font-semibold
                                    ${isOverdue(m.next_due) ? 'text-stop' : 'text-steel'}`}>
                    {fmtDate(m.next_due)}
                    <span className="block text-[11px] font-normal">
                      {isOverdue(m.next_due) ? 'überfällig' : 'fällig'}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Kachel({ wert, label, ton, icon: Icon, onClick }) {
  return (
    <button onClick={onClick}
            className="card p-4 text-left transition-colors hover:border-ink/25 hover:bg-white">
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
