'use client';

/**
 * First-purchase / wheel flow — per-user A→Z checklist.
 *
 * Derived (not logged): reads the user's gating flags + balance + returning
 * status to show each onboarding step done / pending, and flags states that
 * shouldn't happen. Lets you confirm the money-flow ran correctly for any user,
 * new or returning, and spot anyone stuck mid-flow.
 */

import type { UserLookupIdentity } from '@/hooks/admin/useUserLookup';

type StepState = 'done' | 'pending' | 'na' | 'warn';

function Row({ state, label, detail }: { state: StepState; label: string; detail?: string }) {
  const mark =
    state === 'done' ? <span className="text-emerald-400">✓</span>
    : state === 'warn' ? <span className="text-amber-400">⚠️</span>
    : state === 'na' ? <span className="text-sky-400">•</span>
    : <span className="text-gray-500">○</span>;
  const text =
    state === 'done' ? 'text-gray-200'
    : state === 'warn' ? 'text-amber-300'
    : state === 'na' ? 'text-sky-200'
    : 'text-gray-400';
  return (
    <li className="flex items-baseline gap-2.5 py-1.5">
      <span className="w-4 text-center text-sm">{mark}</span>
      <span className={`text-sm ${text}`}>{label}</span>
      {detail && <span className="text-[11px] text-gray-500">· {detail}</span>}
    </li>
  );
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function FirstPurchaseFlowCard({
  identity,
  returning,
}: {
  identity: UserLookupIdentity | null;
  returning: boolean;
}) {
  if (!identity) return null;
  const ps = identity.promoState ?? { firstPurchaseBonusGranted: false, firstPurchasePromoUnlocked: false, hasSpunWheel: false };
  const freeDrafts = identity.balance?.freeDrafts ?? 0;

  const steps: { state: StepState; label: string; detail?: string }[] = [
    { state: 'done', label: 'Signed up', detail: fmtDate(identity.createdAt) },
    ps.hasSpunWheel
      ? { state: 'done', label: 'Spun the wheel' }
      : { state: 'pending', label: 'Has not spun the wheel yet' },
    returning
      ? { state: 'na', label: 'Returning player — classic first-purchase promo (2 passes = 1 spin), available immediately' }
      : ps.firstPurchasePromoUnlocked
        ? { state: 'done', label: 'First-purchase unlocked (free drafts finished)' }
        : { state: 'pending', label: 'First-purchase locked — finishes free drafts to unlock' },
    ps.firstPurchaseBonusGranted
      ? { state: 'done', label: 'First purchase made — bonus granted' }
      : { state: 'pending', label: 'No first purchase yet' },
  ];

  const warnings: string[] = [];
  if (ps.firstPurchaseBonusGranted && !ps.firstPurchasePromoUnlocked && !returning) {
    warnings.push('Purchased before the unlock fired — unexpected for a new user (check firstPurchasePromoUnlocked).');
  }
  if (ps.firstPurchasePromoUnlocked && !ps.firstPurchaseBonusGranted && freeDrafts > 5) {
    warnings.push(`Unlocked but still holds ${freeDrafts} free drafts — they unlocked without burning them down.`);
  }

  return (
    <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      <h3 className="text-sm font-semibold text-white mb-1">First-purchase / wheel flow</h3>
      <p className="text-[11px] text-gray-500 mb-2">Derived from live state — confirms each step ran for this user.</p>
      <ul className="border-t border-white/[0.05] pt-1">
        {steps.map((s, i) => <Row key={i} {...s} />)}
      </ul>
      {warnings.length > 0 && (
        <div className="mt-2 space-y-1">
          {warnings.map((w, i) => (
            <p key={i} className="rounded-md bg-amber-500/[0.06] border border-amber-500/20 px-2.5 py-1.5 text-[11px] text-amber-300">⚠️ {w}</p>
          ))}
        </div>
      )}
    </section>
  );
}
