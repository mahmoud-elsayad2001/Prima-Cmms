const SCHEMA_CODES = ['42703', '42P01', 'PGRST204', 'PGRST205']

/** Fehlt in der Datenbank eine Spalte, Tabelle oder ein ENUM-Wert (Update nicht eingespielt)? */
export function istSchemaFehler(err) {
  if (!err) return false
  const m = err.message || ''
  return SCHEMA_CODES.includes(err.code)
    || /column .* does not exist|relation .* does not exist|schema cache|invalid input value for enum/i.test(m)
}

/** Verständliche deutsche Fehlermeldung für Anwender. */
export function fehlerText(err) {
  if (!err) return null
  const m = err.message || String(err)
  const code = err.code || ''
  if (/^P000[1-4]$/.test(code) || /Vier-Augen|Beanstandung muss|Abnahme nur möglich|Freigabe ist/.test(m)) return m
  if (istSchemaFehler(err)) {
    return 'Die Datenbank ist noch nicht auf dem aktuellen Stand. Bitte supabase/schema.sql einmal im Supabase SQL-Editor ausführen.'
  }
  if (code === '23514' || /stillstand_braucht_grund/.test(m)) return 'Bei Stillstand ist ein Grund der Störung verpflichtend.'
  if (code === '42501' || /row-level security/i.test(m)) return 'Für diese Aktion fehlt die Berechtigung.'
  if (code === '23503') return 'Der Eintrag wird noch von anderen Datensätzen verwendet.'
  if (code === '23505') return 'Dieser Eintrag existiert bereits.'
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) {
    return 'Keine Verbindung zum Server. Bitte Netzwerk prüfen und erneut versuchen.'
  }
  return m
}

/**
 * Führt Abfragen der Reihe nach aus und liefert die erste erfolgreiche.
 * So bleibt eine Seite bedienbar, auch wenn eine optionale Spalte oder
 * Verknüpfung (noch) fehlt.
 */
export async function ersteAbfrage(...abfragen) {
  let letzte = { data: null, error: null }
  for (const abfrage of abfragen) {
    try {
      letzte = await abfrage()
    } catch (e) {
      letzte = { data: null, error: e }
    }
    if (!letzte.error) return letzte
  }
  return letzte
}
