import { useEffect, useRef, useState } from 'react'
import { X, Upload, Loader2, FileText, Image as ImageIcon, Download } from 'lucide-react'
import QRCode from 'qrcode'
import { STATUS, PRIORITY, FAULT_CAUSES } from '../lib/domain'
import { uploadFile, mediaUrl } from '../lib/supabase'

export function StatusBadge({ status }) {
  const s = STATUS[status] ?? STATUS.offen
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[12px] font-semibold ${s.tone}`}>
      {s.label}
    </span>
  )
}

export function PriorityBadge({ priority }) {
  const p = PRIORITY[priority] ?? PRIORITY.mittel
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-[12px] font-semibold ${p.tone}`}>
      {p.label}
    </span>
  )
}

export function Spinner({ text = 'Wird geladen' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-steel">
      <Loader2 className="h-5 w-5 animate-spin" /> {text}
    </div>
  )
}

export function Empty({ title, hint, action }) {
  return (
    <div className="card p-8 text-center">
      <p className="font-semibold">{title}</p>
      {hint && <p className="mt-1 text-sm text-steel">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

export function Fehler({ text }) {
  if (!text) return null
  return (
    <p className="rounded-card border border-stop/30 bg-stop/5 px-3 py-2 text-sm text-stop">{text}</p>
  )
}

export function Modal({ open, onClose, title, children, wide }) {
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose()
    if (open) document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/50 p-0 sm:p-4"
         onClick={onClose}>
      <div className={`w-full ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'} max-h-[92vh] overflow-y-auto
                       rounded-t-2xl sm:rounded-card bg-white`}
           onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-black/10 bg-white px-4 py-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Schließen" className="btn-ghost !min-h-[40px] !px-2">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}

/**
 * Datei-Upload. capture="environment" öffnet am Smartphone direkt die Kamera.
 */
export function FileUpload({ prefix, onUploaded, accept = 'image/*,application/pdf', kamera = false, label = 'Datei hinzufügen' }) {
  const [busy, setBusy] = useState(false)
  const [fehler, setFehler] = useState(null)
  const ref = useRef(null)

  async function handle(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setBusy(true); setFehler(null)
    try {
      for (const f of files) {
        const path = await uploadFile(f, prefix)
        await onUploaded({ file_path: path, file_name: f.name, type: f.type })
      }
    } catch (err) {
      setFehler(err.message || 'Upload fehlgeschlagen. Bitte erneut versuchen.')
    } finally {
      setBusy(false)
      if (ref.current) ref.current.value = ''
    }
  }

  return (
    <div>
      <input ref={ref} type="file" multiple accept={accept}
             capture={kamera ? 'environment' : undefined}
             onChange={handle} className="hidden" id={`up-${prefix}`} />
      <label htmlFor={`up-${prefix}`} className="btn-ghost w-full cursor-pointer">
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
        {busy ? 'Wird hochgeladen' : label}
      </label>
      <Fehler text={fehler} />
    </div>
  )
}

export function MediaListe({ items, onDelete }) {
  if (!items?.length) return <p className="text-sm text-steel">Noch keine Dateien hinterlegt.</p>
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {items.map((m) => {
        const url = mediaUrl(m.file_path)
        const bild = /\.(png|jpe?g|webp|gif|heic)$/i.test(m.file_name)
        return (
          <li key={m.id} className="card overflow-hidden">
            <a href={url} target="_blank" rel="noreferrer" className="block">
              {bild ? (
                <img src={url} alt={m.file_name} loading="lazy" className="h-28 w-full object-cover" />
              ) : (
                <div className="flex h-28 items-center justify-center bg-hall text-steel">
                  <FileText className="h-8 w-8" />
                </div>
              )}
              <p className="truncate px-2 py-1.5 text-[12px]">{m.file_name}</p>
            </a>
            {onDelete && (
              <button onClick={() => onDelete(m)} className="w-full border-t border-black/10 py-1.5 text-[12px] text-stop">
                Entfernen
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function QrCode({ text, size = 220, filename = 'qr-code' }) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    QRCode.toDataURL(text, { width: size, margin: 1, color: { dark: '#0E1A24', light: '#FFFFFF' } })
      .then(setSrc)
      .catch(() => setSrc(null))
  }, [text, size])
  if (!src) return <div className="h-[220px] w-[220px] animate-pulse rounded-card bg-hall" />
  return (
    <div className="flex flex-col items-center gap-3">
      <img src={src} alt="QR-Code zur Maschinenakte" width={size} height={size} className="rounded-card border border-black/10" />
      <a href={src} download={`${filename}.png`} className="btn-ghost">
        <Download className="h-5 w-5" /> QR-Code speichern
      </a>
      <p className="max-w-xs break-all text-center text-[12px] text-steel">{text}</p>
    </div>
  )
}

export function Kennzahl({ wert, label, ton = 'text-ink', icon: Icon }) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between">
        <p className={`num text-3xl font-bold ${ton}`}>{wert}</p>
        {Icon && <Icon className="h-5 w-5 text-steel" />}
      </div>
      <p className="mt-1 text-[13px] text-steel">{label}</p>
    </div>
  )
}

export { ImageIcon }

/** Auswahl "Grund der Störung" (entspricht dem ENUM fault_cause_kind). */
export function GrundSelect({ value, onChange, disabled, leer = 'Bitte wählen', id }) {
  return (
    <select id={id} className="field" value={value || ''} disabled={disabled}
            onChange={(e) => onChange(e.target.value)}>
      <option value="">{leer}</option>
      {Object.entries(FAULT_CAUSES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
    </select>
  )
}
