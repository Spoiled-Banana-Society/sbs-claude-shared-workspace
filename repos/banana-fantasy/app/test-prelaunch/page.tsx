'use client';

/**
 * Pre-launch / countdown landing — MOCK (TEMP, /test-prelaunch).
 * Single page the public sees on sbsfantasy.com before launch: logo top-left,
 * a clean header (no nav / no right-side icons), and the contest box + a live
 * real-time countdown centered on the page. Becomes the real pre-launch mode
 * (flag-gated) once approved.
 */

import React, { useEffect, useState } from 'react';

// Placeholder target — swap for the real launch date/time when set.
const LAUNCH_AT = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.getTime();
})();

const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

function useCountdown(target: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.floor(Math.max(0, target - now) / 1000);
  return { days: Math.floor(s / 86400), hours: Math.floor((s % 86400) / 3600), mins: Math.floor((s % 3600) / 60), secs: s % 60 };
}

function Seg({ value, label }: { value: number; label: string }) {
  const v = String(value).padStart(2, '0');
  return (
    <div className="flex flex-col items-center">
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-2.5 py-2.5 sm:px-6 sm:py-4 min-w-[50px] sm:min-w-[88px]">
        <span key={v} className="block text-2xl sm:text-5xl font-bold tabular-nums text-white animate-fade-in">{v}</span>
      </div>
      <span className="mt-2 text-[9px] sm:text-xs uppercase tracking-[0.16em] text-white/40">{label}</span>
    </div>
  );
}

export default function TestPrelaunch() {
  const { days, hours, mins, secs } = useCountdown(LAUNCH_AT);
  return (
    <div className="min-h-screen bg-[#08090c] flex flex-col">
      {/* header — logo top-left only, no nav / no right-side icons. Static
          (no hover scale) so it never shifts. */}
      <header className="px-5 sm:px-8 lg:px-12 py-5">
        <div className="inline-flex items-center gap-1.5 select-none">
          <img src="/sbs-logo.png" alt="SBS Fantasy" className="w-12 h-12 sm:w-14 sm:h-14" />
          <span className="text-2xl font-bold tracking-tight leading-none text-white">SBS</span>
        </div>
      </header>

      {/* contest box + countdown, centered in the page */}
      <main className="flex-1 flex items-center justify-center px-4 pb-16">
        <div className="relative glass-card rounded-3xl p-6 sm:p-10 max-w-3xl w-full ring-1 ring-banana/40 glow-banana">
          <div className="text-center space-y-4">
            <h3 className="text-2xl sm:text-3xl font-bold text-white">Banana Best Ball IV</h3>
            <div className="flex items-center justify-center gap-2">
              <span className="text-5xl sm:text-6xl font-extrabold text-banana drop-shadow-lg">{usd(100000)}</span>
              <span className="text-sm text-white/50 font-medium leading-tight text-left">Guaranteed<br />Prize Pool</span>
            </div>
            <div className="flex items-center justify-center gap-10 pt-2">
              <div className="text-center">
                <p className="text-2xl font-semibold text-white">{usd(25000)}</p>
                <p className="text-xs text-white/50 uppercase tracking-wide">1st Place</p>
              </div>
              <div className="w-px h-10 bg-white/10" />
              <div className="text-center">
                <p className="text-2xl font-semibold text-white">{usd(25)}</p>
                <p className="text-xs text-white/50 uppercase tracking-wide">Entry</p>
              </div>
            </div>
          </div>

          <div className="mt-9">
            <p className="text-center text-[11px] uppercase tracking-[0.2em] text-white/35 mb-4">Contest drops in</p>
            <div className="flex items-start justify-center gap-1.5 sm:gap-4">
              <Seg value={days} label="Days" />
              <span className="text-2xl sm:text-5xl font-bold text-white/20 pt-1.5 sm:pt-3">:</span>
              <Seg value={hours} label="Hours" />
              <span className="text-2xl sm:text-5xl font-bold text-white/20 pt-1.5 sm:pt-3">:</span>
              <Seg value={mins} label="Mins" />
              <span className="text-2xl sm:text-5xl font-bold text-white/20 pt-1.5 sm:pt-3">:</span>
              <Seg value={secs} label="Secs" />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
