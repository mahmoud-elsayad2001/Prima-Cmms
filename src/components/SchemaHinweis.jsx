import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { istSchemaFehler } from '../lib/fehler'

/**
 * Prüft einmal beim Start, ob das Datenbank-Update eingespielt ist.
 * Wenn nicht, erscheint ein Hinweis statt kryptischer Fehlermeldungen.
 */
export default function SchemaHinweis() {
  const [fehlt, setFehlt] = useState(false)

  useEffect(() => {
    let aktiv = true
    const spalten = supabase.from('work_orders')
      .select('id,fault_cause,work_first_started_at,work_started_at,work_ended_at,work_seconds,work_started_by')
      .limit(1)
    const status = supabase.from('work_orders').select('id').eq('status', 'abgeschlossen').limit(1)
    Promise.all([spalten, status])
      .then((antworten) => {
        if (aktiv && antworten.some((a) => istSchemaFehler(a.error))) setFehlt(true)
      })
      .catch(() => {})
    return () => { aktiv = false }
  }, [])

  if (!fehlt) return null
  return (
    <div role="alert" className="flex items-start gap-3 bg-signal px-4 py-3 text-[14px] text-ink">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
      <p>
        <span className="font-semibold">Datenbank-Update erforderlich.</span>{' '}
        Bitte die Datei <code className="font-mono">supabase/schema.sql</code> einmal im Supabase
        SQL-Editor ausführen. Bis dahin funktionieren Reparaturzeit, Grund der Störung und
        Archiv nur eingeschränkt.
      </p>
    </div>
  )
}
