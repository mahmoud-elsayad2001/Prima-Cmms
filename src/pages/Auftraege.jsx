import { useEffect, useMemo, useState, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Filter, Download, CalendarClock, AlertTriangle, ChevronRight, Archive, Timer } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import {
  STATUS, PRIORITY, CYCLES, CAUSES, ZEITFILTER, imZeitfenster,
  fmtDate, fmtHours, isOverdue, autoTitel, effektiveAusfallzeit
} from '../lib/domain'
import { exportCsv } from '../lib/csv'
import { Spinner, StatusBadge, PriorityBadge, Empty, Modal, Fehler } from '../components/ui'
import { FabNeu } from '../components/Layout'
import Objektwahl, { useStruktur, objektName } from '../components/Objektwahl'

const LEER = { department_id: '', room_id: '', priority: '', status: '', von: '', bis: '' }

export default function Auftraege() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const struktur = useStruktur()
  const [params, setParams] = useSearchParams()

  const tab = ['planmaessig', 'unplanmaessig', 'archiv'].includes(params.get('tab'))
    ? params.get('tab') : 'unplanmaessig'
  const statusFilter = params.get('status') || ''

  const [orders, setOrders] = useState(null)
  const [filter, setFilter] = useState({ ...LEER, status: statusFilter })
  const [zeit, setZeit] = useState('alle')
  const [sortierung, setSortierung] = useState('prioritaet')
  const [filterOffen, setFilterOffen] = useState(false)
  const [neuOffen, setNeuOffen] = useState(false)
  const [fehler, setFehler] = useState(null)

  useEffect(() => { setFilter((f) => ({ ...f, status: statusFilter })) }, [statusFilter])

  const laden = useCallback(async () => {
    const { data, error } = await supabase.from('work_orders')
      .select('*, machines(id,name), rooms(id,name,department_id,departments(name)), ersteller:created_by(full_name), fertig:completed_by(full_name)')
      .order('created_at', { ascending: false })
    if (error) setFehler(error.message)
    setOrders(data ?? [])
  }, [])
  useEffect(() => { laden() }, [laden])

  const gefiltert = useMemo(() => {
    if (!orders) return []
    let list = tab === 'archiv'
      ? orders.filter((o) => o.status === 'abgeschlossen')
      : orders.filter((o) => o.kind === tab && o.status !== 'abgeschlossen')

    if (filter.department_id) list = list.filter((o) => o.rooms?.department_id === filter.department_id)
    if (filter.room_id)       list = list.filter((o) => o.room_id === filter.room_id)
    if (filter.status)        list = list.filter((o) => o.status === filter.status)
    if (filter.priority)      list = list.filter((o) => o.priority === filter.priority)
    if (filter.von)           list = list.filter((o) => (o.repair_date || o.created_at.slice(0, 10)) >= filter.von)
    if (filter.bis)           list = list.filter((o) => (o.repair_date || o.created_at.slice(0, 10)) <= filter.bis)
    if (tab === 'planmaessig') list = list.filter((o) => imZeitfenster(o.due_date, zeit))

    const sort = {
      prioritaet: (a, b) => (PRIORITY[b.priority].rank - PRIORITY[a.priority].rank) || b.created_at.localeCompare(a.created_at),
      neueste:  (a, b) => b.created_at.localeCompare(a.created_at),
      aelteste: (a, b) => a.created_at.localeCompare(b.created_at),
      faellig:  (a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'),
      ausfall:  (a, b) => effektiveAusfallzeit(b) - effektiveAusfallzeit(a)
    }[sortierung]
    return [...list].sort(sort)
  }, [orders, tab, filter, zeit, sortierung])

  const aktiveFilter = Object.values(filter).filter(Boolean).length

  function csv() {
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
      Störungsgrund: o.fault_reason || '',
      'Ausfallzeit (h)': String(o.downtime_hours).replace('.', ','),
      Zyklus: o.cycle ? CYCLES[o.cycle].label : '',
      Fällig: o.due_date || '',
      Ersteller: o.ersteller?.full_name || '',
      Erstellt: fmtDate(o.created_at),
      Beanstandungen: o.rejected_count
    })))
  }

  if (!orders || !struktur.geladen) return <Spinner text="Aufträge werden geladen" />

  const zaehle = (k) => orders.filter((o) =>
    k === 'archiv' ? o.status === 'abgeschlossen' : o.kind === k && o.status !== 'abgeschlossen').length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Aufträge</h1>
        <button onClick={csv} disabled={!gefiltert.length} className="btn-ghost !min-h-[42px] text-[13px]">
          <Download className="h-4 w-4" /> CSV
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 rounded-card border border-black/[0.08] bg-white p-1">
        {[
          { key: 'unplanmaessig', label: 'Störungen', icon: AlertTriangle },
          { key: 'planmaessig',   label: 'Wartungen', icon: CalendarClock },
          { key: 'archiv',        label: 'Archiv',    icon: Archive }
        ].map((t) => {
          const aktiv = tab === t.key
          return (
            <button key={t.key} onClick={() => setParams({ tab: t.key })}
              className={`flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-card text-[13px] font-semibold
                          ${aktiv ? 'bg-ink text-white' : 'text-steel hover:bg-hall'}`}>
              <span className="flex items-center gap-1.5"><t.icon className="h-4 w-4" /> {t.label}</span>
              <span className="num text-[11px] opacity-70">{zaehle(t.key)}</span>
            </button>
          )
        })}
      </div>

      {tab === 'planmaessig' && (
        <div>
          <label className="label">Vorschau-Zeitraum</label>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {Object.entries(ZEITFILTER).map(([k, v]) => (
              <button key={k} onClick={() => setZeit(k)}
                className={`min-h-[40px] shrink-0 rounded-full px-4 text-[13px] font-semibold
                            ${zeit === k ? 'bg-signal text-ink' : 'bg-white text-steel border border-black/10'}`}>
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
          <option value="prioritaet">Priorität</option>
          <option value="neueste">Neueste zuerst</option>
          <option value="aelteste">Älteste zuerst</option>
          <option value="faellig">Fälligkeit</option>
          <option value="ausfall">Ausfallzeit</option>
        </select>
      </div>

      <Fehler text={fehler} />

      {gefiltert.length === 0 ? (
        <Empty title="Keine Aufträge in dieser Ansicht"
               hint={aktiveFilter || zeit !== 'alle'
                 ? 'Filter oder Zeitraum schränken die Liste ein.'
                 : 'Neue Aufträge legen Sie unten rechts an.'}
               action={(aktiveFilter || zeit !== 'alle')
                 ? <button onClick={() => { setFilter(LEER); setZeit('alle') }} className="btn-ghost">Zurücksetzen</button>
                 : null} />
      ) : (
        <ul className="space-y-2">
          {gefiltert.map((o) => <Zeile key={o.id} o={o} onClick={() => navigate(`/auftraege/${o.id}`)} />)}
        </ul>
      )}

      {tab !== 'archiv' && <FabNeu onClick={() => setNeuOffen(true)} label="Auftrag anlegen" />}

      <FilterDialog open={filterOffen} onClose={() => setFilterOffen(false)}
                    filter={filter} setFilter={setFilter} struktur={struktur} />
      <NeuerAuftrag open={neuOffen} onClose={() => setNeuOffen(false)} struktur={struktur}
                    vorgabeKind={tab === 'planmaessig' ? 'planmaessig' : 'unplanmaessig'}
                    user={user}
                    onSaved={(id) => { setNeuOffen(false); laden(); navigate(`/auftraege/${id}`) }} />
    </div>
  )
}

export function Zeile({ o, onClick }) {
  const ausfall = effektiveAusfallzeit(o)
  const laeuft = o.machine_status === 'stillstand'
  return (
    <li>
      <button onClick={onClick} className="card flex w-full items-center gap-3 p-4 text-left hover:border-ink/20">
        <span className={`h-12 w-1.5 shrink-0 rounded-full ${rand(o)}`} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="num text-[12px] text-steel">#{o.order_no}</span>
            <StatusBadge status={o.status} />
            <PriorityBadge priority={o.priority} />
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
          <span className="mt-1 block text-[12px] text-steel">
            {o.due_date && (
              <span className={isOverdue(o.due_date) ? 'font-semibold text-stop' : ''}>
                Fällig {fmtDate(o.due_date)} · </span>
            )}
            {ausfall > 0 && (
              <span className={laeuft ? 'font-semibold text-stop' : ''}>
                {laeuft && <Timer className="mr-0.5 inline h-3 w-3" />}
                Ausfall {fmtHours(ausfall)}{laeuft ? ' (läuft)' : ''} · </span>
            )}
            Erstellt {fmtDate(o.created_at)}
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
          <label className="label">Status</label>
          <select className="field" value={filter.status} onChange={set('status')}>
            <option value="">Alle Status</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
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
  const [kind, setKind] = useState(vorgabeKind)
  const [objekt, setObjekt] = useState({ department_id: '', room_id: '', machine_id: '' })
  const [form, setForm] = useState({
    description: '', priority: 'mittel', machine_status: 'in_betrieb',
    fault_reason: '', cycle: '', due_date: ''
  })
  const [checkliste, setCheckliste] = useState([])
  const [neuerPunkt, setNeuerPunkt] = useState('')
  const [busy, setBusy] = useState(false)
  const [fehler, setFehler] = useState(null)

  useEffect(() => { setKind(vorgabeKind) }, [vorgabeKind, open])

  // Checkliste der gewählten Maschine laden, für diesen Auftrag anpassbar
  useEffect(() => {
    if (kind !== 'planmaessig' || !objekt.machine_id) return setCheckliste([])
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
    if (kind === 'unplanmaessig' && form.machine_status === 'stillstand' && !form.fault_reason.trim()) {
      return setFehler('Bei Stillstand ist ein Störungsgrund verpflichtend.')
    }
    setBusy(true); setFehler(null)

    const { data, error } = await supabase.from('work_orders').insert({
      kind,
      title: autoTitel(objektName(struktur, objekt)),   // automatisch erzeugt
      description: form.description.trim() || null,
      priority: form.priority,
      room_id: objekt.room_id,
      machine_id: objekt.machine_id || null,
      machine_status: kind === 'unplanmaessig' ? form.machine_status : 'in_betrieb',
      fault_reason: form.machine_status === 'stillstand' ? form.fault_reason.trim() : null,
      cycle: kind === 'planmaessig' ? (form.cycle || null) : null,
      due_date: form.due_date || null,
      created_by: user.id                                // Ersteller automatisch
    }).select('id').single()

    if (error) { setBusy(false); return setFehler(uebersetze(error.message)) }

    if (kind === 'planmaessig' && checkliste.length) {
      await supabase.from('checklist_items').insert(
        checkliste.map((label, i) => ({ order_id: data.id, label, position: i })))
    }
    setBusy(false)
    setObjekt({ department_id: '', room_id: '', machine_id: '' })
    setForm({ description: '', priority: 'mittel', machine_status: 'in_betrieb', fault_reason: '', cycle: '', due_date: '' })
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
          <div className="rounded-card border border-black/10 p-3">
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
            {form.machine_status === 'stillstand' && (
              <div className="mt-3">
                <label className="label">Störungsgrund (Pflicht)</label>
                <input list="ursachen" className="field" value={form.fault_reason}
                       onChange={set('fault_reason')} placeholder="z. B. Lagerschaden" />
                <datalist id="ursachen">{CAUSES.map((c) => <option key={c} value={c} />)}</datalist>
                <p className="mt-1.5 text-[12px] text-stop">
                  Die Ausfallzeit läuft ab dem Anlegen dieses Auftrags und stoppt, sobald die Maschine
                  wieder als „In Betrieb“ gemeldet wird.
                </p>
              </div>
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

function uebersetze(m = '') {
  if (/stillstand_braucht_grund/.test(m)) return 'Bei Stillstand ist ein Störungsgrund verpflichtend.'
  return m
}
