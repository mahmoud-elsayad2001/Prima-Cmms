import { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/** Lädt Abteilungen, Räume und Maschinen einmal und hält sie aktuell. */
export function useStruktur() {
  const [daten, setDaten] = useState({ departments: [], rooms: [], machines: [], geladen: false })

  const laden = useCallback(async () => {
    const [d, r, m] = await Promise.all([
      supabase.from('departments').select('*').order('name'),
      supabase.from('rooms').select('*').order('name'),
      supabase.from('machines').select('*').eq('active', true).order('name')
    ])
    setDaten({ departments: d.data ?? [], rooms: r.data ?? [], machines: m.data ?? [], geladen: true })
  }, [])

  useEffect(() => { laden() }, [laden])
  return { ...daten, neuLaden: laden }
}

/**
 * Kaskadierende Auswahl: Abteilung ➔ Raum ➔ Maschine.
 * Die Maschine bleibt optional, damit reine Raumaufträge möglich sind
 * ("Küche reinigen", "Heizung im Büro defekt").
 */
export default function Objektwahl({ struktur, wert, onChange, maschinePflicht = false }) {
  const { departments, rooms, machines } = struktur

  const raeume = useMemo(
    () => rooms.filter((r) => r.department_id === wert.department_id),
    [rooms, wert.department_id])

  const anlagen = useMemo(
    () => machines.filter((m) => m.room_id === wert.room_id),
    [machines, wert.room_id])

  return (
    <div className="space-y-3">
      <div>
        <label className="label">1. Abteilung</label>
        <select className="field" value={wert.department_id}
                onChange={(e) => onChange({ department_id: e.target.value, room_id: '', machine_id: '' })}>
          <option value="">Bitte wählen</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      <div>
        <label className="label">2. Raum / Gebäudeteil</label>
        <select className="field" value={wert.room_id} disabled={!wert.department_id}
                onChange={(e) => onChange({ ...wert, room_id: e.target.value, machine_id: '' })}>
          <option value="">{wert.department_id ? 'Bitte wählen' : 'Zuerst Abteilung wählen'}</option>
          {raeume.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        {wert.department_id && raeume.length === 0 && (
          <p className="mt-1 text-[12px] text-steel">Für diese Abteilung ist noch kein Raum angelegt.</p>
        )}
      </div>

      <div>
        <label className="label">
          3. Maschine / Anlage {!maschinePflicht && <span className="font-normal">(optional)</span>}
        </label>
        <select className="field" value={wert.machine_id} disabled={!wert.room_id}
                onChange={(e) => onChange({ ...wert, machine_id: e.target.value })}>
          <option value="">
            {!wert.room_id ? 'Zuerst Raum wählen'
              : maschinePflicht ? 'Bitte wählen' : 'Auftrag betrifft den ganzen Raum'}
          </option>
          {anlagen.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        {wert.room_id && anlagen.length === 0 && !maschinePflicht && (
          <p className="mt-1 text-[12px] text-steel">
            In diesem Raum ist keine Maschine hinterlegt – der Auftrag wird dem Raum zugeordnet.
          </p>
        )}
      </div>
    </div>
  )
}

/** Anzeigename des gewählten Objekts, Grundlage für den automatischen Titel. */
export function objektName(struktur, { room_id, machine_id }) {
  if (machine_id) return struktur.machines.find((m) => m.id === machine_id)?.name || 'Maschine'
  return struktur.rooms.find((r) => r.id === room_id)?.name || 'Raum'
}
