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

// Short bright blip — the accelerating "ratchet" of the wheel ticking faster.
function blip(ctx: AudioContext, dest: AudioNode, at: number, freq: number, vol = 0.16) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(freq, at);
  gain.gain.setValueAtTime(vol, at);
  gain.gain.exponentialRampToValueAtTime(0.0008, at + 0.06);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(at);
  osc.stop(at + 0.07);
}

// Noise impact / crash — used for the build climax and big wins.
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

// The spin build: a riser that swells over the whole spin and climaxes exactly
// when the wheel lands, with an accelerating kick + ratchet underneath.
function startSpinBuild(durationMs: number): () => void {
  const ctx = getAudioContext();
  const master = masterChain(ctx);
  const now = ctx.currentTime;
  const dur = Math.max(0.3, durationMs / 1000);
  const end = now + dur;

  // --- Riser 1: filtered white-noise sweep (the "whoosh" build) ---
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx, dur + 0.2);
  noise.loop = true;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.setValueAtTime(350, now);
  hp.frequency.exponentialRampToValueAtTime(7000, end);
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.0001, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.22, end);
  noise.connect(hp); hp.connect(noiseGain); noiseGain.connect(master);
  noise.start(now); noise.stop(end + 0.05);

  // --- Riser 2: saw pitch-riser (the tonal lift) ---
  const riser = ctx.createOscillator();
  const riserGain = ctx.createGain();
  riser.type = 'sawtooth';
  riser.frequency.setValueAtTime(220, now);
  riser.frequency.exponentialRampToValueAtTime(1760, end); // up 3 octaves
  riserGain.gain.setValueAtTime(0.0001, now);
  riserGain.gain.exponentialRampToValueAtTime(0.1, end);
  riser.connect(riserGain); riserGain.connect(master);
  riser.start(now); riser.stop(end + 0.02);

  // --- Rising sub bass for weight ---
  const sub = ctx.createOscillator();
  const subGain = ctx.createGain();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(55, now);
  sub.frequency.linearRampToValueAtTime(110, end);
  subGain.gain.setValueAtTime(0.0001, now);
  subGain.gain.exponentialRampToValueAtTime(0.45, end);
  sub.connect(subGain); subGain.connect(master);
  sub.start(now); sub.stop(end + 0.02);

  // --- Driving kick: 4 hits, the last one landing on the drop ---
  for (let i = 0; i < 4; i++) {
    kick(ctx, master, now + (dur * i) / 4, 0.7 + i * 0.1);
  }

  // --- Accelerating ratchet: blips packed tighter + pitched higher toward
  // the end, so the ear hears the wheel "spinning up" into the climax. ---
  const N = 16;
  for (let i = 0; i < N; i++) {
    const frac = i / N;
    // ease-in so hits bunch up near the end
    const at = now + Math.pow(frac, 1.7) * dur;
    const freq = 480 + frac * frac * 1400;
    blip(ctx, master, at, freq, 0.07 + frac * 0.1);
  }

  // --- Climax impact right as it lands ---
  noiseHit(ctx, master, end - 0.02, 0.3, 0.35, 2000);

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    try {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.06);
    } catch { /* already stopped */ }
  };
}

// Public: start the spin soundbed. durationMs should match the wheel's
// SPIN_DURATION_MS so the build climaxes exactly on the stop.
export function startSpinSound(durationMs = 1300): () => void {
  try {
    return startSpinBuild(durationMs);
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
