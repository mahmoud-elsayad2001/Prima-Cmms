import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, Check, Lock, ShieldCheck, Play, ClipboardCheck, Plus, Timer, XCircle, AlertTriangle, Clock
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import {
  CYCLES, MACHINE_STATE, fmtDate, fmtDateTime, fmtHours, fmtDauer, stoppuhr, median,
  abnahmeGesperrt, effektiveAusfallzeit, arbeitLaeuft, arbeitsSekunden, grundText
} from '../lib/domain'
import { fehlerText, ersteAbfrage } from '../lib/fehler'
import {
  Spinner, StatusBadge, PriorityBadge, FileUpload, MediaListe, Fehler, Modal, GrundSelect
} from '../components/ui'
import AbnahmeListe from '../components/AbnahmeKarte'

const VERBINDUNGEN = 'machines(id,name,spare_parts), rooms(id,name,departments(name)), ersteller:created_by(full_name), fertig:completed_by(full_name,role), abnehmer:approved_by(full_name,role)'

export default function AuftragDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [order, setOrder] = useState(null)
  const [items, setItems] = useState([])
  const [medien, setMedien] = useState([])
  const [richtwert, setRichtwert] = useState(null)
  const [fehler, setFehler] = useState(null)
  const [hinweis, setHinweis] = useState(null)
  const [busy, setBusy] = useState(false)
  const [fertigOffen, setFertigOffen] = useState(false)
  const [stillstandOffen, setStillstandOffen] = useState(false)
  const [jetzt, setJetzt] = useState(Date.now())
  const [entwurf, setEntwurf] = useState({ notes: '', parts: '', fault_cause: '', fault_reason: '' })

  const laden = useCallback(async () => {
    const res = await ersteAbfrage(
      () => supabase.from('work_orders').select(`*, ${VERBINDUNGEN}, starter:work_started_by(full_name)`).eq('id', id).single(),
      () => supabase.from('work_orders').select(`*, ${VERBINDUNGEN}`).eq('id', id).single()
    )
    if (res.error) return setFehler(fehlerText(res.error))
    const data = res.data
    setOrder(data)
    setEntwurf({
      notes: data.notes ?? '',
      parts: (data.replaced_parts ?? []).join(', '),
      fault_cause: data.fault_cause ?? '',
      fault_reason: data.fault_reason ?? ''
    })
    const [ci, om] = await Promise.all([
      supabase.from('checklist_items').select('*, person:done_by(full_name)').eq('order_id', id).order('position'),
      supabase.from('order_media').select('*').eq('order_id', id).order('created_at')
    ])
    setItems(ci.data ?? []); setMedien(om.data ?? [])

    // Richtwert aus früheren, abgeschlossenen Aufträgen derselben Maschine und Art
    if (data.machine_id) {
      const rw = await supabase.from('work_orders').select('work_seconds')
        .eq('machine_id', data.machine_id).eq('kind', data.kind).eq('status', 'abgeschlossen')
        .gt('work_seconds', 0).neq('id', id)
      setRichtwert(!rw.error && rw.data?.length
        ? { n: rw.data.length, sek: median(rw.data.map((r) => Number(r.work_seconds))) } : null)
    } else setRichtwert(null)
  }, [id])

  useEffect(() => { laden() }, [laden])

  // Stoppuhr und laufende Ausfallzeit im Sekundentakt aktualisieren
  useEffect(() => {
    if (!order) return
    const tickt = arbeitLaeuft(order) || (order.machine_status === 'stillstand' && order.status !== 'abgeschlossen')
    if (!tickt) return
    const t = setInterval(() => setJetzt(Date.now()), 1000)
    return () => clearInterval(t)
  }, [order])

  if (!order) return fehler ? <Fehler text={fehler} /> : <Spinner text="Auftrag wird geladen" />

  const abgeschlossen = order.status === 'abgeschlossen'
  const unplan = order.kind === 'unplanmaessig'
  const sperre = abnahmeGesperrt(order, user?.id)
  const offeneSchritte = items.filter((i) => !i.done).length
  const stillstand = order.machine_status === 'stillstand' && !abgeschlossen
  const ausfall = effektiveAusfallzeit(order, jetzt)
  const laeuft = arbeitLaeuft(order)
  const arbeit = arbeitsSekunden(order, jetzt)
  const zeitTitel = unplan ? 'Reparaturzeit' : 'Wartungszeit'

  async function haken(item) {
    if (abgeschlossen || order.status === 'fertig_zur_abnahme') return
    const neu = !item.done
    setItems((l) => l.map((i) => i.id === item.id ? { ...i, done: neu } : i))
    const { error } = await supabase.from('checklist_items')
      .update({ done: neu, done_by: neu ? user.id : null, done_at: neu ? new Date().toISOString() : null })
      .eq('id', item.id)
    if (error) { setFehler(fehlerText(error)); laden() }
  }

  async function schrittHinzufuegen() {
    const label = prompt('Zusätzlicher Arbeitsschritt')
    if (!label?.trim()) return
    const { error } = await supabase.from('checklist_items')
      .insert({ order_id: id, label: label.trim(), position: items.length })
    if (error) return setFehler(fehlerText(error))
    laden()
  }

  async function aktualisieren(patch, meldung) {
    setBusy(true); setFehler(null); setHinweis(null)
    const { error } = await supabase.from('work_orders').update(patch).eq('id', id)
    setBusy(false)
    if (error) { setFehler(fehlerText(error)); return false }
    if (meldung) setHinweis(meldung)
    laden()
    return true
  }

  /** Erfasste Dokumentation als Update-Daten (wird auch beim Fertigmelden mitgespeichert). */
  const entwurfPatch = () => ({
    notes: entwurf.notes.trim() || null,
    replaced_parts: entwurf.parts.split(',').map((s) => s.trim()).filter(Boolean),
    ...(unplan ? {
      fault_cause: entwurf.fault_cause || null,
      fault_reason: entwurf.fault_reason.trim() || null
    } : {})
  })

  function dokumentationSpeichern() {
    if (unplan && stillstand && !entwurf.fault_cause && !entwurf.fault_reason.trim()) {
      return setFehler('Solange die Maschine still steht, ist der Grund der Störung verpflichtend.')
    }
    aktualisieren(entwurfPatch(), 'Dokumentation gespeichert.')
  }

  const starten = () => aktualisieren({ status: 'in_bearbeitung' },
    unplan ? 'Reparatur gestartet, die Zeit läuft.' : 'Wartung gestartet, die Zeit läuft.')

  async function fertigmelden(wiederInBetrieb, grund) {
    setFertigOffen(false)
    const patch = {
      ...entwurfPatch(),
      status: 'fertig_zur_abnahme',
      completed_by: user.id,
      repair_date: order.repair_date || new Date().toISOString().slice(0, 10),
      ...(wiederInBetrieb ? { machine_status: 'in_betrieb' } : {})
    }
    if (unplan && grund) patch.fault_cause = grund
    await aktualisieren(patch, 'Fertig gemeldet, die Zeit wurde gestoppt. Der Auftrag wartet auf die Abnahme durch eine andere Person.')
  }

  async function medienHinzu({ file_path, file_name }) {
    const { error } = await supabase.from('order_media')
      .insert({ order_id: id, file_path, file_name, uploaded_by: user.id })
    if (error) return setFehler(fehlerText(error))
    laden()
  }

  return (
    <div className="space-y-5">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm font-medium text-steel">
        <ArrowLeft className="h-4 w-4" /> Zurück
      </button>

      <header className="card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="num text-[13px] text-steel">#{order.order_no}</span>
          <StatusBadge status={order.status} />
          <PriorityBadge priority={order.priority} />
          <span className="rounded bg-hall px-2 py-0.5 text-[12px] font-medium text-steel">
            {unplan ? 'Unplanmäßig' : 'Planmäßig'}{order.cycle ? ` · ${CYCLES[order.cycle].label}` : ''}
          </span>
        </div>
        <h1 className="mt-2 text-xl font-bold leading-snug">{order.title}</h1>
        <p className="text-[13px] text-steel">
          {order.rooms?.departments?.name} · {order.rooms?.name}
          {order.machines?.name ? ' · ' : ''}
          {order.machines && (
            <Link to={`/maschinen/${order.machines.id}`} className="font-medium text-run">{order.machines.name}</Link>
          )}
        </p>
        {order.description && <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed">{order.description}</p>}

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-black/[0.08] pt-3 text-[13px]">
          <div><dt className="text-steel">Erstellt</dt><dd className="font-medium">{fmtDateTime(order.created_at)}</dd></div>
          <div><dt className="text-steel">Ersteller</dt><dd className="font-medium">{order.ersteller?.full_name || '–'}</dd></div>
          <div><dt className="text-steel">Fällig</dt><dd className="font-medium">{fmtDate(order.due_date)}</dd></div>
          <div><dt className="text-steel">Ausführung</dt>
            <dd className="font-medium">{order.starter?.full_name || order.fertig?.full_name || '–'}</dd></div>
        </dl>
      </header>

      {order.qm_notes && !abgeschlossen && (
        <section className="rounded-card border border-stop/30 bg-stop/5 p-4">
          <p className="flex items-center gap-2 font-semibold text-stop">
            <AlertTriangle className="h-4 w-4" /> Beanstandung der Prüfung
            {order.rejected_count > 1 && <span className="num text-[12px]">({order.rejected_count}. Mal)</span>}
          </p>
          <p className="mt-1.5 whitespace-pre-wrap text-[14px] leading-relaxed">{order.qm_notes}</p>
        </section>
      )}

      {/* Reparatur-/Wartungszeit (Stoppuhr) */}
      <section className="card p-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold"><Clock className="h-4 w-4" /> {zeitTitel}</h2>
          {laeuft && (
            <span className="rounded-full bg-run/10 px-3 py-1 text-[12px] font-semibold text-run">läuft</span>
          )}
        </div>

        {laeuft ? (
          <div className="mt-3 rounded-card bg-run/5 p-3">
            <p className="num text-4xl font-bold text-run">{stoppuhr(arbeit)}</p>
            <p className="mt-1 text-[13px] text-steel">
              Gestartet {fmtDateTime(order.work_started_at)}
              {order.starter?.full_name ? ` von ${order.starter.full_name}` : ''}
            </p>
            {Number(order.work_seconds) > 0 && (
              <p className="text-[13px] text-steel">Davon aus früheren Durchläufen: {fmtDauer(order.work_seconds)}</p>
            )}
          </div>
        ) : Number(order.work_seconds) > 0 ? (
          <div className="mt-3">
            <p className="num text-3xl font-bold">{fmtDauer(order.work_seconds)}</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 text-[13px]">
              <div><dt className="text-steel">Erster Start</dt>
                <dd className="font-medium">{fmtDateTime(order.work_first_started_at || order.work_started_at)}</dd></div>
              <div><dt className="text-steel">Beendet</dt>
                <dd className="font-medium">{fmtDateTime(order.work_ended_at)}</dd></div>
            </dl>
          </div>
        ) : (
          <p className="mt-2 text-[14px] text-steel">
            {order.status === 'offen'
              ? 'Noch nicht gestartet. Die Zeit wird automatisch erfasst, sobald die Bearbeitung startet.'
              : 'Für diesen Auftrag wurde keine Zeit erfasst.'}
          </p>
        )}

        {richtwert && (
          <p className="mt-3 rounded-card bg-hall px-3 py-2 text-[13px] text-steel">
            Richtwert dieser Maschine: ca. <span className="font-semibold text-ink">{fmtDauer(richtwert.sek)}</span>{' '}
            (Median aus {richtwert.n} {richtwert.n === 1 ? 'früherem Auftrag' : 'früheren Aufträgen'})
          </p>
        )}
      </section>

      {/* Maschinenstatus und Ausfallzeit */}
      {unplan && (
        <section className="card p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Maschinenstatus</h2>
            <span className={`rounded-full px-3 py-1 text-[13px] font-semibold ${MACHINE_STATE[order.machine_status].tone}`}>
              {MACHINE_STATE[order.machine_status].label}
            </span>
          </div>

          {stillstand ? (
            <div className="mt-3 rounded-card bg-stop/5 p-3">
              <p className="flex items-center gap-2 text-[13px] text-stop">
                <Timer className="h-4 w-4" /> Ausfall läuft seit {fmtDateTime(order.downtime_start)}
              </p>
              <p className="num mt-1 text-3xl font-bold text-stop">{fmtHours(ausfall)}</p>
              <p className="mt-1 text-[13px] text-steel">Grund: {grundText(order)}</p>
              <button onClick={() => aktualisieren({ machine_status: 'in_betrieb' }, 'Maschine läuft wieder, Ausfallzeit festgeschrieben.')}
                      disabled={busy} className="btn-done mt-3 w-full">
                <Play className="h-5 w-5" /> Maschine läuft wieder
              </button>
            </div>
          ) : (
            <div className="mt-3">
              {Number(order.downtime_hours) > 0 ? (
                <p className="text-[14px]">
                  Ausfall beendet: <span className="num font-semibold">{fmtHours(order.downtime_hours)}</span>
                  <span className="block text-[13px] text-steel">
                    {fmtDateTime(order.downtime_start)} bis {fmtDateTime(order.downtime_end)} · {grundText(order)}
                  </span>
                </p>
              ) : (
                <p className="text-[14px] text-steel">Kein Stillstand erfasst, die Anlage lief durchgehend.</p>
              )}
              {!abgeschlossen && (
                <button onClick={() => setStillstandOffen(true)} disabled={busy} className="btn-ghost mt-3 w-full">
                  <Timer className="h-5 w-5" /> Stillstand melden
                </button>
              )}
            </div>
          )}
        </section>
      )}

      <Fehler text={fehler} />
      {hinweis && <p className="rounded-card bg-done/10 px-3 py-2 text-sm text-done">{hinweis}</p>}

      {/* Arbeitsschritte */}
      <section className="card">
        <header className="flex items-center justify-between border-b border-black/10 px-4 py-3">
          <h2 className="font-semibold">
            Arbeitsschritte {items.length > 0 && <span className="num text-steel">({items.length - offeneSchritte}/{items.length})</span>}
          </h2>
          {!abgeschlossen && (
            <button onClick={schrittHinzufuegen} className="btn-ghost !min-h-[38px] text-[13px]">
              <Plus className="h-4 w-4" /> Ergänzen
            </button>
          )}
        </header>
        <ul className="divide-y divide-black/[0.06]">
          {items.map((i) => (
            <li key={i.id}>
              <button onClick={() => haken(i)} disabled={abgeschlossen}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left disabled:opacity-70">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md border-2
                                  ${i.done ? 'border-done bg-done text-white' : 'border-steel/40'}`}>
                  {i.done && <Check className="h-5 w-5" strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-[15px] ${i.done ? 'text-steel line-through' : 'font-medium'}`}>{i.label}</span>
                  {i.done && i.person?.full_name && (
                    <span className="block text-[12px] text-steel">{i.person.full_name} · {fmtDateTime(i.done_at)}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
          {items.length === 0 && <li className="px-4 py-3 text-sm text-steel">Keine Arbeitsschritte hinterlegt.</li>}
        </ul>
      </section>

      {/* Dokumentation */}
      <section className="card p-4">
        <h2 className="mb-3 font-semibold">Dokumentation</h2>
        <div className="space-y-3">
          {unplan && (
            <>
              <div>
                <label className="label" htmlFor="grund">Grund der Störung</label>
                <GrundSelect id="grund" value={entwurf.fault_cause} disabled={abgeschlossen} leer="Ohne Angabe"
                             onChange={(v) => setEntwurf({ ...entwurf, fault_cause: v })} />
              </div>
              <div>
                <label className="label" htmlFor="erl">Erläuterung zum Grund (optional)</label>
                <input id="erl" className="field" value={entwurf.fault_reason} disabled={abgeschlossen}
                       onChange={(e) => setEntwurf({ ...entwurf, fault_reason: e.target.value })} />
              </div>
            </>
          )}
          <div>
            <label className="label" htmlFor="teile">Getauschte Ersatzteile</label>
            <input id="teile" className="field" value={entwurf.parts} disabled={abgeschlossen}
                   onChange={(e) => setEntwurf({ ...entwurf, parts: e.target.value })} placeholder="Mit Komma trennen" />
            {order.machines?.spare_parts?.length > 0 && !abgeschlossen && (
              <div className="mt-2 flex flex-wrap gap-2">
                {order.machines.spare_parts.map((t) => (
                  <button key={t} onClick={() => setEntwurf((d) => ({ ...d, parts: d.parts ? `${d.parts}, ${t}` : t }))}
                          className="rounded-full bg-hall px-3 py-1.5 text-[13px] font-medium text-steel">+ {t}</button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="label" htmlFor="notizen">Notizen</label>
            <textarea id="notizen" className="field min-h-[96px] py-2" value={entwurf.notes} disabled={abgeschlossen}
                      onChange={(e) => setEntwurf({ ...entwurf, notes: e.target.value })} />
          </div>
          {!abgeschlossen && (
            <button onClick={dokumentationSpeichern} disabled={busy} className="btn-ghost w-full">
              Dokumentation speichern
            </button>
          )}
        </div>
      </section>

      {/* Fotos und Dateien */}
      <section className="card p-4">
        <h2 className="mb-3 font-semibold">Fotos und Dateien</h2>
        {!abgeschlossen && (
          <div className="mb-3 grid gap-2 sm:grid-cols-2">
            <FileUpload prefix={`auftraege/${id}`} onUploaded={medienHinzu} kamera accept="image/*" label="Foto aufnehmen" />
            <FileUpload prefix={`auftraege/${id}/dateien`} onUploaded={medienHinzu} label="PDF / Datei" />
          </div>
        )}
        <MediaListe items={medien} onDelete={abgeschlossen ? null : async (m) => {
          await supabase.from('order_media').delete().eq('id', m.id); laden()
        }} />
      </section>

      {/* Ablauf */}
      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">Bearbeitungsstand</h2>

        {order.status === 'offen' && (
          <>
            <button onClick={starten} disabled={busy} className="btn-primary w-full">
              <Play className="h-5 w-5" />
              {Number(order.work_seconds) > 0 ? (unplan ? 'Reparatur erneut starten' : 'Wartung erneut starten')
                                              : (unplan ? 'Reparatur starten' : 'Wartung starten')}
            </button>
            <p className="text-[12px] text-steel">Mit dem Start beginnt die automatische Zeiterfassung.</p>
          </>
        )}

        {order.status === 'in_bearbeitung' && (
          <>
            {offeneSchritte > 0 && (
              <p className="rounded-card bg-signal/15 px-3 py-2 text-[13px] text-[#8a5c00]">
                Noch {offeneSchritte} offene{offeneSchritte === 1 ? 'r Schritt' : ' Schritte'}.
              </p>
            )}
            <button onClick={() => setFertigOffen(true)} disabled={busy} className="btn-signal w-full">
              <ClipboardCheck className="h-5 w-5" /> Fertigmelden &amp; {unplan ? 'Reparatur' : 'Wartung'} beenden
            </button>
          </>
        )}

        {order.status === 'fertig_zur_abnahme' && (
          <>
            <p className="text-[13px] text-steel">
              Der Auftrag wartet auf Freigabe. Die Prüfung erfolgt durch eine andere Person als die, die ihn fertig gemeldet hat.
            </p>
            {sperre && (
              <p className="flex items-start gap-2 rounded-card border border-stop/30 bg-stop/5 px-3 py-2 text-[13px] font-semibold text-stop">
                <Lock className="mt-0.5 h-4 w-4 shrink-0" /> {sperre}
              </p>
            )}
          </>
        )}

        {abgeschlossen && (
          <p className="rounded-card bg-done/10 px-3 py-3 text-sm text-done">
            Abgenommen von {order.abnehmer?.full_name || 'unbekannt'} am {fmtDateTime(order.approved_at)}.
            {Number(order.work_seconds) > 0 && ` ${zeitTitel} ${fmtDauer(order.work_seconds)}.`}
            {Number(order.downtime_hours) > 0 && ` Ausfallzeit ${fmtHours(order.downtime_hours)}.`}
          </p>
        )}
      </section>

      {/* Prüfung direkt im Auftrag, für die Person, die abnehmen darf */}
      {order.status === 'fertig_zur_abnahme' && !sperre && (
        <AbnahmeListe auftraege={[{ ...order, fertig: order.fertig }]} onGeaendert={laden} />
      )}

      <FertigDialog open={fertigOffen} onClose={() => setFertigOffen(false)} order={order}
                    unplan={unplan} arbeit={arbeit} offeneSchritte={offeneSchritte}
                    grundVorgabe={entwurf.fault_cause} onFertig={fertigmelden} />

      <StillstandDialog open={stillstandOffen} onClose={() => setStillstandOffen(false)}
                        vorgabe={entwurf}
                        onSenden={async (grund, text) => {
                          setStillstandOffen(false)
                          await aktualisieren({
                            machine_status: 'stillstand', fault_cause: grund, fault_reason: text || null
                          }, 'Stillstand erfasst, die Ausfalluhr läuft.')
                        }} />
    </div>
  )
}

function FertigDialog({ open, onClose, order, unplan, arbeit, offeneSchritte, grundVorgabe, onFertig }) {
  const [grund, setGrund] = useState(grundVorgabe || '')
  useEffect(() => { if (open) setGrund(grundVorgabe || '') }, [open, grundVorgabe])
  const stillstand = order.machine_status === 'stillstand'

  return (
    <Modal open={open} onClose={onClose} title="Auftrag fertigmelden">
      <div className="space-y-4">
        {offeneSchritte > 0 && (
          <p className="rounded-card bg-signal/15 px-3 py-2 text-[13px] text-[#8a5c00]">
            {offeneSchritte} Arbeitsschritt{offeneSchritte === 1 ? '' : 'e'} noch nicht abgehakt.
            Die Fertigmeldung ist trotzdem möglich.
          </p>
        )}
        <p className="text-[14px] leading-relaxed">
          Die {unplan ? 'Reparaturzeit' : 'Wartungszeit'} wird jetzt bei{' '}
          <span className="font-semibold">{fmtDauer(arbeit)}</span> gestoppt. Der Auftrag wechselt auf
          „Fertig zur Abnahme“ und wird einer zweiten Person zur Prüfung vorgelegt.
        </p>

        {unplan && (
          <div>
            <label className="label">Grund der Störung</label>
            <GrundSelect value={grund} onChange={setGrund} leer="Ohne Angabe" />
            {!grund && (
              <p className="mt-1.5 text-[12px] text-steel">
                Ohne Angabe kann der Auftrag in der Ursachen-Auswertung nicht zugeordnet werden.
              </p>
            )}
          </div>
        )}

        {stillstand ? (
          <>
            <p className="rounded-card bg-stop/5 px-3 py-2 text-[13px] text-stop">
              Läuft die Maschine wieder? Damit stoppt die Ausfalluhr.
            </p>
            <div className="grid gap-2">
              <button onClick={() => onFertig(true, grund)} className="btn-done">
                Maschine läuft wieder – fertigmelden
              </button>
              <button onClick={() => onFertig(false, grund)} className="btn-ghost">
                Maschine steht weiterhin still
              </button>
            </div>
          </>
        ) : (
          <button onClick={() => onFertig(false, grund)} className="btn-signal w-full">Fertigmelden</button>
        )}
      </div>
    </Modal>
  )
}

function StillstandDialog({ open, onClose, vorgabe, onSenden }) {
  const [grund, setGrund] = useState('')
  const [text, setText] = useState('')
  useEffect(() => {
    if (open) { setGrund(vorgabe.fault_cause || ''); setText(vorgabe.fault_reason || '') }
  }, [open, vorgabe.fault_cause, vorgabe.fault_reason])

  return (
    <Modal open={open} onClose={onClose} title="Stillstand melden">
      <div className="space-y-3">
        <p className="text-[14px] leading-relaxed">
          Ab jetzt läuft die Ausfallzeit, bis die Maschine wieder als „In Betrieb“ gemeldet wird.
        </p>
        <div>
          <label className="label">Grund der Störung (Pflicht)</label>
          <GrundSelect value={grund} onChange={setGrund} />
        </div>
        <div>
          <label className="label">Erläuterung (optional)</label>
          <input className="field" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <button onClick={() => onSenden(grund, text.trim())} disabled={!grund} className="btn-stop w-full">
          <Timer className="h-5 w-5" /> Stillstand melden
        </button>
      </div>
    </Modal>
  )
}
