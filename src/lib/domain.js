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

/** Entspricht dem ENUM fault_cause_kind in der Datenbank. */
export const FAULT_CAUSES = {
  verschleiss:         'Verschleiß',
  bedienfehler:        'Bedienfehler',
  materialfehler:      'Materialfehler',
  elektronik:          'Elektronik',
  software:            'Software',
  mechanik:            'Mechanik',
  hydraulik_pneumatik: 'Hydraulik / Pneumatik',
  sonstiges:           'Sonstiges'
}
export const OHNE_ANGABE = 'Ohne Angabe'

export const grundLabel = (key) => FAULT_CAUSES[key] || OHNE_ANGABE

/** Grund der Störung als Text: Auswahl plus optionale Erläuterung. */
export function grundText(o) {
  const teile = [FAULT_CAUSES[o?.fault_cause], (o?.fault_reason || '').trim()].filter(Boolean)
  return teile.length ? teile.join(' – ') : OHNE_ANGABE
}

/** Zeitfilter für die Vorschau planmäßiger Wartungen. */
export const ZEITFILTER = {
  alle:         { label: 'Alle anzeigen',   von: null, bis: null },
  woche:        { label: 'Diese Woche',     von: 0,    bis: 7 },
  umgebung:     { label: '1 Woche +/-',     von: -7,   bis: 7 },
  vierzehn:     { label: 'Nächste 14 Tage', von: 0,    bis: 14 },
  monat:        { label: 'Nächste 30 Tage', von: 0,    bis: 30 },
  ueberfaellig: { label: 'Nur überfällig',  von: null, bis: 0 }
}

export function imZeitfenster(datum, key) {
  const f = ZEITFILTER[key]
  if (!f || (f.von === null && f.bis === null)) return true
  if (!datum) return false
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

export function fmtTime(v) {
  if (!v) return '–'
  return new Date(v).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}

export function fmtDateTime(v) {
  if (!v) return '–'
  return new Date(v).toLocaleString('de-DE',
    { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * Dauer lesbar darstellen. Unter einer Stunde in Minuten ("3 Minuten"),
 * darüber als "1 Std. 20 Min." – nie als Dezimalstunden wie 0,04.
 */
export function fmtDauer(sekunden) {
  const s = Math.max(0, Math.round(Number(sekunden) || 0))
  if (s === 0) return '0 Minuten'
  if (s < 60) return `${s} Sek.`
  const gesamtMin = Math.round(s / 60)
  if (gesamtMin < 60) return `${gesamtMin} ${gesamtMin === 1 ? 'Minute' : 'Minuten'}`
  const h = Math.floor(gesamtMin / 60)
  const m = gesamtMin % 60
  return m === 0 ? `${h} Std.` : `${h} Std. ${m} Min.`
}

/** Eingabe in Stunden (z. B. downtime_hours), Ausgabe wie fmtDauer. */
export const fmtHours = (stunden) => fmtDauer((Number(stunden) || 0) * 3600)

/** Stoppuhr-Anzeige hh:mm:ss */
export function stoppuhr(sekunden) {
  const s = Math.max(0, Math.floor(Number(sekunden) || 0))
  const h = String(Math.floor(s / 3600)).padStart(2, '0')
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const sek = String(s % 60).padStart(2, '0')
  return `${h}:${m}:${sek}`
}

export function median(zahlen) {
  const s = [...zahlen].sort((a, b) => a - b)
  if (!s.length) return 0
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Läuft die Reparatur-Stoppuhr gerade? */
export function arbeitLaeuft(o) {
  return o?.status === 'in_bearbeitung' && !!o.work_started_at && !o.work_ended_at
}

/** Gesamte Reparaturzeit in Sekunden inklusive des gerade laufenden Durchlaufs. */
export function arbeitsSekunden(o, jetzt = Date.now()) {
  const basis = Number(o?.work_seconds || 0)
  if (!arbeitLaeuft(o)) return basis
  return basis + Math.max(0, (jetzt - new Date(o.work_started_at).getTime()) / 1000)
}

/** Laufende Ausfallzeit in Stunden, solange die Maschine stillsteht. */
export function laufendeAusfallzeit(order, jetzt = Date.now()) {
  if (order?.machine_status !== 'stillstand' || !order.downtime_start) return null
  if (order.status === 'abgeschlossen') return null
  return Math.max(0, (jetzt - new Date(order.downtime_start).getTime()) / 3600000)
}

export function effektiveAusfallzeit(order, jetzt = Date.now()) {
  const laufend = laufendeAusfallzeit(order, jetzt)
  return laufend != null ? laufend : Number(order?.downtime_hours || 0)
}

export const ausfallSekunden = (order, jetzt) => effektiveAusfallzeit(order, jetzt) * 3600

/**
 * Einheit für Diagramme: unter 2 Stunden Minuten, sonst Stunden.
 * So bleiben kurze Ausfälle auf der Achse sichtbar.
 */
export function chartEinheit(maxSekunden) {
  return maxSekunden < 2 * 3600
    ? { key: 'min', teiler: 60, kurz: 'Min.' }
    : { key: 'std', teiler: 3600, kurz: 'Std.' }
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
