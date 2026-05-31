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

// Soft-clip distortion curve (waveshaper). Grit = the key to a MODERN,
// aggressive sound vs. clean (80s-sounding) synths.
function distCurve(amount: number) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  return curve;
}

// Gritty 808 sub — sine through light waveshaping for body + edge.
function bass808(ctx: AudioContext, dest: AudioNode, at: number, freq: number, dur: number, vol = 0.62) {
  const ws = ctx.createWaveShaper();
  ws.curve = distCurve(2);
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq * 1.5, at);
  o.frequency.exponentialRampToValueAtTime(freq, at + 0.05);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, at + dur);
  o.connect(ws); ws.connect(g); g.connect(dest);
  o.start(at); o.stop(at + dur + 0.02);
}

// Growl bass — detuned saws through a wobbling lowpass + heavy distortion =
// a modern hybrid-trap / dubstep bass. This is the hook (replaces saw chords).
function growl(ctx: AudioContext, dest: AudioNode, at: number, freq: number, dur: number, vol = 0.38) {
  const ws = ctx.createWaveShaper();
  ws.curve = distCurve(10);
  ws.oversample = '2x';
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(300, at);
  lp.frequency.linearRampToValueAtTime(1500, at + dur * 0.3);
  lp.frequency.linearRampToValueAtTime(450, at + dur * 0.6);
  lp.frequency.linearRampToValueAtTime(1100, at + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0008, at + dur);
  lp.connect(ws); ws.connect(g); g.connect(dest);
  for (const det of [-12, 0, 12]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq * Math.pow(2, det / 1200);
    o.connect(lp);
    o.start(at); o.stop(at + dur + 0.02);
  }
}

// Hard snare — noise crack + short tonal body.
function snare(ctx: AudioContext, dest: AudioNode, at: number, vol = 0.3) {
  noiseHit(ctx, dest, at, vol, 0.16, 1800);
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(220, at);
  o.frequency.exponentialRampToValueAtTime(150, at + 0.08);
  g.gain.setValueAtTime(vol * 0.5, at);
  g.gain.exponentialRampToValueAtTime(0.001, at + 0.1);
  o.connect(g); g.connect(dest);
  o.start(at); o.stop(at + 0.11);
}

// Sidechain pump: duck a bus to ~0.35 on the kick, recover over the beat.
function pumpDuck(node: AudioParam, at: number, beat: number) {
  node.cancelScheduledValues(at);
  node.setValueAtTime(0.35, at);
  node.linearRampToValueAtTime(1.0, at + beat * 0.9);
}

// Dark, warm chord — LOW register detuned saws under a lowpass that stays warm
// (opens only to ~2.2k, not bright/trance). Moody, not cheesy.
function darkChord(ctx: AudioContext, dest: AudioNode, at: number, freqs: number[], dur: number, vol = 0.15) {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(300, at);
  lp.frequency.exponentialRampToValueAtTime(2200, at + dur * 0.5);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.06);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  lp.connect(g);
  g.connect(dest);
  for (const f of freqs) {
    for (const det of [-9, -3, 3, 9]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f * Math.pow(2, det / 1200);
      o.connect(lp);
      o.start(at);
      o.stop(at + dur + 0.02);
    }
  }
}

// The "goes crazy" celebration for HOF / Jackpot — MODERN + hard, not 80s: no
// saw-chord melody at all. It's distorted 808 + a wobbling growl-bass hook,
// hard kicks + snare backbeat + fast hat rolls, and big risers/impacts.
function launchSlotCelebration(ctx: AudioContext, buses: { dry: GainNode; space: GainNode }, big: boolean, startAt: number) {
  const { dry, space } = buses;
  // bass bus — kept dry (tight, upfront) and sidechain-pumped under the kick.
  const bassBus = ctx.createGain();
  bassBus.connect(dry);
  const BEAT = 0.3;
  const HALF = BEAT / 2;
  const barLen = BEAT * 4;

  // downlifter + huge impact into the drop
  riserSweep(ctx, space, startAt - 0.4, 0.4, 0.24);
  boom(ctx, dry, startAt, big ? 0.9 : 0.75, 250);
  noiseHit(ctx, dry, startAt, 0.45, 0.85, 1000); // big crash

  const bars = big ? 4 : 3;
  const roots = [55.0, 49.0, 43.65, 41.2]; // A G F E — dark, low
  for (let bar = 0; bar < bars; bar++) {
    const t = startAt + bar * barLen;
    const root = roots[bar % roots.length];
    // hard kicks on 1 & 3, pumping the bass bus
    kick(ctx, dry, t, 1.0); pumpDuck(bassBus.gain, t, BEAT);
    kick(ctx, dry, t + BEAT * 2, 1.0); pumpDuck(bassBus.gain, t + BEAT * 2, BEAT);
    // snare backbeat (2 & 4), in reverb
    snare(ctx, space, t + BEAT, 0.3);
    snare(ctx, space, t + BEAT * 3, 0.3);
    // fast hats (16ths) + a 32nd roll into the next bar
    for (let h = 0; h < 8; h++) noiseHit(ctx, dry, t + h * HALF, h % 2 ? 0.05 : 0.08, 0.03, 9000);
    noiseHit(ctx, dry, t + barLen - HALF * 0.5, 0.06, 0.025, 9500);
    noiseHit(ctx, dry, t + barLen - HALF * 0.25, 0.06, 0.025, 9500);
    // crash on the bar
    noiseHit(ctx, space, t, 0.16, 0.45, 2200);
    // gritty 808 sub for the whole bar
    bass808(ctx, bassBus, t, root * 2, barLen * 0.95, 0.6);
    // GROWL bass hook — syncopated wobble (the modern centerpiece)
    growl(ctx, bassBus, t, root * 2, BEAT * 1.2, 0.4);
    growl(ctx, bassBus, t + BEAT * 1.5, root * 2, BEAT * 0.8, 0.36);
    growl(ctx, bassBus, t + BEAT * 2.5, root * 3, BEAT * 1.1, 0.36);
  }
  const fin = startAt + bars * barLen;
  boom(ctx, dry, fin, big ? 0.8 : 0.6, 240);
  noiseHit(ctx, dry, fin, 0.4, 1.0, 1000);
  growl(ctx, bassBus, fin, roots[0] * 2, 1.2, 0.42);
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
      // Dark impact hit on the reveal (warm chord, not a bright stab), then the
      // build, then the drop goes crazy.
      riserSweep(ctx, space, now, big ? 0.26 : 0.22, big ? 0.2 : 0.16);
      boom(ctx, dry, now + 0.2, big ? 0.7 : 0.55, big ? 230 : 190);
      noiseHit(ctx, dry, now + 0.2, 0.32, 0.6, big ? 1100 : 1400);
      darkChord(ctx, space, now + 0.22, big ? [110.0, 130.8, 164.8, 220.0] : [110.0, 130.8, 164.8], 1.0, 0.17);
      // the celebration drop kicks in after a short build
      launchSlotCelebration(ctx, { dry, space }, big, now + 0.55);
    } else {
      // pro — clean, positive, not anticlimactic but not huge
      boom(ctx, dry, now, 0.34, 140);
      chordSwell(ctx, space, now, [392.0, 523.3, 659.3], 0.7, 0.13);
      pluck(ctx, space, now + 0.1, 880.0, 0.13, 0.45);
      pluck(ctx, space, now + 0.22, 1046.5, 0.1, 0.45);
    }
  } catch { /* audio unavailable */ }
}
