export const STATUS = {
  offen:              { label: 'Offen',              tone: 'bg-steel/15 text-steel border-steel/30' },
  in_bearbeitung:     { label: 'In Bearbeitung',     tone: 'bg-run/10 text-run border-run/30' },
  fertig_zur_abnahme: { label: 'Fertig zur Abnahme', tone: 'bg-signal/20 text-[#8a5c00] border-signal/50' },
  abgeschlossen:      { label: 'Abgeschlossen',      tone: 'bg-done/10 text-done border-done/30' }
}

export const PRIORITY = {
  niedrig:  { label: 'Niedrig',  tone: 'bg-steel/10 text-steel', rank: 1 },
  mittel:   { label: 'Mittel',   tone: 'bg-run/10 text-run', rank: 2 },
  hoch:     { label: 'Hoch',     tone: 'bg-signal/25 text-[#8a5c00]', rank: 3 },
  kritisch: { label: 'Kritisch', tone: 'bg-stop/10 text-stop', rank: 4 }
}

export const CYCLES = {
  taeglich:      { label: 'Täglich',       tage: 1 },
  woechentlich:  { label: 'Wöchentlich',   tage: 7 },
  monatlich:     { label: 'Monatlich',     tage: 30 },
  quartalsweise: { label: 'Quartalsweise', tage: 91 },
  jaehrlich:     { label: 'Jährlich',      tage: 365 }
}

export const MACHINE_STATE = {
  in_betrieb: { label: 'In Betrieb', tone: 'bg-done/10 text-done' },
  stillstand: { label: 'Stillstand', tone: 'bg-stop/10 text-stop' }
}

export const CAUSES = [
  'Verschleiß', 'Undichtigkeit Hydraulik', 'Elektrik / Antrieb', 'Sensorik / Steuerung',
  'Bedienfehler', 'Materialstau', 'Lagerschaden', 'Software / SPS', 'Fremdverschulden'
]

/** Zeitfilter für die Vorschau planmäßiger Wartungen. */
export const ZEITFILTER = {
  alle:      { label: 'Alle anzeigen',      von: null, bis: null },
  woche:     { label: 'Diese Woche',        von: 0,    bis: 7 },
  umgebung:  { label: '1 Woche +/-',        von: -7,   bis: 7 },
  vierzehn:  { label: 'Nächste 14 Tage',    von: 0,    bis: 14 },
  monat:     { label: 'Nächste 30 Tage',    von: 0,    bis: 30 },
  ueberfaellig: { label: 'Nur überfällig',  von: null, bis: 0 }
}

export function imZeitfenster(datum, key) {
  const f = ZEITFILTER[key]
  if (!f || (f.von === null && f.bis === null)) return true
  if (!datum) return key === 'alle'
  const heute = new Date(); heute.setHours(0, 0, 0, 0)
  const tage = Math.round((new Date(datum) - heute) / 86400000)
  if (key === 'ueberfaellig') return tage < 0
  return tage >= f.von && tage <= f.bis
}

export function isOverdue(d) {
  if (!d) return false
  return new Date(d) < new Date(new Date().toDateString())
}

export function fmtDate(v) {
  if (!v) return '–'
  return new Date(v).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function fmtDateTime(v) {
  if (!v) return '–'
  return new Date(v).toLocaleString('de-DE',
    { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function fmtHours(h) {
  const n = Number(h || 0)
  if (n < 1) return `${Math.round(n * 60)} min`
  return `${n.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} h`
}

/** Laufende Ausfallzeit, solange die Maschine stillsteht. */
export function laufendeAusfallzeit(order) {
  if (order?.machine_status !== 'stillstand' || !order.downtime_start) return null
  return (Date.now() - new Date(order.downtime_start)) / 3600000
}

export function effektiveAusfallzeit(order) {
  const laufend = laufendeAusfallzeit(order)
  return laufend != null ? laufend : Number(order?.downtime_hours || 0)
}

/** Auftragstitel automatisch: "[Maschine/Raum] - [Datum]" */
export function autoTitel(objektName, datum = new Date()) {
  return `${objektName} - ${datum.toLocaleDateString('de-DE')}`
}

/** Vier-Augen-Prüfung für die Oberfläche; die Datenbank prüft dasselbe noch einmal. */
export function abnahmeGesperrt(order, userId) {
  if (!order || order.status !== 'fertig_zur_abnahme') return 'Auftrag ist nicht zur Abnahme gemeldet.'
  if (order.completed_by && order.completed_by === userId) {
    return 'Vier-Augen-Prinzip: Sie haben diesen Auftrag fertig gemeldet. Prüfung und Abnahme muss eine andere Person übernehmen.'
  }
  return null
}
