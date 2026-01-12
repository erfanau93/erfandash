let audioCtx: AudioContext | null = null

type ToneOptions = {
  type?: OscillatorType
  volume?: number
}

const getAudioContext = () => {
  if (typeof window === 'undefined') return null
  const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined
  if (!Ctor) return null

  if (!audioCtx) {
    audioCtx = new Ctor()
  }

  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {
      /* ignore resume errors */
    })
  }

  return audioCtx
}

const playTone = (frequency: number, durationMs: number, options: ToneOptions = {}) => {
  const ctx = getAudioContext()
  if (!ctx) return

  const oscillator = ctx.createOscillator()
  oscillator.type = options.type || 'sine'
  oscillator.frequency.value = frequency

  const gain = ctx.createGain()
  const volume = Math.max(0, Math.min(options.volume ?? 0.08, 1))
  gain.gain.value = volume

  oscillator.connect(gain)
  gain.connect(ctx.destination)

  const now = ctx.currentTime
  const durationSeconds = Math.max(durationMs, 30) / 1000

  gain.gain.setValueAtTime(volume, now)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds)

  oscillator.start(now)
  oscillator.stop(now + durationSeconds + 0.02)
}

export const playSaveSound = () => {
  playTone(1046.5, 120, { type: 'sine', volume: 0.09 }) // C6
  setTimeout(() => playTone(1318.5, 120, { type: 'sine', volume: 0.08 }), 120) // E6
}

export const playNewLeadSound = () => {
  playTone(554.4, 160, { type: 'triangle', volume: 0.1 }) // C#5
  setTimeout(() => playTone(830.6, 200, { type: 'triangle', volume: 0.08 }), 140) // G#5
}










