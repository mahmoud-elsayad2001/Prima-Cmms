import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { Fehler } from '../components/ui'

export default function Anmeldung() {
  const { signIn, signUp } = useAuth()
  const [modus, setModus] = useState('anmelden')
  const [form, setForm] = useState({ email: '', password: '', full_name: '', role: 'Technik' })
  const [fehler, setFehler] = useState(null)
  const [info, setInfo] = useState(null)
  const [busy, setBusy] = useState(false)

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  async function absenden(e) {
    e.preventDefault()
    setBusy(true); setFehler(null); setInfo(null)
    try {
      if (modus === 'anmelden') {
        const { error } = await signIn(form.email, form.password)
        if (error) throw error
      } else {
        const { error } = await signUp(form.email, form.password, form.full_name, form.role)
        if (error) throw error
        setInfo('Konto angelegt. Falls die E-Mail-Bestätigung aktiv ist, bitte zuerst den Link in der E-Mail öffnen.')
        setModus('anmelden')
      }
    } catch (err) {
      setFehler(uebersetze(err.message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <span className="h-10 w-2 rounded-full bg-signal" />
          <div>
            <h1 className="text-2xl font-bold text-white">Instandhaltung</h1>
            <p className="text-sm text-white/60">Wartung, Störungen und Abnahmen für Industrieanlagen</p>
          </div>
        </div>

        <form onSubmit={absenden} className="card space-y-4 p-5">
          <div className="grid grid-cols-2 gap-2">
            {['anmelden', 'registrieren'].map((m) => (
              <button key={m} type="button" onClick={() => { setModus(m); setFehler(null) }}
                className={`min-h-[44px] rounded-card text-sm font-semibold
                            ${modus === m ? 'bg-ink text-white' : 'bg-hall text-steel'}`}>
                {m === 'anmelden' ? 'Anmelden' : 'Konto anlegen'}
              </button>
            ))}
          </div>

          {modus === 'registrieren' && (
            <>
              <div>
                <label className="label" htmlFor="name">Name</label>
                <input id="name" className="field" value={form.full_name} onChange={set('full_name')}
                       placeholder="Vor- und Nachname" required />
              </div>
              <div>
                <label className="label" htmlFor="rolle">Rolle</label>
                <select id="rolle" className="field" value={form.role} onChange={set('role')}>
                  <option value="Technik">Technik</option>
                  <option value="QM">Qualitätsmanagement</option>
                </select>
              </div>
            </>
          )}

          <div>
            <label className="label" htmlFor="email">E-Mail</label>
            <input id="email" type="email" autoComplete="email" className="field"
                   value={form.email} onChange={set('email')} required />
          </div>
          <div>
            <label className="label" htmlFor="pw">Passwort</label>
            <input id="pw" type="password" autoComplete="current-password" className="field"
                   value={form.password} onChange={set('password')} minLength={6} required />
          </div>

          <Fehler text={fehler} />
          {info && <p className="rounded-card bg-done/10 px-3 py-2 text-sm text-done">{info}</p>}

          <button type="submit" disabled={busy} className="btn-signal w-full">
            {busy && <Loader2 className="h-5 w-5 animate-spin" />}
            {modus === 'anmelden' ? 'Anmelden' : 'Konto anlegen'}
          </button>
        </form>

        <p className="mt-4 text-center text-[12px] leading-relaxed text-white/50">
          Die Abnahme von Aufträgen erfolgt im Vier-Augen-Prinzip. Ausführung und Abnahme
          müssen von zwei verschiedenen Konten erfolgen.
        </p>
      </div>
    </div>
  )
}

function uebersetze(msg = '') {
  if (/invalid login credentials/i.test(msg)) return 'E-Mail oder Passwort stimmt nicht.'
  if (/user already registered/i.test(msg)) return 'Für diese E-Mail besteht bereits ein Konto.'
  if (/password should be at least/i.test(msg)) return 'Das Passwort muss mindestens 6 Zeichen haben.'
  if (/email not confirmed/i.test(msg)) return 'Bitte zuerst die E-Mail-Adresse über den Bestätigungslink freischalten.'
  return msg
}
