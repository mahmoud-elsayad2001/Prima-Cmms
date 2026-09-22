/**
 * Akustisches Signal bei neuen oder dringenden Störungsmeldungen.
 * Web Audio statt Audiodatei: funktioniert offline und ohne Ladezeit.
 */
let ctx = null
const KEY = 'cmms.ton'

export const tonAktiv = () => localStorage.getItem(KEY) !== 'aus'
export const tonUmschalten = () => {
  const neu = tonAktiv() ? 'aus' : 'an'
  localStorage.setItem(KEY, neu)
  if (neu === 'an') alarm('info')
  return neu === 'an'
}

/** Muss einmal nach einer Nutzerinteraktion aufgerufen werden (Autoplay-Sperre). */
export function audioFreischalten() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)()
  if (ctx.state === 'suspended') ctx.resume()
}

function ton(freq, start, dauer, gain = 0.15) {
  const osc = ctx.createOscillator()
  const vol = ctx.createGain()
  osc.type = 'square'
  osc.frequency.value = freq
  vol.gain.setValueAtTime(0.0001, ctx.currentTime + start)
  vol.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + start + 0.01)
  vol.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dauer)
  osc.connect(vol).connect(ctx.destination)
  osc.start(ctx.currentTime + start)
  osc.stop(ctx.currentTime + start + dauer + 0.02)
}

/** stufe: 'info' | 'stoerung' | 'kritisch' */
export function alarm(stufe = 'stoerung') {
  if (!tonAktiv()) return
  try {
    audioFreischalten()
    if (stufe === 'info') { ton(880, 0, 0.12); return }
    if (stufe === 'kritisch') {
      ton(980, 0, 0.16, 0.22); ton(740, 0.2, 0.16, 0.22)
      ton(980, 0.4, 0.16, 0.22); ton(740, 0.6, 0.22, 0.22)
    } else {
      ton(760, 0, 0.14); ton(1040, 0.18, 0.18)
    }
    if (navigator.vibrate) navigator.vibrate(stufe === 'kritisch' ? [200, 80, 200] : [140])
  } catch (e) {
    console.warn('Signalton nicht möglich:', e)
  }
}
