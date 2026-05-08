'use client';

import { useMemo } from 'react';

import { useActivityStream, type LiveActivityEvent } from '@/hooks/useActivityStream';
import type { ActivityEventType } from '@/lib/activityEvents';

const TYPE_LABEL: Record<ActivityEventType, string> = {
  pass_purchased: 'Purchased',
  pass_granted: 'Granted',
  spin_won: 'Won on wheel',
  promo_claimed: 'Promo claim',
  draft_entered: 'Entered draft',
  draft_left: 'Left draft',
  draft_won: 'Draft win',
  marketplace_sold: 'Sold',
  cashout_completed: 'Cashed out',
};

const TYPE_EMOJI: Record<ActivityEventType, string> = {
  pass_purchased: '💳',
  pass_granted: '🎁',
  spin_won: '🎡',
  promo_claimed: '🎯',
  draft_entered: '🏟️',
  draft_left: '↩️',
  draft_won: '🏆',
  marketplace_sold: '💰',
  cashout_completed: '💸',
};

const TYPE_COLOR: Record<ActivityEventType, string> = {
  pass_purchased: 'text-emerald-300',
  pass_granted: 'text-[#F3E216]',
  spin_won: 'text-purple-300',
  promo_claimed: 'text-pink-300',
  draft_entered: 'text-blue-300',
  draft_left: 'text-gray-400',
  draft_won: 'text-amber-300',
  marketplace_sold: 'text-cyan-300',
  cashout_completed: 'text-green-300',
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
    case 'pass_granted':
      return `${e.quantity} free draft pass${e.quantity !== 1 ? 'es' : ''} from admin`;
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
    case 'draft_entered':
      return `Entered draft ${String(e.metadata?.leagueId ?? '').slice(0, 16) || ''}`;
    case 'draft_won': {
      const amount = Number(e.metadata?.amount);
      return Number.isFinite(amount) ? `Won $${amount.toLocaleString()}` : 'Draft win';
    }
    case 'marketplace_sold': {
      const price = Number(e.metadata?.price);
      return Number.isFinite(price) ? `Sold for $${price.toLocaleString()}` : 'Marketplace sale';
    }
    case 'cashout_completed': {
      const amount = Number(e.metadata?.amount);
      const rail = String(e.metadata?.rail ?? '');
      const railLabel =
        rail === 'coinbase_offramp' ? 'to bank via Coinbase'
        : rail === 'direct_usdc' ? 'to USDC wallet'
        : rail === 'direct_bank' ? 'to bank'
        : '';
      const amountStr = Number.isFinite(amount) ? `$${amount.toLocaleString()}` : 'Cashout';
      return `${amountStr}${railLabel ? ` ${railLabel}` : ''}`;
    }
    default:
      return String(e.type);
  }
}

export function ActivityHistory({ userId }: { userId: string | null }) {
  const url = userId ? `/api/user/activity/stream?userId=${encodeURIComponent(userId.toLowerCase())}` : null;
  const { events, isConnected } = useActivityStream(url);

  const grouped = useMemo(() => {
    const map = new Map<string, LiveActivityEvent[]>();
    for (const e of events) {
      const ms = e.createdAt ?? Date.parse(e.createdAtIso);
      const key = Number.isFinite(ms) ? new Date(ms).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Unknown';
      const arr = map.get(key);
      if (arr) arr.push(e);
      else map.set(key, [e]);
    }
    return [...map.entries()];
  }, [events]);

  return (
    <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white/40 text-[11px] font-semibold uppercase tracking-widest">Activity History</h3>
        <div className="flex items-center gap-1.5 text-[10px] text-white/30">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-white/20'}`} />
          {isConnected ? 'Live' : 'Connecting…'}
        </div>
      </div>

      {events.length === 0 ? (
        <p className="text-white/30 text-xs py-6 text-center">
          Your purchases, wins, and promo claims will show up here.
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
  return (
    <div className="flex items-center gap-3 py-2 border-b border-white/[0.04] last:border-0">
      <span className="text-base flex-shrink-0 w-6 text-center">{TYPE_EMOJI[event.type]}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className={`text-xs font-semibold ${TYPE_COLOR[event.type]}`}>{TYPE_LABEL[event.type]}</p>
          <p className="text-white/20 text-[10px]">{formatWhen(event.createdAt, event.createdAtIso)}</p>
        </div>
        <p className="text-white/70 text-xs truncate">{describe(event)}</p>
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
