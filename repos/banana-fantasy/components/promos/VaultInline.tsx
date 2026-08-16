'use client';

/**
 * 🔒 Banana Vault — the FULL game on the card front (Boris 2026-08-16:
 * "they shouldn't need to open the card — all of it right there").
 * Tappable tumblers with the pack-opening treatment (rattle → burst/punch/
 * confetti or slump ✕), live seats/bounty lines and claim buttons — rendered
 * inline on the home carousel, drafting sidebar and /promos cards. The modal
 * keeps the same experience plus the slot map.
 *
 * Theme-aware: 'light' for the white carousel/sidebar cards, 'dark' for the
 * /promos glass card. Taps stopPropagation so pressing a tumbler never
 * triggers the card's open-modal navigation.
 */

import React, { useRef, useState } from 'react';

export interface VaultInlinePayload {
  open?: boolean;
  seatsLeft?: number;
  revealedSlots?: number[];
  missedSlots?: number[];
  unrevealed?: number;
  seatWon?: boolean;
  seatClaimable?: boolean;
  spinsClaimable?: boolean;
  paidClicks?: number;
  bountiesLeft?: number;
}

export function VaultInline({ bv, wallet, theme, size = 'sm' }: {
  bv: VaultInlinePayload | undefined;
  wallet: string | null | undefined;
  theme: 'light' | 'dark';
  size?: 'sm' | 'lg';
}) {
  const [justRevealed, setJustRevealed] = useState<number[]>([]);
  const [justMissed, setJustMissed] = useState<number[]>([]);
  const [rattling, setRattling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<{ spins?: boolean; seat?: boolean }>({});
  const [cracked, setCracked] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  const revealedAll = [...new Set([...(bv?.revealedSlots ?? []), ...justRevealed])].sort((a, b) => a - b);
  const localMissed = justMissed.filter((m) => !(bv?.missedSlots ?? []).includes(m)).length;
  const pending = Math.max(0, (bv?.unrevealed ?? 0) - justRevealed.length - localMissed);
  const dark = theme === 'dark';

  const spawnParticles = (colors: string[], count: number) => {
    const host = stageRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;width:7px;height:7px;border-radius:2px;pointer-events:none;z-index:30;';
      el.style.left = `${rect.width / 2}px`;
      el.style.top = '20px';
      el.style.background = colors[i % colors.length];
      const ang = Math.random() * Math.PI * 2;
      const dist = 50 + Math.random() * 100;
      el.animate([
        { opacity: 1, transform: 'translate(0,0) rotate(0deg)' },
        { opacity: 0, transform: `translate(${Math.cos(ang) * dist}px, ${Math.sin(ang) * dist - 30}px) rotate(${Math.random() * 720 - 360}deg)` },
      ], { duration: 850, easing: 'ease-out', fill: 'forwards' });
      host.appendChild(el);
      setTimeout(() => el.remove(), 900);
    }
  };

  const tap = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!wallet || busy || pending === 0) return;
    setBusy(true);
    setRattling(true);
    try {
      const res = await fetch('/api/vault/reveal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: wallet.toLowerCase() }),
      });
      const data = await res.json();
      const slots: number[] = (data.revealed ?? []).map((c: { slot: number }) => c.slot);
      const missed: number[] = data.missedSlots ?? [];
      setTimeout(() => {
        setRattling(false);
        if (missed.length > 0) setJustMissed((prev) => [...new Set([...prev, ...missed])]);
        if (slots.length === 0) {
          setMsg(missed.length > 0
            ? `…no click. Slot${missed.length > 1 ? 's' : ''} ${missed.join(', ')} crossed off.`
            : '…nothing new. Draft to earn more chances.');
          if (missed.length > 0) spawnParticles(['rgba(160,160,160,0.4)'], 6);
          setBusy(false);
        } else {
          slots.forEach((sl, i) => setTimeout(() => {
            setJustRevealed((prev) => {
              const next = prev.includes(sl) ? prev : [...prev, sl];
              spawnParticles(['#fbbf24', '#22c55e', dark ? '#ffffff' : '#1d1d1f'], 22);
              if (new Set([...(bv?.revealedSlots ?? []), ...next]).size >= 4) {
                setTimeout(() => {
                  spawnParticles(['#fbbf24', '#ef4444', '#22c55e'], 50);
                  setCracked(true);
                }, 600);
              }
              return next;
            });
          }, i * 750));
          setMsg(slots.length === 1 ? '🔓 CLICK! A tumbler opened.' : `🔓 ${slots.length} tumblers clicked!`);
          setTimeout(() => setBusy(false), slots.length * 750 + 300);
        }
      }, 1400);
    } catch {
      setRattling(false);
      setBusy(false);
    }
  };

  const claim = async (e: React.MouseEvent, kind: 'spins' | 'seat') => {
    e.stopPropagation();
    e.preventDefault();
    if (!wallet || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/vault/claim', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: wallet.toLowerCase(), kind }),
      });
      const data = await res.json();
      if (data.ok) {
        setClaimed((prev) => ({ ...prev, [kind]: true }));
        spawnParticles(kind === 'seat' ? ['#ef4444', '#fbbf24'] : ['#fbbf24', '#22c55e'], 36);
        setMsg(kind === 'spins' ? '🎰 2 Free Spins added to your wheel!' : '💥 Jackpot seat locked in!');
      }
    } finally {
      setBusy(false);
    }
  };

  const tumSize = size === 'lg' ? 'w-10 h-11 text-[16px] rounded-lg' : 'w-8 h-9 text-[13px] rounded-md';

  return (
    <div ref={stageRef} className="relative" onClick={(e) => { if (pending > 0 || cracked) { e.stopPropagation(); } }}>
      <style>{`
        @keyframes vinRattle {
          0% { transform: translate(0) rotate(0); box-shadow: 0 0 0 rgba(251,191,36,0); }
          20% { transform: translate(-2px,1px) rotate(-1.2deg); }
          40% { transform: translate(3px,-1px) rotate(1.6deg); box-shadow: 0 0 14px rgba(251,191,36,0.3); }
          60% { transform: translate(-4px,2px) rotate(-2.2deg); box-shadow: 0 0 26px rgba(251,191,36,0.55); }
          80% { transform: translate(4px,-2px) rotate(2.6deg); }
          100% { transform: translate(0) rotate(0); box-shadow: 0 0 40px rgba(251,191,36,0.85); }
        }
        @keyframes vinBurst { 0% { transform: scale(1); } 30% { transform: scale(1.18); box-shadow: 0 0 50px rgba(34,197,94,0.85); } 100% { transform: scale(1); box-shadow: 0 0 14px rgba(34,197,94,0.4); } }
        @keyframes vinPunch { 0% { transform: scale(2.6); opacity: 0; } 60% { transform: scale(0.9); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { [style*="vinRattle"], [style*="vinBurst"] { animation: none !important; } }
      `}</style>
      <div className="flex justify-center gap-1.5 mb-1">
        {Array.from({ length: 4 }, (_, i) => {
          const num = revealedAll[i];
          const isRevealed = num !== undefined;
          const justNow = isRevealed && justRevealed.includes(num);
          const isPending = !isRevealed && i < revealedAll.length + pending;
          return (
            <button
              key={i}
              type="button"
              onClick={isPending ? tap : (e) => { e.stopPropagation(); }}
              disabled={busy && !isPending}
              className={`${tumSize} flex items-center justify-center font-black tabular-nums ${isPending && !rattling ? 'animate-pulse' : ''} ${isPending ? 'cursor-pointer' : 'cursor-default'}`}
              style={{
                ...(isRevealed
                  ? { background: '#22c55e', color: '#fff' }
                  : isPending
                    ? { background: '#fbbf24', color: '#000' }
                    : dark
                      ? { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.35)' }
                      : { background: '#e8e8ed', color: '#9a9a9a' }),
                ...(isPending && rattling ? { animation: 'vinRattle 1400ms cubic-bezier(.36,.07,.19,.97) both' } : {}),
                ...(justNow ? { animation: 'vinBurst 420ms ease-out both' } : {}),
              }}
            >
              <span style={justNow ? { animation: 'vinPunch 480ms cubic-bezier(.2,1.6,.35,1) both' } : undefined}>
                {isRevealed ? num : '?'}
              </span>
            </button>
          );
        })}
      </div>
      {cracked && (
        <div className={`text-center text-[12px] font-black ${dark ? 'text-banana' : 'text-[#b45309]'}`}>
          💥 VAULT CRACKED — claim your seat below
        </div>
      )}
      {msg ? (
        <p className={`text-center text-[10px] font-bold ${dark ? 'text-white/80' : 'text-[#1d1d1f]'}`}>{msg}</p>
      ) : pending > 0 ? (
        <p className={`text-center text-[10.5px] font-extrabold animate-pulse ${dark ? 'text-banana' : 'text-[#b45309]'}`}>
          👆 A draft filled — tap the gold tumbler
        </p>
      ) : null}
      {bv?.spinsClaimable && !claimed.spins && (
        <button type="button" onClick={(e) => claim(e, 'spins')} disabled={busy}
          className="mt-1 w-full py-1.5 rounded-lg bg-banana text-black font-extrabold text-[11px]">
          🎰 CLAIM 2 FREE SPINS
        </button>
      )}
      {bv?.seatClaimable && !claimed.seat && (
        <button type="button" onClick={(e) => claim(e, 'seat')} disabled={busy}
          className="mt-1 w-full py-1.5 rounded-lg bg-red-500 text-white font-extrabold text-[11px]">
          🏆 CLAIM YOUR JACKPOT SEAT
        </button>
      )}
    </div>
  );
}
