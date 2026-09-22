import { NavLink, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import {
  LayoutDashboard, Wrench, HardHat, ShieldCheck, BarChart3,
  Volume2, VolumeX, LogOut, Plus
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { alarm, tonAktiv, tonUmschalten, audioFreischalten } from '../lib/sound'
import { InstallButton } from './install'

const nav = [
  { to: '/',          label: 'Übersicht',  icon: LayoutDashboard, end: true },
  { to: '/auftraege', label: 'Aufträge',   icon: Wrench },
  { to: '/maschinen', label: 'Maschinen',  icon: HardHat },
  { to: '/qm',        label: 'QM',         icon: ShieldCheck },
  { to: '/berichte',  label: 'Berichte',   icon: BarChart3 }
]

export default function Layout({ children }) {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [ton, setTon] = useState(tonAktiv())
  const [hinweis, setHinweis] = useState(null)

  // Akustisches Signal bei neuen Störungsmeldungen.
  useEffect(() => {
    const kanal = supabase
      .channel('stoerungen')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'work_orders', filter: 'kind=eq.unplanmaessig' },
        ({ new: o }) => {
          alarm(o.priority === 'kritisch' ? 'kritisch' : 'stoerung')
          setHinweis({ id: o.id, titel: o.title, prio: o.priority })
          setTimeout(() => setHinweis(null), 12000)
        })
      .subscribe()
    return () => supabase.removeChannel(kanal)
  }, [])

  useEffect(() => {
    const frei = () => audioFreischalten()
    document.addEventListener('pointerdown', frei, { once: true })
    return () => document.removeEventListener('pointerdown', frei)
  }, [])

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-40 bg-ink text-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-7 w-1.5 rounded-full bg-signal" />
            <span className="text-[17px] font-bold leading-tight">Prima</span>
          </div>
          <nav className="ml-6 hidden gap-1 md:flex">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}
                className={({ isActive }) =>
                  `rounded-card px-3 py-2 text-sm font-medium ${isActive ? 'bg-white/15' : 'hover:bg-white/10'}`}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <InstallButton kompakt />
            <button onClick={() => setTon(tonUmschalten())}
                    aria-label={ton ? 'Signalton ausschalten' : 'Signalton einschalten'}
                    className="rounded-card p-2 hover:bg-white/10">
              {ton ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5 text-white/50" />}
            </button>
            <div className="hidden text-right sm:block">
              <p className="text-[13px] font-semibold leading-tight">{profile?.full_name}</p>
              <p className="text-[11px] text-white/60">{profile?.role}</p>
            </div>
            <button onClick={signOut} aria-label="Abmelden" className="rounded-card p-2 hover:bg-white/10">
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {hinweis && (
        <button onClick={() => navigate(`/auftraege/${hinweis.id}`)}
                className="w-full bg-stop px-4 py-3 text-left text-white">
          <span className="font-semibold">Neue Störungsmeldung</span> – {hinweis.titel}
          <span className="ml-2 opacity-80">({hinweis.prio})</span>
        </button>
      )}

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-4 md:pb-10">{children}</main>

      {/* Mobile Navigation mit großen Touchflächen */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-black/10 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="grid grid-cols-5">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) =>
                `flex min-h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-medium
                 ${isActive ? 'text-ink' : 'text-steel'}`}>
              {({ isActive }) => (
                <>
                  <n.icon className={`h-5 w-5 ${isActive ? 'text-signal' : ''}`} />
                  {n.label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}

export function FabNeu({ onClick, label = 'Neuer Auftrag' }) {
  return (
    <button onClick={onClick} aria-label={label}
      className="fixed bottom-20 right-4 z-40 flex h-14 items-center gap-2 rounded-full bg-signal px-5
                 font-bold text-ink shadow-lg md:bottom-8">
      <Plus className="h-6 w-6" /> <span className="hidden sm:inline">{label}</span>
    </button>
  )
}
