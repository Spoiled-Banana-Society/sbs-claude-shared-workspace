'use client';

import { useEffect, useMemo } from 'react';

import { useActivityStream, type LiveActivityEvent } from '@/hooks/useActivityStream';
import { LineIcon } from '@/components/NotificationIcons';
import type { ActivityEventType } from '@/lib/activityEvents';
import { reportClientError } from '@/lib/clientErrors';
import { LOG_SOURCES } from '@/lib/logSources';
import { useAuth } from '@/hooks/useAuth';

const TYPE_LABEL: Record<ActivityEventType, string> = {
  pass_purchased: 'Purchased',
  pass_granted: 'Granted',
  spin_won: 'Won on wheel',
  promo_claimed: 'Promo claim',
  draft_entered: 'Entered draft',
  draft_filled: 'Draft filled',
  draft_left: 'Left draft',
  draft_won: 'Draft win',
  marketplace_sold: 'Sold',
  cashout_completed: 'Cashed out',
  // Presence events exist for the ADMIN live feed only — hidden below.
  user_signed_up: 'Account created',
  user_returned: 'Logged in',
};

// Admin-only telemetry types — never rendered in the user-facing history.
const HIDDEN_TYPES: ReadonlySet<ActivityEventType> = new Set(['user_signed_up', 'user_returned']);

// Clean line-icon key per type (same icon set as the bell — never emoji).
// pass_granted is overridden by source in iconFor().
const TYPE_ICON: Record<ActivityEventType, string> = {
  pass_purchased: 'bag',
  pass_granted: 'gift',
  spin_won: 'spin',
  promo_claimed: 'target',
  draft_entered: 'football',
  draft_filled: 'check',
  draft_left: 'undo',
  draft_won: 'trophy',
  marketplace_sold: 'banknote',
  cashout_completed: 'banknote',
  user_signed_up: 'check',
  user_returned: 'check',
};

function iconFor(e: LiveActivityEvent): string {
  if (e.type === 'pass_granted') {
    const s = String(e.metadata?.source ?? '');
    if (s === 'card_fee_reward') return 'banknote';
    if (s === 'wheel_spin_mint') return 'spin';
  }
  return TYPE_ICON[e.type];
}

// Label varies for pass_granted so it only says "from SBS" when we actually
// sent it, and names credit/wheel rewards correctly.
function labelFor(e: LiveActivityEvent): string {
  if (e.type === 'pass_granted') {
    const s = String(e.metadata?.source ?? '');
    if (s === 'card_fee_reward') return 'Credit reward';
    if (s === 'wheel_spin_mint') return 'Wheel prize';
    if (e.metadata?.adminActor) return 'Gift from SBS';
    return 'Reward';
  }
  return TYPE_LABEL[e.type];
}

function leagueShort(e: LiveActivityEvent): string {
  const id = String(e.metadata?.leagueId ?? '');
  return id ? id.slice(0, 8) : '';
}

const TYPE_COLOR: Record<ActivityEventType, string> = {
  pass_purchased: 'text-emerald-300',
  pass_granted: 'text-[#F3E216]',
  spin_won: 'text-purple-300',
  promo_claimed: 'text-pink-300',
  draft_entered: 'text-blue-300',
  draft_filled: 'text-teal-300',
  draft_left: 'text-gray-400',
  draft_won: 'text-amber-300',
  marketplace_sold: 'text-cyan-300',
  cashout_completed: 'text-green-300',
  user_signed_up: 'text-gray-400',
  user_returned: 'text-gray-400',
};

function formatWhen(ms: number | null, iso: string): string {
  const t = ms ?? Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const diff = Date.now() - t;
  if (diff < 60_000) return `${Math.max(1, Math.round(diff / 1000))}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function describe(e: LiveActivityEvent): string {
  switch (e.type) {
    case 'pass_purchased': {
      const price = Number(e.metadata?.totalPrice);
      const currency = String(e.metadata?.currency ?? '');
      const priceStr = Number.isFinite(price) ? ` for $${price.toLocaleString()}${currency ? ` ${currency}` : ''}` : '';
      const via = e.paymentMethod === 'card' ? ' (card)' : e.paymentMethod === 'usdc' ? ' (USDC)' : '';
      return `${e.quantity} draft pass${e.quantity !== 1 ? 'es' : ''}${priceStr}${via}`;
    }
    case 'pass_granted': {
      // pass_granted fires for several reasons — describe by the real source,
      // never a blanket "from admin".
      const passWord = `draft pass${e.quantity !== 1 ? 'es' : ''}`;
      const source = String(e.metadata?.source ?? '');
      // Card-fee credit is EARNED from your accumulated card fees — a PAID
      // pass (usable everywhere, incl. promos), not a free admin gift.
      if (source === 'card_fee_reward') return `${e.quantity} paid ${passWord} from your $25 card credit`;
      if (source === 'wheel_spin_mint') return `${e.quantity} ${passWord}`;
      // Only a true manual admin grant carries adminActor — we actually sent it.
      if (e.metadata?.adminActor) return `SBS Team sent you ${e.quantity} ${passWord}`;
      return `${e.quantity} ${passWord}`;
    }
    case 'spin_won': {
      const prizeType = String(e.metadata?.prizeType ?? '');
      const prizeValue = e.metadata?.prizeValue;
      if (prizeType === 'draft_pass') return `${prizeValue} free draft pass${Number(prizeValue) !== 1 ? 'es' : ''}`;
      if (prizeType === 'custom' && prizeValue === 'jackpot') return 'Jackpot entry';
      if (prizeType === 'custom' && prizeValue === 'hof') return 'HOF entry';
      return String(e.metadata?.segmentLabel ?? 'Wheel prize');
    }
    case 'promo_claimed': {
      const promoType = String(e.metadata?.promoType ?? 'promo');
      const passes = Number(e.metadata?.draftPassesAdded);
      const spins = Number(e.metadata?.spinsAdded);
      if (passes > 0) return `${passes} free draft${passes !== 1 ? 's' : ''} (${promoType})`;
      if (spins > 0) return `${spins} wheel spin${spins !== 1 ? 's' : ''} (${promoType})`;
      return `${promoType} reward`;
    }
    case 'draft_entered': {
      const lg = leagueShort(e);
      return lg ? `League ${lg}` : '';
    }
    case 'draft_filled':
      return 'Your draft filled — drafting begins';
    case 'draft_left':
      return '';
    case 'draft_won': {
      const amount = Number(e.metadata?.amount);
      return Number.isFinite(amount) ? `Won $${amount.toLocaleString()}` : 'Draft win';
    }
    case 'marketplace_sold': {
      const price = Number(e.metadata?.price);
      return Number.isFinite(price) ? `Sold for $${price.toLocaleString()}` : 'Marketplace sale';
    }
    case 'cashout_completed': {
      // Prefer Coinbase's settled USD (what actually landed in the user's
      // bank); fall back to the canonical 'amount' field. Direct
      // withdrawals don't have a settled value — requested = actual.
      const settledUsd = Number(e.metadata?.settledUsd);
      const fallback = Number(e.metadata?.amount);
      const value = Number.isFinite(settledUsd) ? settledUsd : fallback;
      const rail = String(e.metadata?.rail ?? '');
      const railLabel =
        rail === 'coinbase_offramp' ? 'to bank via Coinbase'
        : rail === 'direct_usdc' ? 'to USDC wallet'
        : rail === 'direct_bank' ? 'to bank'
        : '';
      const amountStr = Number.isFinite(value)
        ? `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : 'Cashout';
      return `${amountStr}${railLabel ? ` ${railLabel}` : ''}`;
    }
    default:
      return '';
  }
}

export function ActivityHistory({
  userId,
  filterTypes,
  title = 'Activity History',
  emptyText = 'Your purchases, wins, and promo claims will show up here.',
}: {
  userId: string | null;
  /** If set, only these event types are shown (e.g. a promo-only feed on the Promos tab). */
  filterTypes?: ActivityEventType[];
  title?: string;
  emptyText?: string;
}) {
  const url = userId ? `/api/user/activity/stream?userId=${encodeURIComponent(userId.toLowerCase())}` : null;
  const { events, isConnected, error } = useActivityStream(url);

  // Read the spin-reveal freeze state from auth so we can hide
  // freshly-arrived spin events while the wheel is mid-animation
  // on the banana-wheel page. Without this, opening /profile in
  // another tab during a spin would show "Won on wheel" the moment
  // the server wrote the event — ~5s before the wheel landed and
  // spoiling the reveal. Once the freeze expires (~5.8s after spin
  // start), the queued events show normally.
  const { spinRevealFrozenUntil } = useAuth();

  // Surface activity-stream (SSE) failures to the admin error log. The
  // stream silently degrades to "Connecting…" otherwise, so a broken
  // feed is invisible without this report.
  useEffect(() => {
    if (!error) return;
    reportClientError({
      source: LOG_SOURCES.profile.ACTIVITY_FETCH_FAILED,
      message: `Activity stream error: ${error}`,
      route: 'profile',
      context: { userId },
    });
  }, [error, userId]);

  // Filter out spin-related events that landed during the freeze
  // window. The freeze covers "spin reveal" events specifically
  // (spin_won + the pass_granted that mints a wheel reward), not
  // unrelated activity from other flows.
  const isFrozen = spinRevealFrozenUntil > 0 && Date.now() < spinRevealFrozenUntil;
  const visibleEvents = useMemo(() => {
    // Optional type filter — e.g. the Promos tab passes the promo-relevant
    // types so it only shows spins/claims/buys/wins, not every draft action.
    let evs = events.filter((e) => !HIDDEN_TYPES.has(e.type));
    if (filterTypes && filterTypes.length) {
      const allowed = new Set<ActivityEventType>(filterTypes);
      evs = evs.filter((e) => allowed.has(e.type));
    }
    if (!isFrozen) return evs;
    // Hide spin-related events arriving during the freeze window so
    // the wheel can land before the activity feed reveals the prize.
    return evs.filter((e) => {
      if (e.type !== 'spin_won' && e.type !== 'pass_granted') return true;
      const ms = e.createdAt ?? Date.parse(e.createdAtIso);
      // Events older than the freeze start are normal history — show them.
      const freezeStartedAt = spinRevealFrozenUntil - 6000; // ~SPIN_DURATION_MS + buffer
      return ms < freezeStartedAt;
    });
  }, [events, isFrozen, spinRevealFrozenUntil, filterTypes]);

  const grouped = useMemo(() => {
    const map = new Map<string, LiveActivityEvent[]>();
    for (const e of visibleEvents) {
      const ms = e.createdAt ?? Date.parse(e.createdAtIso);
      const key = Number.isFinite(ms) ? new Date(ms).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Unknown';
      const arr = map.get(key);
      if (arr) arr.push(e);
      else map.set(key, [e]);
    }
    return [...map.entries()];
  }, [visibleEvents]);

  return (
    <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white/40 text-[11px] font-semibold uppercase tracking-widest">{title}</h3>
        <div className="flex items-center gap-1.5 text-[10px] text-white/30">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-white/20'}`} />
          {isConnected ? 'Live' : 'Connecting…'}
        </div>
      </div>

      {visibleEvents.length === 0 ? (
        <p className="text-white/30 text-xs py-6 text-center">
          {emptyText}
        </p>
      ) : (
        <div className="space-y-4">
          {grouped.map(([date, items]) => (
            <div key={date}>
              <p className="text-white/25 text-[10px] uppercase tracking-widest mb-2">{date}</p>
              <div className="space-y-1.5">
                {items.map((e) => (
                  <ActivityRow key={e.id} event={e} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActivityRow({ event }: { event: LiveActivityEvent }) {
  const tx = event.txHash ? `https://basescan.org/tx/${event.txHash}` : null;
  const detail = describe(event);
  return (
    <div className="flex items-center gap-3 py-2 border-b border-white/[0.04] last:border-0">
      {/* Clean line-icon, muted grey — same language as the notification bell. */}
      <span className="flex-shrink-0 w-6 flex items-center justify-center">
        <LineIcon icon={iconFor(event)} color="rgba(255,255,255,0.55)" size={18} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className={`text-xs font-semibold ${TYPE_COLOR[event.type]}`}>{labelFor(event)}</p>
          <p className="text-white/20 text-[10px]">{formatWhen(event.createdAt, event.createdAtIso)}</p>
        </div>
        {detail && <p className="text-white/70 text-xs truncate">{detail}</p>}
      </div>
      {tx && (
        <a
          href={tx}
          target="_blank"
          rel="noreferrer"
          className="text-[10px] text-blue-300 hover:text-blue-200 underline underline-offset-2 flex-shrink-0"
        >
          Tx ↗
        </a>
      )}
    </div>
  );
}
