'use client';

import { useMemo, useState } from 'react';

import { useActivityStream, type LiveActivityEvent } from '@/hooks/useActivityStream';
import type { ActivityEventType, PaymentMethod, WalletType } from '@/lib/activityEvents';
import { WalletLink } from '@/components/admin/WalletLink';

const TYPE_LABEL: Record<ActivityEventType, string> = {
  pass_purchased: 'Pass purchased',
  pass_granted: 'Admin grant',
  spin_won: 'Spin prize',
  promo_claimed: 'Promo claimed',
  draft_entered: 'Draft entered',
  draft_filled: 'Draft filled',
  draft_left: 'Draft left',
  draft_won: 'Draft won',
  marketplace_sold: 'Marketplace sale',
  cashout_completed: 'Cashout completed',
  user_signed_up: 'New account',
  user_returned: 'Logged in',
};

const TYPE_COLOR: Record<ActivityEventType, string> = {
  pass_purchased: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
  pass_granted: 'text-[#F3E216] bg-yellow-500/10 border-yellow-500/30',
  spin_won: 'text-purple-300 bg-purple-500/10 border-purple-500/30',
  promo_claimed: 'text-pink-300 bg-pink-500/10 border-pink-500/30',
  draft_entered: 'text-blue-300 bg-blue-500/10 border-blue-500/30',
  draft_filled: 'text-teal-300 bg-teal-500/10 border-teal-500/30',
  draft_left: 'text-gray-300 bg-gray-500/10 border-gray-500/30',
  draft_won: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  marketplace_sold: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30',
  cashout_completed: 'text-green-300 bg-green-500/10 border-green-500/30',
  user_signed_up: 'text-banana bg-yellow-500/10 border-yellow-500/30',
  user_returned: 'text-indigo-300 bg-indigo-500/10 border-indigo-500/30',
};

/** NEW / OLD tag for presence events (signups + logins), read from the
 *  event's metadata. OLD = past-season player; NEW = first-season account.
 *  "1st" marks a user_returned that is the wallet's first tracked session. */
function PresenceChip({ e }: { e: LiveActivityEvent }) {
  if (e.type !== 'user_signed_up' && e.type !== 'user_returned') return null;
  const m = (e.metadata ?? {}) as { isReturning?: boolean; isNewAccount?: boolean; firstSession?: boolean };
  return (
    <span className="inline-flex items-center gap-1">
      {m.isReturning ? (
        <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-px rounded-full bg-sky-400/10 text-sky-300 border border-sky-400/20">Old</span>
      ) : m.isNewAccount ? (
        <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-px rounded-full bg-emerald-400/10 text-emerald-300 border border-emerald-400/20">New</span>
      ) : null}
      {e.type === 'user_returned' && m.firstSession && (
        <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-px rounded-full bg-white/[0.06] text-gray-300 border border-white/10" title="First tracked session for this wallet">1st</span>
      )}
    </span>
  );
}

const WALLET_TYPE_LABEL: Record<WalletType, string> = {
  privy_embedded: 'Privy (embedded)',
  privy_external: 'Privy + external',
  external_connect: 'External wallet',
  unknown: '—',
};

function shortWallet(v: string | null | undefined): string {
  if (!v) return '—';
  return v.length < 14 ? v : `${v.slice(0, 6)}…${v.slice(-4)}`;
}

function basescanTxUrl(hash: string | null): string | null {
  if (!hash) return null;
  return `https://basescan.org/tx/${hash}`;
}

function relativeTime(createdAt: number | null, iso: string): string {
  const ms = createdAt ?? Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const diff = Date.now() - ms;
  if (diff < 60_000) return `${Math.max(1, Math.round(diff / 1000))}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

type TypeFilter = 'all' | ActivityEventType;
type WalletFilter = 'all' | WalletType;
type PaymentFilter = 'all' | NonNullable<PaymentMethod>;

function eventMatchesFilters(
  e: LiveActivityEvent,
  type: TypeFilter,
  wallet: WalletFilter,
  payment: PaymentFilter,
  search: string,
): boolean {
  if (type !== 'all' && e.type !== type) return false;
  if (wallet !== 'all' && e.walletType !== wallet) return false;
  if (payment !== 'all' && e.paymentMethod !== payment) return false;
  if (search) {
    const q = search.toLowerCase();
    const haystack = [e.walletAddress, e.username ?? '', e.txHash ?? '', ...(e.tokenIds ?? [])].join(' ').toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}

export function LiveActivity({ enabled }: { enabled: boolean }) {
  const { events, isConnected, error } = useActivityStream(enabled ? '/api/admin/activity/stream' : null);

  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [walletFilter, setWalletFilter] = useState<WalletFilter>('all');
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(
    () => events.filter((e) => eventMatchesFilters(e, typeFilter, walletFilter, paymentFilter, search)),
    [events, typeFilter, walletFilter, paymentFilter, search],
  );

  const stats = useMemo(() => {
    const last24h = Date.now() - 24 * 60 * 60 * 1000;
    const recent = events.filter((e) => (e.createdAt ?? Date.parse(e.createdAtIso)) >= last24h);
    const by = (t: ActivityEventType) => recent.filter((e) => e.type === t);
    const purchased = by('pass_purchased');
    const purchasedTotal = purchased.reduce((s, e) => s + (Number(e.metadata?.totalPrice) || 0), 0);
    const revenueCurrency = (purchased[0]?.metadata?.currency as string) ?? 'USD';
    return {
      purchases: purchased.length,
      purchasedPasses: purchased.reduce((s, e) => s + e.quantity, 0),
      purchasedTotal,
      revenueCurrency,
      grants: by('pass_granted').length,
      spins: by('spin_won').length,
      promos: by('promo_claimed').length,
      signups: by('user_signed_up').length,
      returns: by('user_returned').length,
    };
  }, [events]);

  const csv = useMemo(() => {
    const header = [
      'time', 'type', 'userId', 'wallet', 'username', 'walletType', 'paymentMethod',
      'quantity', 'tokenIds', 'txHash', 'device', 'metadata',
    ].join(',');
    const rows = filtered.map((e) =>
      [
        e.createdAtIso,
        e.type,
        e.userId,
        e.walletAddress,
        (e.username ?? '').replace(/,/g, ' '),
        e.walletType,
        e.paymentMethod ?? '',
        e.quantity,
        (e.tokenIds ?? []).join('|'),
        e.txHash ?? '',
        e.devicePlatform,
        JSON.stringify(e.metadata ?? {}).replace(/,/g, ';'),
      ].map((v) => (typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : v)).join(','),
    );
    return [header, ...rows].join('\n');
  }, [filtered]);

  const downloadCsv = () => {
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sbs-activity-${new Date().toISOString().slice(0, 19)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  };

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <StatCard
          label="Purchases (24h)"
          value={stats.purchases.toString()}
          sub={`${stats.purchasedPasses} passes · $${stats.purchasedTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
        />
        <StatCard
          label="New accounts (24h)"
          value={stats.signups.toString()}
          sub={`${stats.returns} log-ins`}
        />
        <StatCard label="Admin grants (24h)" value={stats.grants.toString()} />
        <StatCard label="Spin prizes (24h)" value={stats.spins.toString()} />
        <StatCard label="Promos claimed (24h)" value={stats.promos.toString()} />
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
          <span className={`inline-block w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-red-500'}`} />
          {isConnected ? 'Live' : error ? 'Reconnecting…' : 'Connecting…'}
        </div>
        <Pill active={typeFilter === 'all'} onClick={() => setTypeFilter('all')}>All types</Pill>
        {(Object.keys(TYPE_LABEL) as ActivityEventType[]).map((t) => (
          <Pill key={t} active={typeFilter === t} onClick={() => setTypeFilter(t)}>{TYPE_LABEL[t]}</Pill>
        ))}
        <select
          value={walletFilter}
          onChange={(e) => setWalletFilter(e.target.value as WalletFilter)}
          className="rounded-md border border-white/[0.08] bg-black/40 text-xs text-gray-200 px-2 py-1.5"
        >
          <option value="all">All wallets</option>
          <option value="privy_embedded">Privy embedded</option>
          <option value="privy_external">Privy + external</option>
          <option value="external_connect">External connect</option>
        </select>
        <select
          value={paymentFilter}
          onChange={(e) => setPaymentFilter(e.target.value as PaymentFilter)}
          className="rounded-md border border-white/[0.08] bg-black/40 text-xs text-gray-200 px-2 py-1.5"
        >
          <option value="all">All payments</option>
          <option value="usdc">USDC</option>
          <option value="card">Card</option>
          <option value="free">Free</option>
        </select>
        <input
          type="search"
          placeholder="wallet, username, tx, token id…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-md border border-white/[0.08] bg-black/40 text-xs text-gray-200 px-2 py-1.5 min-w-[220px]"
        />
        <button
          onClick={downloadCsv}
          className="ml-auto rounded-md border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] text-xs text-gray-200 px-3 py-1.5"
          disabled={filtered.length === 0}
        >
          Export CSV ({filtered.length})
        </button>
      </div>

      {/* Events table */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-left text-sm min-w-[720px]">
          <thead className="bg-white/[0.03] text-[11px] uppercase text-gray-500 tracking-wider">
            <tr>
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Wallet</th>
              <th className="px-4 py-3 font-medium">Source</th>
              <th className="px-4 py-3 font-medium">Pay</th>
              <th className="px-4 py-3 font-medium text-right">Qty</th>
              <th className="px-4 py-3 font-medium">Tx</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-gray-500 text-xs">
                  {events.length === 0 ? 'Waiting for events…' : 'No events match the current filters'}
                </td>
              </tr>
            ) : (
              filtered.map((e) => {
                const tx = basescanTxUrl(e.txHash);
                return (
                  <tr key={e.id} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                    <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                      {relativeTime(e.createdAt, e.createdAtIso)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] border ${TYPE_COLOR[e.type]}`}>
                          {TYPE_LABEL[e.type]}
                        </span>
                        <PresenceChip e={e} />
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-200">{e.username ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-400">
                      <WalletLink wallet={e.walletAddress || ''} bare displayName={e.username ?? undefined} />
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {WALLET_TYPE_LABEL[e.walletType]} · {e.devicePlatform}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-300 capitalize">{e.paymentMethod ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-right text-gray-200">{e.quantity}</td>
                    <td className="px-4 py-3 text-xs">
                      {tx ? (
                        <a href={tx} target="_blank" rel="noreferrer" className="text-blue-300 hover:text-blue-200 underline underline-offset-2">
                          {shortWallet(e.txHash)}
                        </a>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wider text-gray-500">{label}</p>
      <p className="text-lg font-semibold text-white mt-0.5">{value}</p>
      {sub && <p className="text-[10px] text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-[11px] border transition-colors ${
        active
          ? 'bg-white/[0.08] border-white/[0.15] text-white'
          : 'bg-transparent border-white/[0.06] text-gray-400 hover:text-white hover:bg-white/[0.03]'
      }`}
    >
      {children}
    </button>
  );
}
