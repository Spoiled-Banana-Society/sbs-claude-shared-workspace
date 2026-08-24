'use client';

/**
 * BANANA ZONE visuals (Richard 2026-08-22). Every surface reads the SAME view
 * shape the server computes (lib/bonusZone BonusZoneView), so the header pill,
 * the promo card, the entry modal and the bot line can never disagree.
 *
 * Design notes: zone green (#34d399) is the one new colour — it sits next to
 * the red Jackpot pill and the gold HOF pill as a third lane. No glow effects
 * (Boris). No dashes in copy (Richard).
 */

import React from 'react';
import { Tooltip } from '@/components/ui/Tooltip';

export const BZ_GREEN = '#34d399';

export type BzTier = 1 | 2 | 3 | null;

export interface BonusZoneViewLike {
  enabled: boolean;
  tier: BzTier;
  label: string | null;
  position: number;
  draftsLeftInTier: number;
  draftsLeftInZone: number;
  tier1Through: number;
  tier2Through: number;
  /** Dormant third band when equal to tier2Through. */
  tier3Through?: number;
  /** JackHOF seats in this tier's packs; present only while zone packs are live. */
  packSeats?: number | null;
}

/** "6 JACKHOF" in the header's own colors (JACK red, HOF gold), white count. */
export function JackHofSeats({ n, seats = false, className = '' }: { n: number; seats?: boolean; className?: string }) {
  return (
    <span className={`font-extrabold leading-none whitespace-nowrap ${className}`}>
      <span className="text-white/90 tabular-nums">{n} </span>
      <span className="text-red-400">JACK</span><span className="text-[#e6c35c]">HOF</span>
      {seats && <span className="text-white/85">{n === 1 ? ' SEAT' : ' SEATS'}</span>}
    </span>
  );
}

export const tierShort = (tier: BzTier) => (tier === 1 ? 'BUY 1 GET 1 SPIN' : tier === 2 ? 'BUY 2 GET 1 SPIN' : tier === 3 ? 'BUY 3 GET 1 SPIN' : 'CLOSED');
export const tierLabel = (tier: BzTier) => (tier === 1 ? 'Buy 1 Get 1 Spin' : tier === 2 ? 'Buy 2 Get 1 Spin' : tier === 3 ? 'Buy 3 Get 1 Spin' : 'Zone closed');
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const zoneEnd = (v: BonusZoneViewLike) => Math.max(v.tier2Through, v.tier3Through ?? 0);
/** Sixths of a free draft → "1 of 2", "2 of 3", else a percentage. */
export const unitsCopy = (units: number) =>
  units === 3 ? '1 of 2' : units === 2 ? '1 of 3' : units === 4 ? '2 of 3' : `${Math.round((units / 6) * 100)}%`;

// ─── Header pill ─────────────────────────────────────────────────────────────

/**
 * The third header pill, left of JACKPOT. Same frame/cut as the lane pills
 * (BatchProgressIndicator), 2 lines: "BANANA ZONE · N LEFT" then the tier.
 * Closed zone → pill hides entirely (the odds sell themselves from 70 on).
 */
export function BonusZonePill({ view, compact = false }: { view: BonusZoneViewLike; compact?: boolean }) {
  if (!view.enabled || !view.tier) return null;
  const left = view.draftsLeftInTier;
  // `compact` = forced phone cut (no viewport breakpoints) for mocks/previews;
  // the live header lets the lg: breakpoints decide, same as the lane pills.
  if (compact) {
    return (
      <div className="flex flex-col items-center justify-center shrink-0 gap-[2px] rounded-[9px] border px-2.5 py-[5px] border-emerald-400/40 bg-emerald-400/[0.06]" data-testid="bonus-zone-pill">
        <span className="text-[7.5px] font-extrabold tracking-[0.04em] leading-none text-emerald-300/90 whitespace-nowrap">BANANA ZONE · {left} DRAFTS LEFT</span>
        <span className="mt-[3px] text-[11px] font-extrabold leading-none tabular-nums text-emerald-400 whitespace-nowrap">{tierShort(view.tier)}</span>
        {!!view.packSeats && <JackHofSeats n={view.packSeats} seats className="mt-[3px] text-[7.5px] tracking-[0.04em]" />}
      </div>
    );
  }
  // Live header: DESKTOP ONLY (lg+). Phones have no room for a fourth box next
  // to JACKPOT / HOF / passes / balance (Richard 8/22) — there the zone rides
  // as a slim strip under the header (BonusZoneMobileBar).
  return (
    <div
      className="hidden lg:flex flex-col items-center justify-center shrink-0 gap-[2px] rounded-[10px] border px-3.5 py-[6px] border-emerald-400/40 bg-emerald-400/[0.06]"
      data-testid="bonus-zone-pill"
    >
      <span className="text-[8.5px] font-extrabold tracking-[0.05em] leading-none text-emerald-300/90 whitespace-nowrap">BANANA ZONE · {left} DRAFTS LEFT</span>
      <span className="mt-[3px] text-[12px] font-extrabold leading-none tabular-nums text-emerald-400 whitespace-nowrap">{tierShort(view.tier)}</span>
      {/* Third line while ZONE PACKS is live: the JackHOF seats hidden in this
          tier's packs (Richard 8/24, option A). Absent = pill stays 2 lines. */}
      {!!view.packSeats && <JackHofSeats n={view.packSeats} seats className="mt-[3px] text-[8.5px] tracking-[0.05em]" />}
    </div>
  );
}

/**
 * PHONE placement: a slim full-width strip under the header bar (stays with
 * the sticky header). One line, tappable → the promo card. Hidden on lg+ where
 * the pill takes over, and gone entirely when the zone is closed.
 */
export function BonusZoneMobileBar({ view, href = '/promos?promo=bonus-zone' }: { view: BonusZoneViewLike; href?: string }) {
  if (!view.enabled || !view.tier) return null;
  const left = view.draftsLeftInTier;
  // Tap behavior matches the JACKPOT / HOF counters (Boris 2026-08-23): the
  // shared Tooltip shows instantly on touch and auto-holds ~4.5s — no more
  // split-second flash. Info lives here; the full promo is one tap away on
  // the Promos page.
  void href;
  return (
    <Tooltip
      position="bottom"
      className="block w-full lg:hidden"
      content={
        <div className="w-[250px] py-0.5">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[12px] font-extrabold tracking-[1px] text-emerald-300">BANANA ZONE</span>
            {view.tier && <span className="text-[11px] font-bold text-text-secondary">{tierLabel(view.tier)}</span>}
          </div>
          <BonusZoneTooltipSection view={view} />
        </div>
      }
    >
      <div
        className="flex items-center justify-center gap-2 w-full border-t border-emerald-400/25 bg-emerald-400/[0.09] px-3 py-[5px] text-emerald-300 cursor-default"
        data-testid="bonus-zone-mobile-bar"
        aria-label={`Banana Zone: ${tierLabel(view.tier)}, ${view.packSeats ? `${view.packSeats} JackHOF seats in packs, ` : ''}${left} drafts left`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        <span className="text-[11px] font-extrabold tracking-[0.12em] leading-none whitespace-nowrap">BANANA ZONE</span>
        <span className="text-[13px] font-extrabold leading-none tabular-nums text-emerald-400 whitespace-nowrap">{tierShort(view.tier)}</span>
        {/* One line on every phone: with the seats in, "DRAFTS" goes so the
            strip never wraps (Richard 8/24, option A). */}
        {!!view.packSeats && <JackHofSeats n={view.packSeats} className="text-[11px] tracking-[0.06em]" />}
        <span className="text-[11px] font-extrabold tracking-[0.08em] leading-none text-emerald-300/90 whitespace-nowrap">
          {left} {view.packSeats ? 'LEFT' : `${left === 1 ? 'DRAFT' : 'DRAFTS'} LEFT`}
        </span>
      </div>
    </Tooltip>
  );
}

/** Tooltip block for the header hover card. */
export function BonusZoneTooltipSection({ view }: { view: BonusZoneViewLike }) {
  if (!view.enabled) return null;
  const t2 = view.tier2Through;
  const end = zoneEnd(view);
  return (
    <div className="mb-2.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-bold text-emerald-400">BANANA ZONE · {view.tier ? tierShort(view.tier) : 'CLOSED'}</span>
        {view.tier && <span className="text-[13px] font-semibold tabular-nums text-emerald-400">{view.draftsLeftInTier} left</span>}
      </div>
      <p className="text-[11.5px] leading-snug text-text-secondary">
        {view.tier === 1 && `Every paid draft that fills in the next ${plural(view.draftsLeftInTier, 'draft')} earns a Free Spin. Then Buy 2 Get 1 Spin through draft ${t2}.`}
        {view.tier === 2 && `Every 2 paid drafts that fill in the next ${plural(view.draftsLeftInTier, 'draft')} earn a Free Spin. ${end > t2 ? `Then Buy 3 Get 1 Spin through ${end}.` : `Zone closes at draft ${t2}.`}`}
        {view.tier === 3 && `Every 3 paid drafts that fill in the next ${plural(view.draftsLeftInTier, 'draft')} earn a Free Spin. Zone closes at draft ${end}.`}
        {!view.tier && `Opens the moment the Jackpot hits: Buy 1 Get 1 Spin for drafts 1 to ${view.tier1Through}, Buy 2 Get 1 Spin through ${t2}.`}
              </p>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, view.position)}%`, background: 'linear-gradient(90deg,#0f766e,#34d399)' }} />
      </div>
    </div>
  );
}

// ─── Promo card ladder ───────────────────────────────────────────────────────

/**
 * The card's indicator: the 100-draft window split into the three bands with
 * the banana playhead at the live position. Same bones as JackpotCycle so it
 * reads as the same family.
 */
/**
 * Tier chips — the SAME visual as the spotlight card (Boris 2026-08-23), so
 * the promo reads identically on the card, the modal and the header tooltip.
 * Replaces the old absolutely-positioned band labels, which overlapped on
 * narrow containers (words rendering on top of words).
 */
export function ZoneTierChips({ view, small = false, packBands = null }: {
  view: BonusZoneViewLike;
  small?: boolean;
  /** JackHOF seats per batch — printed ON the tier chips (Richard 8/23:
   *  "putting 6 jackhof and 4 jackhof on the actual buttons"). */
  packBands?: ReadonlyArray<{ from: number; to: number; seats: number }> | null;
}) {
  // A collapsed third tier (tier3Through == tier2Through, the 25/50 config)
  // must not render — it produced a nonsense "BUY 3 GET 1 · DRAFTS 51–50"
  // chip (caught by Richard on /preview/zone-drop, 2026-08-23). The dead
  // chips' "BACK NEXT JP" label is gone too (Richard, same review).
  const bands: Array<{ band: 1 | 2 | 3; deal: string; range: string }> = [
    { band: 1, deal: 'BUY 1 GET 1', range: `DRAFTS 1–${view.tier1Through}` },
    { band: 2, deal: 'BUY 2 GET 1', range: `DRAFTS ${view.tier1Through + 1}–${view.tier2Through}` },
    ...(zoneEnd(view) > view.tier2Through
      ? [{ band: 3 as const, deal: 'BUY 3 GET 1', range: `DRAFTS ${view.tier2Through + 1}–${zoneEnd(view)}` }]
      : []),
  ];
  const seatsFor = (i: number) => packBands?.[i]?.seats ?? null;
  return (
    <div className={`grid gap-1.5 ${bands.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
      {bands.map(({ band, deal, range }, i) => {
        const st: 'live' | 'dead' | 'future' = view.tier === null ? 'dead' : band === view.tier ? 'live' : band < view.tier ? 'dead' : 'future';
        const seats = seatsFor(i);
        return (
          <div
            key={band}
            className={`text-center rounded-lg px-0.5 uppercase font-extrabold leading-[1.25] transition-all duration-300 ${small ? 'py-1.5' : 'py-2'} ${
              st === 'live'
                ? `${small ? 'text-[10px]' : 'text-[11.5px]'} text-[#04231a] border border-emerald-300 bg-gradient-to-br from-[#7ff0c3] via-[#34d399] to-[#0fa371]`
                : `${small ? 'text-[9.5px]' : 'text-[10.5px]'} ${st === 'dead' ? 'text-white/55 border border-white/10 bg-black/20' : 'text-white/80 border border-white/15 bg-black/20'}`
            }`}
          >
            {deal}
            <em className={`block not-italic mt-0.5 font-extrabold tracking-[1px] ${small ? 'text-[7px]' : 'text-[8px]'} ${st === 'live' ? 'text-[#04231a]/80' : 'text-white/40'}`}>{range}</em>
            {seats !== null && (
              <span className={`block mt-0.5 font-black tracking-[0.8px] ${small ? 'text-[7.5px]' : 'text-[8.5px]'} ${st === 'live' ? 'text-[#04231a]' : 'text-banana'}`}>
                📦 {seats} JACKHOF SEATS
              </span>
            )}
            {st === 'live' && <span className={`block mt-0.5 font-black tracking-[1.6px] text-[#04231a]/85 ${small ? 'text-[6.5px]' : 'text-[7px]'}`}>● LIVE</span>}
          </div>
        );
      })}
    </div>
  );
}

export function BonusZoneLadder({ view, pending = 0, units = 0, packBands = null }: {
  view: BonusZoneViewLike;
  pending?: number;
  units?: number;
  /** JackHOF seats hidden per pack batch, with the batch's draft range —
   *  stamped by /api/promos only while the zone drop switch is on, so the
   *  row can never render early. Per-batch on purpose (Richard 8/23:
   *  "make it knows first window has 6 then second window has 4"). */
  packBands?: ReadonlyArray<{ from: number; to: number; seats: number }> | null;
}) {
  const t1 = view.tier1Through;
  const t2 = view.tier2Through;
  const t3 = zoneEnd(view);
  const pct = Math.min(100, Math.max(0, view.position));
  const bands: Array<{ from: number; to: number; l1: string; l2: string; on: boolean; cls: string }> = [
    { from: 0, to: t1, l1: '1 SPIN PER DRAFT', l2: `DRAFTS 1 TO ${t1}`, on: view.tier === 1, cls: 'bg-emerald-400' },
    { from: t1, to: t2, l1: '1 SPIN PER 2', l2: `${t1 + 1} TO ${t2}`, on: view.tier === 2, cls: 'bg-emerald-400/55' },
    ...(t3 > t2 ? [{ from: t2, to: t3, l1: '1 SPIN PER 3', l2: `${t2 + 1} TO ${t3}`, on: view.tier === 3, cls: 'bg-emerald-400/35' }] : []),
    { from: t3, to: 100, l1: 'NO BONUS', l2: `${t3 + 1} TO 100`, on: view.enabled && view.tier === null, cls: 'bg-white/[0.10]' },
  ];
  return (
    <div className="mt-2">
      <div className="relative h-2 rounded-full overflow-hidden bg-white/[0.06] flex">
        {bands.map((b) => (
          <div key={b.l1} className={`${b.cls} ${b.on ? '' : 'opacity-40'}`} style={{ width: `${b.to - b.from}%` }} />
        ))}
      </div>
      <div className="relative h-[6px]">
        <div className="absolute -top-[13px] w-[3px] h-[18px] rounded-sm bg-banana transition-[left] duration-700" style={{ left: `calc(${pct}% - 1px)` }} />
      </div>
      <ZoneTierChips view={view} small packBands={packBands} />

      {(pending > 0 || units > 0) && (
        <div className="flex gap-[5px] mt-1.5">
          {pending > 0 && (
            <span className="rounded-md bg-emerald-400/15 px-2 py-[3px] text-[10.5px] font-extrabold tracking-[1px] text-emerald-300">
              {pending} PENDING
            </span>
          )}
          {units > 0 && (
            <span className="rounded-md bg-white/[0.08] px-2 py-[3px] text-[10.5px] font-extrabold tracking-[1px] text-white/70">
              {unitsCopy(units).toUpperCase()} TOWARD A FREE SPIN
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── My Drafts row glyph ─────────────────────────────────────────────────────

export interface BonusLockLike { tier: 1 | 2 | 3; label: string; credit: number; eligible: boolean; reason: string }

export function ineligibleCopy(reason: string): string {
  switch (reason) {
    case 'free_pass': return 'Free passes never earn Banana Zone spins.';
    case 'pre_launch': return 'This pass was bought before Banana Zone started.';
    case 'first_purchase': return 'This pass came with the First Purchase promo.';
    case 'granted': return 'This pass came from the wheel or a grant, not a purchase.';
    case 'transferred': return 'This pass was bought by a different wallet.';
    case 'no_purchase_record': return 'This pass has no purchase on record.';
    default: return 'This pass is not Banana Zone eligible.';
  }
}

/**
 * Quiet status tick next to the draft name (same family as the ✈ auto-pick
 * glyph): a small ticket. Green = a free draft (or half) is pending on this
 * fill; dim with a slash = the pass used was not eligible.
 */
export function BonusPendingGlyph({ lock }: { lock: BonusLockLike }) {
  const tip = lock.eligible
    ? `Banana Zone: this seat pays by the window position this draft FILLS at. Right now that is ${lock.label} (${lock.tier === 1 ? 'a Free Spin' : lock.tier === 2 ? 'half a Free Spin' : 'a third of a Free Spin'}). Leave and nothing pays.`
    : `Banana Zone: nothing pays on this seat. ${ineligibleCopy(lock.reason)}`;
  return (
    <Tooltip content={tip}>
      <span className={`inline-flex flex-shrink-0 ${lock.eligible ? 'text-emerald-400/85' : 'text-white/30'}`} aria-label={lock.eligible ? 'Banana Zone Free Spin pending' : 'Banana Zone not eligible'} data-testid="bonus-zone-glyph">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3 sm:w-3.5 sm:h-3.5">
          {/* ticket */}
          <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2.2a2.3 2.3 0 0 0 0 4.6V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3.2a2.3 2.3 0 0 0 0-4.6V7zm6 1v8h1.6V8H9zm3.4 0v8H14V8h-1.6z" />
          {!lock.eligible && <path d="M4 20L20 4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />}
        </svg>
      </span>
    </Tooltip>
  );
}

// ─── Entry modal line ────────────────────────────────────────────────────────

export interface BonusZoneStatusLike {
  enabled: boolean;
  view?: BonusZoneViewLike;
  passes?: { paidTotal: number; eligibleCount: number; ineligibleReasons: Record<string, number> } | null;
  /** Sixths of a free draft banked this window. */
  unitsThisWindow?: number;
}

/**
 * Under the Paid Draft Pass row: what this seat earns right now, and whether
 * the passes in the wallet actually qualify (older passes get used first, so
 * say so before the seat is taken, never after).
 */
export function BonusZoneEntryLine({ status, buyingSeat, firstPurchaseApplies }: { status: BonusZoneStatusLike | null; buyingSeat: boolean; firstPurchaseApplies: boolean }) {
  if (!status?.enabled || !status.view?.tier) return null;
  const v = status.view;
  const left = plural(v.draftsLeftInTier, 'draft');
  const earns = v.tier === 1
    ? `earns a Free Spin if it fills inside the next ${left}`
    : v.tier === 2 ? `earns half a Free Spin if it fills inside the next ${left}` : `earns a third of a Free Spin if it fills inside the next ${left}`;
  if (buyingSeat) {
    if (firstPurchaseApplies) return null; // First Purchase wins; that purchase is not zone-eligible
    return (
      <p className="text-emerald-300 text-xs mt-0.5" data-testid="bonus-zone-entry-line">
        Banana Zone · {tierLabel(v.tier)}. This seat {earns}.
      </p>
    );
  }
  const p = status.passes;
  if (p && p.paidTotal > 0 && p.eligibleCount === 0) {
    return (
      <p className="text-white/45 text-xs mt-0.5" data-testid="bonus-zone-entry-line">
        Banana Zone is on ({tierLabel(v.tier)}) but your paid passes were bought before it started or with a promo, so they will not earn. New passes do.
      </p>
    );
  }
  return (
    <p className="text-emerald-300 text-xs mt-0.5" data-testid="bonus-zone-entry-line">
      Banana Zone · {tierLabel(v.tier)}. This seat {earns}. The tier is set by where the draft fills, not where you enter.
      {p && p.eligibleCount < p.paidTotal && (
        <span className="block text-white/45">{p.eligibleCount} of your {p.paidTotal} paid passes qualify. Older passes get used first.</span>
      )}
      {(status.unitsThisWindow ?? 0) > 0 && v.tier !== 1 && (
        <span className="block text-white/60">
          You have {unitsCopy(status.unitsThisWindow ?? 0)} banked this window.{(status.unitsThisWindow ?? 0) + (v.tier === 2 ? 3 : 2) >= 6 ? ' This fill completes the spin.' : ''}
        </span>
      )}
    </p>
  );
}

/** Speed-step confirm line addition. */
export function BonusZoneConfirmLine({ status }: { status: BonusZoneStatusLike | null }) {
  if (!status?.enabled || !status.view?.tier) return null;
  return (
    <p className="text-emerald-300/90 text-xs mt-1">Banana Zone is {tierLabel(status.view.tier)} right now. Your seat pays by the position the draft fills at.</p>
  );
}

// ─── Leave dialog warning ────────────────────────────────────────────────────

export function BonusLeaveWarning({ lock }: { lock: BonusLockLike | null | undefined }) {
  if (!lock?.eligible) return null;
  return (
    <p className="mb-6 -mt-3 rounded-lg border border-emerald-400/30 bg-emerald-400/[0.07] px-3 py-2 text-[13px] leading-snug text-emerald-200" data-testid="bonus-zone-leave-warning">
      Leaving forfeits this seat&apos;s Banana Zone credit ({lock.label} right now). Nothing pays on a lobby you leave.
    </p>
  );
}

// ─── Post-join toast line ────────────────────────────────────────────────────

export function bonusLockedToastCopy(lock: BonusLockLike): { title: string; message: string } {
  if (!lock.eligible) {
    return { title: 'Seat taken. No Banana Zone on this pass', message: ineligibleCopy(lock.reason) };
  }
  return lock.tier === 1
    ? { title: 'Seat taken. Banana Zone: Buy 1 Get 1 Spin', message: 'Fills inside the band and a Free Spin lands on your Banana Zone card. The tier is set by where it fills.' }
    : lock.tier === 2
      ? { title: 'Seat taken. Banana Zone: Buy 2 Get 1 Spin', message: 'Fills inside the band and half a Free Spin banks. Two in the same Jackpot window make one.' }
      : { title: 'Seat taken. Banana Zone: Buy 3 Get 1 Spin', message: 'Fills inside the band and a third of a Free Spin banks. Three in the same Jackpot window make one.' };
}

// ─── Promo modal body ────────────────────────────────────────────────────────

export interface BonusZoneModalData {
  tier: BzTier;
  label: string | null;
  position: number;
  draftsLeftInTier: number;
  draftsLeftInZone: number;
  tier1Through: number;
  tier2Through: number;
  tier3Through?: number;
  eligiblePasses: number | null;
  paidPasses: number | null;
  pending: Array<{ draftId: string; tier: 1 | 2 | 3; label: string; credit: number; eligible: boolean; reason: string }>;
  unitsThisWindow: number;
  earned: number;
  history: Array<{ draftId: string; label: string; status: string; settledAtIso?: string; unitsAfter?: number }>;
}

const draftName = (id: string) => {
  const m = /^2026-(fast|slow)-draft-(\d+)$/.exec(id);
  return m ? `${m[1] === 'slow' ? 'Slow' : 'Fast'} draft ${m[2]}` : id;
};

export function BonusZoneModalContent({ data, rules, packsMode = false, claimSlot = null }: {
  data: BonusZoneModalData | undefined;
  rules: string[];
  /** ZONE PACKS era: the pack room above is the hero, so this collapses to
   *  the essentials (live tier + stats) with everything else behind an ⓘ
   *  (Richard 8/23: "that module is way too much... just put the most
   *  important shit and top should be opening packs"). */
  packsMode?: boolean;
  /** The modal's CLAIM button, rendered right under the stats so the right
   *  column needs no scrolling (Richard 8/23). */
  claimSlot?: React.ReactNode;
}) {
  const [showAll, setShowAll] = React.useState(false);
  const expanded = !packsMode || showAll;
  const view: BonusZoneViewLike = {
    enabled: true,
    tier: data?.tier ?? null,
    label: data?.label ?? null,
    position: data?.position ?? 1,
    draftsLeftInTier: data?.draftsLeftInTier ?? 0,
    draftsLeftInZone: data?.draftsLeftInZone ?? 0,
    tier1Through: data?.tier1Through ?? 20,
    tier2Through: data?.tier2Through ?? 40,
    tier3Through: data?.tier3Through ?? 60,
  };
  const pendingEligible = (data?.pending ?? []).filter((p) => p.eligible);
  return (
    <div className="space-y-4">
      {/* Live state */}
      <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/[0.06] px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[12px] font-extrabold tracking-[2px] text-emerald-300">RIGHT NOW · DRAFT {view.position} OF THE WINDOW</span>
          {view.tier && <span className="text-[12px] font-bold tabular-nums text-white/70">{plural(view.draftsLeftInTier, 'draft')} left</span>}
        </div>
        <p className="mt-1 text-2xl font-black text-white leading-tight">{view.tier ? tierLabel(view.tier) : 'Zone closed'}</p>
        <p className="text-[14px] text-white/65 leading-snug">
          {view.tier === 1 && 'Every paid draft that fills now earns a Free Spin on the Banana Wheel.'}
          {view.tier === 2 && 'Every paid draft that fills now earns half a Free Spin. Two in this window make one.'}
          {view.tier === 3 && 'Every paid draft that fills now earns a third of a Free Spin. Three in this window make one.'}
          {!view.tier && 'The zone reopens the moment the Jackpot hits. Buy 1 Get 1 Spin from draft 1.'}
                  </p>
        <BonusZoneLadder view={view} />
      </div>

      {/* Your stats */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { v: data?.earned ?? 0, l: 'FREE SPINS EARNED' },
          { v: pendingEligible.length, l: 'PENDING ON FILLS' },
          { v: (data?.unitsThisWindow ?? 0) > 0 ? unitsCopy(data?.unitsThisWindow ?? 0) : 0, l: 'BANKED THIS WINDOW' },
        ].map((s) => (
          <div key={s.l} className="rounded-lg bg-white/[0.05] px-2 py-2.5 text-center">
            <p className="text-xl font-black text-white tabular-nums">{s.v}</p>
            <p className="text-[8.5px] font-extrabold tracking-[1px] text-white/45">{s.l}</p>
          </div>
        ))}
      </div>
      {claimSlot}

      {packsMode && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/[0.10] py-2.5 text-[12px] font-bold text-white/60 transition-colors hover:bg-white/[0.04] hover:text-white/80"
        >
          <span className="flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px]">i</span>
          How it all works · your activity
        </button>
      )}

      {expanded && data && data.paidPasses !== null && data.eligiblePasses !== null && (
        <p className="text-[12px] text-white/55">
          {data.paidPasses === 0
            ? 'You have no unused paid passes. New passes you buy are Banana Zone eligible.'
            : data.eligiblePasses === data.paidPasses
              ? `All ${data.paidPasses} of your paid passes are Banana Zone eligible.`
              : `${data.eligiblePasses} of your ${data.paidPasses} paid passes are eligible. Passes bought before the zone or with the First Purchase promo do not earn, and older passes get used first.`}
        </p>
      )}

      {/* Pending locks */}
      {expanded && (data?.pending?.length ?? 0) > 0 && (
        <div>
          <p className="text-[10px] font-extrabold tracking-[2px] text-white/50 mb-1.5">YOUR SEATS IN LOBBIES STILL FILLING</p>
          <ul className="space-y-1">
            {data!.pending.map((p) => (
              <li key={p.draftId} className="flex items-center justify-between rounded-lg bg-white/[0.04] px-3 py-2 text-[12.5px]">
                <span className="text-white/80">{draftName(p.draftId)}</span>
                <span className={p.eligible ? 'font-bold text-emerald-300' : 'text-white/40'}>
                  {p.eligible ? `pays by fill position · now ${p.label}` : 'not eligible'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* History */}
      {expanded && (data?.history?.length ?? 0) > 0 && (
        <div>
          <p className="text-[10px] font-extrabold tracking-[2px] text-white/50 mb-1.5">PAID OUT</p>
          <ul className="space-y-1">
            {data!.history.map((h) => (
              <li key={`${h.draftId}-${h.settledAtIso ?? ''}`} className="flex items-center justify-between rounded-lg bg-white/[0.04] px-3 py-2 text-[12.5px]">
                <span className="text-white/80">{draftName(h.draftId)} <span className="text-white/35">· {h.label}</span></span>
                <span className={h.status === 'paid' ? 'font-bold text-emerald-300' : h.status === 'half' ? 'text-white/70' : 'text-amber-300'}>
                  {h.status === 'paid' ? '+1 Free Spin' : h.status === 'half' ? unitsCopy(h.unitsAfter ?? 3) : 'retrying'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Rules */}
      {expanded && (<div>
        <p className="text-[10px] font-extrabold tracking-[2px] text-white/50 mb-1.5">HOW IT WORKS</p>
        <ul className="space-y-1.5">
          {rules.map((r, i) => (
            <li key={i} className="relative pl-4 text-[13px] leading-[1.5] text-white/75">
              <span className="absolute left-0 top-[8px] w-1.5 h-1.5 rounded-full bg-emerald-400/70" />
              {r}
            </li>
          ))}
        </ul>
      </div>)}
    </div>
  );
}
