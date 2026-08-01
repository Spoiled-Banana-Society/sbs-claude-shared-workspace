'use client';

/**
 * Sound for THE ELIMINATOR burn.
 *
 * Synthesised with Web Audio rather than shipping audio files — a fire whoosh
 * is filtered noise, which is a few lines of code and zero bytes over the wire.
 * It also sidesteps the iOS volume problem the draft sounds hit (iOS ignores
 * `el.volume`, so loudness had to be baked into the wav); here every level is a
 * GainNode, which iOS honours.
 *
 * ⚠️ Browsers suspend an AudioContext created without a user gesture. Same
 * failure the draft room hit when a tab sat idle — the context exists, plays
 * nothing, and reports no error. `ensure()` resumes it on every call and the
 * first real click on the page unlocks it.
 */

let ctx: AudioContext | null = null;

function ensure(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const Ctor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Unlock audio from a real user gesture (a click anywhere on the board). */
export function primeEliminatorAudio(): void {
  ensure();
}

/** Filtered-noise whoosh + low rumble — the burn igniting. ~1.1s. */
export function playBurnSound(): void {
  const c = ensure();
  if (!c || c.state !== 'running') return;
  const t0 = c.currentTime;

  // ── whoosh: white noise through a lowpass that sweeps down ──
  const dur = 1.1;
  const frames = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, frames, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;

  const noise = c.createBufferSource();
  noise.buffer = buf;

  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(5200, t0);
  lp.frequency.exponentialRampToValueAtTime(240, t0 + dur);
  lp.Q.value = 1.2;

  const noiseGain = c.createGain();
  noiseGain.gain.setValueAtTime(0.0001, t0);
  noiseGain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.09);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  noise.connect(lp).connect(noiseGain).connect(c.destination);
  noise.start(t0);
  noise.stop(t0 + dur);

  // ── rumble: a low sine falling away underneath ──
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(84, t0);
  osc.frequency.exponentialRampToValueAtTime(38, t0 + 0.9);

  const oscGain = c.createGain();
  oscGain.gain.setValueAtTime(0.0001, t0);
  oscGain.gain.exponentialRampToValueAtTime(0.16, t0 + 0.07);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.95);

  osc.connect(oscGain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + 1);
}

/**
 * One rising chime per survivor as they appear. `index` staggers the pitch so
 * five reveals read as a phrase climbing rather than the same note five times.
 */
export function playSurvivorChime(index: number): void {
  const c = ensure();
  if (!c || c.state !== 'running') return;
  const t0 = c.currentTime;
  // Pentatonic steps — always consonant however many land.
  const semis = [0, 3, 5, 7, 10, 12];
  const freq = 392 * Math.pow(2, (semis[Math.min(index, semis.length - 1)]) / 12);

  const osc = c.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, t0);

  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.13, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);

  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + 0.6);
}

const MUTE_KEY = 'sbs.eliminator.muted';

export function isEliminatorMuted(): boolean {
  if (typeof window === 'undefined') return true;
  try { return window.localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}

export function setEliminatorMuted(muted: boolean): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* private mode */ }
}
