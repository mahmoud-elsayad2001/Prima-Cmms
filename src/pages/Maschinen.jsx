import { useEffect, useMemo, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Download, ChevronRight, Building2, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { CYCLES, fmtDate, isOverdue } from '../lib/domain'
import { exportCsv } from '../lib/csv'
import { Spinner, Empty, Modal, Fehler } from '../components/ui'
import { FabNeu } from '../components/Layout'
import { useStruktur } from '../components/Objektwahl'

export default function Maschinen() {
  const navigate = useNavigate()
  const struktur = useStruktur()
  const [liste, setListe] = useState(null)
  const [suche, setSuche] = useState('')
  const [abteilung, setAbteilung] = useState('')
  const [neuOffen, setNeuOffen] = useState(false)
  const [strukturOffen, setStrukturOffen] = useState(false)
  const [fehler, setFehler] = useState(null)

  const laden = useCallback(async () => {
    const { data, error } = await supabase.from('machines_due').select('*').order('name')
    if (error) setFehler(error.message)
    setListe(data ?? [])
  }, [])
  useEffect(() => { laden() }, [laden])

  const gefiltert = useMemo(() => {
    const q = suche.trim().toLowerCase()
    return (liste ?? []).filter((m) => {
      if (abteilung && m.department_id !== abteilung) return false
      if (!q) return true
      return [m.name, m.room_name, m.department_name, m.manufacturer]
        .filter(Boolean).some((v) => v.toLowerCase().includes(q))
    })
  }, [liste, suche, abteilung])

  function csv() {
    exportCsv(`maschinen-${new Date().toISOString().slice(0, 10)}`, gefiltert.map((m) => ({
      Name: m.name,
      Abteilung: m.department_name,
      Raum: m.room_name,
      Hersteller: m.manufacturer || '',
      Wartungszyklus: m.cycle ? CYCLES[m.cycle].label : '',
      'Letzte Wartung': m.last_maintenance || '',
      'Nächste Fälligkeit': m.next_due || '',
      Ersatzteile: (m.spare_parts || []).join(' | ')
    })))
  }

  if (!liste || !struktur.geladen) return <Spinner text="Maschinen werden geladen" />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Maschinen</h1>
        <div className="flex gap-2">
          <button onClick={() => setStrukturOffen(true)} className="btn-ghost !min-h-[42px] text-[13px]">
            <Building2 className="h-4 w-4" /> Struktur
          </button>
          <button onClick={csv} disabled={!gefiltert.length} className="btn-ghost !min-h-[42px] text-[13px]">
            <Download className="h-4 w-4" /> CSV
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel" />
          <input className="field pl-9" value={suche} onChange={(e) => setSuche(e.target.value)}
                 placeholder="Name, Raum, Hersteller" aria-label="Maschinen durchsuchen" />
        </div>
        <select className="field w-[45%] sm:w-52" value={abteilung}
                onChange={(e) => setAbteilung(e.target.value)} aria-label="Abteilung">
          <option value="">Alle Abteilungen</option>
          {struktur.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      <Fehler text={fehler} />

      {gefiltert.length === 0 ? (
        <Empty title="Keine Maschine gefunden"
               hint={struktur.departments.length === 0
                 ? 'Legen Sie zuerst über „Struktur“ eine Abteilung und einen Raum an.'
                 : 'Neue Maschinen legen Sie unten rechts an.'} />
      ) : (
        <ul className="space-y-2">
          {gefiltert.map((m) => (
            <li key={m.id}>
              <button onClick={() => navigate(`/maschinen/${m.id}`)}
                      className="card flex w-full items-center gap-3 p-4 text-left hover:border-ink/20">
                <span className="num flex h-11 w-11 shrink-0 items-center justify-center rounded-card bg-ink text-[13px] font-bold text-white">
                  {m.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{m.name}</span>
                  <span className="block truncate text-[13px] text-steel">{m.department_name} · {m.room_name}</span>
                  {m.cycle && <span className="block text-[12px] text-steel">{CYCLES[m.cycle].label}</span>}
                </span>
                {m.next_due && (
                  <span className="shrink-0 text-right text-[12px]">
                    <span className={`num block font-semibold ${isOverdue(m.next_due) ? 'text-stop' : 'text-steel'}`}>
                      {fmtDate(m.next_due)}
                    </span>
                    <span className="block text-steel">{isOverdue(m.next_due) ? 'überfällig' : 'fällig'}</span>
                  </span>
                )}
                <ChevronRight className="h-5 w-5 shrink-0 text-steel" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <FabNeu onClick={() => setNeuOffen(true)} label="Maschine anlegen" />

      <MaschineForm open={neuOffen} onClose={() => setNeuOffen(false)} struktur={struktur}
                    onSaved={(id) => { setNeuOffen(false); laden(); navigate(`/maschinen/${id}`) }} />
      <StrukturDialog open={strukturOffen} onClose={() => { setStrukturOffen(false); struktur.neuLaden(); laden() }}
                      struktur={struktur} />
    </div>
  )
}

/** Anlegen und Bearbeiten – ohne Inventarnummer, der Name genügt. */
export function MaschineForm({ open, onClose, onSaved, struktur, vorgabe }) {
  const leer = { room_id: '', name: '', manufacturer: '', cycle: '', last_maintenance: '', spare_parts: '', notes: '' }
  const [form, setForm] = useState(leer)
  const [abteilung, setAbteilung] = useState('')
  const [busy, setBusy] = useState(false)
  const [fehler, setFehler] = useState(null)

  useEffect(() => {
    if (!open) return
    if (vorgabe) {
      setForm({
        room_id: vorgabe.room_id, name: vorgabe.name, manufacturer: vorgabe.manufacturer || '',
        cycle: vorgabe.cycle || '', last_maintenance: vorgabe.last_maintenance || '',
        spare_parts: (vorgabe.spare_parts || []).join(', '), notes: vorgabe.notes || ''
      })
      setAbteilung(vorgabe.department_id || '')
    } else { setForm(leer); setAbteilung('') }
  }, [open, vorgabe])

  const raeume = struktur.rooms.filter((r) => r.department_id === abteilung)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  async function speichern() {
    if (!form.name.trim()) return setFehler('Bitte einen Maschinennamen angeben.')
    if (!form.room_id) return setFehler('Bitte Abteilung und Raum auswählen.')
    setBusy(true); setFehler(null)
    const daten = {
      room_id: form.room_id,
      name: form.name.trim(),
      manufacturer: form.manufacturer.trim() || null,
      cycle: form.cycle || null,
      last_maintenance: form.last_maintenance || null,
      spare_parts: form.spare_parts.split(',').map((s) => s.trim()).filter(Boolean),
      notes: form.notes.trim() || null
    }
    const { data, error } = vorgabe
      ? await supabase.from('machines').update(daten).eq('id', vorgabe.id).select('id').single()
      : await supabase.from('machines').insert(daten).select('id').single()
    setBusy(false)
    if (error) return setFehler(error.message)
    onSaved(data.id)
  }

  return (
    <Modal open={open} onClose={onClose} title={vorgabe ? 'Maschine bearbeiten' : 'Maschine anlegen'}>
      <div className="space-y-3">
        <div>
          <label className="label">Maschinenname</label>
          <input className="field" value={form.name} onChange={set('name')} placeholder="z. B. CNC-Fräse 01" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Abteilung</label>
            <select className="field" value={abteilung}
                    onChange={(e) => { setAbteilung(e.target.value); setForm({ ...form, room_id: '' }) }}>
              <option value="">Bitte wählen</option>
              {struktur.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Raum</label>
            <select className="field" value={form.room_id} disabled={!abteilung} onChange={set('room_id')}>
              <option value="">{abteilung ? 'Bitte wählen' : 'Zuerst Abteilung'}</option>
              {raeume.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Hersteller</label>
            <input className="field" value={form.manufacturer} onChange={set('manufacturer')} />
          </div>
          <div>
            <label className="label">Wartungszyklus</label>
            <select className="field" value={form.cycle} onChange={set('cycle')}>
              <option value="">Kein Zyklus</option>
              {Object.entries(CYCLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Letzte Wartung</label>
          <input type="date" className="field" value={form.last_maintenance} onChange={set('last_maintenance')} />
        </div>
        <div>
          <label className="label">Ersatzteile</label>
          <input className="field" value={form.spare_parts} onChange={set('spare_parts')} placeholder="Mit Komma trennen" />
        </div>
        <div>
          <label className="label">Bemerkungen</label>
          <textarea className="field min-h-[80px] py-2" value={form.notes} onChange={set('notes')} />
        </div>
        <Fehler text={fehler} />
        <button onClick={speichern} disabled={busy} className="btn-signal w-full">
          {busy ? 'Wird gespeichert' : vorgabe ? 'Änderungen speichern' : 'Maschine anlegen'}
        </button>
      </div>
    </Modal>
  )
}

/** Abteilungen und Räume pflegen. */
function StrukturDialog({ open, onClose, struktur }) {
  const [neueAbt, setNeueAbt] = useState('')
  const [neuerRaum, setNeuerRaum] = useState({})
  const [fehler, setFehler] = useState(null)

  async function abteilungAnlegen() {
    if (!neueAbt.trim()) return
    const { error } = await supabase.from('departments').insert({ name: neueAbt.trim() })
    if (error) return setFehler(error.message)
    setNeueAbt(''); struktur.neuLaden()
  }

  async function raumAnlegen(dep) {
    const name = (neuerRaum[dep] || '').trim()
    if (!name) return
    const { error } = await supabase.from('rooms').insert({ department_id: dep, name })
    if (error) return setFehler(error.message)
    setNeuerRaum({ ...neuerRaum, [dep]: '' }); struktur.neuLaden()
  }

  async function loeschen(tabelle, id) {
    if (!confirm('Wirklich löschen?')) return
    const { error } = await supabase.from(tabelle).delete().eq('id', id)
    if (error) return setFehler('Löschen nicht möglich, solange Maschinen oder Aufträge daran hängen.')
    struktur.neuLaden()
  }

  return (
    <Modal open={open} onClose={onClose} title="Abteilungen und Räume" wide>
      <div className="space-y-4">
        <div className="flex gap-2">
          <input className="field flex-1" value={neueAbt} onChange={(e) => setNeueAbt(e.target.value)}
                 placeholder="Neue Abteilung" onKeyDown={(e) => e.key === 'Enter' && abteilungAnlegen()} />
          <button onClick={abteilungAnlegen} className="btn-primary"><Plus className="h-5 w-5" /></button>
        </div>

        <Fehler text={fehler} />

        {struktur.departments.length === 0 && (
          <p className="text-sm text-steel">Noch keine Abteilung angelegt.</p>
        )}

        {struktur.departments.map((d) => (
          <div key={d.id} className="rounded-card border border-black/10 p-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold">{d.name}</p>
              <button onClick={() => loeschen('departments', d.id)} aria-label="Abteilung löschen"
                      className="p-1.5 text-stop"><Trash2 className="h-4 w-4" /></button>
            </div>
            <ul className="mt-2 space-y-1">
              {struktur.rooms.filter((r) => r.department_id === d.id).map((r) => (
                <li key={r.id} className="flex items-center justify-between rounded bg-hall px-3 py-2 text-[14px]">
                  {r.name}
                  <button onClick={() => loeschen('rooms', r.id)} aria-label="Raum löschen"
                          className="text-stop"><Trash2 className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex gap-2">
              <input className="field flex-1 !min-h-[42px]" placeholder="Neuer Raum"
                     value={neuerRaum[d.id] || ''}
                     onChange={(e) => setNeuerRaum({ ...neuerRaum, [d.id]: e.target.value })}
                     onKeyDown={(e) => e.key === 'Enter' && raumAnlegen(d.id)} />
              <button onClick={() => raumAnlegen(d.id)} className="btn-ghost !min-h-[42px]">Hinzufügen</button>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
