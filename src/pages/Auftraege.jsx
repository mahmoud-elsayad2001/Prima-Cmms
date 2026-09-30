import { useEffect, useMemo, useState, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Filter, Download, CalendarClock, AlertTriangle, ChevronRight, Archive, Timer,
  Inbox, Wrench, ClipboardCheck
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import {
  STATUS, PRIORITY, CYCLES, ZEITFILTER, imZeitfenster, fmtDate, fmtDateTime, fmtTime, fmtDauer,
  fmtHours, isOverdue, autoTitel, effektiveAusfallzeit, arbeitsSekunden, arbeitLaeuft, grundText
} from '../lib/domain'
import { fehlerText, ersteAbfrage } from '../lib/fehler'
import { pruefeFaelligeWartungen } from '../lib/wartung'
import { exportCsv } from '../lib/csv'
import { Spinner, StatusBadge, PriorityBadge, Empty, Modal, Fehler, GrundSelect } from '../components/ui'
import { FabNeu } from '../components/Layout'
import AbnahmeListe from '../components/AbnahmeKarte'
import Objektwahl, { useStruktur, objektName } from '../components/Objektwahl'

const LEER = { department_id: '', room_id: '', priority: '', von: '', bis: '' }

const TABS = [
  { key: 'offen',       label: 'Offen',          icon: Inbox },
  { key: 'bearbeitung', label: 'In Bearbeitung', icon: Wrench },
  { key: 'abnahme',     label: 'Zur Abnahme',    icon: ClipboardCheck },
  { key: 'stoerungen',  label: 'Störungen',      icon: AlertTriangle },
  { key: 'wartungen',   label: 'Wartungen',      icon: CalendarClock },
  { key: 'archiv',      label: 'Archiv',         icon: Archive }
]
// Ältere Verweise (vor dieser Version) weiter unterstützen
const ALIAS = { unplanmaessig: 'stoerungen', planmaessig: 'wartungen' }

const AKTIV = ['offen', 'in_bearbeitung']

/** Genau die Aufträge, die zu einem Reiter gehören – keine Vermischung. */
function imTab(o, tab, art) {
  switch (tab) {
    case 'offen':       return o.status === 'offen'
    case 'bearbeitung': return o.status === 'in_bearbeitung'
    case 'abnahme':     return o.status === 'fertig_zur_abnahme'
    case 'stoerungen':  return o.kind === 'unplanmaessig' && AKTIV.includes(o.status)
    case 'wartungen':   return o.kind === 'planmaessig' && AKTIV.includes(o.status)
    case 'archiv':      return o.status === 'abgeschlossen'
      && o.kind === (art === 'ungeplant' ? 'unplanmaessig' : 'planmaessig')
    default:            return false
  }
}

const VERBINDUNGEN = 'machines(id,name), rooms(id,name,department_id,departments(name)), ersteller:created_by(full_name), fertig:completed_by(full_name)'

export default function Auftraege() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const struktur = useStruktur()
  const [params, setParams] = useSearchParams()

  const angefragt = ALIAS[params.get('tab')] || params.get('tab')
  const tab = TABS.some((t) => t.key === angefragt) ? angefragt : 'stoerungen'
  const art = params.get('art') === 'ungeplant' ? 'ungeplant' : 'geplant'

  const [orders, setOrders] = useState(null)
  const [filter, setFilter] = useState(LEER)
  const [zeit, setZeit] = useState('alle')
  const [sortierung, setSortierung] = useState('standard')
  const [filterOffen, setFilterOffen] = useState(false)
  const [neuOffen, setNeuOffen] = useState(false)
  const [fehler, setFehler] = useState(null)

  const laden = useCallback(async () => {
    const res = await ersteAbfrage(
      () => supabase.from('work_orders')
        .select(`*, ${VERBINDUNGEN}, starter:work_started_by(full_name)`)
        .order('created_at', { ascending: false }),
      () => supabase.from('work_orders')
        .select(`*, ${VERBINDUNGEN}`)
        .order('created_at', { ascending: false })
    )
    setFehler(res.error ? fehlerText(res.error) : null)
    setOrders(res.data ?? [])
  }, [])

  useEffect(() => { pruefeFaelligeWartungen().finally(laden) }, [laden])

  const gefiltert = useMemo(() => {
    if (!orders) return []
    let list = orders.filter((o) => imTab(o, tab, art))
    if (filter.department_id) list = list.filter((o) => o.rooms?.department_id === filter.department_id)
    if (filter.room_id)       list = list.filter((o) => o.room_id === filter.room_id)
    if (filter.priority)      list = list.filter((o) => o.priority === filter.priority)
    if (filter.von)           list = list.filter((o) => (o.repair_date || o.created_at.slice(0, 10)) >= filter.von)
    if (filter.bis)           list = list.filter((o) => (o.repair_date || o.created_at.slice(0, 10)) <= filter.bis)
    if (tab === 'wartungen')  list = list.filter((o) => imZeitfenster(o.due_date, zeit))
    return [...list].sort(sortierer(sortierung, tab))
  }, [orders, tab, art, filter, zeit, sortierung])

  const aktiveFilter = Object.values(filter).filter(Boolean).length

  function csv() {
    const min = (sek) => String(Math.round((sek / 60) * 10) / 10).replace('.', ',')
    exportCsv(`auftraege-${tab}-${new Date().toISOString().slice(0, 10)}`, gefiltert.map((o) => ({
      Auftragsnummer: o.order_no,
      Art: o.kind === 'planmaessig' ? 'Planmäßig' : 'Unplanmäßig',
      Bezeichnung: o.title,
      Abteilung: o.rooms?.departments?.name,
      Raum: o.rooms?.name,
      Maschine: o.machines?.name || '',
      Status: STATUS[o.status].label,
      Priorität: PRIORITY[o.priority].label,
      Maschinenstatus: o.machine_status === 'stillstand' ? 'Stillstand' : 'In Betrieb',
      'Grund der Störung': o.kind === 'unplanmaessig' ? grundText(o) : '',
      'Ausfallzeit (Min.)': min(effektiveAusfallzeit(o) * 3600),
      'Reparatur Start': o.work_first_started_at ? fmtDateTime(o.work_first_started_at) : '',
      'Reparatur Ende': o.work_ended_at ? fmtDateTime(o.work_ended_at) : '',
      'Reparaturdauer (Min.)': min(arbeitsSekunden(o)),
      'Getauschte Ersatzteile': (o.replaced_parts || []).join(' | '),
      Zyklus: o.cycle ? CYCLES[o.cycle].label : '',
      Fällig: o.due_date || '',
      Ersteller: o.ersteller?.full_name || '',
      Erstellt: fmtDate(o.created_at),
      Beanstandungen: o.rejected_count
    })))
  }

  if (!orders || !struktur.geladen) return <Spinner text="Aufträge werden geladen" />

  const zaehle = (key) => key === 'archiv'
    ? orders.filter((o) => o.status === 'abgeschlossen').length
    : orders.filter((o) => imTab(o, key, art)).length
  const zaehleArchiv = (a) => orders.filter((o) => imTab(o, 'archiv', a)).length

  const liste = (items) => (
    <ul className="space-y-2">
      {items.map((o) => <Zeile key={o.id} o={o} onClick={() => navigate(`/auftraege/${o.id}`)} />)}
    </ul>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Aufträge</h1>
        {tab !== 'abnahme' && (
          <button onClick={csv} disabled={!gefiltert.length} className="btn-ghost !min-h-[42px] text-[13px]">
            <Download className="h-4 w-4" /> CSV
          </button>
        )}
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist">
        {TABS.map((t) => {
          const aktiv = tab === t.key
          const anzahl = zaehle(t.key)
          return (
            <button key={t.key} role="tab" aria-selected={aktiv} onClick={() => setParams({ tab: t.key })}
              className={`flex min-h-[48px] shrink-0 items-center gap-2 rounded-card px-4 text-[13px] font-semibold
                          ${aktiv ? 'bg-ink text-white' : 'border border-black/10 bg-white text-steel'}`}>
              <t.icon className="h-4 w-4" /> {t.label}
              <span className={`num rounded-full px-2 py-0.5 text-[12px]
                                ${aktiv ? 'bg-white/20' : (t.key === 'abnahme' && anzahl > 0) ? 'bg-signal text-ink' : 'bg-hall'}`}>
                {anzahl}
              </span>
            </button>
          )
        })}
      </div>

      {tab === 'archiv' && (
        <div className="grid grid-cols-2 gap-2 rounded-card border border-black/[0.08] bg-white p-1">
          {[['geplant', 'Geplante Wartungen'], ['ungeplant', 'Ungeplante Störungen']].map(([k, l]) => (
            <button key={k} onClick={() => setParams({ tab: 'archiv', art: k })}
              className={`flex min-h-[48px] items-center justify-center gap-2 rounded-card text-[13px] font-semibold
                          ${art === k ? 'bg-signal text-ink' : 'text-steel hover:bg-hall'}`}>
              {l}
              <span className="num rounded-full bg-black/10 px-2 py-0.5 text-[12px]">{zaehleArchiv(k)}</span>
            </button>
          ))}
        </div>
      )}

      {tab === 'wartungen' && (
        <div>
          <label className="label">Vorschau-Zeitraum</label>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {Object.entries(ZEITFILTER).map(([k, v]) => (
              <button key={k} onClick={() => setZeit(k)}
                className={`min-h-[40px] shrink-0 rounded-full px-4 text-[13px] font-semibold
                            ${zeit === k ? 'bg-signal text-ink' : 'border border-black/10 bg-white text-steel'}`}>
                {v.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={() => setFilterOffen(true)} className="btn-ghost flex-1 !min-h-[44px] text-[13px]">
          <Filter className="h-4 w-4" /> Filter{aktiveFilter ? ` (${aktiveFilter})` : ''}
        </button>
        <select value={sortierung} onChange={(e) => setSortierung(e.target.value)}
                className="field !min-h-[44px] flex-1 text-[13px]" aria-label="Sortierung">
          <option value="standard">Standard</option>
          <option value="neueste">Neueste zuerst</option>
          <option value="aelteste">Älteste zuerst</option>
          <option value="faellig">Fälligkeit</option>
          <option value="ausfall">Ausfallzeit</option>
        </select>
      </div>

      <Fehler text={fehler} />

      {tab === 'abnahme' ? (
        <AbnahmeListe auftraege={gefiltert} onGeaendert={laden} />
      ) : tab === 'offen' ? (
        <div className="space-y-5">
          {[['unplanmaessig', 'Unplanmäßige Aufträge', 'Störung'], ['planmaessig', 'Planmäßige Aufträge', 'Wartung']].map(([k, titel, wort]) => {
            const teil = gefiltert.filter((o) => o.kind === k)
            return (
              <section key={k}>
                <h2 className="mb-2 flex items-center gap-2 font-semibold">
                  {titel}
                  <span className="num rounded-full bg-hall px-2 py-0.5 text-[12px] text-steel">{teil.length}</span>
                </h2>
                {teil.length === 0
                  ? <p className="card p-4 text-sm text-steel">Keine offene {wort}.</p>
                  : liste(teil)}
              </section>
            )
          })}
        </div>
      ) : gefiltert.length === 0 ? (
        <Empty title={leerTitel(tab)}
               hint={(aktiveFilter || (tab === 'wartungen' && zeit !== 'alle'))
                 ? 'Filter oder Zeitraum schränken die Liste ein.'
                 : 'Neue Aufträge legen Sie unten rechts an.'}
               action={(aktiveFilter || (tab === 'wartungen' && zeit !== 'alle'))
                 ? <button onClick={() => { setFilter(LEER); setZeit('alle') }} className="btn-ghost">Zurücksetzen</button>
                 : null} />
      ) : liste(gefiltert)}

      {tab !== 'archiv' && tab !== 'abnahme' && (
        <FabNeu onClick={() => setNeuOffen(true)} label="Auftrag anlegen" />
      )}

      <FilterDialog open={filterOffen} onClose={() => setFilterOffen(false)}
                    filter={filter} setFilter={setFilter} struktur={struktur} />
      <NeuerAuftrag open={neuOffen} onClose={() => setNeuOffen(false)} struktur={struktur}
                    vorgabeKind={tab === 'wartungen' ? 'planmaessig' : 'unplanmaessig'}
                    user={user}
                    onSaved={(id) => { setNeuOffen(false); navigate(`/auftraege/${id}`) }} />
    </div>
  )
}

function leerTitel(tab) {
  return {
    bearbeitung: 'Aktuell ist kein Auftrag in Bearbeitung',
    stoerungen: 'Keine offenen Störungen',
    wartungen: 'Keine offenen Wartungen',
    archiv: 'Noch keine abgeschlossenen Aufträge in dieser Kategorie'
  }[tab] || 'Keine Aufträge in dieser Ansicht'
}

function sortierer(sortierung, tab) {
  const abschluss = (o) => o.approved_at || o.completed_at || o.created_at
  const standard = (tab === 'archiv' || tab === 'abnahme')
    ? (a, b) => abschluss(b).localeCompare(abschluss(a))
    : (a, b) => ((PRIORITY[b.priority]?.rank || 0) - (PRIORITY[a.priority]?.rank || 0))
        || b.created_at.localeCompare(a.created_at)
  return {
    standard,
    neueste:  (a, b) => b.created_at.localeCompare(a.created_at),
    aelteste: (a, b) => a.created_at.localeCompare(b.created_at),
    faellig:  (a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'),
    ausfall:  (a, b) => effektiveAusfallzeit(b) - effektiveAusfallzeit(a)
  }[sortierung] || standard
}

export function Zeile({ o, onClick }) {
  const ausfall = effektiveAusfallzeit(o)
  const stillstand = o.machine_status === 'stillstand' && o.status !== 'abgeschlossen'
  const laeuft = arbeitLaeuft(o)
  const arbeit = arbeitsSekunden(o)
  return (
    <li>
      <button onClick={onClick} className="card flex w-full items-center gap-3 p-4 text-left hover:border-ink/20">
        <span className={`h-12 w-1.5 shrink-0 rounded-full ${rand(o)}`} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="num text-[12px] text-steel">#{o.order_no}</span>
            <StatusBadge status={o.status} />
            <PriorityBadge priority={o.priority} />
            <span className="rounded bg-hall px-2 py-0.5 text-[12px] text-steel">
              {o.kind === 'planmaessig' ? 'Wartung' : 'Störung'}
            </span>
            {o.rejected_count > 0 && (
              <span className="rounded bg-stop/10 px-2 py-0.5 text-[12px] font-semibold text-stop">
                {o.rejected_count}× beanstandet
              </span>
            )}
          </span>
          <span className="mt-1 block truncate font-semibold">{o.title}</span>
          <span className="block truncate text-[13px] text-steel">
            {o.rooms?.departments?.name} · {o.rooms?.name}{o.machines?.name ? ` · ${o.machines.name}` : ''}
          </span>
          <span className="mt-1 flex flex-wrap gap-x-3 text-[12px] text-steel">
            {o.due_date && (
              <span className={isOverdue(o.due_date) && o.status !== 'abgeschlossen' ? 'font-semibold text-stop' : ''}>
                Fällig {fmtDate(o.due_date)}
              </span>
            )}
            {ausfall > 0 && (
              <span className={stillstand ? 'font-semibold text-stop' : ''}>
                {stillstand && <Timer className="mr-0.5 inline h-3 w-3" />}
                Ausfall {fmtHours(ausfall)}{stillstand ? ' (läuft)' : ''}
              </span>
            )}
            {laeuft && (
              <span className="font-semibold text-run">
                In Arbeit seit {fmtTime(o.work_started_at)}{o.starter?.full_name ? ` · ${o.starter.full_name}` : ''}
              </span>
            )}
            {!laeuft && arbeit > 0 && <span>Reparatur {fmtDauer(arbeit)}</span>}
            <span>Erstellt {fmtDate(o.created_at)}</span>
          </span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-steel" />
      </button>
    </li>
  )
}

function rand(o) {
  if (o.status === 'abgeschlossen') return 'bg-done'
  if (o.machine_status === 'stillstand') return 'bg-stop'
  if (o.status === 'fertig_zur_abnahme') return 'bg-signal'
  if (o.status === 'in_bearbeitung') return 'bg-run'
  return o.priority === 'kritisch' ? 'bg-stop' : 'bg-steel/40'
}

function FilterDialog({ open, onClose, filter, setFilter, struktur }) {
  const set = (k) => (e) => setFilter({ ...filter, [k]: e.target.value })
  const raeume = struktur.rooms.filter((r) => !filter.department_id || r.department_id === filter.department_id)
  return (
    <Modal open={open} onClose={onClose} title="Filter">
      <div className="space-y-4">
        <div>
          <label className="label">Abteilung</label>
          <select className="field" value={filter.department_id}
                  onChange={(e) => setFilter({ ...filter, department_id: e.target.value, room_id: '' })}>
            <option value="">Alle Abteilungen</option>
            {struktur.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Raum</label>
          <select className="field" value={filter.room_id} onChange={set('room_id')}>
            <option value="">Alle Räume</option>
            {raeume.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Priorität</label>
          <select className="field" value={filter.priority} onChange={set('priority')}>
            <option value="">Alle Prioritäten</option>
            {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Datum von</label>
            <input type="date" className="field" value={filter.von} onChange={set('von')} /></div>
          <div><label className="label">Datum bis</label>
            <input type="date" className="field" value={filter.bis} onChange={set('bis')} /></div>
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={() => setFilter(LEER)} className="btn-ghost flex-1">Zurücksetzen</button>
          <button onClick={onClose} className="btn-primary flex-1">Anwenden</button>
        </div>
      </div>
    </Modal>
  )
}

function NeuerAuftrag({ open, onClose, struktur, vorgabeKind, user, onSaved }) {
  const leerForm = { description: '', priority: 'mittel', machine_status: 'in_betrieb', fault_cause: '', fault_reason: '', cycle: '', due_date: '' }
  const [kind, setKind] = useState(vorgabeKind)
  const [objekt, setObjekt] = useState({ department_id: '', room_id: '', machine_id: '' })
  const [form, setForm] = useState(leerForm)
  const [checkliste, setCheckliste] = useState([])
  const [neuerPunkt, setNeuerPunkt] = useState('')
  const [busy, setBusy] = useState(false)
  const [fehler, setFehler] = useState(null)

  useEffect(() => { setKind(vorgabeKind) }, [vorgabeKind, open])

  // Checkliste der gewählten Maschine laden, für diesen Auftrag anpassbar
  useEffect(() => {
    if (kind !== 'planmaessig' || !objekt.machine_id) { setCheckliste([]); return }
    supabase.from('machine_checklists').select('label,position')
      .eq('machine_id', objekt.machine_id).order('position')
      .then(({ data }) => setCheckliste((data ?? []).map((c) => c.label)))
  }, [kind, objekt.machine_id])

  // Zyklus der Maschine vorschlagen
  useEffect(() => {
    if (kind !== 'planmaessig' || !objekt.machine_id) return
    const m = struktur.machines.find((x) => x.id === objekt.machine_id)
    if (m?.cycle) setForm((f) => ({ ...f, cycle: f.cycle || m.cycle }))
  }, [kind, objekt.machine_id, struktur.machines])

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const titelVorschau = objekt.room_id ? autoTitel(objektName(struktur, objekt)) : '–'

  async function speichern() {
    if (!objekt.room_id) return setFehler('Bitte Abteilung und Raum auswählen.')
    if (kind === 'unplanmaessig' && form.machine_status === 'stillstand' && !form.fault_cause) {
      return setFehler('Bei Stillstand ist der Grund der Störung verpflichtend.')
    }
    setBusy(true); setFehler(null)

    const unplan = kind === 'unplanmaessig'
    const { data, error } = await supabase.from('work_orders').insert({
      kind,
      title: autoTitel(objektName(struktur, objekt)),   // automatisch erzeugt
      description: form.description.trim() || null,
      priority: form.priority,
      room_id: objekt.room_id,
      machine_id: objekt.machine_id || null,
      machine_status: unplan ? form.machine_status : 'in_betrieb',
      fault_cause: unplan ? (form.fault_cause || null) : null,
      fault_reason: unplan ? (form.fault_reason.trim() || null) : null,
      cycle: kind === 'planmaessig' ? (form.cycle || null) : null,
      due_date: form.due_date || null,
      created_by: user.id                                // Ersteller automatisch
    }).select('id').single()

    if (error) { setBusy(false); return setFehler(fehlerText(error)) }

    if (kind === 'planmaessig' && checkliste.length) {
      const ci = await supabase.from('checklist_items').insert(
        checkliste.map((label, i) => ({ order_id: data.id, label, position: i })))
      if (ci.error) console.warn('Checkliste konnte nicht angelegt werden:', ci.error.message)
    }
    setBusy(false)
    setObjekt({ department_id: '', room_id: '', machine_id: '' })
    setForm(leerForm)
    onSaved(data.id)
  }

  return (
    <Modal open={open} onClose={onClose} title="Auftrag anlegen" wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {[['unplanmaessig', 'Störung'], ['planmaessig', 'Wartung']].map(([k, l]) => (
            <button key={k} onClick={() => setKind(k)}
              className={`min-h-[48px] rounded-card text-sm font-semibold
                          ${kind === k ? 'bg-ink text-white' : 'bg-hall text-steel'}`}>{l}</button>
          ))}
        </div>

        <Objektwahl struktur={struktur} wert={objekt} onChange={setObjekt}
                    maschinePflicht={kind === 'planmaessig'} />

        <p className="rounded-card bg-hall px-3 py-2 text-[13px] text-steel">
          Bezeichnung wird automatisch vergeben: <span className="font-semibold text-ink">{titelVorschau}</span>
          <br />Ersteller und Zeitpunkt werden ebenfalls automatisch gesetzt.
        </p>

        <div>
          <label className="label">Beschreibung</label>
          <textarea className="field min-h-[96px] py-2" value={form.description} onChange={set('description')}
                    placeholder={kind === 'planmaessig' ? 'Besonderheiten zur Wartung' : 'Was ist aufgefallen?'} />
        </div>

        {kind === 'unplanmaessig' && (
          <div className="space-y-3 rounded-card border border-black/10 p-3">
            <div>
              <label className="label">Maschinenstatus</label>
              <div className="grid grid-cols-2 gap-2">
                {[['in_betrieb', 'In Betrieb'], ['stillstand', 'Stillstand']].map(([k, l]) => (
                  <button key={k} onClick={() => setForm({ ...form, machine_status: k })}
                    className={`min-h-[48px] rounded-card text-sm font-semibold
                                ${form.machine_status === k
                                  ? (k === 'stillstand' ? 'bg-stop text-white' : 'bg-done text-white')
                                  : 'bg-hall text-steel'}`}>{l}</button>
                ))}
              </div>
            </div>

            <div>
              <label className="label">
                Grund der Störung {form.machine_status === 'stillstand'
                  ? <span className="font-normal text-stop">(Pflicht bei Stillstand)</span>
                  : <span className="font-normal">(optional)</span>}
              </label>
              <GrundSelect value={form.fault_cause} onChange={(v) => setForm({ ...form, fault_cause: v })} />
            </div>

            {form.fault_cause && (
              <div>
                <label className="label">Erläuterung zum Grund (optional)</label>
                <input className="field" value={form.fault_reason} onChange={set('fault_reason')}
                       placeholder="z. B. Sicherung F3 durchgebrannt" />
              </div>
            )}

            {form.machine_status === 'stillstand' && (
              <p className="text-[12px] text-stop">
                Die Ausfallzeit läuft ab dem Anlegen dieses Auftrags und stoppt, sobald die Maschine
                wieder als „In Betrieb“ gemeldet wird.
              </p>
            )}
          </div>
        )}

        {kind === 'planmaessig' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Wartungszyklus</label>
                <select className="field" value={form.cycle} onChange={set('cycle')}>
                  <option value="">Einmalig</option>
                  {Object.entries(CYCLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Fällig am</label>
                <input type="date" className="field" value={form.due_date} onChange={set('due_date')} />
              </div>
            </div>

            <div>
              <label className="label">Checkliste für diesen Auftrag</label>
              {checkliste.length === 0 && (
                <p className="mb-2 text-[13px] text-steel">
                  {objekt.machine_id
                    ? 'Für diese Maschine ist noch keine Wartungsvorlage hinterlegt. Punkte lassen sich hier direkt ergänzen.'
                    : 'Nach Auswahl der Maschine erscheint deren Wartungsvorlage.'}
                </p>
              )}
              <ul className="space-y-1.5">
                {checkliste.map((c, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-card bg-hall px-3 py-2">
                    <input className="flex-1 bg-transparent text-[14px] outline-none" value={c}
                           onChange={(e) => setCheckliste(checkliste.map((x, j) => j === i ? e.target.value : x))} />
                    <button onClick={() => setCheckliste(checkliste.filter((_, j) => j !== i))}
                            className="text-[13px] font-semibold text-stop">Entfernen</button>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex gap-2">
                <input className="field flex-1" value={neuerPunkt} onChange={(e) => setNeuerPunkt(e.target.value)}
                       placeholder="Weitere Maßnahme"
                       onKeyDown={(e) => {
                         if (e.key === 'Enter' && neuerPunkt.trim()) {
                           setCheckliste([...checkliste, neuerPunkt.trim()]); setNeuerPunkt('')
                         }
                       }} />
                <button onClick={() => { if (neuerPunkt.trim()) { setCheckliste([...checkliste, neuerPunkt.trim()]); setNeuerPunkt('') } }}
                        className="btn-ghost">Hinzufügen</button>
              </div>
            </div>
          </>
        )}

        <div>
          <label className="label">Priorität</label>
          <select className="field" value={form.priority} onChange={set('priority')}>
            {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>

        <Fehler text={fehler} />
        <button onClick={speichern} disabled={busy} className="btn-signal w-full">
          {busy ? 'Wird angelegt' : 'Auftrag anlegen'}
        </button>
      </div>
    </Modal>
  )
}
