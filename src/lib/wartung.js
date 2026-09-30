import { supabase } from './supabase'

let letzterLauf = 0
let laufend = null

/**
 * Legt fällige Wartungsaufträge automatisch an (Zyklus erreicht).
 * Läuft im Hintergrund höchstens einmal pro Stunde; Fehler stören die Oberfläche nicht.
 */
export function pruefeFaelligeWartungen() {
  if (laufend) return laufend
  if (Date.now() - letzterLauf < 60 * 60 * 1000) return Promise.resolve(0)
  laufend = Promise.resolve(supabase.rpc('generate_due_maintenance'))
    .then(({ data, error }) => {
      if (error) console.warn('Automatische Wartungsplanung nicht möglich:', error.message)
      return error ? 0 : (data ?? 0)
    })
    .catch(() => 0)
    .then((n) => { letzterLauf = Date.now(); laufend = null; return n })
  return laufend
}
