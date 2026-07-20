// Web Audio API sound for the Banana Wheel — fully procedural (no audio files).
// Modern, dark, bass-driven electronic — NOT 80s. The "produced" feel comes
// from real reverb (a generated impulse response) + filtered plucks/pads +
// sidechain pump, and from staying SPARSE (no busy square-wave arps, no cheesy
// major-trance stabs). Big wins (jackpot / HOF / 10 / 20) open into a modern
// future-bass drop built off the same track.

let audioCtx: AudioContext | null = null;
let reverbIR: AudioBuffer | null = null;

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

// Generated reverb impulse — exponentially-decaying noise. This is what makes
// everything sit in a space and read as "produced" rather than dry/cheap.
function getReverb(ctx: AudioContext): ConvolverNode {
  const conv = ctx.createConvolver();
  if (!reverbIR) {
    const dur = 1.7;
    const rate = ctx.sampleRate;
    const len = Math.floor(dur * rate);
    const ir = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.6);
      }
    }
    reverbIR = ir;
  }
  conv.buffer = reverbIR;
  return conv;
}

// Routing buses:
//  - dry:   straight to the mix (kick, hats, sub) — tight, no wash.
//  - space: dry + reverb (plucks, pads, claps, risers, leads) — sits in space.
// master fades the whole thing; a compressor glues + limits.
function masterChain(ctx: AudioContext): { master: GainNode; dry: GainNode; space: GainNode } {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.knee.value = 26;
  comp.ratio.value = 12;
  comp.attack.value = 0.004;
  comp.release.value = 0.18;
  comp.connect(ctx.destination);

  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(comp);

  const dry = ctx.createGain();
  dry.connect(master);

  const verb = getReverb(ctx);
  const wet = ctx.createGain();
  wet.gain.value = 0.32;
  verb.connect(wet);
  wet.connect(master);

  // `space` fans to both dry and reverb so elements routed here get depth.
  const space = ctx.createGain();
  space.connect(dry);
  space.connect(verb);

  return { master, dry, space };
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

// Tight modern kick.
function kick(ctx: AudioContext, dest: AudioNode, at: number, vol = 1.0) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(165, at);
  osc.frequency.exponentialRampToValueAtTime(48, at + 0.07);
  gain.gain.setValueAtTime(vol, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + 0.13);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(at);
  osc.stop(at + 0.14);
}

// Deep clean sub-bass (sine), gentle glide in.
function sub(ctx: AudioContext, dest: AudioNode, at: number, freq: number, dur: number, vol = 0.6) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq * 1.5, at);
  o.frequency.exponentialRampToValueAtTime(freq, at + 0.05);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, at + dur);
  o.connect(g);
  g.connect(dest);
  o.start(at);
  o.stop(at + dur + 0.02);
}

// Crisp filtered-noise hit — hats / crash.
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

// Tight clap.
function clap(ctx: AudioContext, dest: AudioNode, at: number, vol = 0.2) {
  noiseHit(ctx, dest, at, vol, 0.14, 1700);
}

// Modern pluck — two slightly-detuned saws through a fast filter envelope.
// Sparse use of this (not a busy arp) is what keeps it modern, not cheesy.
function pluck(ctx: AudioContext, dest: AudioNode, at: number, freq: number, vol = 0.16, dur = 0.4) {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(freq * 7, at);
  lp.frequency.exponentialRampToValueAtTime(freq * 1.8, at + 0.14);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  lp.connect(g);
  g.connect(dest);
  for (const det of [-6, 6]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq * Math.pow(2, det / 1200);
    o.connect(lp);
    o.start(at);
    o.stop(at + dur + 0.02);
  }
}

// Low atmospheric pad — soft detuned saws under a lowpass, slow swell.
function pad(ctx: AudioContext, dest: AudioNode, at: number, freqs: number[], dur: number, vol = 0.05) {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(vol, at + dur * 0.4);
  g.gain.linearRampToValueAtTime(0.0001, at + dur);
  lp.connect(g);
  g.connect(dest);
  for (const f of freqs) {
    for (const det of [-8, 8]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f * Math.pow(2, det / 1200);
      o.connect(lp);
      o.start(at);
      o.stop(at + dur + 0.05);
    }
  }
}

// Future-bass chord swell — wide detuned saws, filter opens (the big-win lead).
function chordSwell(ctx: AudioContext, dest: AudioNode, at: number, freqs: number[], dur: number, vol = 0.16) {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(400, at);
  lp.frequency.exponentialRampToValueAtTime(7500, at + dur * 0.5);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.04);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  lp.connect(g);
  g.connect(dest);
  for (const f of freqs) {
    for (const det of [-11, -4, 4, 11]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f * Math.pow(2, det / 1200);
      o.connect(lp);
      o.start(at);
      o.stop(at + dur + 0.02);
    }
  }
}

// Filtered-noise riser — tension/build.
function riserSweep(ctx: AudioContext, dest: AudioNode, at: number, dur: number, vol = 0.14) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, dur + 0.1);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(500, at);
  bp.frequency.exponentialRampToValueAtTime(7000, at + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + dur);
  g.gain.linearRampToValueAtTime(0.0001, at + dur + 0.06);
  src.connect(bp);
  bp.connect(g);
  g.connect(dest);
  src.start(at);
  src.stop(at + dur + 0.12);
}

// Sub-bass boom drop.
function boom(ctx: AudioContext, dest: AudioNode, at: number, vol: number, startFreq: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(startFreq, at);
  osc.frequency.exponentialRampToValueAtTime(38, at + 0.5);
  gain.gain.setValueAtTime(vol, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + 0.65);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(at);
  osc.stop(at + 0.7);
}

export function playTick(pitch = 800) {
  playTone(pitch, 0.05, 0.08, 'sine');
}

// Dark, sparse loop in A minor (i-i-VI-VII) — root + pad chord + 2 lead notes/bar.
const TRACK = [
  { root: 55.00, pad: [220.0, 261.6, 329.6], lead: [659.3, 440.0] }, // Am
  { root: 55.00, pad: [220.0, 261.6, 329.6], lead: [523.3, 659.3] }, // Am
  { root: 43.65, pad: [174.6, 220.0, 261.6], lead: [523.3, 349.2] }, // F
  { root: 49.00, pad: [196.0, 246.9, 293.7], lead: [587.3, 392.0] }, // G
];
// Rising lead for the big-win drop.
const DROP_LEAD = [523.3, 659.3, 587.3, 784.0, 659.3, 880.0, 784.0, 1046.5];

const BPM = 150;
const BEAT = 60 / BPM;
const STEP16 = BEAT / 4;

// Sidechain pump: duck a bus to ~0.35 on the kick, recover over the beat.
function pumpDuck(node: AudioParam, at: number) {
  node.cancelScheduledValues(at);
  node.setValueAtTime(0.35, at);
  node.linearRampToValueAtTime(1.0, at + BEAT * 0.92);
}

// The big-four FUTURE-BASS DROP — riser into a wide reverbed chord swell + a
// sparse rising lead over driving kicks/sub/claps. Modern, not a trance stab.
function launchBigOutro(ctx: AudioContext, buses: { dry: GainNode; space: GainNode }, tier: WinTier, startAt: number) {
  const { dry, space } = buses;
  const huge = tier === 'legendary';
  const pump = ctx.createGain();
  pump.connect(space);

  riserSweep(ctx, pump, startAt - 0.5, 0.5, 0.2); // riser into the drop
  boom(ctx, dry, startAt, huge ? 0.7 : 0.52, 220);
  noiseHit(ctx, dry, startAt, 0.3, 0.6, 1600);

  const bars = huge ? 3 : 2;
  const barLen = STEP16 * 16;
  const roots = [55.0, 49.0, 43.65]; // A G F
  const chords = [[220, 261.6, 329.6], [196, 246.9, 293.7], [174.6, 220, 261.6]];
  let leadIdx = 0;
  for (let bar = 0; bar < bars; bar++) {
    const t = startAt + bar * barLen;
    for (let beatN = 0; beatN < 4; beatN++) {
      const bt = t + beatN * BEAT;
      kick(ctx, dry, bt, 1.0);
      pumpDuck(pump.gain, bt);
      noiseHit(ctx, dry, bt + BEAT / 2, 0.1, 0.05, 9000); // tight hat offbeat
    }
    sub(ctx, pump, t, roots[bar % roots.length] * 2, barLen * 0.9, 0.6);
    clap(ctx, pump, t + BEAT, 0.24);
    clap(ctx, pump, t + BEAT * 3, 0.24);
    chordSwell(ctx, pump, t, chords[bar % chords.length], barLen * 0.95, 0.15);
    // sparse rising lead — 4 notes across the bar
    for (let k = 0; k < 4; k++) {
      const f = DROP_LEAD[Math.min(leadIdx++, DROP_LEAD.length - 1)];
      pluck(ctx, pump, t + k * BEAT, f, 0.16, 0.5);
    }
  }
  const fin = startAt + bars * barLen;
  boom(ctx, dry, fin, huge ? 0.6 : 0.45, 200);
  noiseHit(ctx, dry, fin, 0.3, 0.9, 1100);
  chordSwell(ctx, pump, fin, [523.3, 659.3, 784.0, 1046.5], 1.6, 0.17);
}

// The spin groove: modern, dark, bass-driven and SPARSE so it never gets cheesy.
// Starts AUDIBLE the instant the wheel moves; loops for any spin length; on
// finish(tier) plays the tier-aware outro.
function startGroove(): (tier?: WinTier) => void {
  const ctx = getAudioContext();
  const { master, dry, space } = masterChain(ctx);
  const t0 = ctx.currentTime;
  master.gain.setValueAtTime(0.0001, t0);
  master.gain.exponentialRampToValueAtTime(0.9, t0 + 0.05);

  // Pumped, reverbed bus for the musical layers (breathes under the kick).
  const pump = ctx.createGain();
  pump.connect(space);

  const scheduleStep = (s: number, t: number) => {
    const c = TRACK[Math.floor(s / 16) % TRACK.length];
    const b = s % 16;

    if (b % 4 === 0) { kick(ctx, dry, t, 1.0); pumpDuck(pump.gain, t); }   // four-on-floor + pump
    // tight hats: closed 16ths, a touch louder on the offbeat
    noiseHit(ctx, dry, t, b % 4 === 2 ? 0.1 : b % 2 === 0 ? 0.06 : 0.04, b % 4 === 2 ? 0.05 : 0.03, b % 4 === 2 ? 7000 : 9500);
    if (b === 4 || b === 12) clap(ctx, pump, t, 0.2);                       // backbeat clap (reverb)
    // deep sub on the 1 and a syncopated push
    if (b === 0) sub(ctx, pump, t, c.root * 2, BEAT * 2.4, 0.6);
    if (b === 10) sub(ctx, pump, t, c.root * 2, BEAT * 1.2, 0.4);
    // atmospheric pad chord, one swell per bar
    if (b === 0) pad(ctx, pump, t, c.pad, BEAT * 4, 0.05);
    // sparse pluck melody — 2 notes per bar (NOT a busy arp)
    if (b === 0) pluck(ctx, pump, t, c.lead[0], 0.15, 0.45);
    if (b === 10) pluck(ctx, pump, t, c.lead[1], 0.13, 0.4);
    // a slow riser sweeps up every 2 bars for tension
    if (s % 32 === 0) riserSweep(ctx, pump, t, BEAT * 7.5, 0.1);
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
      nextTime += STEP16;
    }
  }, 30);

  let outroStarted = false;
  return (tier?: WinTier) => {
    if (outroStarted) return;
    outroStarted = true;
    const now = ctx.currentTime;
    const big = tier === 'great' || tier === 'legendary';
    const tail = tier === 'legendary' ? 7.2 : tier === 'great' ? 5.4 : tier === 'good' ? 2.4 : 1.7;
    if (big) {
      // STOP the looping groove immediately — the big-win outro brings its own
      // beat, and letting the groove keep running on its own grid underneath
      // produced two out-of-phase beats ("tripping out / out of sync"). The
      // already-queued groove notes (<0.2s) tail out under the riser lead-in.
      stopped = true;
      clearInterval(timer);
      launchBigOutro(ctx, { dry, space }, tier, now + 0.6);
    }
    try {
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.setValueAtTime(0.9, now + tail - 1.3);
      master.gain.exponentialRampToValueAtTime(0.0008, now + tail);
    } catch { /* ignore */ }
    if (!big) setTimeout(() => { stopped = true; clearInterval(timer); }, tail * 1000 + 120);
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

// Win stings — clean, modern, reverbed. Scaled by tier; even a basic 1-draft
// is a tasteful sub + pluck, not a cheesy fanfare.
export function playWinSound(tier: WinTier) {
  try {
    const ctx = getAudioContext();
    const { dry, space } = masterChain(ctx);
    const now = ctx.currentTime;

    switch (tier) {
      case 'standard': {
        riserSweep(ctx, space, now, 0.16, 0.1);
        boom(ctx, dry, now + 0.15, 0.32, 130);
        pluck(ctx, space, now + 0.15, 880.0, 0.16, 0.5);
        pluck(ctx, space, now + 0.28, 1318.5, 0.12, 0.5);
        break;
      }
      case 'good': {
        riserSweep(ctx, space, now, 0.2, 0.13);
        boom(ctx, dry, now + 0.18, 0.45, 160);
        noiseHit(ctx, dry, now + 0.18, 0.2, 0.3, 2500);
        chordSwell(ctx, space, now + 0.18, [523.3, 659.3, 784.0], 0.7, 0.14);
        [880, 1046.5, 1318.5].forEach((f, i) => pluck(ctx, space, now + 0.2 + i * 0.1, f, 0.12, 0.5));
        break;
      }
      case 'great': {
        riserSweep(ctx, space, now, 0.26, 0.16);
        boom(ctx, dry, now + 0.24, 0.55, 190);
        noiseHit(ctx, dry, now + 0.24, 0.28, 0.5, 1500);
        chordSwell(ctx, space, now + 0.24, [523.3, 659.3, 784.0, 1046.5], 0.9, 0.16);
        [784, 1046.5, 1318.5, 1568].forEach((f, i) => pluck(ctx, space, now + 0.26 + i * 0.09, f, 0.13, 0.5));
        break;
      }
      case 'legendary': {
        riserSweep(ctx, space, now, 0.32, 0.2);
        boom(ctx, dry, now + 0.3, 0.7, 220);
        noiseHit(ctx, dry, now + 0.3, 0.36, 0.7, 1100);
        chordSwell(ctx, space, now + 0.3, [523.3, 659.3, 784.0, 1046.5], 1.2, 0.18);
        [784, 1046.5, 1318.5, 1568, 2093].forEach((f, i) => pluck(ctx, space, now + 0.32 + i * 0.085, f, 0.13, 0.55));
        break;
      }
    }
  } catch { /* audio unavailable — no-op */ }
}

// Map a wheel segment to a sound tier.
export function getWinTier(segment: { prizeValue?: number | string; id: string }): WinTier {
  if (segment.id === 'jackpot' || segment.id === 'jackhof') return 'legendary';
  if (typeof segment.prizeValue === 'number' && segment.prizeValue >= 20) return 'legendary';
  if (typeof segment.prizeValue === 'number' && segment.prizeValue >= 10) return 'great';
  if (segment.id === 'hof') return 'good';
  if (typeof segment.prizeValue === 'number' && segment.prizeValue >= 5) return 'good';
  return 'standard';
}
