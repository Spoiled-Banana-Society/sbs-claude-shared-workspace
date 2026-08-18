'use client';

// Shared promo visuals — the pieces every promo surface is built from:
//   • CountdownChip  — the white Hype-style countdown (HRS : MIN : SEC)
//   • PromoSwatch    — the colored block with THE indicator for that promo
//                      (packs / pick tile / 4 pips / 10 slots / friends / cycle)
//   • PromoLive      — the one live fact line for the card foot (chip or number)
// Same components at three sizes: 'lg' (/promos long cards + spotlight),
// 'md' (home carousel / draft sidebar), 'sm' (modal header strip).

import React, { useEffect, useMemo, useState } from 'react';
import type { Promo } from '@/types';
import { deriveChaseState } from '@/lib/chasePromo';
import { useDropMe } from '@/hooks/useDropMe';
import { msUntilDrop, msUntilOpen } from '@/lib/dropRates';
import { promoAccent, promoHueStyle } from '@/lib/promoTheme';

const pad = (n: number) => String(n).padStart(2, '0');

/** 1s ticker shared by every live element on a surface. */
export function useTick(active = true) {
  const [, setT] = useState(0);
  useEffect(() => {
    if (!active) return;
    const i = setInterval(() => setT((t) => t + 1), 1000);
    return () => clearInterval(i);
  }, [active]);
}

// ─── Countdown chip ──────────────────────────────────────────────────────────

export function CountdownChip({
  endMs,
  label,
  size = 'md',
  className = '',
}: {
  /** Absolute epoch ms the clock counts to. */
  endMs: number;
  /** Small caps label before the digits ("LEFT", "TO MATCH", "NEXT DROP"). */
  label?: string;
  size?: 'lg' | 'md' | 'sm';
  className?: string;
}) {
  useTick(true);
  const d = Math.max(0, Math.floor((endMs - Date.now()) / 1000));
  const h = Math.floor(d / 3600);
  const m = Math.floor((d % 3600) / 60);
  const s = d % 60;
  // Always white — yellow is reserved for claim/ready states site-wide, so a
  // clock must never turn banana (Boris 2026-08-18). No urgency color either.
  const digit = size === 'lg' ? 'text-[15px]' : size === 'md' ? 'text-[13px]' : 'text-[12px]';
  const unit = size === 'sm' ? 'hidden' : size === 'lg' ? 'text-[7.5px]' : 'text-[7px]';
  const padc = size === 'lg' ? 'px-2.5 py-1.5 gap-[7px]' : size === 'md' ? 'px-2 py-1 gap-1.5' : 'px-1.5 py-[3px] gap-1';
  const seg = (v: number, u: string, tick?: boolean) => (
    <span className="flex flex-col items-center min-w-[18px]">
      <b
        key={tick ? v : undefined}
        className={`${digit} font-extrabold leading-none tabular-nums text-white ${tick ? 'promo-sec' : ''}`}
      >
        {pad(v)}
      </b>
      <span className={`${unit} font-extrabold tracking-[1.3px] text-white/35 mt-[2px]`}>{u}</span>
    </span>
  );
  const colon = <span className={`text-white/30 font-extrabold text-[12px] ${size === 'sm' ? '' : '-mt-2'}`}>:</span>;
  return (
    <span
      className={`inline-flex items-center rounded-[10px] border ${padc} border-white/[0.16] bg-white/[0.04] ${className}`}
    >
      {label && size !== 'sm' && (
        <span className="text-[8px] font-extrabold tracking-[1.6px] text-white/50 mr-0.5 whitespace-nowrap">{label}</span>
      )}
      {seg(h, 'HRS')}
      {colon}
      {seg(m, 'MIN')}
      {colon}
      {seg(s, 'SEC', true)}
    </span>
  );
}

// ─── Indicators ──────────────────────────────────────────────────────────────

const SZ = {
  lg: { big: 'text-[32px] tracking-[-1.2px]', small: 'text-[9px] tracking-[1.8px] mt-[5px]', tile: 'w-[54px] h-[54px] rounded-[14px] text-[25px]', pk: 'w-[15px] h-[21px] rounded', pip: 'w-[14px] h-[14px]', slot: 'text-[11px] rounded-[6px]', av: 'w-6 h-6', lbl: 'text-[9px] tracking-[1.8px] mt-2' },
  md: { big: 'text-[24px] tracking-[-.9px]', small: 'text-[8px] tracking-[1.5px] mt-[3px]', tile: 'w-[38px] h-[38px] rounded-[10px] text-[18px]', pk: 'w-[11px] h-[16px] rounded-[3px]', pip: 'w-[10px] h-[10px]', slot: 'text-[7.5px] rounded', av: 'w-[18px] h-[18px]', lbl: 'text-[8px] tracking-[1.5px] mt-1.5' },
  sm: { big: 'text-[20px] tracking-[-.7px]', small: 'text-[7px] tracking-[1.3px] mt-[2px]', tile: 'w-[30px] h-[30px] rounded-[8px] text-[14px]', pk: 'w-[9px] h-[13px] rounded-[2px]', pip: 'w-[8px] h-[8px]', slot: 'text-[6.5px] rounded-[3px]', av: 'w-[16px] h-[16px]', lbl: 'text-[7px] tracking-[1.3px] mt-1' },
} as const;

type Size = keyof typeof SZ;

function Big({ n, label, size }: { n: React.ReactNode; label: string; size: Size }) {
  return (
    <div className="promo-tx text-white text-center">
      <div className={`${SZ[size].big} font-extrabold leading-none tabular-nums`}>{n}</div>
      <div className={`${SZ[size].small} font-extrabold`}>{label}</div>
    </div>
  );
}

function Tile({ v, dim, gold, label, size }: { v: React.ReactNode; dim?: boolean; gold?: boolean; label: string; size: Size }) {
  return (
    <div className="text-center">
      <div
        className={`${SZ[size].tile} mx-auto grid place-items-center font-extrabold transition-colors duration-300 ${
          gold ? 'bg-banana text-black' : dim ? 'bg-black/35 text-white/55 border border-white/35' : 'bg-white text-black'
        }`}
      >
        {v}
      </div>
      <div className={`promo-tx text-white ${SZ[size].lbl} font-extrabold`}>{label}</div>
    </div>
  );
}

function SlotsGrid({ hits, size }: { hits: number[]; size: Size }) {
  const w = size === 'lg' ? 'w-full max-w-[112px]' : size === 'md' ? 'w-[74px]' : 'w-[60px]';
  return (
    <div className={`grid grid-cols-5 gap-[3px] ${w} mx-auto`}>
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
        const hit = hits.includes(n);
        return (
          <div
            key={n}
            className={`aspect-square grid place-items-center font-extrabold ${SZ[size].slot} ${
              hit ? 'bg-white text-black' : 'bg-black/35 text-white/60'
            }`}
          >
            {n}
          </div>
        );
      })}
    </div>
  );
}

function Packs({ n, ready, size }: { n: number; ready: boolean; size: Size }) {
  const show = Math.max(Math.min(n, 4), 3);
  return (
    <div>
      <div className="flex justify-center gap-1 mb-2 min-h-[16px]">
        {Array.from({ length: show }, (_, i) => (
          <div
            key={i}
            className={`${SZ[size].pk} border transition-colors ${
              i < n ? 'bg-white border-white' : 'bg-black/35 border-white/45'
            }`}
          />
        ))}
        {n > 4 && (
          <div className={`${SZ[size].pk} w-auto px-1 grid place-items-center text-[9px] font-extrabold bg-white/20 border-transparent text-white`}>
            +{n - 4}
          </div>
        )}
      </div>
      <Big n={n} label={ready ? 'READY TO OPEN' : n === 1 ? 'PACK SEALED' : 'PACKS SEALED'} size={size} />
    </div>
  );
}

function Pips({ n, max, size }: { n: number; max: number; size: Size }) {
  return (
    <div>
      <div className="flex justify-center gap-1.5 mb-2">
        {Array.from({ length: max }, (_, i) => (
          <div
            key={i}
            className={`${SZ[size].pip} rounded-full border transition-colors ${
              i < n ? 'bg-white border-white' : 'bg-black/35 border-white/45'
            }`}
          />
        ))}
      </div>
      <Big n={n} label={`OF ${max} PAID DRAFTS`} size={size} />
    </div>
  );
}

function Friends({ joined, size }: { joined: number; size: Size }) {
  return (
    <div>
      <div className="flex justify-center mb-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={`${SZ[size].av} rounded-full border-2 border-black/40 ${i > 0 ? '-ml-2' : ''} ${
              i < joined ? 'bg-gradient-to-br from-[#f6d365] to-[#fda085]' : 'bg-black/30 border-dashed border-white/55'
            }`}
          />
        ))}
      </div>
      <Big n={joined} label={joined === 1 ? 'FRIEND JOINED' : 'FRIENDS JOINED'} size={size} />
    </div>
  );
}

function DropIndicator({ wallet, size }: { wallet: string | null; size: Size }) {
  const me = useDropMe(wallet);
  useTick(true);
  const canOpen = msUntilOpen() <= 0 && me.loaded && me.sealed > 0;
  const n = me.loaded ? (canOpen ? me.sealed : me.upcomingSealed) : 0;
  return <Packs n={n} ready={canOpen} size={size} />;
}

/** The colored block: gradient + the promo's own indicator. */
export function PromoSwatch({
  promo,
  size = 'lg',
  wallet = null,
  className = '',
  sweep = false,
  sweepDelayS = 0,
  isClaimed = false,
  align = 'center',
}: {
  promo: Promo;
  size?: Size;
  wallet?: string | null;
  className?: string;
  /** Add the slow light sweep (/promos only). */
  sweep?: boolean;
  sweepDelayS?: number;
  isClaimed?: boolean;
  /** 'right' leaves room on the left for an overlaid kicker (mini cards). */
  align?: 'center' | 'right';
}) {
  const mc = promo.modalContent || ({} as Promo['modalContent']);
  let inner: React.ReactNode;
  switch (promo.type) {
    case 'around-the-banana': {
      const atb = mc.aroundTheBanana;
      inner = <SlotsGrid hits={atb?.slotsHit ?? []} size={size} />;
      break;
    }
    case 'drop':
      inner = <DropIndicator wallet={wallet} size={size} />;
      break;
    case 'daily-drafts':
      inner = <Pips n={promo.progressCurrent || 0} max={promo.progressMax || 4} size={size} />;
      break;
    case 'pick-chase': {
      const c = deriveChaseState(promo);
      inner = c.active
        ? <Tile v={c.slot} gold={!!promo.claimable} label={promo.claimable ? 'MATCHED' : 'YOUR PICK'} size={size} />
        : <Tile v="?" dim label="NEXT DRAFT LOCKS" size={size} />;
      break;
    }
    case 'referral': {
      const joined = (mc.referralHistory || []).length;
      inner = <Friends joined={joined} size={size} />;
      break;
    }
    case 'pick-10': {
      const hits = mc.totalPick10s ?? 0;
      inner = <Tile v="10" dim={hits === 0} label={`${hits} HIT${hits === 1 ? '' : 'S'}`} size={size} />;
      break;
    }
    case 'jackpot': {
      const cyc = mc.cycle;
      if (cyc) inner = <Big n={cyc.position} label={`OF ${cyc.windowLength}`} size={size} />;
      else inner = <Big n="1:100" label="JACKPOT ODDS" size={size} />;
      break;
    }
    case 'first-purchase':
      inner = <Big n="×2" label="FREE DRAFTS / PASS" size={size} />;
      break;
    case 'new-user':
      inner = <Big n="1" label="FREE DRAFT · GUARANTEED" size={size} />;
      break;
    case 'mint':
    case 'buy-bonus': {
      const cur = promo.progressCurrent || 0;
      const max = promo.progressMax || 10;
      inner = <Big n={<>{cur}<span className="text-white/50 text-[.55em]">/{max}</span></>} label="PASSES" size={size} />;
      break;
    }
    case 'founder-draft':
      inner = <Big n="👑" label="FOUNDER DRAFT" size={size} />;
      break;
    default: {
      const cur = promo.progressCurrent || 0;
      const max = promo.progressMax || 0;
      inner = max > 1
        ? <Big n={<>{cur}<span className="text-white/50 text-[.55em]">/{max}</span></>} label="PROGRESS" size={size} />
        : <Big n={isClaimed ? '✓' : '★'} label={isClaimed ? 'CLAIMED' : 'PROMO'} size={size} />;
    }
  }
  return (
    <div
      className={`promo-grad ${sweep ? 'promo-sweep' : ''} flex items-center ${align === 'right' ? 'justify-end' : 'justify-center'} text-white ${className}`}
      style={promoHueStyle(promo.type, sweepDelayS)}
    >
      <div className={`relative z-[1] ${align === 'right' ? 'pr-3.5 pl-[100px] w-full flex justify-end' : 'w-full px-2'}`}>{inner}</div>
    </div>
  );
}

// ─── Live fact line ──────────────────────────────────────────────────────────

/**
 * The one live fact for the card foot: a countdown chip for timed promos,
 * otherwise a short number line. Returns null when the promo has nothing live.
 */
export function PromoLive({
  promo,
  size = 'md',
  wallet = null,
  hasVisibleClaim = false,
  isClaimed = false,
  className = '',
  hideLabel = false,
}: {
  promo: Promo;
  size?: Size;
  wallet?: string | null;
  hasVisibleClaim?: boolean;
  isClaimed?: boolean;
  className?: string;
  /** Drop the small-caps label when the row is tight (mini card + button). */
  hideLabel?: boolean;
}) {
  useTick(true);
  const mc = promo.modalContent || ({} as Promo['modalContent']);
  const accent = promoAccent(promo.type);
  const t = size === 'lg' ? 'text-[13px]' : size === 'md' ? 'text-[12px]' : 'text-[11px]';
  const sm = size === 'lg' ? 'text-[10px] tracking-[1.6px]' : 'text-[8.5px] tracking-[0.9px]';
  const Stat = ({ v, l, ready }: { v: React.ReactNode; l?: string; ready?: boolean }) => (
    <span className={`${t} font-extrabold tabular-nums whitespace-nowrap ${ready ? 'text-banana' : 'text-white'} ${className}`}>
      {v}
      {l && !hideLabel && <small className={`${sm} font-extrabold text-white/45 ml-1.5`}>{l}</small>}
    </span>
  );
  if (hasVisibleClaim) return <Stat v="Ready to claim" ready />;
  const endMs = promo.timerEndTime ? new Date(promo.timerEndTime).getTime() : 0;
  const live = endMs > Date.now();
  switch (promo.type) {
    case 'around-the-banana': {
      const atb = mc.aroundTheBanana;
      const hits = (atb?.slotsHit ?? []).length;
      const left = Math.max(0, (atb?.seatsTotal ?? 10) - (atb?.seatsClaimed ?? 0));
      if (atb?.won) return <Stat v={<><span style={{ color: accent }}>Seat {atb.seatNumber}</span> · {hits}/10</>} l={`${left} SEATS LEFT`} />;
      return <Stat v={`${hits}/10`} l={`${left} SEATS LEFT`} />;
    }
    case 'drop':
      return <DropLive size={size} wallet={wallet} />;
    case 'daily-drafts':
      return live
        ? <CountdownChip endMs={endMs} label="LEFT" size={size} className={className} />
        : <Stat v={isClaimed ? '✓ Claimed' : 'Paid draft'} l={isClaimed ? '' : 'STARTS THE CLOCK'} />;
    case 'pick-chase': {
      const c = deriveChaseState(promo);
      if (c.active) return <CountdownChip endMs={endMs} label="TO MATCH" size={size} className={className} />;
      return <Stat v="Next draft" l="LOCKS YOUR PICK" />;
    }
    case 'referral': {
      const spins = (mc.referralHistory || []).reduce((s, e) => {
        const r = e.rewards; if (!r) return s;
        return s + (r.bought1 === 'claimed' ? 1 : 0) + (r.bought4 === 'claimed' ? 1 : 0) + (r.bought10 === 'claimed' ? 1 : 0);
      }, 0);
      return <Stat v={spins} l={spins === 1 ? 'SPIN EARNED' : 'SPINS EARNED'} />;
    }
    case 'pick-10':
      return <Stat v="Nothing to do" l="LANDS ON ITS OWN" />;
    case 'jackpot': {
      const cyc = mc.cycle;
      if (!cyc) return <Stat v="1 in 100" l="DRAFTS" />;
      if (cyc.reward >= 10) return <Stat v={<span style={{ color: accent }}>10-spin window</span>} l={`${cyc.tenLeft} ${cyc.tenLeft === 1 ? 'DRAFT' : 'DRAFTS'} LEFT`} />;
      if (cyc.reward >= 5) return <Stat v={<span style={{ color: accent }}>5-spin window</span>} l={`${cyc.fiveLeft} ${cyc.fiveLeft === 1 ? 'DRAFT' : 'DRAFTS'} LEFT`} />;
      return <Stat v="Windows closed" l="RESETS ON A HIT" />;
    }
    case 'first-purchase':
      return <Stat v="One-time" l="FIRST BUY ONLY" />;
    case 'new-user':
      return <Stat v="Connect X" l="TO CLAIM" />;
    case 'mint':
    case 'buy-bonus': {
      if (live) return <CountdownChip endMs={endMs} label="LEFT" size={size} className={className} />;
      return <Stat v={`${promo.progressCurrent || 0}/${promo.progressMax || 10}`} l="PASSES" />;
    }
    default:
      if (live) return <CountdownChip endMs={endMs} label="LEFT" size={size} className={className} />;
      if (isClaimed) return <Stat v="✓ Claimed" />;
      return null;
  }
}

function DropLive({ size, wallet }: { size: Size; wallet: string | null }) {
  const me = useDropMe(wallet);
  useTick(true);
  const canOpen = msUntilOpen() <= 0 && me.loaded && me.sealed > 0;
  if (canOpen) {
    // Straight to the pack room (Boris 2026-08-05: no modal detour once packs
    // are open). stopPropagation so the card's own tap doesn't fire.
    return (
      <span
        role="link"
        tabIndex={0}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); window.location.assign('/drop'); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); e.preventDefault(); window.location.assign('/drop'); } }}
        className={`${size === 'lg' ? 'text-[13px]' : 'text-[12px]'} font-extrabold text-banana cursor-pointer hover:underline`}
      >
        Open your packs →
      </span>
    );
  }
  return <CountdownChip endMs={Date.now() + msUntilDrop()} label="NEXT DROP" size={size} />;
}

/** True when the promo has a live countdown chip (used to size card feet). */
export function promoHasChip(promo: Promo): boolean {
  if (promo.type === 'drop') return true;
  const endMs = promo.timerEndTime ? new Date(promo.timerEndTime).getTime() : 0;
  return endMs > Date.now();
}

export function usePromoAccent(promo: Promo) {
  return useMemo(() => promoAccent(promo.type), [promo.type]);
}
