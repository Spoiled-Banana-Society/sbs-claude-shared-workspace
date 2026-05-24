'use client';

/**
 * Activity section: per-user lifetime summary + recent event timeline.
 *
 * Built May 2026 in response to Boris's "I want all the data that makes
 * sense — many promos they've won, pending ones, …" feedback. The
 * underlying data was already fetched (userEvents collection, 200 most
 * recent) but never surfaced anywhere in the lookup page.
 *
 * Two halves:
 *   - Summary chips: counts of each event type (promos claimed, spins,
 *     purchases, wins, etc.) computed client-side from the event array.
 *   - Recent events list: chronological, last 30 with type pill +
 *     when + tx link if present.
 *
 * If the underlying section fetch failed (Firestore index missing,
 * etc.) we render a graceful "unavailable" message instead of the
 * usual sections.
 */

import { isSectionFail } from '@/hooks/admin/useUserLookup';

interface RawEvent {
  id?: string;
  // v2_activity_events uses `type`; the older v2_user_events used `eventType`.
  // Read either so this section works no matter which collection the
  // route ends up reading from.
  type?: string;
  eventType?: string;
  // v2_activity_events stores `createdAt` (ms epoch) + `createdAtIso`.
  // v2_user_events stores `timestamp` (ISO). Accept all.
  createdAt?: number | string | null;
  createdAtIso?: string;
  timestamp?: string;
  // metadata (v2_activity_events) vs meta (v2_user_events).
  metadata?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  txHash?: string;
}

function eventTypeOf(e: RawEvent): string {
  return e.type || e.eventType || 'unknown';
}

function metaOf(e: RawEvent): Record<string, unknown> {
  return (e.metadata ?? e.meta ?? {}) as Record<string, unknown>;
}

function isoOf(e: RawEvent): string | undefined {
  if (e.createdAtIso) return e.createdAtIso;
  if (typeof e.createdAt === 'number') return new Date(e.createdAt).toISOString();
  if (typeof e.createdAt === 'string') return e.createdAt;
  return e.timestamp;
}

function fmtWhen(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return `${Math.max(1, Math.round(diff / 1000))}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.round(diff / 86_400_000)}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const EVENT_LABEL: Record<string, string> = {
  signup: 'Signup',
  login: 'Login',
  pass_purchased: 'Pass purchased',
  pass_granted: 'Pass granted',
  spin_won: 'Wheel spin win',
  promo_claimed: 'Promo claimed',
  draft_entered: 'Draft entered',
  draft_left: 'Draft left',
  draft_won: 'Draft win',
  marketplace_sold: 'Marketplace sale',
  cashout_completed: 'Cashout',
  withdrawal_requested: 'Withdrawal request',
  withdrawal_paid: 'Withdrawal paid',
};

const EVENT_COLOR: Record<string, string> = {
  signup: 'text-green-300',
  login: 'text-blue-300',
  pass_purchased: 'text-emerald-300',
  pass_granted: 'text-[#F3E216]',
  spin_won: 'text-purple-300',
  promo_claimed: 'text-pink-300',
  draft_entered: 'text-blue-300',
  draft_left: 'text-gray-400',
  draft_won: 'text-amber-300',
  marketplace_sold: 'text-cyan-300',
  cashout_completed: 'text-green-300',
  withdrawal_requested: 'text-yellow-300',
  withdrawal_paid: 'text-green-300',
};

interface Props {
  activity: Record<string, unknown>[] | { ok: false; reason: string };
}

export function ActivitySection({ activity }: Props) {
  if (isSectionFail(activity)) {
    return (
      <section className="rounded-xl border border-gray-700 bg-gray-900/40 p-4">
        <h3 className="text-sm font-semibold text-white">Activity</h3>
        <p className="mt-1 text-xs text-amber-300">Activity log unavailable: {activity.reason}</p>
      </section>
    );
  }

  const events = activity as RawEvent[];

  // Summary counts — one tally per event type. Boris wanted "as much info
  // as possible that makes sense" — these are the high-signal counters.
  // We also break out spin wins by prize so admins can see "1 free draft × 12,
  // 5 free drafts × 3, jackpot entry × 2, …" at a glance.
  const tally = new Map<string, number>();
  let promoTypeBreakdown = new Map<string, number>();
  const spinPrizeBreakdown = new Map<string, number>();
  for (const e of events) {
    const t = eventTypeOf(e);
    const meta = metaOf(e);
    tally.set(t, (tally.get(t) ?? 0) + 1);
    if (t === 'promo_claimed') {
      const promoType = String(meta.promoType ?? 'unknown');
      promoTypeBreakdown.set(promoType, (promoTypeBreakdown.get(promoType) ?? 0) + 1);
    }
    if (t === 'spin_won') {
      // Surface prize label so the breakdown reads "1 free draft", "JP entry",
      // "HOF entry" etc. Falls back to segmentLabel when prizeType isn't set.
      const prizeType = String(meta.prizeType ?? '');
      const prizeValue = meta.prizeValue;
      let label = String(meta.segmentLabel ?? 'unknown');
      if (prizeType === 'draft_pass') {
        label = `${prizeValue} free draft${Number(prizeValue) === 1 ? '' : 's'}`;
      } else if (prizeType === 'custom' && prizeValue === 'jackpot') {
        label = 'Jackpot entry';
      } else if (prizeType === 'custom' && prizeValue === 'hof') {
        label = 'HOF entry';
      }
      spinPrizeBreakdown.set(label, (spinPrizeBreakdown.get(label) ?? 0) + 1);
    }
  }
  // Sort breakdown for stable display, most-claimed first.
  promoTypeBreakdown = new Map(
    [...promoTypeBreakdown.entries()].sort((a, b) => b[1] - a[1]),
  );

  const summaryChips: { label: string; value: number; accent?: string; emoji: string }[] = [
    { label: 'Logins', value: tally.get('login') ?? 0, emoji: '🔑', accent: 'text-blue-300' },
    { label: 'Wheel spins', value: tally.get('spin_won') ?? 0, emoji: '🎡', accent: 'text-purple-300' },
    { label: 'Promos claimed', value: tally.get('promo_claimed') ?? 0, emoji: '🎯', accent: 'text-pink-300' },
    { label: 'Passes bought', value: tally.get('pass_purchased') ?? 0, emoji: '💳', accent: 'text-emerald-300' },
    { label: 'Passes granted', value: tally.get('pass_granted') ?? 0, emoji: '🎁', accent: 'text-[#F3E216]' },
    { label: 'Drafts entered', value: tally.get('draft_entered') ?? 0, emoji: '🏟️' },
    { label: 'Draft wins', value: tally.get('draft_won') ?? 0, emoji: '🏆', accent: 'text-amber-300' },
    { label: 'Cashouts', value: tally.get('cashout_completed') ?? 0, emoji: '💸', accent: 'text-green-300' },
  ];

  // Sort events by timestamp desc (already sorted server-side, but defend
  // against any reordering by Firestore index quirks).
  const sortedEvents = [...events].sort((a, b) =>
    (isoOf(b) || '').localeCompare(isoOf(a) || ''),
  );
  const recent = sortedEvents.slice(0, 30);

  return (
    <section className="space-y-3 rounded-xl border border-gray-700 bg-gray-900/40 p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-white">Activity</h3>
        <p className="text-[11px] text-gray-500">
          {events.length} event{events.length === 1 ? '' : 's'} on file
        </p>
      </div>

      {/* Lifetime summary chips */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {summaryChips.map((chip) => (
          <div
            key={chip.label}
            className="flex items-center gap-2 rounded-md border border-gray-800 bg-gray-950/40 px-2.5 py-1.5"
          >
            <span className="text-base shrink-0" aria-hidden>{chip.emoji}</span>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-gray-500 truncate">{chip.label}</p>
              <p className={`text-base font-semibold tabular-nums ${chip.accent ?? 'text-white'}`}>
                {chip.value.toLocaleString()}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Promo-type breakdown — surfaces which promo this user actually
          engages with. Hidden when no promos claimed. */}
      {promoTypeBreakdown.size > 0 && (
        <div className="rounded-md border border-pink-500/20 bg-pink-500/[0.04] px-3 py-2">
          <p className="mb-1.5 text-[11px] uppercase tracking-wider text-pink-300/80">
            Promos by type
          </p>
          <div className="flex flex-wrap gap-1.5">
            {[...promoTypeBreakdown.entries()].map(([type, count]) => (
              <span
                key={type}
                className="rounded-full bg-pink-500/[0.10] px-2 py-0.5 text-[11px] text-pink-200 ring-1 ring-pink-500/20"
              >
                {type.replace(/_/g, ' ')} · {count}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Wheel-spin prize breakdown — Boris's explicit ask: "how many won
          1 draft, 5 draft, 20 drafts, JP, HOF etc." Each chip = one prize
          label with its hit count for this wallet. */}
      {spinPrizeBreakdown.size > 0 && (
        <div className="rounded-md border border-purple-500/20 bg-purple-500/[0.04] px-3 py-2">
          <p className="mb-1.5 text-[11px] uppercase tracking-wider text-purple-300/80">
            Wheel wins by prize
          </p>
          <div className="flex flex-wrap gap-1.5">
            {[...spinPrizeBreakdown.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([prize, count]) => (
                <span
                  key={prize}
                  className="rounded-full bg-purple-500/[0.10] px-2 py-0.5 text-[11px] text-purple-200 ring-1 ring-purple-500/20"
                >
                  {prize} · {count}
                </span>
              ))}
          </div>
        </div>
      )}

      {/* Recent events */}
      <div>
        <p className="mb-1.5 text-[11px] uppercase tracking-wider text-gray-500">
          Recent events
        </p>
        {recent.length === 0 ? (
          <p className="rounded-md border border-dashed border-gray-700 px-3 py-4 text-center text-xs text-gray-500">
            No activity events found for this wallet.
          </p>
        ) : (
          <ul className="divide-y divide-white/[0.04] rounded-md border border-white/[0.04] bg-black/20">
            {recent.map((e, i) => {
              const t = eventTypeOf(e);
              const label = EVENT_LABEL[t] ?? t;
              const color = EVENT_COLOR[t] ?? 'text-gray-300';
              const tx = e.txHash ? `https://basescan.org/tx/${e.txHash}` : null;
              const detail = describeEvent(e);
              return (
                <li key={e.id ?? i} className="flex items-center gap-3 px-3 py-2 text-xs">
                  <span className={`shrink-0 font-semibold ${color}`}>{label}</span>
                  {detail && <span className="text-gray-400 truncate flex-1">{detail}</span>}
                  {!detail && <span className="flex-1" />}
                  <span className="shrink-0 text-gray-500">{fmtWhen(isoOf(e))}</span>
                  {tx && (
                    <a
                      href={tx}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-blue-300 hover:text-blue-200 underline underline-offset-2"
                      title={e.txHash}
                    >
                      tx ↗
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

/**
 * One-line human description of an event derived from its meta payload.
 * Returns null when nothing useful can be said beyond the type label.
 */
function describeEvent(e: RawEvent): string | null {
  const meta = metaOf(e);
  switch (eventTypeOf(e)) {
    case 'pass_purchased': {
      const price = Number(meta.totalPrice);
      const qty = Number(meta.quantity ?? 1);
      const currency = String(meta.currency ?? '');
      const priceStr = Number.isFinite(price) ? ` · $${price.toLocaleString()}${currency ? ` ${currency}` : ''}` : '';
      return `${qty} pass${qty === 1 ? '' : 'es'}${priceStr}`;
    }
    case 'pass_granted': {
      const qty = Number(meta.quantity ?? meta.draftPassesAdded ?? 1);
      return `${qty} free pass${qty === 1 ? '' : 'es'}`;
    }
    case 'spin_won': {
      const prizeType = String(meta.prizeType ?? '');
      const prizeValue = meta.prizeValue;
      if (prizeType === 'draft_pass') return `${prizeValue} free pass${Number(prizeValue) === 1 ? '' : 'es'}`;
      if (prizeType === 'custom' && prizeValue === 'jackpot') return 'Jackpot entry';
      if (prizeType === 'custom' && prizeValue === 'hof') return 'HOF entry';
      return String(meta.segmentLabel ?? '');
    }
    case 'promo_claimed': {
      const promoType = String(meta.promoType ?? '');
      const passes = Number(meta.draftPassesAdded);
      const spins = Number(meta.spinsAdded);
      const parts: string[] = [];
      if (promoType) parts.push(promoType);
      if (passes > 0) parts.push(`+${passes} pass${passes === 1 ? '' : 'es'}`);
      if (spins > 0) parts.push(`+${spins} spin${spins === 1 ? '' : 's'}`);
      return parts.join(' · ') || null;
    }
    case 'draft_won': {
      const amount = Number(meta.amount);
      return Number.isFinite(amount) ? `$${amount.toLocaleString()}` : null;
    }
    case 'cashout_completed': {
      const value = Number(meta.settledUsd ?? meta.amount);
      return Number.isFinite(value) ? `$${value.toFixed(2)}` : null;
    }
    case 'marketplace_sold': {
      const price = Number(meta.price);
      return Number.isFinite(price) ? `$${price.toLocaleString()}` : null;
    }
    default:
      return null;
  }
}
