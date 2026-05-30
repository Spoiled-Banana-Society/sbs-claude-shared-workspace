// Web Audio API sound for the Banana Wheel — fully procedural (no audio files).
// Hype-forward: a driving EDM groove that starts the instant the wheel moves,
// punchy tiered win stings (even a basic 1-draft pops), and an extended
// "music goes crazy + stays longer" celebration outro for the big four
// (jackpot / HOF / 10 / 20).

let audioCtx: AudioContext | null = null;

export type WinTier = 'standard' | 'good' | 'great' | 'legendary';

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

// Mastering chain — compressor glues the stacked layers + stops clipping, which
// is most of what makes a pile of oscillators read as "produced".
function masterChain(ctx: AudioContext): GainNode {
  const out = ctx.createGain();
  out.gain.value = 0.95;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.knee.value = 26;
  comp.ratio.value = 14;
  comp.attack.value = 0.003;
  comp.release.value = 0.16;
  out.connect(comp);
  comp.connect(ctx.destination);
  return out;
}

function noiseBuffer(ctx: AudioContext, seconds = 1): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function playTone(frequency: number, duration: number, volume = 0.15, type: OscillatorType = 'sine', dest?: AudioNode) {
  const ctx = getAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain);
  gain.connect(dest ?? ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + duration);
}

// Punchy kick: pitch-dropping sine + fast decay.
function kick(ctx: AudioContext, dest: AudioNode, at: number, vol = 0.95) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(175, at);
  osc.frequency.exponentialRampToValueAtTime(44, at + 0.11);
  gain.gain.setValueAtTime(vol, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + 0.17);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(at);
  osc.stop(at + 0.19);
}

// Noise impact — hats / claps / crashes / big-win hits.
function noiseHit(ctx: AudioContext, dest: AudioNode, at: number, vol = 0.4, dur = 0.5, hp = 1200) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, dur + 0.05);
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = hp;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + dur);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  src.start(at);
  src.stop(at + dur + 0.05);
}

// Detuned-saw chord stab through an opening lowpass = festival "supersaw".
function stab(ctx: AudioContext, dest: AudioNode, freqs: number[], at: number, dur: number, vol: number, cutoffEnd = 6500) {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(600, at);
  lp.frequency.exponentialRampToValueAtTime(cutoffEnd, at + 0.1);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, at);
  g.gain.exponentialRampToValueAtTime(0.001, at + dur);
  lp.connect(g);
  g.connect(dest);
  for (const f of freqs) {
    for (const det of [-7, 0, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f * Math.pow(2, det / 1200);
      o.connect(lp);
      o.start(at);
      o.stop(at + dur + 0.02);
    }
  }
}

// Quick noise "whoosh" riser into an impact — front of every win sting.
function riser(ctx: AudioContext, dest: AudioNode, at: number, dur: number, vol: number) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, dur + 0.05);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.setValueAtTime(400, at);
  hp.frequency.exponentialRampToValueAtTime(8000, at + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + dur);
  src.connect(hp);
  hp.connect(g);
  g.connect(dest);
  src.start(at);
  src.stop(at + dur + 0.05);
}

// Sub-bass "boom" drop under a win.
function boom(ctx: AudioContext, dest: AudioNode, at: number, vol: number, startFreq: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(startFreq, at);
  osc.frequency.exponentialRampToValueAtTime(38, at + 0.45);
  gain.gain.setValueAtTime(vol, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + 0.6);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(at);
  osc.stop(at + 0.65);
}

// Tick — kept for backwards-compat.
export function playTick(pitch = 800) {
  playTone(pitch, 0.05, 0.08, 'square');
}

// 4-chord loop (Am – F – C – G) the groove cycles through for a musical feel.
const GROOVE_CHORDS = [
  { bass: 55.00, notes: [220.0, 261.6, 329.6] }, // Am
  { bass: 43.65, notes: [174.6, 220.0, 261.6] }, // F
  { bass: 65.41, notes: [261.6, 329.6, 392.0] }, // C
  { bass: 49.00, notes: [196.0, 246.9, 293.7] }, // G
];

// Triumphant ascending progression for the big-win outro.
const OUTRO_PROG = [
  [261.6, 329.6, 392.0],  // C
  [293.7, 370.0, 440.0],  // D
  [329.6, 415.3, 493.9],  // E
  [349.2, 440.0, 523.3],  // F
  [392.0, 493.9, 587.3],  // G
  [440.0, 554.4, 659.3],  // A
  [523.3, 659.3, 784.0],  // C↑
  [587.3, 740.0, 880.0],  // D↑
];

// The over-the-top extended celebration for the big four — rising chord stabs +
// kicks + crashes, capped by a huge final hit. Runs ON TOP of the still-driving
// groove so the music genuinely "goes crazy and stays longer".
function launchBigOutro(ctx: AudioContext, dest: AudioNode, tier: WinTier, startAt: number): number {
  const huge = tier === 'legendary';
  const beats = huge ? 12 : 8;
  const step = 0.34;
  for (let i = 0; i < beats; i++) {
    const at = startAt + i * step;
    const base = OUTRO_PROG[i % OUTRO_PROG.length];
    const chord = i >= OUTRO_PROG.length ? base.map((f) => f * 2) : base;
    stab(ctx, dest, chord, at, step * 1.7, 0.15, 7500);
    kick(ctx, dest, at, 0.9);
    if (i % 2 === 0) noiseHit(ctx, dest, at, 0.15, 0.28, 2800);
    // sparkle arp on the upbeats
    playTone(chord[i % chord.length] * 2, 0.16, 0.08, 'triangle', dest);
  }
  const fin = startAt + beats * step;
  stab(ctx, dest, [523.3, 659.3, 784.0, 1046.5], fin, 1.3, 0.2, 8500);
  noiseHit(ctx, dest, fin, 0.32, 0.9, 1100);
  boom(ctx, dest, fin, huge ? 0.6 : 0.45, 200);
  return fin + 1.3; // when the outro tail ends
}

// The spin groove: a driving EDM loop that starts AUDIBLE the instant the wheel
// starts, loops for any spin length, and on finish(tier) plays a tier-aware
// outro — short for small wins, a long crazy celebration for the big four.
function startGroove(): (tier?: WinTier) => void {
  const ctx = getAudioContext();
  const master = masterChain(ctx);
  const t0 = ctx.currentTime;
  master.gain.setValueAtTime(0.0001, t0);
  master.gain.exponentialRampToValueAtTime(0.95, t0 + 0.06); // ~instant on

  const tempo = 150;
  const sixteenth = 60 / tempo / 4;

  const hat = (t: number, vol: number) => noiseHit(ctx, master, t, vol, 0.03, 8000);

  const bass = (t: number, freq: number, vol = 0.5) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    lp.type = 'lowpass';
    lp.frequency.value = 460;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.17);
    o.connect(lp); lp.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.19);
  };

  const scheduleStep = (s: number, t: number) => {
    const chord = GROOVE_CHORDS[Math.floor(s / 16) % GROOVE_CHORDS.length];
    const b = s % 16;
    if (b % 4 === 0) kick(ctx, master, t, 1.0);                 // four-on-the-floor
    if (b % 2 === 0) hat(t, b % 4 === 2 ? 0.14 : 0.06);         // hats
    if (b === 4 || b === 12) noiseHit(ctx, master, t, 0.2, 0.14, 1700); // clap backbeat
    // moving bass riff
    if (b === 0 || b === 6 || b === 10) bass(t, chord.bass * 2);
    if (b === 3) bass(t, chord.bass * 2, 0.35);
    if (b === 8) bass(t, chord.bass * 3);
    // chord stabs for body
    if (b === 0) stab(ctx, master, chord.notes, t, sixteenth * 6, 0.1, 5200);
    if (b === 8) stab(ctx, master, chord.notes, t, sixteenth * 3, 0.08, 4600);
    // bright arp on every 16th, following the chord
    const note = chord.notes[s % chord.notes.length] * 2;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = note;
    g.gain.setValueAtTime(0.055, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + sixteenth * 0.9);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + sixteenth);
  };

  let step = 0;
  let nextTime = t0 + 0.05;
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    const horizon = ctx.currentTime + 0.2;
    while (nextTime < horizon) {
      scheduleStep(step, nextTime);
      step += 1;
      nextTime += sixteenth;
    }
  }, 35);

  let outroStarted = false;
  return (tier?: WinTier) => {
    if (outroStarted) return;
    outroStarted = true;
    const now = ctx.currentTime;
    const big = tier === 'great' || tier === 'legendary';
    // Tail length: big wins keep the music going much longer.
    const tail = tier === 'legendary' ? 6.0 : tier === 'great' ? 4.6 : tier === 'good' ? 2.4 : 1.7;
    if (big) launchBigOutro(ctx, master, tier, now + 0.15);
    try {
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.setValueAtTime(0.95, now + tail - 1.3);
      master.gain.exponentialRampToValueAtTime(0.0008, now + tail);
    } catch { /* ignore */ }
    setTimeout(() => { stopped = true; clearInterval(timer); }, tail * 1000 + 120);
  };
}

// Public: start the spin soundbed the moment the wheel starts moving.
// Returns finish(tier) — call it when the wheel lands so the outro matches.
export function startSpinSound(): (tier?: WinTier) => void {
  try {
    return startGroove();
  } catch {
    return () => { /* audio unavailable — no-op */ };
  }
}

// Win stings — the payoff. Bigger across the board; even a basic 1-draft pops.
export function playWinSound(tier: WinTier) {
  try {
    const ctx = getAudioContext();
    const master = masterChain(ctx);
    const now = ctx.currentTime;

    const sparkleRun = (freqs: number[], stepMs: number, vol: number, fifth = false) => {
      freqs.forEach((f, i) => setTimeout(() => {
        playTone(f, 0.4, vol, 'triangle', master);
        if (fifth) playTone(f * 1.5, 0.4, vol * 0.4, 'sine', master);
      }, i * stepMs));
    };

    switch (tier) {
      case 'standard': {
        // Short but punchy — this plays on ~93% of spins.
        riser(ctx, master, now, 0.18, 0.12);
        boom(ctx, master, now + 0.16, 0.3, 130);
        stab(ctx, master, [392.0, 523.3, 659.3], now + 0.16, 0.4, 0.16, 6500);
        setTimeout(() => playTone(1046.5, 0.3, 0.12, 'triangle', master), 200);
        break;
      }
      case 'good': {
        riser(ctx, master, now, 0.22, 0.16);
        boom(ctx, master, now + 0.2, 0.45, 160);
        noiseHit(ctx, master, now + 0.2, 0.22, 0.35, 3500);
        stab(ctx, master, [392.0, 523.3, 659.3], now + 0.2, 0.5, 0.18, 7000);
        sparkleRun([659.3, 784.0, 1046.5], 110, 0.14);
        break;
      }
      case 'great': {
        riser(ctx, master, now, 0.26, 0.2);
        boom(ctx, master, now + 0.24, 0.55, 180);
        noiseHit(ctx, master, now + 0.24, 0.32, 0.5, 1400);
        stab(ctx, master, [523.3, 659.3, 784.0], now + 0.26, 0.6, 0.2, 7500);
        sparkleRun([523.3, 659.3, 784.0, 1046.5, 1318.5], 90, 0.16, true);
        break;
      }
      case 'legendary': {
        riser(ctx, master, now, 0.3, 0.24);
        boom(ctx, master, now + 0.28, 0.7, 220);
        noiseHit(ctx, master, now + 0.28, 0.4, 0.7, 1000);
        stab(ctx, master, [523.3, 659.3, 784.0, 1046.5], now + 0.3, 0.8, 0.22, 8500);
        setTimeout(() => stab(ctx, master, [587.3, 740.0, 880.0, 1174.7], now + 0.0, 0.8, 0.2, 8500), 260);
        sparkleRun([523.3, 659.3, 784.0, 1046.5, 1318.5, 1568.0, 2093.0], 80, 0.16, true);
        break;
      }
    }
  } catch { /* audio unavailable — no-op */ }
}

// Map a wheel segment to a sound tier.
export function getWinTier(segment: { prizeValue?: number | string; id: string }): WinTier {
  if (segment.id === 'jackpot') return 'legendary';
  if (typeof segment.prizeValue === 'number' && segment.prizeValue >= 20) return 'legendary';
  if (typeof segment.prizeValue === 'number' && segment.prizeValue >= 10) return 'great';
  if (segment.id === 'hof') return 'good';
  if (typeof segment.prizeValue === 'number' && segment.prizeValue >= 5) return 'good';
  return 'standard';
}
