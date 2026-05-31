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

// Crisp reel tick — a tiny click as the reel clicks past a symbol. Triangle
// (not square) so it's clean, not harsh/8-bit. Pitch rises as the spin builds.
function tick(ctx: AudioContext, dest: AudioNode, at: number, pitch = 1300) {
  noiseHit(ctx, dest, at, 0.045, 0.015, 5500);
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'triangle';
  o.frequency.value = pitch;
  g.gain.setValueAtTime(0.026, at);
  g.gain.exponentialRampToValueAtTime(0.0006, at + 0.018);
  o.connect(g);
  g.connect(dest);
  o.start(at);
  o.stop(at + 0.022);
}

// Soft, clean sub pulse for body — gated (a heartbeat, NOT a droning hum).
function subPulse(ctx: AudioContext, dest: AudioNode, at: number) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.value = 58;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(0.16, at + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, at + 0.16);
  o.connect(g);
  g.connect(dest);
  o.start(at);
  o.stop(at + 0.18);
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

// Punchy kick + sustained sub note for the celebration drop.
function kick(ctx: AudioContext, dest: AudioNode, at: number, vol = 1.0) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(170, at);
  osc.frequency.exponentialRampToValueAtTime(48, at + 0.08);
  gain.gain.setValueAtTime(vol, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + 0.14);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(at);
  osc.stop(at + 0.15);
}

function subNote(ctx: AudioContext, dest: AudioNode, at: number, freq: number, dur: number, vol = 0.55) {
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

// Sidechain pump: duck a bus to ~0.35 on the kick, recover over the beat.
function pumpDuck(node: AudioParam, at: number, beat: number) {
  node.cancelScheduledValues(at);
  node.setValueAtTime(0.35, at);
  node.linearRampToValueAtTime(1.0, at + beat * 0.9);
}

// Rising lead for the celebration.
const CELEB_LEAD = [523.3, 659.3, 587.3, 784.0, 659.3, 880.0, 784.0, 1046.5, 880.0, 1318.5];

// The "goes crazy and stays longer" celebration for HOF / Jackpot reveals — a
// modern future-bass drop: riser -> wide chord swell + rising lead over driving
// kicks/sub/claps. `big` = jackpot (longer + harder); else HOF.
function launchSlotCelebration(ctx: AudioContext, buses: { dry: GainNode; space: GainNode }, big: boolean, startAt: number) {
  const { dry, space } = buses;
  const pump = ctx.createGain();
  pump.connect(space);
  const BEAT = 0.4;
  const barLen = BEAT * 4;

  riserSweep(ctx, pump, startAt - 0.45, 0.45, 0.22);
  boom(ctx, dry, startAt, big ? 0.7 : 0.55, 220);
  noiseHit(ctx, dry, startAt, 0.32, 0.6, 1500);

  const bars = big ? 3 : 2;
  const roots = [55.0, 49.0, 43.65]; // A G F
  const chords = [[220, 261.6, 329.6], [196, 246.9, 293.7], [174.6, 220, 261.6]];
  let leadIdx = 0;
  for (let bar = 0; bar < bars; bar++) {
    const t = startAt + bar * barLen;
    for (let beatN = 0; beatN < 4; beatN++) {
      const bt = t + beatN * BEAT;
      kick(ctx, dry, bt, 1.0);
      pumpDuck(pump.gain, bt, BEAT);
      noiseHit(ctx, dry, bt + BEAT / 2, 0.1, 0.05, 9000); // offbeat hat
    }
    subNote(ctx, pump, t, roots[bar % roots.length] * 2, barLen * 0.9, 0.55);
    noiseHit(ctx, space, t + BEAT, 0.22, 0.14, 1700);     // clap
    noiseHit(ctx, space, t + BEAT * 3, 0.22, 0.14, 1700);
    chordSwell(ctx, pump, t, chords[bar % chords.length], barLen * 0.95, 0.16);
    for (let k = 0; k < 4; k++) {
      const f = CELEB_LEAD[Math.min(leadIdx++, CELEB_LEAD.length - 1)];
      pluck(ctx, pump, t + k * BEAT, f, 0.16, 0.5);
    }
  }
  const fin = startAt + bars * barLen;
  boom(ctx, dry, fin, big ? 0.6 : 0.45, 200);
  noiseHit(ctx, dry, fin, 0.3, 0.9, 1100);
  chordSwell(ctx, pump, fin, [523.3, 659.3, 784.0, 1046.5], 1.6, 0.18);
}

// The reels spinning — CLEAN and cool: crisp ticks (the star) + an airy HIGH
// rising sweep for tension + a soft rhythmic sub pulse for body. Deliberately
// no low sawtooth/drone (that was the buzzy "hum"). Returns a stop() that fades.
export function startSlotSpin(): () => void {
  try {
    const ctx = getAudioContext();
    const { master, dry, space } = masterChain(ctx);
    const t0 = ctx.currentTime;
    master.gain.setValueAtTime(0.0001, t0);
    master.gain.exponentialRampToValueAtTime(0.8, t0 + 0.08);

    // airy rising sweep — high-passed noise sweeping UP. Kept high + quiet so
    // there's zero low hum, just an "ssshhh" of building tension (in reverb).
    const air = ctx.createBufferSource();
    air.buffer = noiseBuffer(ctx, 1.5);
    air.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(3200, t0);
    hp.frequency.exponentialRampToValueAtTime(9000, t0 + 6);
    const airG = ctx.createGain();
    airG.gain.value = 0.028;
    air.connect(hp); hp.connect(airG); airG.connect(space);
    air.start(t0);

    // crisp reel ticks — pitch rises as the spin builds (excitement)
    let stopped = false;
    let nextT = t0 + 0.05;
    let n = 0;
    const tickInt = 0.05;
    const tickTimer = setInterval(() => {
      if (stopped) return;
      const horizon = ctx.currentTime + 0.15;
      while (nextT < horizon) {
        tick(ctx, dry, nextT, 950 + Math.min(n * 7, 750));
        nextT += tickInt;
        n += 1;
      }
    }, 25);

    // soft rhythmic sub pulse for weight (heartbeat, not a drone)
    let pulseT = t0 + 0.12;
    const pulseTimer = setInterval(() => {
      if (stopped) return;
      const horizon = ctx.currentTime + 0.3;
      while (pulseT < horizon) {
        subPulse(ctx, dry, pulseT);
        pulseT += 0.4;
      }
    }, 60);

    return () => {
      if (stopped) return;
      stopped = true;
      clearInterval(tickTimer);
      clearInterval(pulseTimer);
      const now = ctx.currentTime;
      try {
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(master.gain.value, now);
        master.gain.exponentialRampToValueAtTime(0.0008, now + 0.2);
      } catch { /* ignore */ }
      try { air.stop(now + 0.25); } catch { /* ignore */ }
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
    if (type === 'jackpot' || type === 'hof') {
      // Immediate "hit" on the reveal, then the music GOES CRAZY — a full
      // celebration drop that rides for several seconds (jackpot biggest).
      const big = type === 'jackpot';
      riserSweep(ctx, space, now, big ? 0.26 : 0.22, big ? 0.2 : 0.16);
      boom(ctx, dry, now + 0.22, big ? 0.6 : 0.5, big ? 220 : 180);
      noiseHit(ctx, dry, now + 0.22, 0.3, 0.6, big ? 1000 : 1400);
      chordSwell(ctx, space, now + 0.24, big ? [523.3, 659.3, 784.0, 1046.5] : [523.3, 659.3, 784.0], 1.0, big ? 0.19 : 0.16);
      // the celebration drop kicks in after a short build
      launchSlotCelebration(ctx, { dry, space }, big, now + 0.7);
    } else {
      // pro — clean, positive, not anticlimactic but not huge
      boom(ctx, dry, now, 0.34, 140);
      chordSwell(ctx, space, now, [392.0, 523.3, 659.3], 0.7, 0.13);
      pluck(ctx, space, now + 0.1, 880.0, 0.13, 0.45);
      pluck(ctx, space, now + 0.22, 1046.5, 0.1, 0.45);
    }
  } catch { /* audio unavailable */ }
}
