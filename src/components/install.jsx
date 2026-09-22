import { useEffect, useState } from 'react'
import { Download, Share } from 'lucide-react'

/**
 * Installationshinweis für die PWA.
 * Chrome und Edge liefern beforeinstallprompt, iOS Safari nicht –
 * dort wird stattdessen der Weg über das Teilen-Menü erklärt.
 */
export function InstallButton({ kompakt }) {
  const [prompt, setPrompt] = useState(null)
  const [iosHinweis, setIosHinweis] = useState(false)
  const [installiert, setInstalliert] = useState(false)

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone
    setInstalliert(standalone)
    const auf = (e) => { e.preventDefault(); setPrompt(e) }
    const fertig = () => { setInstalliert(true); setPrompt(null) }
    window.addEventListener('beforeinstallprompt', auf)
    window.addEventListener('appinstalled', fertig)
    return () => {
      window.removeEventListener('beforeinstallprompt', auf)
      window.removeEventListener('appinstalled', fertig)
    }
  }, [])

  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
  if (installiert) return null
  if (!prompt && !ios) return null

  async function installieren() {
    if (ios && !prompt) return setIosHinweis(true)
    prompt.prompt()
    await prompt.userChoice
    setPrompt(null)
  }

  return (
    <>
      <button onClick={installieren}
        className={kompakt
          ? 'rounded-card p-2 hover:bg-white/10'
          : 'btn-signal w-full'}
        aria-label="App installieren">
        <Download className="h-5 w-5" />
        {!kompakt && 'App installieren'}
      </button>
      {iosHinweis && (
        <p className="mt-2 flex items-start gap-2 rounded-card bg-hall px-3 py-2 text-[13px] text-steel">
          <Share className="mt-0.5 h-4 w-4 shrink-0" />
          In Safari auf „Teilen“ tippen und „Zum Home-Bildschirm“ wählen.
        </p>
      )}
    </>
  )
}
