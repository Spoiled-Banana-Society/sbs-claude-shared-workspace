'use client';

/**
 * BONUS ZONE visuals (Richard 2026-08-22). Every surface reads the SAME view
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
}

export const tierShort = (tier: BzTier) => (tier === 1 ? 'BUY 1 GET 1' : tier === 2 ? 'BUY 2 GET 1' : tier === 3 ? 'BUY 3 GET 1' : 'CLOSED');
export const tierLabel = (tier: BzTier) => (tier === 1 ? 'Buy 1 Get 1' : tier === 2 ? 'Buy 2 Get 1' : tier === 3 ? 'Buy 3 Get 1' : 'Zone closed');
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const zoneEnd = (v: BonusZoneViewLike) => Math.max(v.tier2Through, v.tier3Through ?? 0);
/** Sixths of a free draft → "1 of 2", "2 of 3", else a percentage. */
export const unitsCopy = (units: number) =>
  units === 3 ? '1 of 2' : units === 2 ? '1 of 3' : units === 4 ? '2 of 3' : `${Math.round((units / 6) * 100)}%`;

// ─── Header pill ─────────────────────────────────────────────────────────────

/**
 * The third header pill, left of JACKPOT. Same frame/cut as the lane pills
 * (BatchProgressIndicator), 2 lines: "BONUS ZONE · N LEFT" then the tier.
 * Closed zone → pill hides entirely (the odds sell themselves from 70 on).
 */
export function BonusZonePill({ view, compact = false }: { view: BonusZoneViewLike; compact?: boolean }) {
  if (!view.enabled || !view.tier) return null;
  const left = view.draftsLeftInTier;
  return (
    <div
      className={`flex flex-col items-center justify-center shrink-0 gap-[2px] rounded-[9px] lg:rounded-[10px] border px-1.5 lg:px-2 py-[5px] lg:py-[6px] border-emerald-400/45 bg-emerald-400/[0.07] ${compact ? 'w-[84px]' : 'w-[84px] lg:w-[118px]'}`}
      data-testid="bonus-zone-pill"
    >
      <span className="text-[8px] lg:text-[9.5px] font-extrabold tracking-[0.07em] leading-none text-emerald-300 whitespace-nowrap">
        <span className="lg:hidden">BONUS · {left} LEFT</span>
        <span className="hidden lg:inline">BONUS ZONE · {left} LEFT</span>
      </span>
      <span className="mt-[3px] text-[10.5px] lg:text-[12.5px] font-extrabold leading-none tabular-nums text-emerald-400 whitespace-nowrap">
        {tierShort(view.tier)}
      </span>
    </div>
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
        <span className="text-[11.5px] font-bold text-emerald-400">BONUS ZONE · {view.tier ? tierShort(view.tier) : 'CLOSED'}</span>
        {view.tier && <span className="text-[12px] font-semibold tabular-nums text-emerald-400">{view.draftsLeftInTier} left</span>}
      </div>
      <p className="text-[10.5px] leading-snug text-text-secondary">
        {view.tier === 1 && `Every paid draft you enter in the next ${plural(view.draftsLeftInTier, 'draft')} earns a free draft when it fills. Then Buy 2 Get 1 through draft ${t2}.`}
        {view.tier === 2 && `Every 2 paid drafts you enter in the next ${plural(view.draftsLeftInTier, 'draft')} earn a free draft when they fill. ${end > t2 ? `Then Buy 3 Get 1 through ${end}.` : `Zone closes at draft ${t2}.`}`}
        {view.tier === 3 && `Every 3 paid drafts you enter in the next ${plural(view.draftsLeftInTier, 'draft')} earn a free draft when they fill. Zone closes at draft ${end}.`}
        {!view.tier && `Opens the moment the Jackpot hits: Buy 1 Get 1 for drafts 1 to ${view.tier1Through}, Buy 2 Get 1 through ${t2}.`}
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
export function BonusZoneLadder({ view, pending = 0, units = 0 }: { view: BonusZoneViewLike; pending?: number; units?: number }) {
  const t1 = view.tier1Through;
  const t2 = view.tier2Through;
  const t3 = zoneEnd(view);
  const pct = Math.min(100, Math.max(0, view.position));
  const bands: Array<{ from: number; to: number; l1: string; l2: string; on: boolean; cls: string }> = [
    { from: 0, to: t1, l1: 'BUY 1 GET 1', l2: `DRAFTS 1 TO ${t1}`, on: view.tier === 1, cls: 'bg-emerald-400' },
    { from: t1, to: t2, l1: 'BUY 2 GET 1', l2: `${t1 + 1} TO ${t2}`, on: view.tier === 2, cls: 'bg-emerald-400/55' },
    ...(t3 > t2 ? [{ from: t2, to: t3, l1: 'BUY 3 GET 1', l2: `${t2 + 1} TO ${t3}`, on: view.tier === 3, cls: 'bg-emerald-400/35' }] : []),
    { from: t3, to: 100, l1: 'NO BONUS', l2: `${t3 + 1} TO 100`, on: view.enabled && view.tier === null, cls: 'bg-white/[0.10]' },
  ];
  return (
    <div className="mt-2">
      <div className="relative h-2 rounded-full overflow-hidden bg-white/[0.06] flex">
        {bands.map((b) => (
          <div key={b.l1} className={`${b.cls} ${b.on ? '' : 'opacity-40'}`} style={{ width: `${b.to - b.from}%` }} />
        ))}
      </div>
      <div className="relative h-[34px]">
        {bands.map((b) => (
          <div key={b.l1} className="absolute top-1 text-center" style={{ left: `${b.from}%`, width: `${b.to - b.from}%` }}>
            <span className={`block text-[8px] tracking-[1px] font-extrabold leading-[1.3] whitespace-nowrap ${b.on ? 'text-emerald-300' : 'text-white/45'}`}>{b.l1}</span>
            <span className="block text-[7.5px] tracking-[1px] font-bold text-white/35 whitespace-nowrap">{b.l2}</span>
          </div>
        ))}
        <div className="absolute -top-[13px] w-[3px] h-[18px] rounded-sm bg-banana transition-[left] duration-700" style={{ left: `calc(${pct}% - 1px)` }} />
      </div>
      {(pending > 0 || units > 0) && (
        <div className="flex gap-[5px] -mt-1">
          {pending > 0 && (
            <span className="rounded-md bg-emerald-400/15 px-2 py-[3px] text-[9.5px] font-extrabold tracking-[1px] text-emerald-300">
              {pending} PENDING
            </span>
          )}
          {units > 0 && (
            <span className="rounded-md bg-white/[0.08] px-2 py-[3px] text-[9.5px] font-extrabold tracking-[1px] text-white/70">
              {unitsCopy(units).toUpperCase()} TOWARD A FREE DRAFT
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
    case 'free_pass': return 'Free passes never earn Bonus Zone.';
    case 'pre_launch': return 'This pass was bought before Bonus Zone started.';
    case 'first_purchase': return 'This pass came with the First Purchase promo.';
    case 'granted': return 'This pass was a reward, not a purchase.';
    case 'transferred': return 'This pass was bought by a different wallet.';
    case 'no_purchase_record': return 'This pass has no purchase on record.';
    default: return 'This pass is not Bonus Zone eligible.';
  }
}

/**
 * Quiet status tick next to the draft name (same family as the ✈ auto-pick
 * glyph): a small ticket. Green = a free draft (or half) is pending on this
 * fill; dim with a slash = the pass used was not eligible.
 */
export function BonusPendingGlyph({ lock }: { lock: BonusLockLike }) {
  const tip = lock.eligible
    ? (lock.tier === 1
        ? 'Bonus Zone locked: Buy 1 Get 1. A free draft pays the moment this draft fills. Leave and it is forfeited.'
        : lock.tier === 2
          ? 'Bonus Zone locked: Buy 2 Get 1. Half a free draft pays when this fills; two halves in the same Jackpot window make one free draft.'
          : 'Bonus Zone locked: Buy 3 Get 1. A third of a free draft pays when this fills; three in the same Jackpot window make one free draft.')
    : `Bonus Zone: nothing pays on this seat. ${ineligibleCopy(lock.reason)}`;
  return (
    <Tooltip content={tip}>
      <span className={`inline-flex flex-shrink-0 ${lock.eligible ? 'text-emerald-400/85' : 'text-white/30'}`} aria-label={lock.eligible ? 'Bonus Zone free draft pending' : 'Bonus Zone not eligible'} data-testid="bonus-zone-glyph">
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
    ? 'earns a free draft when it fills'
    : v.tier === 2 ? 'earns half a free draft when it fills, two fills make one' : 'earns a third of a free draft when it fills, three fills make one';
  if (buyingSeat) {
    if (firstPurchaseApplies) return null; // First Purchase wins; that purchase is not zone-eligible
    return (
      <p className="text-emerald-300 text-xs mt-0.5" data-testid="bonus-zone-entry-line">
        Bonus Zone · {tierLabel(v.tier)} · ends in {left}. This seat {earns}.
      </p>
    );
  }
  const p = status.passes;
  if (p && p.paidTotal > 0 && p.eligibleCount === 0) {
    return (
      <p className="text-white/45 text-xs mt-0.5" data-testid="bonus-zone-entry-line">
        Bonus Zone is on ({tierLabel(v.tier)}) but your paid passes were bought before it started or with a promo, so they will not earn. New passes do.
      </p>
    );
  }
  return (
    <p className="text-emerald-300 text-xs mt-0.5" data-testid="bonus-zone-entry-line">
      Bonus Zone · {tierLabel(v.tier)} · ends in {left}. This seat {earns}.
      {p && p.eligibleCount < p.paidTotal && (
        <span className="block text-white/45">{p.eligibleCount} of your {p.paidTotal} paid passes qualify. Older passes get used first.</span>
      )}
      {(status.unitsThisWindow ?? 0) > 0 && v.tier !== 1 && (
        <span className="block text-white/60">
          You have {unitsCopy(status.unitsThisWindow ?? 0)} banked this window.{(status.unitsThisWindow ?? 0) + (v.tier === 2 ? 3 : 2) >= 6 ? ' This fill completes the free draft.' : ''}
        </span>
      )}
    </p>
  );
}

/** Speed-step confirm line addition. */
export function BonusZoneConfirmLine({ status }: { status: BonusZoneStatusLike | null }) {
  if (!status?.enabled || !status.view?.tier) return null;
  return (
    <p className="text-emerald-300/90 text-xs mt-1">Bonus Zone {tierLabel(status.view.tier)} locks the moment you take your seat. It pays when the draft fills.</p>
  );
}

// ─── Leave dialog warning ────────────────────────────────────────────────────

export function BonusLeaveWarning({ lock }: { lock: BonusLockLike | null | undefined }) {
  if (!lock?.eligible) return null;
  return (
    <p className="mb-6 -mt-3 rounded-lg border border-emerald-400/30 bg-emerald-400/[0.07] px-3 py-2 text-[13px] leading-snug text-emerald-200" data-testid="bonus-zone-leave-warning">
      Leaving forfeits this seat&apos;s Bonus Zone {lock.label}{lock.tier === 1 ? ' free draft' : lock.tier === 2 ? ' half credit' : ' third credit'}. Re-enter later and you lock whatever tier is live then.
    </p>
  );
}

// ─── Post-join toast line ────────────────────────────────────────────────────

export function bonusLockedToastCopy(lock: BonusLockLike): { title: string; message: string } {
  if (!lock.eligible) {
    return { title: 'Seat taken. No Bonus Zone on this pass', message: ineligibleCopy(lock.reason) };
  }
  return lock.tier === 1
    ? { title: 'Locked: Buy 1 Get 1', message: 'A free draft lands in your passes the moment this draft fills.' }
    : lock.tier === 2
      ? { title: 'Locked: Buy 2 Get 1', message: 'Half a free draft lands when this fills. Two in the same Jackpot window make one.' }
      : { title: 'Locked: Buy 3 Get 1', message: 'A third of a free draft lands when this fills. Three in the same Jackpot window make one.' };
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

export function BonusZoneModalContent({ data, rules }: { data: BonusZoneModalData | undefined; rules: string[] }) {
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
          <span className="text-[11px] font-extrabold tracking-[2px] text-emerald-300">RIGHT NOW · DRAFT {view.position} OF THE WINDOW</span>
          {view.tier && <span className="text-[11px] font-bold tabular-nums text-white/70">{plural(view.draftsLeftInTier, 'draft')} left</span>}
        </div>
        <p className="mt-1 text-2xl font-black text-white leading-tight">{view.tier ? tierLabel(view.tier) : 'Zone closed'}</p>
        <p className="text-[13px] text-white/65 leading-snug">
          {view.tier === 1 && 'Every paid draft you enter now earns a free draft when it fills.'}
          {view.tier === 2 && 'Every paid draft you enter now earns half a free draft when it fills. Two in this window make one.'}
          {view.tier === 3 && 'Every paid draft you enter now earns a third of a free draft when it fills. Three in this window make one.'}
          {!view.tier && 'The zone reopens the moment the Jackpot hits. Buy 1 Get 1 from draft 1.'}
        </p>
        <BonusZoneLadder view={view} />
      </div>

      {/* Your stats */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { v: data?.earned ?? 0, l: 'FREE DRAFTS EARNED' },
          { v: pendingEligible.length, l: 'PENDING ON FILLS' },
          { v: (data?.unitsThisWindow ?? 0) > 0 ? unitsCopy(data?.unitsThisWindow ?? 0) : 0, l: 'BANKED THIS WINDOW' },
        ].map((s) => (
          <div key={s.l} className="rounded-lg bg-white/[0.05] px-2 py-2.5 text-center">
            <p className="text-xl font-black text-white tabular-nums">{s.v}</p>
            <p className="text-[8.5px] font-extrabold tracking-[1px] text-white/45">{s.l}</p>
          </div>
        ))}
      </div>
      {data && data.paidPasses !== null && data.eligiblePasses !== null && (
        <p className="text-[12px] text-white/55">
          {data.paidPasses === 0
            ? 'You have no unused paid passes. New passes you buy are Bonus Zone eligible.'
            : data.eligiblePasses === data.paidPasses
              ? `All ${data.paidPasses} of your paid passes are Bonus Zone eligible.`
              : `${data.eligiblePasses} of your ${data.paidPasses} paid passes are eligible. Passes bought before the zone or with the First Purchase promo do not earn, and older passes get used first.`}
        </p>
      )}

      {/* Pending locks */}
      {(data?.pending?.length ?? 0) > 0 && (
        <div>
          <p className="text-[10px] font-extrabold tracking-[2px] text-white/50 mb-1.5">LOCKED ON LOBBIES STILL FILLING</p>
          <ul className="space-y-1">
            {data!.pending.map((p) => (
              <li key={p.draftId} className="flex items-center justify-between rounded-lg bg-white/[0.04] px-3 py-2 text-[12.5px]">
                <span className="text-white/80">{draftName(p.draftId)}</span>
                <span className={p.eligible ? 'font-bold text-emerald-300' : 'text-white/40'}>
                  {p.eligible ? `${p.label} · ${p.tier === 1 ? 'free draft' : p.tier === 2 ? 'half' : 'third'} pending` : 'not eligible'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* History */}
      {(data?.history?.length ?? 0) > 0 && (
        <div>
          <p className="text-[10px] font-extrabold tracking-[2px] text-white/50 mb-1.5">PAID OUT</p>
          <ul className="space-y-1">
            {data!.history.map((h) => (
              <li key={`${h.draftId}-${h.settledAtIso ?? ''}`} className="flex items-center justify-between rounded-lg bg-white/[0.04] px-3 py-2 text-[12.5px]">
                <span className="text-white/80">{draftName(h.draftId)} <span className="text-white/35">· {h.label}</span></span>
                <span className={h.status === 'paid' ? 'font-bold text-emerald-300' : h.status === 'half' ? 'text-white/70' : 'text-amber-300'}>
                  {h.status === 'paid' ? '+1 free draft' : h.status === 'half' ? unitsCopy(h.unitsAfter ?? 3) : 'retrying'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Rules */}
      <div>
        <p className="text-[10px] font-extrabold tracking-[2px] text-white/50 mb-1.5">HOW IT WORKS</p>
        <ul className="space-y-1.5">
          {rules.map((r, i) => (
            <li key={i} className="relative pl-4 text-[13px] leading-[1.5] text-white/75">
              <span className="absolute left-0 top-[8px] w-1.5 h-1.5 rounded-full bg-emerald-400/70" />
              {r}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
