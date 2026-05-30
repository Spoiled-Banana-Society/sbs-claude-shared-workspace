// Web Audio API sound for the Banana Wheel — fully procedural (no audio files).
// Vibe: electronic hip-hop / trap. A head-nod beat with 808 sub-bass, rolling
// hi-hats, snare on the 3, and dark sparse bells. Starts the instant the wheel
// moves; the big four (jackpot / HOF / 10 / 20) explode into a longer, crazier
// triumphant-trap outro built straight off the same beat.

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

// Mastering chain — compressor glues the layers + tames the 808/clipping.
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

// Tight punchy transient — layered on top of the 808 for attack.
function kick(ctx: AudioContext, dest: AudioNode, at: number, vol = 0.9) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(190, at);
  osc.frequency.exponentialRampToValueAtTime(55, at + 0.05);
  gain.gain.setValueAtTime(vol, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + 0.09);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(at);
  osc.stop(at + 0.1);
}

// 808 — the boomy sub-bass that defines trap. Click → drops to a ringing
// sustained sub note. `freq` is the note (Hz); it rings for `dur`.
function eight08(ctx: AudioContext, dest: AudioNode, at: number, freq: number, dur: number, vol = 0.8) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq * 3, at);          // attack click
  o.frequency.exponentialRampToValueAtTime(freq, at + 0.045); // glide down to the sub
  g.gain.setValueAtTime(vol, at);
  g.gain.exponentialRampToValueAtTime(vol * 0.72, at + 0.08); // punch → sustain
  g.gain.exponentialRampToValueAtTime(0.001, at + dur);       // ring out
  o.connect(g);
  g.connect(dest);
  o.start(at);
  o.stop(at + dur + 0.02);
}

// Noise burst — hi-hats / crashes.
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

// Trap snare/clap: noise crack + a short tonal body.
function snareHit(ctx: AudioContext, dest: AudioNode, at: number, vol = 0.22) {
  noiseHit(ctx, dest, at, vol, 0.18, 1400);
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(190, at);
  o.frequency.exponentialRampToValueAtTime(140, at + 0.1);
  g.gain.setValueAtTime(vol * 0.6, at);
  g.gain.exponentialRampToValueAtTime(0.001, at + 0.12);
  o.connect(g);
  g.connect(dest);
  o.start(at);
  o.stop(at + 0.13);
}

// Dark bell / pluck — the sparse melodic element (triangle + a soft harmonic).
function bellHit(ctx: AudioContext, dest: AudioNode, at: number, freq: number, vol = 0.09, dur = 0.45) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'triangle';
  o.frequency.value = freq;
  g.gain.setValueAtTime(vol, at);
  g.gain.exponentialRampToValueAtTime(0.0008, at + dur);
  o.connect(g);
  g.connect(dest);
  o.start(at);
  o.stop(at + dur + 0.02);
  const o2 = ctx.createOscillator();
  const g2 = ctx.createGain();
  o2.type = 'sine';
  o2.frequency.value = freq * 2;
  g2.gain.setValueAtTime(vol * 0.35, at);
  g2.gain.exponentialRampToValueAtTime(0.0008, at + dur * 0.7);
  o2.connect(g2);
  g2.connect(dest);
  o2.start(at);
  o2.stop(at + dur * 0.7 + 0.02);
}

// Detuned-saw chord stab — used sparingly as a bright accent in the big outro.
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

// Quick noise whoosh into an impact — front of every win sting.
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

// Sub-bass boom drop.
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

export function playTick(pitch = 800) {
  playTone(pitch, 0.05, 0.08, 'square');
}

// Dark trap loop: A1 i-i-VI-VII (Am) 808 roots, A-minor-pentatonic bells.
const TRAP_ROOTS = [55.00, 55.00, 43.65, 49.00]; // A1 A1 F1 G1 (per bar)
const BELL_MOTIF = [440.0, 523.3, 659.3, 523.3, 587.3, 440.0, 392.0, 523.3]; // A-min pent
// Ascending climb for the triumphant big-win outro.
const OUTRO_CLIMB = [440.0, 523.3, 587.3, 659.3, 784.0, 880.0, 1046.5, 1174.7, 1318.5];

const TRAP_16TH = 0.135; // seconds per 16th note (~111 BPM feel, brisk trap hats)

// The big-four celebration: triumphant trap built off the same beat — driving
// 808s, accelerating hat rolls, climbing bells, snare rolls and bright accents.
// Runs ON TOP of the still-playing groove so it "goes crazy and stays longer".
function launchBigOutro(ctx: AudioContext, dest: AudioNode, tier: WinTier, startAt: number) {
  const huge = tier === 'legendary';
  const bars = huge ? 3 : 2;
  const barLen = TRAP_16TH * 16;
  const roots = [55.0, 49.0, 43.65]; // A1 G1 F1 climb-down 808s
  let climbIdx = 0;
  for (let bar = 0; bar < bars; bar++) {
    const t = startAt + bar * barLen;
    const root = roots[bar % roots.length];
    // driving 808s
    eight08(ctx, dest, t, root * 2, TRAP_16TH * 6, 0.9);
    eight08(ctx, dest, t + TRAP_16TH * 6, root * 2, TRAP_16TH * 3, 0.6);
    eight08(ctx, dest, t + TRAP_16TH * 10, root * 3, TRAP_16TH * 5, 0.65);
    kick(ctx, dest, t, 0.95);
    kick(ctx, dest, t + TRAP_16TH * 8, 0.75);
    snareHit(ctx, dest, t + TRAP_16TH * 8, 0.26);
    noiseHit(ctx, dest, t, 0.18, 0.5, 2400); // crash on the bar
    // accelerating hat roll across the bar (more rolls each bar = building)
    const rolls = 16 + bar * 8;
    for (let i = 0; i < rolls; i++) {
      noiseHit(ctx, dest, t + (i / rolls) * barLen, 0.04 + 0.06 * (i / rolls), 0.022, 9000);
    }
    // climbing bells (the triumphant melody)
    for (let k = 0; k < 4; k++) {
      const f = OUTRO_CLIMB[Math.min(climbIdx++, OUTRO_CLIMB.length - 1)];
      bellHit(ctx, dest, t + k * TRAP_16TH * 4, f, 0.12, 0.5);
    }
    // one bright stab accent per bar
    stab(ctx, dest, [OUTRO_CLIMB[(bar * 2) % OUTRO_CLIMB.length]], t, TRAP_16TH * 6, 0.08, 6500);
  }
  // huge final hit
  const fin = startAt + bars * barLen;
  eight08(ctx, dest, fin, 110, 1.3, 0.95);
  boom(ctx, dest, fin, huge ? 0.6 : 0.45, 220);
  noiseHit(ctx, dest, fin, 0.3, 0.9, 1100);
  bellHit(ctx, dest, fin, 1568.0, 0.14, 1.0);
  bellHit(ctx, dest, fin, 2093.0, 0.1, 1.0);
}

// The spin groove: a head-nod trap beat that starts AUDIBLE the instant the
// wheel moves, loops for any spin length, and on finish(tier) plays a tier-aware
// outro — short fade for small wins, the long crazy celebration for the big four.
function startGroove(): (tier?: WinTier) => void {
  const ctx = getAudioContext();
  const master = masterChain(ctx);
  const t0 = ctx.currentTime;
  master.gain.setValueAtTime(0.0001, t0);
  master.gain.exponentialRampToValueAtTime(0.95, t0 + 0.06); // ~instant on

  const sx = TRAP_16TH;

  const scheduleStep = (s: number, t: number) => {
    const bar = Math.floor(s / 16) % 4;
    const root = TRAP_ROOTS[bar];
    const b = s % 16;

    // 808 + punch transient on syncopated positions
    if (b === 0) { kick(ctx, master, t, 0.95); eight08(ctx, master, t, root * 2, sx * 7, 0.85); }
    if (b === 6) { kick(ctx, master, t, 0.6); eight08(ctx, master, t, root * 2, sx * 3, 0.55); }
    if (b === 10) { eight08(ctx, master, t, root * 3, sx * 4, 0.55); }

    // snare on beat 3 (the trap backbeat)
    if (b === 8) snareHit(ctx, master, t, 0.2);

    // rolling hi-hats every 16th, accented; rolls into the bar + a mid triplet
    noiseHit(ctx, master, t, b % 4 === 0 ? 0.11 : b % 2 === 0 ? 0.08 : 0.045, 0.028, 8500);
    if (b === 7) { noiseHit(ctx, master, t + sx / 3, 0.05, 0.022, 9000); noiseHit(ctx, master, t + (2 * sx) / 3, 0.05, 0.022, 9000); }
    if (b === 14 || b === 15) noiseHit(ctx, master, t + sx / 2, 0.06, 0.022, 9000);

    // sparse dark bell melody
    if (b === 0) bellHit(ctx, master, t, BELL_MOTIF[(bar * 2) % BELL_MOTIF.length]);
    if (b === 6) bellHit(ctx, master, t, BELL_MOTIF[(bar * 2 + 1) % BELL_MOTIF.length]);
    if (b === 11) bellHit(ctx, master, t, BELL_MOTIF[(bar + 4) % BELL_MOTIF.length], 0.06, 0.3);
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
      nextTime += sx;
    }
  }, 35);

  let outroStarted = false;
  return (tier?: WinTier) => {
    if (outroStarted) return;
    outroStarted = true;
    const now = ctx.currentTime;
    const big = tier === 'great' || tier === 'legendary';
    const tail = tier === 'legendary' ? 6.6 : tier === 'great' ? 4.5 : tier === 'good' ? 2.4 : 1.7;
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

// Win stings — the payoff. Punchy across the board; even a basic 1-draft pops.
export function playWinSound(tier: WinTier) {
  try {
    const ctx = getAudioContext();
    const master = masterChain(ctx);
    const now = ctx.currentTime;

    const sparkleRun = (freqs: number[], stepMs: number, vol: number) => {
      freqs.forEach((f, i) => setTimeout(() => bellHit(ctx, master, getAudioContext().currentTime, f, vol, 0.4), i * stepMs));
    };

    switch (tier) {
      case 'standard': {
        riser(ctx, master, now, 0.16, 0.1);
        boom(ctx, master, now + 0.14, 0.32, 130);
        bellHit(ctx, master, now + 0.14, 880, 0.12, 0.4);
        setTimeout(() => bellHit(ctx, master, getAudioContext().currentTime, 1318.5, 0.1, 0.4), 150);
        break;
      }
      case 'good': {
        riser(ctx, master, now, 0.2, 0.14);
        boom(ctx, master, now + 0.18, 0.45, 160);
        noiseHit(ctx, master, now + 0.18, 0.2, 0.35, 3500);
        sparkleRun([659.3, 880.0, 1046.5], 110, 0.13);
        break;
      }
      case 'great': {
        riser(ctx, master, now, 0.24, 0.18);
        boom(ctx, master, now + 0.22, 0.55, 190);
        noiseHit(ctx, master, now + 0.22, 0.3, 0.5, 1400);
        stab(ctx, master, [523.3, 659.3, 784.0], now + 0.24, 0.5, 0.16, 7000);
        sparkleRun([523.3, 659.3, 784.0, 1046.5, 1318.5], 90, 0.14);
        break;
      }
      case 'legendary': {
        riser(ctx, master, now, 0.28, 0.22);
        boom(ctx, master, now + 0.26, 0.7, 220);
        noiseHit(ctx, master, now + 0.26, 0.4, 0.7, 1000);
        stab(ctx, master, [523.3, 659.3, 784.0, 1046.5], now + 0.28, 0.7, 0.18, 8500);
        sparkleRun([523.3, 659.3, 784.0, 1046.5, 1318.5, 1568.0, 2093.0], 80, 0.14);
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
