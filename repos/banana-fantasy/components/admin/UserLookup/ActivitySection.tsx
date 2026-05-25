'use client';

/**
 * Per-user activity section — the comprehensive lifetime breakdown.
 *
 * Boris's spec (May 2026):
 *   "want way more data and info for the user. how much prizes they won.
 *    do they have money in their account. all their txns their history.
 *    clickable category filters to drill in. organized super clean."
 *
 * Layout (clean Apple-style, no graphs):
 *   1. Lifetime tiles — 8 big-number squares: spend, free drafts won,
 *      jackpot/HOF wins, promos done, drafts entered, draft wins,
 *      cashouts, spins
 *   2. Wheel wins by prize — table: prize / count
 *   3. Promos done by type — table: type / count
 *   4. Recent activity — chronological list with CLICKABLE filter chips
 *      across the top (All · Purchases · Grants · Spins · Promos · Drafts
 *      · Cashouts). Default: All. Filter narrows the visible list.
 */

import { useMemo, useState } from 'react';
import { isSectionFail } from '@/hooks/admin/useUserLookup';

interface RawEvent {
  id?: string;
  type?: string;
  eventType?: string;
  createdAt?: number | string | null;
  createdAtIso?: string;
  timestamp?: string;
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

/** Filter chips at top of the activity timeline → groups of event types. */
type FilterKey = 'all' | 'purchases' | 'grants' | 'spins' | 'promos' | 'drafts' | 'cashouts';
const FILTERS: { key: FilterKey; label: string; types: string[] }[] = [
  { key: 'all', label: 'All', types: [] },
  { key: 'purchases', label: 'Purchases', types: ['pass_purchased'] },
  { key: 'grants', label: 'Grants', types: ['pass_granted'] },
  { key: 'spins', label: 'Spins', types: ['spin_won'] },
  { key: 'promos', label: 'Promos', types: ['promo_claimed'] },
  { key: 'drafts', label: 'Drafts', types: ['draft_entered', 'draft_left', 'draft_won'] },
  { key: 'cashouts', label: 'Cashouts', types: ['cashout_completed', 'withdrawal_requested', 'withdrawal_paid', 'marketplace_sold'] },
];

interface Props {
  activity: Record<string, unknown>[] | { ok: false; reason: string };
  /**
   * Canonical per-user promo claim counts (sum of claimCount across
   * the user's promo subcollection). When present, overrides the
   * event-derived numbers below — activity events drop claims for
   * heavy users (Boris caught it: 9 mint claims in claimCount, only
   * 2 in activity events).
   */
  promoState?:
    | {
        byType: Record<string, number>;
        totalClaims: number;
        startedTypes: string[];
        completedTypes: string[];
        pendingTypes: string[];
      }
    | { ok: false; reason: string };
}

export function ActivitySection({ activity, promoState }: Props) {
  // Hooks must run unconditionally — pull events out before any early
  // return. Section-fail just leaves events empty.
  const [filter, setFilter] = useState<FilterKey>('all');
  const failed = isSectionFail(activity);
  const events: RawEvent[] = failed ? [] : (activity as RawEvent[]);

  // Lifetime aggregations — computed once per event list.
  const stats = useMemo(() => {
    const out = {
      spendUsd: 0,
      freeDraftsWon: 0,
      jackpotWins: 0,
      hofWins: 0,
      spinsWon: 0,
      promosClaimed: 0,
      passesPurchased: 0,
      passesGranted: 0,
      draftsEntered: 0,
      draftsLeft: 0,
      draftsWon: 0,
      draftWinningsUsd: 0,
      cashoutsCompleted: 0,
      cashoutsUsd: 0,
      lastActivityIso: '',
      firstActivityIso: '',
      promoBreakdown: new Map<string, number>(),
      wheelPrizeBreakdown: new Map<string, number>(),
    };
    for (const e of events) {
      const t = eventTypeOf(e);
      const meta = metaOf(e);
      const iso = isoOf(e) ?? '';
      if (iso > out.lastActivityIso) out.lastActivityIso = iso;
      if (!out.firstActivityIso || iso < out.firstActivityIso) out.firstActivityIso = iso;
      switch (t) {
        case 'pass_purchased': {
          out.passesPurchased += Number(meta.quantity ?? 1);
          const price = Number(meta.totalPrice);
          if (Number.isFinite(price)) out.spendUsd += price;
          break;
        }
        case 'pass_granted':
          out.passesGranted += Number(meta.quantity ?? meta.draftPassesAdded ?? 1);
          break;
        case 'spin_won': {
          out.spinsWon += 1;
          const prizeType = String(meta.prizeType ?? '');
          const prizeValue = meta.prizeValue;
          let label = String(meta.segmentLabel ?? 'unknown');
          if (prizeType === 'draft_pass' && Number.isFinite(Number(prizeValue))) {
            const v = Number(prizeValue);
            out.freeDraftsWon += v;
            label = `${v} free draft${v === 1 ? '' : 's'}`;
          } else if (prizeType === 'custom' && prizeValue === 'jackpot') {
            out.jackpotWins += 1;
            label = 'Jackpot entry';
          } else if (prizeType === 'custom' && prizeValue === 'hof') {
            out.hofWins += 1;
            label = 'HOF entry';
          }
          out.wheelPrizeBreakdown.set(label, (out.wheelPrizeBreakdown.get(label) ?? 0) + 1);
          break;
        }
        case 'promo_claimed': {
          // Event-derived count — reconciled at the end with the
          // canonical claimCount sum via max() so single-claim and
          // multi-claim promos both report correctly.
          out.promosClaimed += 1;
          const promoType = String(meta.promoType ?? 'unknown');
          out.promoBreakdown.set(promoType, (out.promoBreakdown.get(promoType) ?? 0) + 1);
          break;
        }
        case 'draft_entered':
          out.draftsEntered += 1;
          break;
        case 'draft_left':
          out.draftsLeft += 1;
          break;
        case 'draft_won': {
          out.draftsWon += 1;
          const amt = Number(meta.amount);
          if (Number.isFinite(amt)) out.draftWinningsUsd += amt;
          break;
        }
        case 'cashout_completed': {
          out.cashoutsCompleted += 1;
          const val = Number(meta.settledUsd ?? meta.amount);
          if (Number.isFinite(val)) out.cashoutsUsd += val;
          break;
        }
      }
    }
    // Reconcile promo counts: take max(claimCount sum, event-derived).
    // Multi-claim promos (mint, daily-drafts) → claimCount wins.
    // Single-claim promos (new-user, referral) → event count wins
    // (claimCount stays 0 because the promo uses claimable:true→false
    // semantics instead of bumping a counter). See
    // lib/admin/metricSources.ts.
    if (promoState && !isSectionFail(promoState)) {
      out.promosClaimed = Math.max(out.promosClaimed, promoState.totalClaims);
      // Per-type breakdown: union of both, taking max per key.
      for (const [t, n] of Object.entries(promoState.byType)) {
        const cur = out.promoBreakdown.get(t) ?? 0;
        if (n > cur) out.promoBreakdown.set(t, n);
      }
    }
    return out;
  }, [events, promoState]);

  // Filtered timeline
  const visible = useMemo(() => {
    if (filter === 'all') return events;
    const allowed = new Set(FILTERS.find((f) => f.key === filter)?.types ?? []);
    return events.filter((e) => allowed.has(eventTypeOf(e)));
  }, [events, filter]);

  const sortedVisible = useMemo(
    () => [...visible].sort((a, b) => (isoOf(b) || '').localeCompare(isoOf(a) || '')),
    [visible],
  );

  if (failed) {
    return (
      <section className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.04] px-5 py-4">
        <h3 className="text-sm font-semibold text-amber-300">Activity unavailable</h3>
        <p className="mt-1 text-xs text-gray-400">
          {(activity as { ok: false; reason: string }).reason}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      {/* Lifetime tiles — 8 squares */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Tile label="Total spend" value={`$${stats.spendUsd.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`} accent="text-emerald-300" />
        <Tile label="Free drafts won" value={stats.freeDraftsWon} accent="text-purple-300" />
        <Tile label="Jackpot wins" value={stats.jackpotWins} accent="text-red-300" />
        <Tile label="HOF wins" value={stats.hofWins} accent="text-[#D4AF37]" />
        <Tile label="Promos claimed" value={stats.promosClaimed} accent="text-pink-300" />
        <Tile label="Drafts entered" value={stats.draftsEntered} />
        <Tile label="Draft wins" value={`${stats.draftsWon} · $${stats.draftWinningsUsd.toLocaleString()}`} accent="text-amber-300" />
        <Tile label="Cashouts" value={`${stats.cashoutsCompleted} · $${stats.cashoutsUsd.toLocaleString()}`} accent="text-green-300" />
      </div>

      {/* Wheel prize breakdown table */}
      {stats.wheelPrizeBreakdown.size > 0 && (
        <Card>
          <Header title="Wheel wins by prize" sub={`${stats.spinsWon} total spins won`} />
          <Table
            rows={[...stats.wheelPrizeBreakdown.entries()].sort((a, b) => b[1] - a[1])}
            accentFor={(label) => /jackpot/i.test(label) ? 'text-red-300' : /hof/i.test(label) ? 'text-[#D4AF37]' : 'text-purple-300'}
          />
        </Card>
      )}

      {/* Promo breakdown table */}
      {stats.promoBreakdown.size > 0 && (
        <Card>
          <Header title="Promos claimed by type" sub={`${stats.promosClaimed} total`} />
          <Table
            rows={[...stats.promoBreakdown.entries()].sort((a, b) => b[1] - a[1])}
            accentFor={() => 'text-pink-300'}
            capitalize
          />
        </Card>
      )}

      {/* Recent activity with filter chips */}
      <Card>
        <Header
          title="Recent activity"
          sub={`${events.length} event${events.length === 1 ? '' : 's'} on file · ${sortedVisible.length} shown`}
        />
        {/* Clickable filter chips. Boris's ask: "i should be able to click
            into the specific categories to go deeper into things." */}
        <div className="flex items-center gap-1.5 px-5 py-2 border-b border-white/[0.06] overflow-x-auto">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] border transition-colors ${
                  active
                    ? 'bg-banana text-black border-banana font-semibold'
                    : 'border-white/[0.08] text-gray-400 hover:text-white hover:border-white/[0.20]'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
        {sortedVisible.length === 0 ? (
          <p className="px-5 py-6 text-center text-xs text-gray-500">
            {events.length === 0
              ? 'No activity events found for this wallet.'
              : `No ${filter} events.`}
          </p>
        ) : (
          <ul className="divide-y divide-white/[0.04] max-h-96 overflow-y-auto">
            {sortedVisible.slice(0, 50).map((e, i) => {
              const t = eventTypeOf(e);
              const label = EVENT_LABEL[t] ?? t;
              const color = EVENT_COLOR[t] ?? 'text-gray-300';
              const tx = e.txHash ? `https://basescan.org/tx/${e.txHash}` : null;
              const detail = describeEvent(e);
              return (
                <li key={e.id ?? i} className="flex items-center gap-3 px-5 py-2 text-xs">
                  <span className={`shrink-0 font-semibold ${color} w-32 truncate`}>{label}</span>
                  {detail && <span className="text-gray-400 truncate flex-1">{detail}</span>}
                  {!detail && <span className="flex-1" />}
                  <span className="shrink-0 text-gray-500 tabular-nums">{fmtWhen(isoOf(e))}</span>
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
      </Card>
    </section>
  );
}

/* ─── Primitives ──────────────────────────────────────────────────── */

function Tile({ label, value, accent = 'text-white' }: { label: string; value: number | string; accent?: string }) {
  const display = typeof value === 'number' ? value.toLocaleString() : value;
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-[0.1em] text-gray-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${accent}`}>{display}</p>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02]">{children}</div>;
}

function Header({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="px-5 py-3 border-b border-white/[0.06] flex items-baseline justify-between gap-2">
      <h4 className="text-sm font-semibold text-white">{title}</h4>
      {sub && <p className="text-[11px] text-gray-500">{sub}</p>}
    </div>
  );
}

function Table({
  rows,
  accentFor,
  capitalize,
}: {
  rows: [string, number][];
  accentFor: (label: string) => string;
  capitalize?: boolean;
}) {
  const total = rows.reduce((s, [, n]) => s + n, 0);
  return (
    <table className="w-full text-sm">
      <tbody className="tabular-nums">
        {rows.map(([label, count]) => (
          <tr key={label} className="border-t border-white/[0.04]">
            <td className={`px-5 py-1.5 ${accentFor(label)} ${capitalize ? 'capitalize' : ''}`}>{label.replace(/_/g, ' ').replace(/-/g, ' ')}</td>
            <td className="py-1.5 text-right text-gray-200">{count.toLocaleString()}</td>
            <td className="px-5 py-1.5 text-right text-[11px] text-gray-500">{total > 0 ? `${((count / total) * 100).toFixed(1)}%` : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

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
