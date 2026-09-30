import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldCheck, Lock, XCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import {
  abnahmeGesperrt, fmtDateTime, fmtDauer, fmtHours, effektiveAusfallzeit, grundText
} from '../lib/domain'
import { fehlerText } from '../lib/fehler'
import { StatusBadge, PriorityBadge, Modal, Fehler, Empty } from './ui'

/**
 * Liste abnahmebereiter Aufträge mit Freigabe und Beanstandung.
 * Wird im Auftrags-Reiter "Zur Abnahme" und im QM-Modul verwendet.
 */
export default function AbnahmeListe({ auftraege, onGeaendert, leerText }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(null)
  const [fehler, setFehler] = useState(null)
  const [hinweis, setHinweis] = useState(null)
  const [reklaFuer, setReklaFuer] = useState(null)

  async function freigeben(o) {
    if (!confirm(`Auftrag #${o.order_no} freigeben und ins Archiv verschieben?`)) return
    setBusy(o.id); setFehler(null); setHinweis(null)
    const { error } = await supabase.from('work_orders').update({ status: 'abgeschlossen' }).eq('id', o.id)
    setBusy(null)
    if (error) return setFehler(fehlerText(error))
    setHinweis(`Auftrag #${o.order_no} freigegeben und archiviert.`)
    onGeaendert?.()
  }

  async function beanstanden(o, notiz) {
    setReklaFuer(null); setBusy(o.id); setFehler(null); setHinweis(null)
    const { error } = await supabase.from('work_orders')
      .update({ status: 'offen', qm_notes: notiz }).eq('id', o.id)
    setBusy(null)
    if (error) return setFehler(fehlerText(error))
    setHinweis(`Auftrag #${o.order_no} beanstandet und an die Technik zurückgegeben.`)
    onGeaendert?.()
  }

  return (
    <div className="space-y-3">
      <Fehler text={fehler} />
      {hinweis && <p className="rounded-card bg-done/10 px-3 py-2 text-sm text-done">{hinweis}</p>}

      {auftraege.length === 0 ? (
        <Empty title="Keine Aufträge zur Abnahme"
               hint={leerText || 'Fertig gemeldete Aufträge erscheinen hier, bis sie freigegeben oder beanstandet werden.'} />
      ) : (
        <ul className="space-y-3">
          {auftraege.map((o) => {
            const sperre = abnahmeGesperrt(o, user?.id)
            const ausfall = effektiveAusfallzeit(o)
            return (
              <li key={o.id} className="card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="num text-[12px] text-steel">#{o.order_no}</span>
                  <StatusBadge status={o.status} />
                  <PriorityBadge priority={o.priority} />
                  <span className="rounded bg-hall px-2 py-0.5 text-[12px] text-steel">
                    {o.kind === 'planmaessig' ? 'Wartung' : 'Störung'}
                  </span>
                  {o.rejected_count > 0 && (
                    <span className="rounded bg-stop/10 px-2 py-0.5 text-[12px] font-semibold text-stop">
                      {o.rejected_count}× beanstandet
                    </span>
                  )}
                </div>

                <button onClick={() => navigate(`/auftraege/${o.id}`)} className="mt-1 block w-full text-left">
                  <p className="font-semibold">{o.title}</p>
                  <p className="text-[13px] text-steel">
                    {o.rooms?.departments?.name} · {o.rooms?.name}{o.machines?.name ? ` · ${o.machines.name}` : ''}
                  </p>
                </button>

                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
                  <div><dt className="text-steel">Fertig gemeldet</dt>
                    <dd className="font-medium">{o.fertig?.full_name || 'unbekannt'}, {fmtDateTime(o.completed_at)}</dd></div>
                  {Number(o.work_seconds) > 0 && (
                    <div><dt className="text-steel">Reparaturzeit</dt>
                      <dd className="font-medium">{fmtDauer(o.work_seconds)}</dd></div>
                  )}
                  {ausfall > 0 && (
                    <div><dt className="text-steel">Ausfallzeit</dt>
                      <dd className="font-medium">{fmtHours(ausfall)}</dd></div>
                  )}
                  {o.kind === 'unplanmaessig' && (
                    <div><dt className="text-steel">Grund der Störung</dt>
                      <dd className="font-medium">{grundText(o)}</dd></div>
                  )}
                </dl>

                {sperre ? (
                  <div className="mt-3 rounded-card border border-stop/30 bg-stop/5 p-3">
                    <p className="flex items-start gap-2 text-[13px] font-semibold text-stop">
                      <Lock className="mt-0.5 h-4 w-4 shrink-0" /> {sperre}
                    </p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <button disabled className="btn-done"><Lock className="h-5 w-5" /> Freigeben</button>
                      <button disabled className="btn-stop"><Lock className="h-5 w-5" /> Beanstanden</button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <button onClick={() => freigeben(o)} disabled={busy === o.id} className="btn-done">
                      <ShieldCheck className="h-5 w-5" /> Freigeben
                    </button>
                    <button onClick={() => setReklaFuer(o)} disabled={busy === o.id} className="btn-stop">
                      <XCircle className="h-5 w-5" /> Beanstanden
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {reklaFuer && (
        <BeanstandungDialog auftrag={reklaFuer} onClose={() => setReklaFuer(null)}
                            onSenden={(notiz) => beanstanden(reklaFuer, notiz)} />
      )}
    </div>
  )
}

function BeanstandungDialog({ auftrag, onClose, onSenden }) {
  const [notiz, setNotiz] = useState('')
  return (
    <Modal open onClose={onClose} title={`Auftrag #${auftrag.order_no} beanstanden`}>
      <div className="space-y-3">
        <p className="text-[14px] leading-relaxed">
          Der Auftrag geht mit Ihrer Notiz zurück auf „Offen“ und wird der Technik erneut vorgelegt.
        </p>
        <div>
          <label className="label">Was ist nachzuarbeiten? (Pflicht)</label>
          <textarea className="field min-h-[120px] py-2" value={notiz} onChange={(e) => setNotiz(e.target.value)}
                    placeholder="Konkret beschreiben, was fehlt oder nicht in Ordnung ist." />
        </div>
        <button onClick={() => notiz.trim() && onSenden(notiz.trim())} disabled={!notiz.trim()} className="btn-stop w-full">
          <XCircle className="h-5 w-5" /> Beanstandung senden
        </button>
      </div>
    </Modal>
  )
}
