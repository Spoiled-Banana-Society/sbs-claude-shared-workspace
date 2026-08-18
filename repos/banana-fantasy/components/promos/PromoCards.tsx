'use client';

// /promos page cards — the SPOTLIGHT (one hero at the top: the pinned /
// featured promo, or whatever the shared sort puts first) and the LONG cards
// under it (128px color block on the left, body on the right, inline "How it
// works" that opens on tap). Desktop tilts toward the pointer with a soft
// highlight; mobile stacks to one column and keeps the same block-left shape.

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Promo } from '@/types';
import { deriveChaseState } from '@/lib/chasePromo';
import { promoAccent, promoCta, promoHueStyle, promoKicker, promoName, promoRules } from '@/lib/promoTheme';
import { PromoSwatch, PromoLive } from '@/components/promos/PromoVisuals';
import { SpinExplainer } from '@/components/promos/SpinExplainer';
import { firstPurchaseCardLines } from '@/lib/firstPurchaseCopy';

// ─── Per-promo secondary indicators (under the one-liner) ───────────────────

function ChaseLadder({ promo }: { promo: Promo }) {
  const c = deriveChaseState(promo);
  const won = !!promo.claimable;
  return (
    <div className="flex items-center gap-[5px] mt-1">
      {[1, 2, 3, 4, 5].map((n) => {
        const next = c.active && !won && n === Math.min(c.nextHit, 5);
        const used = c.active && !won && n < Math.min(c.nextHit, 5);
        const win = won && n === Math.min(Math.max(promo.claimCount || 1, 1), 5);
        return (
          <div
            key={n}
            className={`flex-1 text-center text-[10px] font-extrabold py-[5px] rounded-lg border transition-all ${
              win ? 'bg-banana text-black border-transparent'
                : next ? 'bg-white/[0.12] text-white border-white/35'
                : used ? 'text-white/35 line-through border-transparent bg-white/[0.06]'
                : 'bg-white/[0.06] text-white/45 border-transparent'
            }`}
          >
            {n}
            <small className="block text-[8px] tracking-[1px] opacity-80 leading-none mt-[2px]">
              {win ? 'WON' : next ? 'NEXT' : n === 5 ? 'MAX' : ' '}
            </small>
          </div>
        );
      })}
    </div>
  );
}

function ReferralMilestones({ promo }: { promo: Promo }) {
  const hist = promo.modalContent?.referralHistory || [];
  const best = (k: 'bought1' | 'bought4' | 'bought10') => hist.some((e) => e.rewards?.[k] === 'claimed' || e.rewards?.[k] === 'claim');
  const cells: [string, string, boolean][] = [['1st pass', '1 SPIN', best('bought1')], ['4 passes', '1 SPIN', best('bought4')], ['10 passes', '1 SPIN', best('bought10')]];
  return (
    <div className="flex gap-[5px] mt-1">
      {cells.map(([l, r, on]) => (
        <div key={l} className={`flex-1 text-center text-[10px] font-extrabold py-[5px] px-1 rounded-lg ${on ? 'bg-white/[0.14] text-white' : 'bg-white/[0.06] text-white/45'}`}>
          {l}
          <small className="block text-[8px] tracking-[1px] opacity-85 mt-[1px]">{on ? '✓' : r}</small>
        </div>
      ))}
    </div>
  );
}

function JackpotCycle({ promo }: { promo: Promo }) {
  const cyc = promo.modalContent?.cycle;
  if (!cyc) return null;
  const pct = Math.min(100, (cyc.position / Math.max(cyc.windowLength, 1)) * 100);
  const m10 = (25 / cyc.windowLength) * 100;
  const m5 = (50 / cyc.windowLength) * 100;
  return (
    <div className="relative h-2 rounded-full bg-white/[0.08] mt-2.5 mb-[26px]">
      <div className="absolute left-0 top-0 bottom-0 rounded-full bg-white transition-[width] duration-700" style={{ width: `${pct}%` }} />
      {[[m10, '10 SPINS', 'BY DRAFT 25'], [m5, '5 SPINS', 'BY DRAFT 50']].map(([x, l1, l2]) => (
        <div key={String(l1)} className="absolute -top-[3px] w-[2px] h-[14px] bg-white/50" style={{ left: `${x}%` }}>
          <span className="absolute top-4 -left-7 w-14 text-center text-[8px] tracking-[1px] font-extrabold text-white/60 whitespace-nowrap leading-[1.3]">
            {l1}<br /><span className="text-white/35">{l2}</span>
          </span>
        </div>
      ))}
      <div className="absolute -top-[5px] w-[3px] h-[18px] rounded-sm bg-banana transition-[left] duration-700" style={{ left: `${pct}%` }} />
    </div>
  );
}

function FirstBuyLadder({ variant }: { variant: 'new' | 'returning' }) {
  const rungs = variant === 'new' ? ['1 → 2', '2 → 4', '3 → 6'] : ['2 → 1', '4 → 2', '6 → 3'];
  return (
    <div className="flex items-center gap-[5px] mt-1">
      {rungs.map((r, i) => (
        <div key={r} className={`flex-1 text-center text-[10px] font-extrabold py-[5px] rounded-lg ${i === 0 ? 'bg-white/[0.12] text-white border border-white/35' : 'bg-white/[0.06] text-white/45'}`}>
          {r}
          <small className="block text-[8px] tracking-[1px] opacity-80 mt-[1px]">{variant === 'new' ? 'PASS → DRAFTS' : 'PASSES → DRAFTS'}</small>
        </div>
      ))}
    </div>
  );
}

function Extra({ promo, fpVariant }: { promo: Promo; fpVariant: 'new' | 'returning' }) {
  switch (promo.type) {
    case 'pick-chase': return <ChaseLadder promo={promo} />;
    case 'referral': return <ReferralMilestones promo={promo} />;
    case 'jackpot': return <JackpotCycle promo={promo} />;
    case 'first-purchase': return <FirstBuyLadder variant={fpVariant} />;
    default: return null;
  }
}

// ─── Long card ───────────────────────────────────────────────────────────────

export interface PromoLongCardProps {
  promo: Promo;
  index: number;
  wallet: string | null;
  isClaimed: boolean;
  hasVisibleClaim: boolean;
  onOpenModal: () => void;
  onClaim: () => void;
  fpVariant?: 'new' | 'returning';
  fpShowNewPlayerTag?: boolean;
  /** Open the inline rules on mount (deep-link). */
  defaultOpen?: boolean;
}

export function PromoLongCard({
  promo, index, wallet, isClaimed, hasVisibleClaim, onOpenModal, onClaim,
  fpVariant = 'new', fpShowNewPlayerTag = false, defaultOpen = false,
}: PromoLongCardProps) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const ref = useRef<HTMLDivElement>(null);
  const accent = promoAccent(promo.type);
  const cta = promoCta(promo);
  const passive = promo.type === 'pick-10' || promo.type === 'jackpot';
  const rules = promoRules(promo);
  const isFp = promo.type === 'first-purchase';

  // Pointer tilt + highlight (desktop only, never while open).
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || open || e.pointerType !== 'mouse') return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.transform = `perspective(900px) rotateX(${(0.5 - y) * 5}deg) rotateY(${(x - 0.5) * 7}deg) translateY(-3px)`;
    el.style.setProperty('--mx', `${x * 100}%`);
    el.style.setProperty('--my', `${y * 100}%`);
  };
  const onLeave = () => { if (ref.current) ref.current.style.transform = ''; };
  useEffect(() => { if (open && ref.current) ref.current.style.transform = ''; }, [open]);

  const go = (e: React.MouseEvent, href: string) => { e.stopPropagation(); router.push(href); };

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={() => setOpen((o) => !o)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((o) => !o); } }}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className={`promo-rise promo-tilt relative flex flex-col overflow-hidden rounded-[20px] bg-[#131318] border cursor-pointer select-none
        transition-[box-shadow,border-color,transform] duration-150 ease-out hover:shadow-[0_18px_40px_rgba(0,0,0,.45)] active:scale-[.985] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white
        ${hasVisibleClaim ? 'border-banana/70 shadow-[0_0_0_1px_rgba(251,191,36,.3),0_10px_30px_rgba(251,191,36,.12)]' : 'border-white/[0.08]'}
        ${passive && !hasVisibleClaim ? 'opacity-[.78] hover:opacity-100' : ''}`}
      style={{ '--pi': `${0.06 + index * 0.07}s`, transformStyle: 'preserve-3d' } as React.CSSProperties}
    >
      <div className="promo-spec" />
      <div className="grid grid-cols-[96px_1fr] sm:grid-cols-[128px_1fr] flex-1 min-h-[168px]">
        <PromoSwatch promo={promo} size="lg" wallet={wallet} isClaimed={isClaimed} sweep sweepDelayS={index * 2.1} className="self-stretch py-3.5 px-2.5" />
        <div className="flex flex-col gap-1.5 min-w-0 px-4 sm:px-[18px] pt-3.5 pb-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-extrabold tracking-[2px] truncate min-w-0" style={{ color: accent }}>{promoKicker(promo)}</span>
            <span className="text-[10px] font-extrabold tracking-[1px] text-white/45 shrink-0 whitespace-nowrap">
              {open ? 'CLOSE ▴' : 'DETAILS ▾'}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-[17px] font-extrabold text-white tracking-[-.2px] leading-tight">{promoName(promo)}</h4>
            {promo.isNew && <span className="rounded-full bg-banana px-2 py-[2px] text-[9px] font-black tracking-[1.4px] text-black">NEW</span>}
          </div>
          {isFp ? (
            <div className="text-[13px] leading-[1.4] text-[#c9c9d2]">
              {fpShowNewPlayerTag && <span className="block text-[9.5px] font-extrabold uppercase tracking-[1.4px] text-white/80">New players</span>}
              {firstPurchaseCardLines(fpVariant, promo.description).map((line) => <span key={line} className="block">{line}</span>)}
            </div>
          ) : (
            <>
              <p className="text-[13px] leading-[1.4] text-[#c9c9d2] whitespace-pre-line">{promo.description}</p>
              <SpinExplainer promoTitle={promo.title} promoType={promo.type} className="block text-[11px] leading-snug text-banana/80" />
            </>
          )}
          <Extra promo={promo} fpVariant={fpVariant} />
          <div className="mt-auto pt-2 flex items-center justify-between gap-2.5 min-h-[34px]">
            <PromoLive promo={promo} size="lg" wallet={wallet} hasVisibleClaim={hasVisibleClaim} isClaimed={isClaimed} />
            {hasVisibleClaim ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onClaim(); }}
                className="promo-glow shrink-0 rounded-full bg-banana px-3.5 py-2 text-[11px] font-extrabold text-black hover:-translate-y-px active:scale-[.97] transition-transform"
              >
                {promo.claimCount && promo.claimCount > 1 ? `Claim · ${promo.claimCount}` : 'Claim'}
              </button>
            ) : cta ? (
              <button
                type="button"
                onClick={(e) => go(e, cta.href)}
                className="shrink-0 rounded-full bg-white px-3.5 py-2 text-[11px] font-extrabold text-black hover:-translate-y-px hover:shadow-[0_8px_20px_rgba(0,0,0,.35)] active:scale-[.97] transition-all"
              >
                {cta.label}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* Inline "How it works" */}
      <div className={`promo-how ${open ? 'open' : ''}`}>
        <div>
          <div className="border-t border-white/[0.08] bg-[#191920] px-4 sm:px-[18px] pt-4 pb-[18px] text-[#d8d8de]">
            <div className="text-[10px] font-extrabold tracking-[2px] mb-2.5" style={{ color: accent }}>HOW IT WORKS</div>
            <ul className="grid gap-2">
              {rules.map((r, n) => (
                <li key={n} className="relative pl-4 text-[13.5px] leading-[1.5]" style={{ '--n': n } as React.CSSProperties}>
                  <span className="absolute left-0 top-[9px] w-1.5 h-1.5 rounded-full bg-current opacity-70" />
                  {r}
                </li>
              ))}
            </ul>
            <div className="mt-3.5 flex items-center gap-2.5 flex-wrap">
              {cta && (
                <button type="button" onClick={(e) => go(e, cta.href)} className="rounded-full bg-white px-3.5 py-2 text-[11px] font-extrabold text-black hover:-translate-y-px transition-transform">
                  {cta.label}
                </button>
              )}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onOpenModal(); }}
                className="rounded-full border border-white/40 bg-white/[0.08] px-3.5 py-2 text-[11px] font-extrabold text-white hover:bg-white/[0.14] transition-colors"
              >
                Full details & history
              </button>
              <span className="text-[11.5px] text-white/40">Tap the card again to close</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Spotlight ───────────────────────────────────────────────────────────────

export interface PromoSpotlightProps {
  promo: Promo;
  wallet: string | null;
  isClaimed: boolean;
  hasVisibleClaim: boolean;
  onOpenModal: () => void;
  onClaim: () => void;
  fpVariant?: 'new' | 'returning';
  fpShowNewPlayerTag?: boolean;
}

export function PromoSpotlight({ promo, wallet, isClaimed, hasVisibleClaim, onOpenModal, onClaim, fpVariant = 'new', fpShowNewPlayerTag = false }: PromoSpotlightProps) {
  const router = useRouter();
  const [how, setHow] = useState(false);
  const cta = promoCta(promo);
  const rules = promoRules(promo);
  const isAtb = promo.type === 'around-the-banana';
  const atb = promo.modalContent?.aroundTheBanana;
  const hits = atb?.slotsHit ?? [];
  const seatsLeft = Math.max(0, (atb?.seatsTotal ?? 10) - (atb?.seatsClaimed ?? 0));
  const isFp = promo.type === 'first-purchase';

  let kicker = promoKicker(promo);
  let line: React.ReactNode = promo.description;
  let primary: { label: string; href: string } | null = cta;
  if (isAtb && atb?.won) {
    kicker = 'YOU MADE IT AROUND · JACKPOT SEAT';
    line = `All 10 slots hit — you won seat ${atb.seatNumber}. Your Jackpot pass is in your passes; this round keeps running, and you can win another seat.`;
    primary = { label: 'View your seat', href: '/my-teams' };
  }

  return (
    <section
      className={`promo-grad promo-sweep promo-rise rounded-[24px] p-6 sm:p-8 text-white ${hasVisibleClaim ? 'ring-2 ring-banana' : ''}`}
      style={promoHueStyle(promo.type, 0)}
      aria-label={`${promoName(promo)} — featured promo`}
    >
      <div className="relative z-[1] grid grid-cols-1 md:grid-cols-[1.2fr_1fr] gap-6 md:gap-8 items-center">
        <div className="promo-tx min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-extrabold tracking-[2.4px]">
            <i className="promo-ping w-[7px] h-[7px] rounded-full bg-white" />
            <span>{kicker}</span>
            {promo.isNew && <span className="ml-1 rounded-full bg-banana px-2 py-[2px] text-[9px] font-black tracking-[1.4px] text-black">NEW</span>}
          </div>
          <h3 className="mt-3 text-[30px] sm:text-[40px] font-extrabold leading-[1] tracking-[-.8px]" style={{ textWrap: 'balance' } as React.CSSProperties}>
            {promoName(promo)}
          </h3>
          {isFp ? (
            <div className="mt-3 text-[15px] leading-[1.5] max-w-[44ch]">
              {fpShowNewPlayerTag && <span className="block text-[10px] font-extrabold uppercase tracking-[1.6px] text-white/85">New players</span>}
              {firstPurchaseCardLines(fpVariant, promo.description).map((l) => <span key={l} className="block">{l}</span>)}
            </div>
          ) : (
            <p className="mt-3 text-[15px] leading-[1.5] max-w-[44ch] whitespace-pre-line">{line}</p>
          )}
          {isAtb && (
            <div className="mt-4 flex gap-6">
              <div><b className="block text-[22px] font-extrabold tabular-nums leading-none">{hits.length}/10</b><span className="text-[10px] tracking-[1.8px] font-extrabold">YOUR SLOTS</span></div>
              <div><b className="block text-[22px] font-extrabold tabular-nums leading-none">{seatsLeft}</b><span className="text-[10px] tracking-[1.8px] font-extrabold">SEATS LEFT</span></div>
              {atb?.won && <div><b className="block text-[22px] font-extrabold tabular-nums leading-none">#{atb.seatNumber}</b><span className="text-[10px] tracking-[1.8px] font-extrabold">YOUR SEAT</span></div>}
            </div>
          )}
          {!isAtb && (
            <div className="mt-4">
              <PromoLive promo={promo} size="lg" wallet={wallet} hasVisibleClaim={hasVisibleClaim} isClaimed={isClaimed} />
            </div>
          )}
          <div className="mt-5 flex items-center gap-2.5 flex-wrap">
            {hasVisibleClaim ? (
              <button type="button" onClick={onClaim} className="promo-glow rounded-full bg-banana px-4 py-2.5 text-[12px] font-extrabold text-black hover:-translate-y-px active:scale-[.97] transition-transform">
                {promo.claimCount && promo.claimCount > 1 ? `Claim · ${promo.claimCount}` : 'Claim'}
              </button>
            ) : primary ? (
              <button type="button" onClick={() => router.push(primary!.href)} className="rounded-full bg-white px-4 py-2.5 text-[12px] font-extrabold text-black hover:-translate-y-px hover:shadow-[0_8px_20px_rgba(0,0,0,.35)] active:scale-[.97] transition-all">
                {primary.label}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setHow((h) => !h)}
              aria-expanded={how}
              className="rounded-full border border-white/40 bg-white/[0.14] px-4 py-2.5 text-[12px] font-extrabold text-white hover:bg-white/[0.2] transition-colors"
            >
              Details {how ? '▴' : '▾'}
            </button>
          </div>
        </div>

        {/* Right: the big indicator */}
        {isAtb ? (
          <div className="grid grid-cols-5 gap-2 sm:gap-2.5 max-w-[360px] w-full md:justify-self-end">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
              const hit = hits.includes(n);
              return (
                <div
                  key={n}
                  className={`aspect-square rounded-[12px] sm:rounded-[14px] grid place-items-center text-[18px] sm:text-[20px] font-extrabold ${hit ? 'bg-white text-black promo-pop' : 'bg-black/30 text-white/60'}`}
                  style={{ '--pi': `${hits.indexOf(n) * 0.08}s` } as React.CSSProperties}
                >
                  {n}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="md:justify-self-end w-full max-w-[220px] md:max-w-[300px] rounded-[20px] bg-black/25 border border-white/15 p-4 md:p-6 grid place-items-center min-h-[110px] md:min-h-[150px]">
            <PromoSwatch promo={promo} size="lg" wallet={wallet} isClaimed={isClaimed} className="!bg-none !animate-none w-full" />
          </div>
        )}
      </div>

      <div className={`promo-how ${how ? 'open' : ''} relative z-[1]`}>
        <div>
          <ul className="promo-tx grid gap-2 mt-6 max-w-[70ch]">
            {rules.map((r, n) => (
              <li key={n} className="relative pl-4 text-[13.5px] leading-[1.5]" style={{ '--n': n } as React.CSSProperties}>
                <span className="absolute left-0 top-[9px] w-1.5 h-1.5 rounded-full bg-current opacity-70" />
                {r}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={onOpenModal}
            className="mt-4 rounded-full border border-white/40 bg-white/[0.08] px-3.5 py-2 text-[11px] font-extrabold text-white hover:bg-white/[0.14] transition-colors"
          >
            Full details & history
          </button>
        </div>
      </div>
    </section>
  );
}
