import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, QrCode as QrIcon, Pencil, FileText, Camera, History, Printer,
  ListChecks, Plus, Trash2, Timer
} from 'lucide-react'
import { supabase, mediaUrl } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { CYCLES, fmtDate, fmtDateTime, fmtHours, isOverdue, effektiveAusfallzeit } from '../lib/domain'
import { Spinner, Modal, QrCode, FileUpload, MediaListe, StatusBadge, Fehler, Kennzahl } from '../components/ui'
import { MaschineForm } from './Maschinen'
import { useStruktur } from '../components/Objektwahl'

const REITER = [
  { key: 'stammdaten', label: 'Stammdaten' },
  { key: 'checkliste', label: 'Wartungsplan' },
  { key: 'dateien',    label: 'Dateien' },
  { key: 'ausfaelle',  label: 'Ausfälle' },
  { key: 'historie',   label: 'Historie' }
]

export default function MaschineDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const struktur = useStruktur()

  const [m, setM] = useState(null)
  const [medien, setMedien] = useState([])
  const [historie, setHistorie] = useState([])
  const [vorlage, setVorlage] = useState([])
  const [reiter, setReiter] = useState('stammdaten')
  const [qrOffen, setQrOffen] = useState(false)
  const [editOffen, setEditOffen] = useState(false)
  const [neuerPunkt, setNeuerPunkt] = useState('')
  const [fehler, setFehler] = useState(null)

  const laden = useCallback(async () => {
    const [mm, med, hist, vl] = await Promise.all([
      supabase.from('machines_due').select('*').eq('id', id).single(),
      supabase.from('machine_media').select('*').eq('machine_id', id).order('created_at', { ascending: false }),
      supabase.from('work_orders')
        .select('id,order_no,title,kind,status,downtime_hours,downtime_start,downtime_end,machine_status,fault_reason,repair_date,created_at,replaced_parts')
        .eq('machine_id', id).order('created_at', { ascending: false }),
      supabase.from('machine_checklists').select('*').eq('machine_id', id).order('position')
    ])
    if (mm.error) return setFehler(mm.error.message)
    setM(mm.data); setMedien(med.data ?? []); setHistorie(hist.data ?? []); setVorlage(vl.data ?? [])
  }, [id])

  useEffect(() => { laden() }, [laden])
  if (!m) return <Spinner text="Maschinenakte wird geladen" />

  const qrText = `${window.location.origin}/maschinen/${m.id}`
  const dokumente = medien.filter((x) => x.kind !== 'foto')
  const fotos = medien.filter((x) => x.kind === 'foto')
  const ausfaelle = historie.filter((h) => h.downtime_start)
  const ausfallSumme = ausfaelle.reduce((s, h) => s + effektiveAusfallzeit(h), 0)

  const medienHinzu = (kind) => async ({ file_path, file_name }) => {
    const { error } = await supabase.from('machine_media')
      .insert({ machine_id: id, kind, file_path, file_name, uploaded_by: user.id })
    if (error) return setFehler(error.message)
    laden()
  }

  async function punktHinzu() {
    if (!neuerPunkt.trim()) return
    await supabase.from('machine_checklists')
      .insert({ machine_id: id, label: neuerPunkt.trim(), position: vorlage.length })
    setNeuerPunkt(''); laden()
  }

  async function punktLoeschen(pid) {
    await supabase.from('machine_checklists').delete().eq('id', pid)
    laden()
  }

  function drucken() {
    window.print()
  }

  return (
    <div className="space-y-5">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm font-medium text-steel print:hidden">
        <ArrowLeft className="h-4 w-4" /> Zurück
      </button>

      <header className="card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold leading-snug">{m.name}</h1>
            <p className="text-[13px] text-steel">
              {m.department_name} · {m.room_name}{m.manufacturer ? ` · ${m.manufacturer}` : ''}
            </p>
          </div>
          <div className="flex shrink-0 gap-2 print:hidden">
            <button onClick={() => setQrOffen(true)} aria-label="QR-Code" className="btn-ghost !min-h-[42px] !px-3">
              <QrIcon className="h-5 w-5" />
            </button>
            <button onClick={() => setEditOffen(true)} aria-label="Bearbeiten" className="btn-ghost !min-h-[42px] !px-3">
              <Pencil className="h-5 w-5" />
            </button>
          </div>
        </div>
        {m.next_due && (
          <p className={`mt-3 rounded-card px-3 py-2 text-[13px] font-semibold
                         ${isOverdue(m.next_due) ? 'bg-stop/10 text-stop' : 'bg-signal/15 text-[#8a5c00]'}`}>
            Nächste Wartung {fmtDate(m.next_due)}{isOverdue(m.next_due) ? ' – überfällig' : ''}
            {m.cycle ? ` · ${CYCLES[m.cycle].label}` : ''}
          </p>
        )}
      </header>

      <div className="grid grid-cols-3 gap-3 print:hidden">
        <Kennzahl wert={historie.length} label="Aufträge gesamt" />
        <Kennzahl wert={ausfaelle.length} label="Ausfälle" ton="text-stop" />
        <Kennzahl wert={fmtHours(ausfallSumme)} label="Ausfallzeit" />
      </div>

      <Fehler text={fehler} />

      <div className="flex gap-1 overflow-x-auto rounded-card border border-black/[0.08] bg-white p-1 print:hidden">
        {REITER.map((r) => (
          <button key={r.key} onClick={() => setReiter(r.key)}
            className={`min-h-[44px] flex-1 whitespace-nowrap rounded-card px-3 text-[13px] font-semibold
                        ${reiter === r.key ? 'bg-ink text-white' : 'text-steel'}`}>
            {r.label}
          </button>
        ))}
      </div>

      {reiter === 'stammdaten' && (
        <section className="card p-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[14px]">
            <div><dt className="text-steel">Abteilung</dt><dd className="font-medium">{m.department_name}</dd></div>
            <div><dt className="text-steel">Raum</dt><dd className="font-medium">{m.room_name}</dd></div>
            <div><dt className="text-steel">Zyklus</dt>
              <dd className="font-medium">{m.cycle ? CYCLES[m.cycle].label : 'kein Zyklus'}</dd></div>
            <div><dt className="text-steel">Letzte Wartung</dt>
              <dd className="font-medium">{fmtDate(m.last_maintenance)}</dd></div>
          </dl>
          <div className="mt-4">
            <p className="label">Ersatzteile</p>
            {m.spare_parts?.length ? (
              <ul className="flex flex-wrap gap-2">
                {m.spare_parts.map((t) => (
                  <li key={t} className="rounded-full bg-hall px-3 py-1.5 text-[13px] font-medium">{t}</li>
                ))}
              </ul>
            ) : <p className="text-sm text-steel">Keine Ersatzteile hinterlegt.</p>}
          </div>
          {m.notes && (
            <div className="mt-4">
              <p className="label">Bemerkungen</p>
              <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{m.notes}</p>
            </div>
          )}
        </section>
      )}

      {reiter === 'checkliste' && (
        <section className="card p-4">
          <h2 className="mb-1 flex items-center gap-2 font-semibold">
            <ListChecks className="h-4 w-4" /> Wartungsplan dieser Maschine
          </h2>
          <p className="mb-3 text-[13px] text-steel">
            Diese Punkte werden bei jedem planmäßigen Auftrag für diese Maschine übernommen und
            lassen sich dort für den Einzelfall anpassen.
          </p>
          <ul className="space-y-1.5">
            {vorlage.map((p, i) => (
              <li key={p.id} className="flex items-center gap-3 rounded-card bg-hall px-3 py-2.5">
                <span className="num text-[12px] text-steel">{i + 1}</span>
                <span className="flex-1 text-[14px]">{p.label}</span>
                <button onClick={() => punktLoeschen(p.id)} aria-label="Punkt entfernen" className="text-stop">
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
            {vorlage.length === 0 && <li className="text-sm text-steel">Noch keine Wartungsmaßnahmen hinterlegt.</li>}
          </ul>
          <div className="mt-3 flex gap-2">
            <input className="field flex-1" value={neuerPunkt} onChange={(e) => setNeuerPunkt(e.target.value)}
                   placeholder="Neue Wartungsmaßnahme"
                   onKeyDown={(e) => e.key === 'Enter' && punktHinzu()} />
            <button onClick={punktHinzu} className="btn-primary"><Plus className="h-5 w-5" /></button>
          </div>
        </section>
      )}

      {reiter === 'dateien' && (
        <section className="card space-y-4 p-4">
          <div>
            <h2 className="mb-2 flex items-center gap-2 font-semibold">
              <FileText className="h-4 w-4" /> Bedienungsanleitungen und Dokumente
            </h2>
            <FileUpload prefix={`maschinen/${id}/dokumente`} accept="application/pdf"
                        onUploaded={medienHinzu('anleitung')} label="PDF hochladen" />
            <div className="mt-3"><MediaListe items={dokumente} onDelete={async (x) => {
              await supabase.from('machine_media').delete().eq('id', x.id); laden()
            }} /></div>
          </div>
          <div className="border-t border-black/[0.08] pt-4">
            <h2 className="mb-2 flex items-center gap-2 font-semibold"><Camera className="h-4 w-4" /> Fotos</h2>
            <FileUpload prefix={`maschinen/${id}/fotos`} accept="image/*" kamera
                        onUploaded={medienHinzu('foto')} label="Foto aufnehmen" />
            <div className="mt-3"><MediaListe items={fotos} onDelete={async (x) => {
              await supabase.from('machine_media').delete().eq('id', x.id); laden()
            }} /></div>
          </div>
        </section>
      )}

      {reiter === 'ausfaelle' && (
        <section className="card">
          <header className="flex items-center justify-between border-b border-black/10 px-4 py-3">
            <h2 className="flex items-center gap-2 font-semibold"><Timer className="h-4 w-4" /> Ausfallhistorie</h2>
            <span className="num text-[13px] font-semibold">{fmtHours(ausfallSumme)}</span>
          </header>
          {ausfaelle.length === 0 ? (
            <p className="p-4 text-sm text-steel">Für diese Maschine ist kein Stillstand erfasst.</p>
          ) : (
            <ul className="divide-y divide-black/[0.06]">
              {ausfaelle.map((h) => {
                const laeuft = h.machine_status === 'stillstand'
                return (
                  <li key={h.id}>
                    <Link to={`/auftraege/${h.id}`} className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-hall">
                      <span className="min-w-0">
                        <span className="block font-medium">{h.fault_reason || 'Ohne Angabe'}</span>
                        <span className="block text-[13px] text-steel">
                          {fmtDateTime(h.downtime_start)} bis {h.downtime_end ? fmtDateTime(h.downtime_end) : 'jetzt'}
                        </span>
                      </span>
                      <span className={`num shrink-0 font-semibold ${laeuft ? 'text-stop' : ''}`}>
                        {fmtHours(effektiveAusfallzeit(h))}
                        {laeuft && <span className="block text-[11px]">läuft</span>}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {reiter === 'historie' && (
        <section className="card">
          <header className="flex items-center gap-2 border-b border-black/10 px-4 py-3">
            <History className="h-4 w-4" /> <h2 className="font-semibold">Wartungen und Reparaturen</h2>
          </header>
          {historie.length === 0 ? (
            <p className="p-4 text-sm text-steel">Noch kein Auftrag erfasst.</p>
          ) : (
            <ul className="divide-y divide-black/[0.06]">
              {historie.map((h) => (
                <li key={h.id}>
                  <Link to={`/auftraege/${h.id}`} className="block px-4 py-3 hover:bg-hall">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="num text-[12px] text-steel">#{h.order_no}</span>
                      <StatusBadge status={h.status} />
                      <span className="rounded bg-hall px-2 py-0.5 text-[12px] text-steel">
                        {h.kind === 'planmaessig' ? 'Wartung' : 'Störung'}
                      </span>
                    </div>
                    <p className="mt-1 font-medium">{h.title}</p>
                    <p className="text-[13px] text-steel">
                      {fmtDate(h.repair_date || h.created_at)}
                      {Number(h.downtime_hours) > 0 && ` · Ausfall ${fmtHours(h.downtime_hours)}`}
                      {h.fault_reason && ` · ${h.fault_reason}`}
                    </p>
                    {h.replaced_parts?.length > 0 && (
                      <p className="text-[12px] text-steel">Ersatzteile: {h.replaced_parts.join(', ')}</p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <Modal open={qrOffen} onClose={() => setQrOffen(false)} title="QR-Code für die Maschine">
        <div id="qr-druck" className="space-y-4">
          <p className="text-sm text-steel">
            Ausdrucken und an der Anlage anbringen. Beim Scannen öffnet sich diese Maschinenakte
            mit Anleitungen, Historie und offenen Aufträgen.
          </p>
          <div className="rounded-card border border-black/10 p-5 text-center">
            <p className="mb-3 text-lg font-bold">{m.name}</p>
            <p className="mb-4 text-[13px] text-steel">{m.department_name} · {m.room_name}</p>
            <QrCode text={qrText} filename={`qr-${m.name.replace(/\s+/g, '-')}`} />
          </div>
          <button onClick={drucken} className="btn-primary w-full print:hidden">
            <Printer className="h-5 w-5" /> QR-Schild drucken
          </button>
        </div>
      </Modal>

      <MaschineForm open={editOffen} onClose={() => setEditOffen(false)} struktur={struktur} vorgabe={m}
                    onSaved={() => { setEditOffen(false); laden() }} />
    </div>
  )
}
