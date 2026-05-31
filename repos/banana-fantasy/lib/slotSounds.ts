// Web Audio API sound for the draft-fill SLOT MACHINE reveal — fully procedural
// (no audio files). Modern + hype, matching the wheel's vibe: a mechanical
// spin whir with fast ticks + a building tension riser, a satisfying "CHUNK"
// per reel that climbs in pitch as the suspense builds, and a tiered reveal
// (Jackpot = huge drop, HOF = gold, Pro = clean). Reverb gives it polish.

let audioCtx: AudioContext | null = null;
let reverbIR: AudioBuffer | null = null;

export type SlotRevealType = 'jackpot' | 'hof' | 'pro';

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function getReverb(ctx: AudioContext): ConvolverNode {
  const conv = ctx.createConvolver();
  if (!reverbIR) {
    const dur = 1.6;
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
  wet.gain.value = 0.3;
  verb.connect(wet);
  wet.connect(master);

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

function noiseHit(ctx: AudioContext, dest: AudioNode, at: number, vol = 0.3, dur = 0.2, hp = 1200) {
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

// Crisp reel tick — a tiny click as the reel clicks past a symbol.
function tick(ctx: AudioContext, dest: AudioNode, at: number) {
  noiseHit(ctx, dest, at, 0.05, 0.018, 5000);
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'square';
  o.frequency.value = 1400;
  g.gain.setValueAtTime(0.03, at);
  g.gain.exponentialRampToValueAtTime(0.0006, at + 0.02);
  o.connect(g);
  g.connect(dest);
  o.start(at);
  o.stop(at + 0.025);
}

// Modern pluck — two detuned saws through a fast filter env.
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

// Future-bass chord swell — wide detuned saws, filter opens.
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

// The reels spinning: a mechanical whir + low motor rumble + fast ticks +
// a tension tone that slowly rises. Returns a stop() that fades it out.
export function startSlotSpin(): () => void {
  try {
    const ctx = getAudioContext();
    const { master, dry, space } = masterChain(ctx);
    const t0 = ctx.currentTime;
    master.gain.setValueAtTime(0.0001, t0);
    master.gain.exponentialRampToValueAtTime(0.85, t0 + 0.08);

    // whir — looping band-passed noise (reels rushing past)
    const whir = ctx.createBufferSource();
    whir.buffer = noiseBuffer(ctx, 1.2);
    whir.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    bp.frequency.value = 1900;
    const whirG = ctx.createGain();
    whirG.gain.value = 0.05;
    whir.connect(bp); bp.connect(whirG); whirG.connect(dry);
    whir.start(t0);

    // motor rumble
    const rumble = ctx.createOscillator();
    rumble.type = 'sawtooth';
    rumble.frequency.value = 68;
    const rLp = ctx.createBiquadFilter();
    rLp.type = 'lowpass';
    rLp.frequency.value = 200;
    const rG = ctx.createGain();
    rG.gain.value = 0.06;
    rumble.connect(rLp); rLp.connect(rG); rG.connect(dry);
    rumble.start(t0);

    // tension tone rising under the spin
    const tens = ctx.createOscillator();
    tens.type = 'sine';
    tens.frequency.setValueAtTime(220, t0);
    tens.frequency.exponentialRampToValueAtTime(660, t0 + 6);
    const tG = ctx.createGain();
    tG.gain.setValueAtTime(0.0001, t0);
    tG.gain.exponentialRampToValueAtTime(0.04, t0 + 5);
    tens.connect(tG); tG.connect(space);
    tens.start(t0);

    // fast reel ticks
    let stopped = false;
    let nextT = t0 + 0.05;
    const tickInt = 0.045;
    const timer = setInterval(() => {
      if (stopped) return;
      const horizon = ctx.currentTime + 0.15;
      while (nextT < horizon) {
        tick(ctx, dry, nextT);
        nextT += tickInt;
      }
    }, 25);

    return () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      const now = ctx.currentTime;
      try {
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(master.gain.value, now);
        master.gain.exponentialRampToValueAtTime(0.0008, now + 0.25);
      } catch { /* ignore */ }
      try { whir.stop(now + 0.3); rumble.stop(now + 0.3); tens.stop(now + 0.3); } catch { /* ignore */ }
    };
  } catch {
    return () => { /* audio unavailable */ };
  }
}

// A reel locking — a mechanical CHUNK + a bright accent that climbs in pitch
// with the reel index (reel 0 → low, reel 2 → high = peak suspense).
export function playReelStop(index: number) {
  try {
    const ctx = getAudioContext();
    const { dry, space } = masterChain(ctx);
    const now = ctx.currentTime;
    // mechanical thud
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, now);
    o.frequency.exponentialRampToValueAtTime(52, now + 0.09);
    g.gain.setValueAtTime(0.5, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    o.connect(g); g.connect(dry);
    o.start(now); o.stop(now + 0.15);
    // chunk
    noiseHit(ctx, dry, now, 0.26, 0.08, 1500);
    // bright accent — rises with the reel index
    const accent = [523.3, 659.3, 880.0][Math.min(Math.max(index, 0), 2)];
    pluck(ctx, space, now + 0.02, accent, 0.16, 0.3);
    // last reel = a little suspense lift
    if (index >= 2) riserSweep(ctx, space, now + 0.03, 0.18, 0.1);
  } catch { /* audio unavailable */ }
}

// The reveal payoff, tiered by draft type.
export function playSlotReveal(type: SlotRevealType) {
  try {
    const ctx = getAudioContext();
    const { dry, space } = masterChain(ctx);
    const now = ctx.currentTime;
    if (type === 'jackpot') {
      riserSweep(ctx, space, now, 0.26, 0.2);
      boom(ctx, dry, now + 0.26, 0.7, 220);
      noiseHit(ctx, dry, now + 0.26, 0.35, 0.7, 1000);
      chordSwell(ctx, space, now + 0.28, [523.3, 659.3, 784.0, 1046.5], 1.4, 0.2);
      [784, 1046.5, 1318.5, 1568, 2093].forEach((f, i) => pluck(ctx, space, now + 0.3 + i * 0.08, f, 0.14, 0.6));
    } else if (type === 'hof') {
      riserSweep(ctx, space, now, 0.22, 0.16);
      boom(ctx, dry, now + 0.22, 0.5, 180);
      noiseHit(ctx, dry, now + 0.22, 0.24, 0.5, 1400);
      chordSwell(ctx, space, now + 0.24, [523.3, 659.3, 784.0], 1.1, 0.17);
      [659.3, 880, 1046.5, 1318.5].forEach((f, i) => pluck(ctx, space, now + 0.26 + i * 0.09, f, 0.13, 0.55));
    } else {
      // pro — clean, positive, not anticlimactic but not huge
      boom(ctx, dry, now, 0.34, 140);
      chordSwell(ctx, space, now, [392.0, 523.3, 659.3], 0.7, 0.13);
      pluck(ctx, space, now + 0.1, 880.0, 0.13, 0.45);
      pluck(ctx, space, now + 0.22, 1046.5, 0.1, 0.45);
    }
  } catch { /* audio unavailable */ }
}
