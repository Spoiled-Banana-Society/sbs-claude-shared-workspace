// Web Audio API sound for the Banana Wheel — fully procedural (no audio files).
// Vibe: fast, hype festival EDM. Constant building risers + a sidechain "pump"
// + big supersaw so every spin feels like you're about to drop. Starts the
// instant the wheel moves; the big four (jackpot / HOF / 10 / 20) explode into
// a longer, crazier festival DROP built off the same track.

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

// Mastering chain — compressor glues the layers + stops clipping.
function masterChain(ctx: AudioContext): GainNode {
  const out = ctx.createGain();
  out.gain.value = 0.95;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -11;
  comp.knee.value = 26;
  comp.ratio.value = 14;
  comp.attack.value = 0.003;
  comp.release.value = 0.14;
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

// Punchy four-on-the-floor kick.
function kick(ctx: AudioContext, dest: AudioNode, at: number, vol = 1.0) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(180, at);
  osc.frequency.exponentialRampToValueAtTime(48, at + 0.09);
  gain.gain.setValueAtTime(vol, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + 0.15);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(at);
  osc.stop(at + 0.16);
}

// Noise burst — hi-hats / open hats / crashes / build snares.
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

// Clap/snare crack for the backbeat.
function clap(ctx: AudioContext, dest: AudioNode, at: number, vol = 0.22) {
  noiseHit(ctx, dest, at, vol, 0.16, 1600);
}

// Detuned-saw chord stab (supersaw) through an opening lowpass = festival lead.
function stab(ctx: AudioContext, dest: AudioNode, freqs: number[], at: number, dur: number, vol: number, cutoffEnd = 7000) {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(700, at);
  lp.frequency.exponentialRampToValueAtTime(cutoffEnd, at + 0.1);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, at);
  g.gain.exponentialRampToValueAtTime(0.001, at + dur);
  lp.connect(g);
  g.connect(dest);
  for (const f of freqs) {
    for (const det of [-8, 0, 8]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f * Math.pow(2, det / 1200);
      o.connect(lp);
      o.start(at);
      o.stop(at + dur + 0.02);
    }
  }
}

// Rolling EDM offbeat bass through a lowpass.
function bassNote(ctx: AudioContext, dest: AudioNode, at: number, freq: number, vol = 0.5) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  const lp = ctx.createBiquadFilter();
  o.type = 'sawtooth';
  o.frequency.value = freq;
  lp.type = 'lowpass';
  lp.frequency.value = 500;
  g.gain.setValueAtTime(vol, at);
  g.gain.exponentialRampToValueAtTime(0.001, at + 0.16);
  o.connect(lp); lp.connect(g); g.connect(dest);
  o.start(at); o.stop(at + 0.18);
}

// THE RISER — white-noise sweep + pitch-rising saw that build tension. Routed
// to the pump bus so it breathes with the beat. This is the "so pumped" energy.
function riserSweep(ctx: AudioContext, dest: AudioNode, at: number, dur: number, vol = 0.16) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, dur + 0.1);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.1;
  bp.frequency.setValueAtTime(500, at);
  bp.frequency.exponentialRampToValueAtTime(7000, at + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + dur);
  g.gain.linearRampToValueAtTime(0.0001, at + dur + 0.06);
  src.connect(bp); bp.connect(g); g.connect(dest);
  src.start(at); src.stop(at + dur + 0.12);

  const o = ctx.createOscillator();
  const og = ctx.createGain();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(220, at);
  o.frequency.exponentialRampToValueAtTime(1760, at + dur);
  og.gain.setValueAtTime(0.0001, at);
  og.gain.exponentialRampToValueAtTime(vol * 0.5, at + dur);
  og.gain.linearRampToValueAtTime(0.0001, at + dur + 0.06);
  o.connect(og); og.connect(dest);
  o.start(at); o.stop(at + dur + 0.12);
}

// Sub-bass boom drop.
function boom(ctx: AudioContext, dest: AudioNode, at: number, vol: number, startFreq: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(startFreq, at);
  osc.frequency.exponentialRampToValueAtTime(40, at + 0.45);
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

// Anthemic progression (C–G–Am–F) — bright and hype.
const EDM_CHORDS = [
  { bass: 65.41, notes: [261.6, 329.6, 392.0] }, // C
  { bass: 49.00, notes: [196.0, 246.9, 293.7] }, // G
  { bass: 55.00, notes: [220.0, 261.6, 329.6] }, // Am
  { bass: 43.65, notes: [174.6, 220.0, 261.6] }, // F
];
// Ascending lead for the big-win festival drop.
const DROP_LEAD = [523.3, 587.3, 659.3, 784.0, 880.0, 1046.5, 880.0, 784.0, 1046.5, 1174.7, 1318.5];

const EDM_BPM = 156;
const EDM_BEAT = 60 / EDM_BPM;
const EDM_16TH = EDM_BEAT / 4;

// A sidechain "pump": duck the bus to 0.3 on the kick, recover over the beat.
function pumpDuck(node: AudioParam, at: number, beat: number) {
  node.cancelScheduledValues(at);
  node.setValueAtTime(0.32, at);
  node.linearRampToValueAtTime(1.0, at + beat * 0.9);
}

// The big-four FESTIVAL DROP — a quick riser into a pumping supersaw anthem
// climbing over big kicks + crashes. Built off the same EDM track so it lands
// as a "drop". Runs ON TOP of the still-playing groove and stays long.
function launchBigOutro(ctx: AudioContext, dest: AudioNode, tier: WinTier, startAt: number) {
  const huge = tier === 'legendary';
  const pump = ctx.createGain();
  pump.gain.value = 1;
  pump.connect(dest);

  // riser builds INTO the drop (startAt is scheduled ~0.5s ahead by finish()).
  riserSweep(ctx, pump, startAt - 0.45, 0.45, 0.24);
  noiseHit(ctx, dest, startAt, 0.34, 0.6, 1800); // crash on the drop

  const bars = huge ? 3 : 2;
  const barLen = EDM_16TH * 16;
  const roots = [65.41, 49.0, 55.0]; // C G Am
  let leadIdx = 0;
  for (let bar = 0; bar < bars; bar++) {
    const t = startAt + bar * barLen;
    const root = roots[bar % roots.length];
    for (let beatN = 0; beatN < 4; beatN++) {
      const bt = t + beatN * EDM_BEAT;
      kick(ctx, dest, bt, 1.0);
      pumpDuck(pump.gain, bt, EDM_BEAT);
      bassNote(ctx, pump, bt + EDM_BEAT / 2, root * 2, 0.5); // offbeat bass
      noiseHit(ctx, dest, bt + EDM_BEAT / 2, 0.12, 0.06, 6500); // open hat
    }
    clap(ctx, dest, t + EDM_BEAT, 0.26);
    clap(ctx, dest, t + EDM_BEAT * 3, 0.26);
    // climbing supersaw lead — two notes per beat
    for (let k = 0; k < 8; k++) {
      const f = DROP_LEAD[Math.min(leadIdx++, DROP_LEAD.length - 1)];
      stab(ctx, pump, [f, f * 1.5], t + k * (barLen / 8), barLen / 8 * 1.6, 0.13, 8000);
    }
  }
  const fin = startAt + bars * barLen;
  kick(ctx, dest, fin, 1.0);
  boom(ctx, dest, fin, huge ? 0.6 : 0.45, 220);
  noiseHit(ctx, dest, fin, 0.34, 0.9, 1100);
  stab(ctx, pump, [523.3, 659.3, 784.0, 1046.5], fin, 1.4, 0.2, 9000);
}

// The spin groove: fast, pumping festival EDM with constant building risers.
// Starts AUDIBLE the instant the wheel moves; loops for any spin length; on
// finish(tier) plays the tier-aware outro (quick fade vs. the long festival drop).
function startGroove(): (tier?: WinTier) => void {
  const ctx = getAudioContext();
  const master = masterChain(ctx);
  const t0 = ctx.currentTime;
  master.gain.setValueAtTime(0.0001, t0);
  master.gain.exponentialRampToValueAtTime(0.95, t0 + 0.05);

  // Sidechain pump bus — melodic layers route here and breathe with the kick.
  const pump = ctx.createGain();
  pump.gain.value = 1;
  pump.connect(master);

  const sx = EDM_16TH;

  const scheduleStep = (s: number, t: number) => {
    const chord = EDM_CHORDS[Math.floor(s / 16) % EDM_CHORDS.length];
    const b = s % 16;

    if (b % 4 === 0) { kick(ctx, master, t, 1.0); pumpDuck(pump.gain, t, EDM_BEAT); } // four-on-floor + pump
    if (b === 4 || b === 12) clap(ctx, master, t, 0.22);                              // backbeat
    // hats: open hat on the offbeat (the "tss" energy), closed on the 16ths
    if (b % 4 === 2) noiseHit(ctx, master, t, 0.13, 0.07, 6500);
    else noiseHit(ctx, master, t, b % 2 === 0 ? 0.06 : 0.04, 0.025, 9000);
    // offbeat rolling bass
    if (b % 4 === 2) bassNote(ctx, pump, t, chord.bass * 2);
    if (b === 0) bassNote(ctx, pump, t, chord.bass * 2, 0.4);
    // big supersaw chord stab on the downbeat (pumped)
    if (b === 0) stab(ctx, pump, chord.notes, t, EDM_BEAT * 1.7, 0.13, 6000);
    if (b === 8) stab(ctx, pump, chord.notes, t, EDM_BEAT * 0.9, 0.1, 5400);
    // fast bright arp every 16th (pumped)
    const note = chord.notes[s % chord.notes.length] * 2;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = note;
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + sx * 0.9);
    o.connect(g); g.connect(pump);
    o.start(t); o.stop(t + sx);

    // a building riser sweeps up every 2 bars (continuous "about to drop" feel)
    if (s % 32 === 0) riserSweep(ctx, pump, t, EDM_BEAT * 7.5, 0.14);
    // crash accent every 4 bars
    if (s % 64 === 0) noiseHit(ctx, master, t, 0.2, 0.5, 2200);
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
  }, 30);

  let outroStarted = false;
  return (tier?: WinTier) => {
    if (outroStarted) return;
    outroStarted = true;
    const now = ctx.currentTime;
    const big = tier === 'great' || tier === 'legendary';
    const tail = tier === 'legendary' ? 6.9 : tier === 'great' ? 4.9 : tier === 'good' ? 2.3 : 1.6;
    if (big) launchBigOutro(ctx, master, tier, now + 0.5); // 0.5s riser lead-in
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
export function startSpinSound(): (tier?: WinTier) => void {
  try {
    return startGroove();
  } catch {
    return () => { /* audio unavailable — no-op */ };
  }
}

// Win stings — a riser into a drop, scaled by tier. Even a basic 1-draft pops.
export function playWinSound(tier: WinTier) {
  try {
    const ctx = getAudioContext();
    const master = masterChain(ctx);
    const now = ctx.currentTime;

    const sparkleRun = (freqs: number[], stepMs: number, vol: number) => {
      freqs.forEach((f, i) => setTimeout(() => {
        playTone(f, 0.35, vol, 'triangle', master);
        playTone(f * 1.5, 0.35, vol * 0.4, 'sine', master);
      }, i * stepMs));
    };

    switch (tier) {
      case 'standard': {
        riserSweep(ctx, master, now, 0.18, 0.14);
        boom(ctx, master, now + 0.18, 0.32, 140);
        stab(ctx, master, [392.0, 523.3, 659.3], now + 0.18, 0.4, 0.16, 7000);
        break;
      }
      case 'good': {
        riserSweep(ctx, master, now, 0.24, 0.18);
        boom(ctx, master, now + 0.24, 0.45, 170);
        noiseHit(ctx, master, now + 0.24, 0.24, 0.4, 2000);
        stab(ctx, master, [392.0, 523.3, 659.3], now + 0.24, 0.5, 0.18, 7500);
        sparkleRun([659.3, 880.0, 1046.5], 100, 0.12);
        break;
      }
      case 'great': {
        riserSweep(ctx, master, now, 0.3, 0.2);
        boom(ctx, master, now + 0.3, 0.55, 200);
        noiseHit(ctx, master, now + 0.3, 0.34, 0.6, 1300);
        stab(ctx, master, [523.3, 659.3, 784.0], now + 0.32, 0.6, 0.2, 8000);
        sparkleRun([523.3, 659.3, 784.0, 1046.5, 1318.5], 85, 0.14);
        break;
      }
      case 'legendary': {
        riserSweep(ctx, master, now, 0.36, 0.24);
        boom(ctx, master, now + 0.36, 0.7, 230);
        noiseHit(ctx, master, now + 0.36, 0.42, 0.8, 1000);
        stab(ctx, master, [523.3, 659.3, 784.0, 1046.5], now + 0.38, 0.8, 0.22, 9000);
        sparkleRun([523.3, 659.3, 784.0, 1046.5, 1318.5, 1568.0, 2093.0], 78, 0.15);
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
