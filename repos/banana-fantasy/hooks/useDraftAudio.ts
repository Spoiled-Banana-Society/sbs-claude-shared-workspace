'use client';

import { useRef, useCallback } from 'react';

export function useDraftAudio() {
  const audioContextRef = useRef<AudioContext | null>(null);
  // Continuous, inaudible source. Browsers idle-suspend an AudioContext that
  // has nothing scheduled (and suspend it outright when the tab is
  // backgrounded). Keeping one near-silent source running keeps the context
  // "warm" so countdown ticks + your-turn alerts still fire after the user has
  // been away from the tab for a while. See AFK-sound bug.
  const keepAliveRef = useRef<OscillatorNode | null>(null);

  const initAudio = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      // Start the keep-warm source once, for the life of the context.
      try {
        const ctx = audioContextRef.current;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0.0001; // -80 dB: inaudible
        osc.frequency.value = 20;  // sub-audible
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        keepAliveRef.current = osc;
      } catch {}
    }
    // Matches slotSounds/wheelSounds — a context that was suspended (tab
    // backgrounded, autoplay policy) must be resumed or nothing plays.
    if (audioContextRef.current.state === 'suspended') {
      void audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);

  // Resume audio after the tab regains focus / the user interacts. Safe to call
  // repeatedly; no-ops if the context is already running or not yet created.
  const resumeAudio = useCallback(() => {
    try {
      const ctx = audioContextRef.current;
      if (ctx && ctx.state === 'suspended') void ctx.resume();
    } catch {}
  }, []);

  const playSpinningSound = useCallback(() => {
    try {
      const ctx = initAudio();
      for (let i = 0; i < 30; i++) {
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);
        oscillator.frequency.value = 200 + Math.random() * 100;
        oscillator.type = 'square';
        const startTime = ctx.currentTime + i * 0.08;
        gainNode.gain.setValueAtTime(0.1, startTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + 0.05);
        oscillator.start(startTime);
        oscillator.stop(startTime + 0.05);
      }
    } catch {}
  }, [initAudio]);

  const playReelStop = useCallback(() => {
    try {
      const ctx = initAudio();
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      oscillator.frequency.value = 80;
      oscillator.type = 'sine';
      gainNode.gain.setValueAtTime(0.4, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.2);

      const click = ctx.createOscillator();
      const clickGain = ctx.createGain();
      click.connect(clickGain);
      clickGain.connect(ctx.destination);
      click.frequency.value = 1000;
      click.type = 'square';
      clickGain.gain.setValueAtTime(0.2, ctx.currentTime);
      clickGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.05);
      click.start(ctx.currentTime);
      click.stop(ctx.currentTime + 0.05);
    } catch {}
  }, [initAudio]);

  const playCountdownTick = useCallback(() => {
    try {
      const ctx = initAudio();
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.08);
    } catch {}
  }, [initAudio]);

  // Final-seconds urgency beep for YOUR pick clock — one per second at 3, 2, 1.
  // Louder and pitched higher than playCountdownTick (the pre-draft tick), and
  // rising each second so the last one reads as "now or never". Web Audio, not
  // a .wav, so it isn't affected by iOS ignoring HTMLAudioElement.volume.
  const playFinalCountdownTick = useCallback((secondsLeft: number) => {
    try {
      const ctx = initAudio();
      const freq = secondsLeft <= 1 ? 1200 : secondsLeft === 2 ? 1000 : 850;
      const t = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.32, t + 0.008); // fast attack, no click
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      osc.start(t);
      osc.stop(t + 0.16);

      // Square harmonic an octave down gives it a hard edge so it still cuts
      // through on a phone speaker.
      const edge = ctx.createOscillator();
      const edgeGain = ctx.createGain();
      edge.connect(edgeGain);
      edgeGain.connect(ctx.destination);
      edge.type = 'square';
      edge.frequency.value = freq / 2;
      edgeGain.gain.setValueAtTime(0.0001, t);
      edgeGain.gain.exponentialRampToValueAtTime(0.09, t + 0.008);
      edgeGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      edge.start(t);
      edge.stop(t + 0.1);
    } catch {}
  }, [initAudio]);

  const playWinSound = useCallback((isRare: boolean) => {
    try {
      const ctx = initAudio();
      if (isRare) {
        const fanfare = [
          { freq: 523, delay: 0, duration: 0.15 },
          { freq: 659, delay: 0.1, duration: 0.15 },
          { freq: 784, delay: 0.2, duration: 0.15 },
          { freq: 1047, delay: 0.3, duration: 0.3 },
          { freq: 784, delay: 0.5, duration: 0.1 },
          { freq: 880, delay: 0.6, duration: 0.1 },
          { freq: 1047, delay: 0.7, duration: 0.4 },
          { freq: 1319, delay: 0.9, duration: 0.5 },
        ];
        fanfare.forEach(note => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = note.freq;
          osc.type = 'sine';
          const start = ctx.currentTime + note.delay;
          gain.gain.setValueAtTime(0, start);
          gain.gain.linearRampToValueAtTime(0.3, start + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.01, start + note.duration);
          osc.start(start);
          osc.stop(start + note.duration);
        });
        for (let i = 0; i < 20; i++) {
          const shimmer = ctx.createOscillator();
          const shimmerGain = ctx.createGain();
          shimmer.connect(shimmerGain);
          shimmerGain.connect(ctx.destination);
          shimmer.frequency.value = 2000 + Math.random() * 2000;
          shimmer.type = 'sine';
          const start = ctx.currentTime + 0.3 + Math.random() * 0.8;
          shimmerGain.gain.setValueAtTime(0.05, start);
          shimmerGain.gain.exponentialRampToValueAtTime(0.001, start + 0.2);
          shimmer.start(start);
          shimmer.stop(start + 0.2);
        }
      } else {
        const frequencies = [440, 554, 659];
        frequencies.forEach((freq, i) => {
          const oscillator = ctx.createOscillator();
          const gainNode = ctx.createGain();
          oscillator.connect(gainNode);
          gainNode.connect(ctx.destination);
          oscillator.frequency.value = freq;
          oscillator.type = 'triangle';
          const startTime = ctx.currentTime + i * 0.1;
          gainNode.gain.setValueAtTime(0, startTime);
          gainNode.gain.linearRampToValueAtTime(0.15, startTime + 0.03);
          gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + 0.3);
          oscillator.start(startTime);
          oscillator.stop(startTime + 0.3);
        });
      }
    } catch {}
  }, [initAudio]);

  // ==================== FILE-BASED AUDIO (your turn, new pick) ====================
  // Uses HTML Audio elements for .wav file playback (matches dev's useAudioYourTurn / useAudioNewTurn)
  const yourTurnAudioRef = useRef<HTMLAudioElement | null>(null);
  const newPickAudioRef = useRef<HTMLAudioElement | null>(null);

  const playYourTurnSound = useCallback(() => {
    try {
      if (!yourTurnAudioRef.current) {
        yourTurnAudioRef.current = new Audio('/your-turn.wav');
      }
      yourTurnAudioRef.current.muted = false; // primeAudio may have left it muted
      yourTurnAudioRef.current.currentTime = 0;
      yourTurnAudioRef.current.play().catch(() => {});
    } catch {}
  }, []);

  const playNewPickSound = useCallback(() => {
    try {
      if (!newPickAudioRef.current) {
        newPickAudioRef.current = new Audio('/new-turn.wav');
      }
      newPickAudioRef.current.muted = false; // primeAudio may have left it muted
      newPickAudioRef.current.currentTime = 0;
      newPickAudioRef.current.play().catch(() => {});
    } catch {}
  }, []);

  // iOS/Safari (esp. installed PWA) unlock: an HTMLAudioElement can only play
  // programmatically AFTER it has been played once inside a real user gesture,
  // and the Web Audio context can only be resumed from a gesture. The your-turn
  // ding + countdown ticks fire on state changes (no tap), so without this they
  // stay muted forever — only the pick-made sound, which fires right after the
  // draft-button tap, happened to be unlocked. Call this from the FIRST tap in
  // the draft room to unlock every draft sound at once. Idempotent + silent
  // (each .wav is started muted, then immediately paused/reset).
  const primeAudio = useCallback(() => {
    try {
      // Web Audio: create + resume within the gesture so ticks/alerts work.
      initAudio();
    } catch {}
    try {
      if (!yourTurnAudioRef.current) yourTurnAudioRef.current = new Audio('/your-turn.wav');
      if (!newPickAudioRef.current) newPickAudioRef.current = new Audio('/new-turn.wav');
      for (const el of [yourTurnAudioRef.current, newPickAudioRef.current]) {
        el.muted = true;
        const p = el.play();
        if (p && typeof p.then === 'function') {
          p.then(() => { el.pause(); el.currentTime = 0; el.muted = false; })
           .catch(() => { el.muted = false; });
        } else {
          el.pause(); el.currentTime = 0; el.muted = false;
        }
      }
    } catch {}
  }, [initAudio]);

  const cleanup = useCallback(() => {
    if (keepAliveRef.current) {
      try { keepAliveRef.current.stop(); } catch {}
      keepAliveRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    yourTurnAudioRef.current = null;
    newPickAudioRef.current = null;
  }, []);

  return { playSpinningSound, playReelStop, playCountdownTick, playFinalCountdownTick, playWinSound, playYourTurnSound, playNewPickSound, resumeAudio, primeAudio, cleanup };
}
