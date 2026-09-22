import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, Check, Lock, ShieldCheck, Play, ClipboardCheck, Plus, Timer, XCircle, AlertTriangle
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import {
  STATUS, PRIORITY, CYCLES, CAUSES, MACHINE_STATE,
  fmtDate, fmtDateTime, fmtHours, abnahmeGesperrt, effektiveAusfallzeit, laufendeAusfallzeit
} from '../lib/domain'
import { Spinner, StatusBadge, PriorityBadge, FileUpload, MediaListe, Fehler, Modal } from '../components/ui'

export default function AuftragDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, isQM } = useAuth()

  const [order, setOrder] = useState(null)
  const [items, setItems] = useState([])
  const [medien, setMedien] = useState([])
  const [fehler, setFehler] = useState(null)
  const [hinweis, setHinweis] = useState(null)
  const [busy, setBusy] = useState(false)
  const [fertigOffen, setFertigOffen] = useState(false)
  const [reklaOffen, setReklaOffen] = useState(false)
  const [tick, setTick] = useState(0)
  const [entwurf, setEntwurf] = useState({ notes: '', parts: '', fault_reason: '' })

  const laden = useCallback(async () => {
    const { data, error } = await supabase.from('work_orders')
      .select('*, machines(id,name,spare_parts), rooms(id,name,departments(name)), ersteller:created_by(full_name), fertig:completed_by(full_name,role), abnehmer:approved_by(full_name,role)')
      .eq('id', id).single()
    if (error) return setFehler(error.message)
    setOrder(data)
    setEntwurf({
      notes: data.notes ?? '',
      parts: (data.replaced_parts ?? []).join(', '),
      fault_reason: data.fault_reason ?? ''
    })
    const [ci, om] = await Promise.all([
      supabase.from('checklist_items').select('*, person:done_by(full_name)').eq('order_id', id).order('position'),
      supabase.from('order_media').select('*').eq('order_id', id).order('created_at')
    ])
    setItems(ci.data ?? []); setMedien(om.data ?? [])
  }, [id])

  useEffect(() => { laden() }, [laden])

  // Laufende Ausfalluhr jede Minute aktualisieren
  useEffect(() => {
    if (order?.machine_status !== 'stillstand') return
    const t = setInterval(() => setTick((x) => x + 1), 60000)
    return () => clearInterval(t)
  }, [order?.machine_status])

  if (!order) return <Spinner text="Auftrag wird geladen" />

  const abgeschlossen = order.status === 'abgeschlossen'
  const sperre = abnahmeGesperrt(order, user?.id)
  const offeneSchritte = items.filter((i) => !i.done).length
  const stillstand = order.machine_status === 'stillstand'
  const ausfall = effektiveAusfallzeit(order)

  async function haken(item) {
    if (abgeschlossen || order.status === 'fertig_zur_abnahme') return
    const neu = !item.done
    setItems((l) => l.map((i) => i.id === item.id ? { ...i, done: neu } : i))
    const { error } = await supabase.from('checklist_items')
      .update({ done: neu, done_by: neu ? user.id : null, done_at: neu ? new Date().toISOString() : null })
      .eq('id', item.id)
    if (error) { setFehler(error.message); laden() }
  }

  async function schrittHinzufuegen() {
    const label = prompt('Zusätzlicher Arbeitsschritt')
    if (!label?.trim()) return
    await supabase.from('checklist_items').insert({ order_id: id, label: label.trim(), position: items.length })
    laden()
  }

  async function aktualisieren(patch, meldung) {
    setBusy(true); setFehler(null); setHinweis(null)
    const { error } = await supabase.from('work_orders').update(patch).eq('id', id)
    setBusy(false)
    if (error) return setFehler(error.message)
    if (meldung) setHinweis(meldung)
    laden()
  }

  const erfassungSpeichern = () => aktualisieren({
    notes: entwurf.notes || null,
    replaced_parts: entwurf.parts.split(',').map((s) => s.trim()).filter(Boolean),
    fault_reason: entwurf.fault_reason || null
  }, 'Dokumentation gespeichert.')

  async function medienHinzu({ file_path, file_name }) {
    await supabase.from('order_media').insert({ order_id: id, file_path, file_name, uploaded_by: user.id })
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
            {order.kind === 'planmaessig' ? 'Planmäßig' : 'Unplanmäßig'}
            {order.cycle ? ` · ${CYCLES[order.cycle].label}` : ''}
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
          <div><dt className="text-steel">Erstellt</dt>
            <dd className="font-medium">{fmtDateTime(order.created_at)}</dd></div>
          <div><dt className="text-steel">Ersteller</dt>
            <dd className="font-medium">{order.ersteller?.full_name || '–'}</dd></div>
          <div><dt className="text-steel">Fällig</dt><dd className="font-medium">{fmtDate(order.due_date)}</dd></div>
          <div><dt className="text-steel">Fertig gemeldet</dt>
            <dd className="font-medium">{order.fertig?.full_name || '–'}</dd></div>
        </dl>
      </header>

      {/* Beanstandung durch die Prüfung */}
      {order.qm_notes && order.status !== 'abgeschlossen' && (
        <section className="rounded-card border border-stop/30 bg-stop/5 p-4">
          <p className="flex items-center gap-2 font-semibold text-stop">
            <AlertTriangle className="h-4 w-4" /> Beanstandung der Prüfung
            {order.rejected_count > 1 && <span className="num text-[12px]">({order.rejected_count}. Mal)</span>}
          </p>
          <p className="mt-1.5 whitespace-pre-wrap text-[14px] leading-relaxed">{order.qm_notes}</p>
        </section>
      )}

      {/* Ausfallzeit */}
      {order.kind === 'unplanmaessig' && (
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
              <p className="mt-1 text-[13px] text-steel">Grund: {order.fault_reason || 'ohne Angabe'}</p>
              {!abgeschlossen && (
                <button onClick={() => aktualisieren({ machine_status: 'in_betrieb' }, 'Maschine läuft wieder, Ausfallzeit festgeschrieben.')}
                        disabled={busy} className="btn-done mt-3 w-full">
                  <Play className="h-5 w-5" /> Maschine läuft wieder
                </button>
              )}
            </div>
          ) : (
            <div className="mt-3">
              {Number(order.downtime_hours) > 0 ? (
                <p className="text-[14px]">
                  Ausfall beendet: <span className="num font-semibold">{fmtHours(order.downtime_hours)}</span>
                  <span className="block text-[13px] text-steel">
                    {fmtDateTime(order.downtime_start)} bis {fmtDateTime(order.downtime_end)}
                    {order.fault_reason ? ` · ${order.fault_reason}` : ''}
                  </span>
                </p>
              ) : (
                <p className="text-[14px] text-steel">Kein Stillstand erfasst, die Anlage lief durchgehend.</p>
              )}
              {!abgeschlossen && (
                <button onClick={() => {
                  const grund = prompt('Störungsgrund (Pflicht bei Stillstand)', order.fault_reason || '')
                  if (grund?.trim()) aktualisieren({ machine_status: 'stillstand', fault_reason: grund.trim() },
                    'Stillstand erfasst, die Ausfalluhr läuft.')
                }} disabled={busy} className="btn-ghost mt-3 w-full">
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
          {order.kind === 'unplanmaessig' && (
            <div>
              <label className="label">Störungsgrund</label>
              <input list="ursachen2" className="field" value={entwurf.fault_reason} disabled={abgeschlossen}
                     onChange={(e) => setEntwurf({ ...entwurf, fault_reason: e.target.value })} />
              <datalist id="ursachen2">{CAUSES.map((c) => <option key={c} value={c} />)}</datalist>
            </div>
          )}
          <div>
            <label className="label">Getauschte Ersatzteile</label>
            <input className="field" value={entwurf.parts} disabled={abgeschlossen}
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
            <label className="label">Notizen</label>
            <textarea className="field min-h-[96px] py-2" value={entwurf.notes} disabled={abgeschlossen}
                      onChange={(e) => setEntwurf({ ...entwurf, notes: e.target.value })} />
          </div>
          {!abgeschlossen && (
            <button onClick={erfassungSpeichern} disabled={busy} className="btn-ghost w-full">Dokumentation speichern</button>
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
          <button onClick={() => aktualisieren({ status: 'in_bearbeitung' }, 'Bearbeitung gestartet.')}
                  disabled={busy} className="btn-primary w-full">
            <Play className="h-5 w-5" /> Bearbeitung starten
          </button>
        )}

        {order.status === 'in_bearbeitung' && (
          <>
            {offeneSchritte > 0 && (
              <p className="rounded-card bg-signal/15 px-3 py-2 text-[13px] text-[#8a5c00]">
                Noch {offeneSchritte} offene{offeneSchritte === 1 ? 'r Schritt' : ' Schritte'}.
              </p>
            )}
            {stillstand && (
              <p className="rounded-card bg-stop/10 px-3 py-2 text-[13px] text-stop">
                Die Maschine steht noch still. Beim Fertigmelden wird gefragt, ob sie wieder läuft.
              </p>
            )}
            <button onClick={() => setFertigOffen(true)} disabled={busy} className="btn-signal w-full">
              <ClipboardCheck className="h-5 w-5" /> Fertigmelden
            </button>
          </>
        )}

        {order.status === 'fertig_zur_abnahme' && (
          sperre ? (
            <div className="rounded-card border border-stop/30 bg-stop/5 p-3">
              <p className="flex items-start gap-2 text-sm font-semibold text-stop">
                <Lock className="mt-0.5 h-4 w-4 shrink-0" /> Prüfung durch Sie nicht möglich
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-stop/90">{sperre}</p>
              <button disabled className="btn-done mt-3 w-full">
                <Lock className="h-5 w-5" /> Abnehmen &amp; abschließen
              </button>
            </div>
          ) : (
            <>
              <p className="text-[13px] text-steel">
                Fertig gemeldet von {order.fertig?.full_name || 'unbekannt'} am {fmtDateTime(order.completed_at)}.
              </p>
              <button onClick={() => {
                if (confirm('Auftrag abnehmen und ins Archiv verschieben?'))
                  aktualisieren({ status: 'abgeschlossen' }, 'Abgenommen und archiviert.')
              }} disabled={busy} className="btn-done w-full">
                <ShieldCheck className="h-5 w-5" /> Freigeben &amp; abschließen
              </button>
              <button onClick={() => setReklaOffen(true)} disabled={busy} className="btn-stop w-full">
                <XCircle className="h-5 w-5" /> Beanstanden
              </button>
            </>
          )
        )}

        {abgeschlossen && (
          <p className="rounded-card bg-done/10 px-3 py-3 text-sm text-done">
            Abgenommen von {order.abnehmer?.full_name || 'unbekannt'} am {fmtDateTime(order.approved_at)}.
            {Number(order.downtime_hours) > 0 && ` Ausfallzeit ${fmtHours(order.downtime_hours)}.`}
          </p>
        )}
      </section>

      <FertigDialog open={fertigOffen} onClose={() => setFertigOffen(false)} order={order}
                    offeneSchritte={offeneSchritte}
                    onFertig={async (wiederInBetrieb) => {
                      setFertigOffen(false)
                      await aktualisieren({
                        status: 'fertig_zur_abnahme',
                        completed_by: user.id,
                        repair_date: order.repair_date || new Date().toISOString().slice(0, 10),
                        ...(wiederInBetrieb ? { machine_status: 'in_betrieb' } : {})
                      }, 'Fertig gemeldet. Der Auftrag wartet auf die Abnahme durch eine andere Person.')
                    }} />

      <ReklamationDialog open={reklaOffen} onClose={() => setReklaOffen(false)}
                         onSenden={async (notiz) => {
                           setReklaOffen(false)
                           await aktualisieren({ status: 'offen', qm_notes: notiz },
                             'Beanstandet. Der Auftrag liegt wieder bei der Technik.')
                         }} />
    </div>
  )
}

function FertigDialog({ open, onClose, order, offeneSchritte, onFertig }) {
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
          Der Auftrag wechselt auf „Fertig zur Abnahme“ und wird einer zweiten Person zur Prüfung vorgelegt.
        </p>
        {stillstand ? (
          <>
            <p className="rounded-card bg-stop/5 px-3 py-2 text-[13px] text-stop">
              Läuft die Maschine wieder? Damit stoppt die Ausfalluhr.
            </p>
            <div className="grid gap-2">
              <button onClick={() => onFertig(true)} className="btn-done">
                Maschine läuft wieder – fertigmelden
              </button>
              <button onClick={() => onFertig(false)} className="btn-ghost">
                Maschine steht weiterhin still
              </button>
            </div>
          </>
        ) : (
          <button onClick={() => onFertig(false)} className="btn-signal w-full">Fertigmelden</button>
        )}
      </div>
    </Modal>
  )
}

function ReklamationDialog({ open, onClose, onSenden }) {
  const [notiz, setNotiz] = useState('')
  return (
    <Modal open={open} onClose={onClose} title="Auftrag beanstanden">
      <div className="space-y-3">
        <p className="text-[14px] leading-relaxed">
          Der Auftrag geht mit Ihrer Notiz zurück auf „Offen“ und erscheint erneut bei der Technik.
        </p>
        <div>
          <label className="label">Was ist nachzuarbeiten? (Pflicht)</label>
          <textarea className="field min-h-[120px] py-2" value={notiz} onChange={(e) => setNotiz(e.target.value)}
                    placeholder="z. B. Dichtung sitzt nicht bündig, bitte nachziehen und Foto ergänzen." />
        </div>
        <button onClick={() => notiz.trim() && onSenden(notiz.trim())}
                disabled={!notiz.trim()} className="btn-stop w-full">
          <XCircle className="h-5 w-5" /> Beanstandung senden
        </button>
      </div>
    </Modal>
  )
}
