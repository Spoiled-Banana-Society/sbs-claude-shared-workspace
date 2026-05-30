// Web Audio API sound effects for the Banana Wheel.
// Fully procedural — no external audio files. Designed around the real spin
// length (SPIN_DURATION_MS ≈ 1300ms): a tight EDM build that climaxes the
// instant the wheel stops, then a tiered "drop" sting for the prize.

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

// A shared mastering chain: compressor glues the layers and stops the stacked
// oscillators from clipping, which is most of what makes this read as "produced"
// rather than a pile of beeps.
function masterChain(ctx: AudioContext): GainNode {
  const out = ctx.createGain();
  out.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 24;
  comp.ratio.value = 12;
  comp.attack.value = 0.003;
  comp.release.value = 0.18;
  out.connect(comp);
  comp.connect(ctx.destination);
  return out;
}

// One-second of white noise, reused for hats / risers / impacts.
function noiseBuffer(ctx: AudioContext, seconds = 1): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
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

// Punchy kick: pitch-dropping sine + click transient.
function kick(ctx: AudioContext, dest: AudioNode, at: number, vol = 0.9) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(170, at);
  osc.frequency.exponentialRampToValueAtTime(46, at + 0.11);
  gain.gain.setValueAtTime(vol, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + 0.16);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(at);
  osc.stop(at + 0.18);
}

// Noise impact / crash — used for hats, claps and big wins.
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

// Tick — kept for backwards-compat (used to be the per-segment click).
export function playTick(pitch = 800) {
  playTone(pitch, 0.05, 0.08, 'square');
}

// The spin groove: a driving EDM loop that starts AUDIBLE the instant the
// wheel starts (not after the result lands), keeps looping for as long as the
// wheel spins (variable — depends on network), and on stop() rides a beat past
// the landing then fades, so the music clearly continues after the wheel stops.
function startGroove(): () => void {
  const ctx = getAudioContext();
  const master = masterChain(ctx);
  const t0 = ctx.currentTime;
  // ~instant fade-in (just avoids a click), so it reads as "starts immediately".
  master.gain.setValueAtTime(0.0001, t0);
  master.gain.exponentialRampToValueAtTime(0.85, t0 + 0.07);

  const tempo = 142;                       // BPM — driving house/EDM
  const sixteenth = 60 / tempo / 4;        // seconds per 16th note
  const bassRoot = 55;                     // A1
  const arp = [220.0, 261.6, 329.6, 440.0, 329.6, 261.6, 392.0, 329.6]; // A-min-ish

  // Closed hat = a tiny high-passed noise tick.
  const hat = (t: number, vol: number) => noiseHit(ctx, master, t, vol, 0.035, 7000);

  // Plucky sub-bass note through a lowpass.
  const bass = (t: number, freq: number, vol = 0.5) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(lp); lp.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.2);
  };

  // Schedule one 16th-note step of the bar.
  const scheduleStep = (s: number, t: number) => {
    const b = s % 16; // position within the 16-step bar
    if (b % 4 === 0) kick(ctx, master, t, 0.95);                 // four-on-the-floor
    if (b % 2 === 0) hat(t, b % 4 === 2 ? 0.13 : 0.06);          // hats, offbeat accent
    if (b === 4 || b === 12) noiseHit(ctx, master, t, 0.16, 0.13, 1800); // clap backbeat
    if (b === 0 || b === 6 || b === 10) bass(t, bassRoot * 2);   // bass groove
    if (b === 8) bass(t, bassRoot * 3);
    // bright square arp on every 16th
    const note = arp[s % arp.length] * 2;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = note;
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + sixteenth * 0.9);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + sixteenth);
  };

  // Lookahead scheduler — keeps the loop going for any spin length.
  let step = 0;
  let nextTime = t0 + 0.06;
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    const horizon = ctx.currentTime + 0.2;
    while (nextTime < horizon) {
      scheduleStep(step, nextTime);
      step += 1;
      nextTime += sixteenth;
    }
  }, 40);

  let outroStarted = false;
  return () => {
    if (outroStarted) return;
    outroStarted = true;
    const now = ctx.currentTime;
    try {
      // Hold full volume for ~0.9s past the stop, THEN fade — the music keeps
      // grooving after the wheel lands instead of cutting off.
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.setValueAtTime(0.85, now + 0.9);
      master.gain.exponentialRampToValueAtTime(0.0008, now + 2.8);
    } catch { /* ignore */ }
    // Keep scheduling through the tail, then stop.
    setTimeout(() => { stopped = true; clearInterval(timer); }, 2900);
  };
}

// Public: start the spin soundbed the moment the wheel starts moving.
export function startSpinSound(): () => void {
  try {
    return startGroove();
  } catch {
    return () => { /* audio unavailable — no-op */ };
  }
}

// Win sounds — the payoff "drop". Tiered by prize quality.
export function playWinSound(tier: 'standard' | 'good' | 'great' | 'legendary') {
  try {
    const ctx = getAudioContext();
    const master = masterChain(ctx);
    const now = ctx.currentTime;

    // Sub-bass drop boom — the gut-punch under every win, bigger as tier climbs.
    const boom = (vol: number, startFreq: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(startFreq, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.4);
      gain.gain.setValueAtTime(vol, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
      osc.connect(gain); gain.connect(master);
      osc.start(now); osc.stop(now + 0.6);
    };

    // Detuned-saw stab chord (supersaw) through an opening lowpass = festival stab.
    const stab = (freqs: number[], at: number, dur: number, vol: number) => {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(500, now + at);
      lp.frequency.exponentialRampToValueAtTime(6000, now + at + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, now + at);
      g.gain.exponentialRampToValueAtTime(0.001, now + at + dur);
      lp.connect(g); g.connect(master);
      for (const f of freqs) {
        for (const det of [-6, 0, 6]) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = f * Math.pow(2, det / 1200);
          o.connect(lp);
          o.start(now + at);
          o.stop(now + at + dur + 0.02);
        }
      }
    };

    const sparkle = (base: number, steps: number, vol: number) => {
      for (let i = 0; i < steps; i++) {
        playTone(base * Math.pow(2, i / 12) * 2, 0.18, vol, 'triangle', master);
      }
    };

    switch (tier) {
      case 'standard': {
        boom(0.35, 120);
        playTone(523, 0.18, 0.16, 'square', master);          // C5
        setTimeout(() => playTone(784, 0.3, 0.16, 'square', master), 110); // G5
        break;
      }
      case 'good': {
        boom(0.45, 160);
        stab([392, 523, 659], 0, 0.35, 0.16);                  // G/C/E chord stab
        setTimeout(() => playTone(1047, 0.4, 0.14, 'triangle', master), 180);
        noiseHit(ctx, master, now, 0.18, 0.3, 4000);
        break;
      }
      case 'great': {
        boom(0.55, 180);
        noiseHit(ctx, master, now, 0.3, 0.5, 1500);            // crash
        stab([523, 659, 784], 0.02, 0.5, 0.18);                // bright major stab
        // ascending sparkle arp
        [0, 100, 200, 320, 460].forEach((d, i) =>
          setTimeout(() => playTone([523, 659, 784, 1047, 1319][i], 0.4, 0.16, 'triangle', master), d));
        break;
      }
      case 'legendary': {
        // Full festival drop: sub boom + crash + huge detuned stab + rising
        // sparkle run + an octave-up shimmer tail.
        boom(0.7, 220);
        noiseHit(ctx, master, now, 0.4, 0.7, 1000);            // big crash
        stab([523, 659, 784, 1047], 0.0, 0.7, 0.2);            // wide stab
        setTimeout(() => stab([587, 740, 880, 1175], 0.0, 0.7, 0.18), 240); // lift a step
        // rising sparkle run
        [523, 659, 784, 1047, 1319, 1568, 2093].forEach((f, i) =>
          setTimeout(() => {
            playTone(f, 0.5, 0.16, 'triangle', master);
            playTone(f * 1.5, 0.5, 0.07, 'sine', master);       // fifth shimmer
          }, 120 + i * 80));
        sparkle(1568, 4, 0.06);
        break;
      }
    }
  } catch { /* audio unavailable — no-op */ }
}

// Map a wheel segment to a sound tier.
export function getWinTier(segment: { prizeValue?: number | string; id: string }): 'standard' | 'good' | 'great' | 'legendary' {
  if (segment.id === 'jackpot') return 'legendary';
  if (typeof segment.prizeValue === 'number' && segment.prizeValue >= 20) return 'legendary';
  if (typeof segment.prizeValue === 'number' && segment.prizeValue >= 10) return 'great';
  if (segment.id === 'hof') return 'good';
  if (typeof segment.prizeValue === 'number' && segment.prizeValue >= 5) return 'good';
  return 'standard';
}
