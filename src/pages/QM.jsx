import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldCheck, Lock, Plus, FileCheck2, AlertOctagon, XCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { fmtDate, fmtDateTime, fmtHours, abnahmeGesperrt } from '../lib/domain'
import { Spinner, Empty, Modal, Fehler, StatusBadge, PriorityBadge } from '../components/ui'
import { useStruktur } from '../components/Objektwahl'

export default function QM() {
  const { user, isQM, profile } = useAuth()
  const navigate = useNavigate()
  const struktur = useStruktur()
  const [reiter, setReiter] = useState('abnahmen')
  const [abnahmen, setAbnahmen] = useState(null)
  const [records, setRecords] = useState([])
  const [neuOffen, setNeuOffen] = useState(false)
  const [reklaFuer, setReklaFuer] = useState(null)
  const [fehler, setFehler] = useState(null)
  const [hinweis, setHinweis] = useState(null)
  const [busy, setBusy] = useState(null)

  const laden = useCallback(async () => {
    const [a, r] = await Promise.all([
      supabase.from('work_orders')
        .select('*, machines(name), rooms(name,departments(name)), fertig:completed_by(full_name,role)')
        .eq('status', 'fertig_zur_abnahme').order('completed_at'),
      supabase.from('qm_records')
        .select('*, machines(name), ersteller:created_by(full_name), freigeber:released_by(full_name)')
        .order('created_at', { ascending: false })
    ])
    if (a.error) setFehler(a.error.message)
    setAbnahmen(a.data ?? []); setRecords(r.data ?? [])
  }, [])
  useEffect(() => { laden() }, [laden])

  async function freigeben(o) {
    setBusy(o.id); setFehler(null); setHinweis(null)
    const { error } = await supabase.from('work_orders').update({ status: 'abgeschlossen' }).eq('id', o.id)
    setBusy(null)
    if (error) return setFehler(error.message)
    setHinweis(`Auftrag #${o.order_no} freigegeben und archiviert.`)
    laden()
  }

  async function beanstanden(o, notiz) {
    setBusy(o.id); setFehler(null); setHinweis(null); setReklaFuer(null)
    const { error } = await supabase.from('work_orders')
      .update({ status: 'offen', qm_notes: notiz }).eq('id', o.id)
    setBusy(null)
    if (error) return setFehler(error.message)
    setHinweis(`Auftrag #${o.order_no} beanstandet und an die Technik zurückgegeben.`)
    laden()
  }

  async function protokollFreigeben(r) {
    setBusy(r.id)
    const { error } = await supabase.from('qm_records').update({ released: true }).eq('id', r.id)
    setBusy(null)
    if (error) return setFehler(error.message)
    setHinweis('Freigabe erteilt.'); laden()
  }

  if (!abnahmen) return <Spinner text="Prüfliste wird geladen" />

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Prüfung und Abnahme</h1>
        <p className="text-sm text-steel">
          Angemeldet als {profile?.full_name} ({profile?.role}).
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-card border border-black/[0.08] bg-white p-1">
        {[
          { key: 'abnahmen', label: 'Zur Abnahme', anzahl: abnahmen.length },
          { key: 'meldungen', label: 'Meldungen', anzahl: records.filter((r) => !r.released).length }
        ].map((t) => (
          <button key={t.key} onClick={() => setReiter(t.key)}
            className={`flex min-h-[52px] items-center justify-center gap-2 rounded-card text-sm font-semibold
                        ${reiter === t.key ? 'bg-ink text-white' : 'text-steel'}`}>
            {t.label}
            <span className={`num rounded-full px-2 py-0.5 text-[12px] ${reiter === t.key ? 'bg-white/20' : 'bg-hall'}`}>
              {t.anzahl}
            </span>
          </button>
        ))}
      </div>

      <Fehler text={fehler} />
      {hinweis && <p className="rounded-card bg-done/10 px-3 py-2 text-sm text-done">{hinweis}</p>}

      {reiter === 'abnahmen' && (
        abnahmen.length === 0
          ? <Empty title="Keine offenen Abnahmen" hint="Fertig gemeldete Aufträge erscheinen hier." />
          : (
            <ul className="space-y-3">
              {abnahmen.map((o) => {
                const sperre = abnahmeGesperrt(o, user?.id)
                return (
                  <li key={o.id} className="card p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="num text-[12px] text-steel">#{o.order_no}</span>
                      <StatusBadge status={o.status} />
                      <PriorityBadge priority={o.priority} />
                      {o.rejected_count > 0 && (
                        <span className="rounded bg-stop/10 px-2 py-0.5 text-[12px] font-semibold text-stop">
                          {o.rejected_count}× beanstandet
                        </span>
                      )}
                    </div>
                    <button onClick={() => navigate(`/auftraege/${o.id}`)} className="mt-1 block text-left">
                      <p className="font-semibold">{o.title}</p>
                      <p className="text-[13px] text-steel">
                        {o.rooms?.departments?.name} · {o.rooms?.name}
                        {o.machines?.name ? ` · ${o.machines.name}` : ''}
                      </p>
                    </button>
                    <p className="mt-2 text-[13px] text-steel">
                      Fertig gemeldet von {o.fertig?.full_name || 'unbekannt'} am {fmtDateTime(o.completed_at)}
                      {Number(o.downtime_hours) > 0 && ` · Ausfall ${fmtHours(o.downtime_hours)}`}
                    </p>

                    {sperre ? (
                      <div className="mt-3 rounded-card border border-stop/30 bg-stop/5 p-3">
                        <p className="flex items-start gap-2 text-[13px] font-semibold text-stop">
                          <Lock className="mt-0.5 h-4 w-4 shrink-0" /> {sperre}
                        </p>
                        <button disabled className="btn-done mt-2 w-full">
                          <Lock className="h-5 w-5" /> Abnehmen &amp; abschließen
                        </button>
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
          )
      )}

      {reiter === 'meldungen' && (
        <div className="space-y-3">
          <button onClick={() => setNeuOffen(true)} className="btn-primary w-full">
            <Plus className="h-5 w-5" /> Meldung oder Prüfprotokoll anlegen
          </button>
          {records.length === 0 ? (
            <Empty title="Keine Einträge" hint="Mängelmeldungen und Prüfprotokolle sammeln sich hier." />
          ) : (
            <ul className="space-y-3">
              {records.map((r) => {
                const eigen = r.created_by === user?.id
                return (
                  <li key={r.id} className="card p-4">
                    <div className="flex items-center gap-2">
                      {r.kind === 'maengelmeldung'
                        ? <AlertOctagon className="h-4 w-4 text-stop" />
                        : <FileCheck2 className="h-4 w-4 text-run" />}
                      <span className="text-[12px] font-semibold text-steel">
                        {r.kind === 'maengelmeldung' ? 'Mängelmeldung' : 'Prüfprotokoll'}
                      </span>
                      <span className={`ml-auto rounded-full px-2.5 py-1 text-[12px] font-semibold
                                        ${r.released ? 'bg-done/10 text-done' : 'bg-signal/20 text-[#8a5c00]'}`}>
                        {r.released ? 'Freigegeben' : 'Offen'}
                      </span>
                    </div>
                    <p className="mt-2 font-semibold">{r.title}</p>
                    {r.body && <p className="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed">{r.body}</p>}
                    <p className="mt-2 text-[12px] text-steel">
                      {r.machines?.name ? `${r.machines.name} · ` : ''}{r.ersteller?.full_name} · {fmtDate(r.created_at)}
                      {r.released && ` · freigegeben von ${r.freigeber?.full_name || 'QM'}`}
                    </p>
                    {!r.released && (
                      isQM && !eigen ? (
                        <button onClick={() => protokollFreigeben(r)} disabled={busy === r.id} className="btn-done mt-3 w-full">
                          <ShieldCheck className="h-5 w-5" /> Freigeben
                        </button>
                      ) : (
                        <p className="mt-3 flex items-center gap-2 rounded-card bg-hall px-3 py-2 text-[13px] text-steel">
                          <Lock className="h-4 w-4 shrink-0" />
                          {eigen ? 'Eigene Einträge können nicht selbst freigegeben werden.'
                                 : 'Freigabe nur durch das Qualitätsmanagement.'}
                        </p>
                      )
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {reklaFuer && (
        <Beanstandung auftrag={reklaFuer} onClose={() => setReklaFuer(null)}
                      onSenden={(notiz) => beanstanden(reklaFuer, notiz)} />
      )}
      <NeuerEintrag open={neuOffen} onClose={() => setNeuOffen(false)} struktur={struktur}
                    userId={user?.id} onSaved={() => { setNeuOffen(false); laden() }} />
    </div>
  )
}

function Beanstandung({ auftrag, onClose, onSenden }) {
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

function NeuerEintrag({ open, onClose, struktur, userId, onSaved }) {
  const [form, setForm] = useState({ kind: 'maengelmeldung', title: '', body: '', machine_id: '' })
  const [busy, setBusy] = useState(false)
  const [fehler, setFehler] = useState(null)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  async function speichern() {
    if (!form.title.trim()) return setFehler('Bitte einen Titel angeben.')
    setBusy(true); setFehler(null)
    const { error } = await supabase.from('qm_records').insert({
      kind: form.kind, title: form.title.trim(), body: form.body.trim() || null,
      machine_id: form.machine_id || null, created_by: userId
    })
    setBusy(false)
    if (error) return setFehler(error.message)
    setForm({ kind: 'maengelmeldung', title: '', body: '', machine_id: '' })
    onSaved()
  }

  return (
    <Modal open={open} onClose={onClose} title="Neuer QM-Eintrag">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {[['maengelmeldung', 'Mängelmeldung'], ['pruefprotokoll', 'Prüfprotokoll']].map(([k, l]) => (
            <button key={k} onClick={() => setForm({ ...form, kind: k })}
              className={`min-h-[48px] rounded-card text-sm font-semibold
                          ${form.kind === k ? 'bg-ink text-white' : 'bg-hall text-steel'}`}>{l}</button>
          ))}
        </div>
        <div><label className="label">Titel</label>
          <input className="field" value={form.title} onChange={set('title')} /></div>
        <div>
          <label className="label">Maschine (optional)</label>
          <select className="field" value={form.machine_id} onChange={set('machine_id')}>
            <option value="">Ohne Maschinenbezug</option>
            {struktur.machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div><label className="label">Beschreibung</label>
          <textarea className="field min-h-[120px] py-2" value={form.body} onChange={set('body')} /></div>
        <Fehler text={fehler} />
        <button onClick={speichern} disabled={busy} className="btn-signal w-full">
          {busy ? 'Wird gespeichert' : 'Eintrag anlegen'}
        </button>
      </div>
    </Modal>
  )
}
