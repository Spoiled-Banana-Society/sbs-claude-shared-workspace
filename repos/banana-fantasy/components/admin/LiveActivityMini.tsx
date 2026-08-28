'use client';

/**
 * Live Activity, pocket edition: the last 5 things that happened, as a
 * slim card that reads on a phone (Richard 2026-08-22). Lives under the
 * Fast Drafts box on the admin Drafts tab. Same SSE stream the full Live
 * Activity tab uses — no extra polling, no filters, no flag lookups.
 * "See all" jumps to the full tab.
 */

import Link from 'next/link';

import { useActivityStream, type LiveActivityEvent } from '@/hooks/useActivityStream';
import { TYPE_COLOR, typeLabelFor, relativeTime } from '@/components/admin/LiveActivity';
import { bananaPlaceholderName } from '@/utils/helpers';

const MAX_ROWS = 10;

/** Per-event detail, split so REAL MONEY renders loud (banana, bold) and the
 *  rest stays quiet gray. Everything here comes off the event doc already in
 *  the stream — richer rows cost zero extra reads (Boris 2026-08-28). */
function detailFor(e: LiveActivityEvent): { money: string | null; text: string } {
  const m = e.metadata ?? {};
  switch (e.type) {
    case 'pass_purchased': {
      const total = Number(m.totalPrice);
      return {
        money: total > 0 ? `$${total.toFixed(0)}` : null,
        text: `${e.quantity} pass${e.quantity === 1 ? '' : 'es'} · ${e.paymentMethod === 'card' ? 'card' : 'USDC'}`,
      };
    }
    case 'deposit_completed':
      return {
        money: typeof m.amountUsd === 'number' ? `$${(m.amountUsd as number).toFixed(2)}` : null,
        text: 'deposit · card',
      };
    case 'pass_granted':
      return { money: null, text: `${e.quantity} pass${e.quantity === 1 ? '' : 'es'} granted` };
    case 'spin_won': {
      const prize = String(m.prizeLabel ?? m.prizeType ?? m.prize ?? '');
      const val = Number(m.prizeValue ?? m.amount);
      return { money: null, text: [prize, val > 1 ? `×${val}` : ''].filter(Boolean).join(' ') };
    }
    case 'user_signed_up': {
      const how = String(m.loginMethod ?? e.walletType ?? '');
      return { money: null, text: how ? `via ${how}` : '' };
    }
    case 'draft_entered':
    case 'draft_filled':
    case 'draft_left': {
      const pass = m.passType ? String(m.passType) : '';
      const league = m.leagueId ? String(m.leagueId) : '';
      return { money: null, text: [pass, league].filter(Boolean).join(' · ') };
    }
    case 'marketplace_sold':
    case 'marketplace_bought': {
      const price = Number(m.priceUsd ?? m.price);
      return { money: price > 0 ? `$${price.toFixed(0)}` : null, text: '' };
    }
    default:
      return { money: null, text: '' };
  }
}

export function LiveActivityMini({ enabled }: { enabled: boolean }) {
  const { events, isConnected } = useActivityStream(enabled ? '/api/admin/activity/stream' : null);
  const rows = events.slice(0, MAX_ROWS);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <div className="px-4 py-2 bg-white/[0.03] border-b border-white/[0.04] flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-wider text-gray-500 font-medium">
          <span className={`h-1.5 w-1.5 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-gray-600'}`} aria-hidden />
          Live Activity
        </span>
        <Link href="/admin?tab=activity" className="text-[11px] text-gray-400 hover:text-white transition-colors whitespace-nowrap">
          See all →
        </Link>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-center text-gray-500 text-xs">
          {isConnected ? 'Waiting for events…' : 'Connecting…'}
        </div>
      ) : (
        <ul className="divide-y divide-white/[0.04]">
          {rows.map((e) => {
            const name = e.username ?? (e.walletAddress ? bananaPlaceholderName(e.walletAddress) : '—');
            const detail = detailFor(e);
            return (
              <li key={e.id} className="px-4 py-2.5 flex items-center gap-3 min-w-0">
                <span className="shrink-0 w-12 text-[11px] text-gray-500 tabular-nums whitespace-nowrap">
                  {relativeTime(e.createdAt, e.createdAtIso)}
                </span>
                <span className={`shrink-0 inline-flex rounded-full px-2 py-0.5 text-[11px] border whitespace-nowrap ${TYPE_COLOR[e.type]}`}>
                  {typeLabelFor(e)}
                </span>
                <span className="min-w-0 flex-1 flex items-baseline gap-2 text-xs">
                  <Link
                    href={`/admin?tab=user-lookup&wallet=${encodeURIComponent(e.walletAddress || '')}`}
                    className="truncate text-gray-200 hover:text-white"
                  >
                    {name}
                  </Link>
                  {detail.money && <span className="shrink-0 text-banana font-bold tabular-nums">{detail.money}</span>}
                  {detail.text && <span className="truncate text-gray-500">{detail.text}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
