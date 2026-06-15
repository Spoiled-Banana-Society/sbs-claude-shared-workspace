'use client';

/**
 * Pre-launch / countdown landing — MOCK (TEMP, /test-prelaunch).
 * The single page the public sees on sbsfantasy.com before launch: contest box
 * (no promos, no icons, no Enter) + a live real-time countdown. When this is
 * approved it becomes the real pre-launch mode (gated by a flag).
 */

import React, { useEffect, useState } from 'react';

// Placeholder target — swap for the real launch date/time when set.
// (7 days out from when the page first loads, so the mock always ticks.)
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
  const diff = Math.max(0, target - now);
  const s = Math.floor(diff / 1000);
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    mins: Math.floor((s % 3600) / 60),
    secs: s % 60,
    done: diff === 0,
  };
}

function Seg({ value, label }: { value: number; label: string }) {
  const v = String(value).padStart(2, '0');
  return (
    <div className="flex flex-col items-center">
      <div className="relative rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 sm:px-6 sm:py-4 min-w-[64px] sm:min-w-[88px]">
        {/* key on the value gives a subtle pop each tick */}
        <span key={v} className="block text-3xl sm:text-5xl font-bold tabular-nums text-white animate-fade-in">{v}</span>
      </div>
      <span className="mt-2 text-[10px] sm:text-xs uppercase tracking-[0.18em] text-white/40">{label}</span>
    </div>
  );
}

export default function TestPrelaunch() {
  const { days, hours, mins, secs } = useCountdown(LAUNCH_AT);
  return (
    <div className="min-h-screen bg-[#08090c] flex flex-col items-center justify-center px-4 py-12">
      {/* brand */}
      <div className="flex items-center gap-2 mb-8">
        <img src="/sbs-logo.png" alt="SBS" className="w-8 h-8" />
        <span className="text-white font-bold tracking-tight text-lg">SBS Fantasy</span>
      </div>

      {/* contest box — mirrors the real ContestCard, minus icon/Enter */}
      <div className="relative glass-card rounded-3xl p-8 sm:p-10 max-w-3xl w-full ring-1 ring-banana/40 glow-banana">
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

        {/* live countdown (replaces the ENTER button) */}
        <div className="mt-9">
          <p className="text-center text-[11px] uppercase tracking-[0.2em] text-white/35 mb-4">Drafts open in</p>
          <div className="flex items-start justify-center gap-3 sm:gap-4">
            <Seg value={days} label="Days" />
            <span className="text-3xl sm:text-5xl font-bold text-white/20 pt-2 sm:pt-3">:</span>
            <Seg value={hours} label="Hours" />
            <span className="text-3xl sm:text-5xl font-bold text-white/20 pt-2 sm:pt-3">:</span>
            <Seg value={mins} label="Mins" />
            <span className="text-3xl sm:text-5xl font-bold text-white/20 pt-2 sm:pt-3">:</span>
            <Seg value={secs} label="Secs" />
          </div>
        </div>
      </div>

      <p className="mt-8 text-white/40 text-sm text-center">The biggest SBS contest yet. Follow <span className="text-banana">@SBSFantasy</span> for the drop.</p>
    </div>
  );
}
