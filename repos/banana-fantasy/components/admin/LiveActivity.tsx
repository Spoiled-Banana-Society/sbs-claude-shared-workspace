'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { usePrivy } from '@privy-io/react-auth';

import { useActivityStream, type LiveActivityEvent } from '@/hooks/useActivityStream';
import type { ActivityEventType, PaymentMethod, WalletType } from '@/lib/activityEvents';
import { WalletLink } from '@/components/admin/WalletLink';
import { bananaDefaultName } from '@/utils/helpers';

const TYPE_LABEL: Record<ActivityEventType, string> = {
  pass_purchased: 'Pass purchased',
  pass_granted: 'Pass granted',
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

/** pass_granted covers three real sources — label by which one it was.
 *  (It used to blanket-say "Admin grant", making every wheel-prize mint look
 *  like a manual freebie — Boris 2026-07-03.) */
function typeLabelFor(e: LiveActivityEvent): string {
  if (e.type === 'pass_granted') {
    const s = String(e.metadata?.source ?? '');
    if (s === 'wheel_spin_mint') return 'Wheel prize mint';
    if (s === 'card_fee_reward') return 'Credit reward';
    if (e.metadata?.adminActor) return 'Admin grant';
    return 'Pass granted';
  }
  return TYPE_LABEL[e.type];
}

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

interface UserFlags {
  isNew: boolean;
  isReturning: boolean;
  createdAt?: string | null;
  name?: string | null;
}

/** NEW / OLD account tag rendered beside every user in the feed. */
function AccountChip({ flags }: { flags?: UserFlags }) {
  if (!flags) return null;
  if (flags.isReturning) {
    return (
      <span title="Returning player — matched a past-season identity" className="text-[9px] font-black uppercase tracking-widest px-1.5 py-px rounded-full bg-sky-400/10 text-sky-300 border border-sky-400/20">Old</span>
    );
  }
  if (flags.isNew) {
    return (
      <span title={`New user — first-season account${flags.createdAt ? ` — created ${new Date(flags.createdAt).toLocaleString()}` : ''}`} className="text-[9px] font-black uppercase tracking-widest px-1.5 py-px rounded-full bg-emerald-400/10 text-emerald-300 border border-emerald-400/20">New</span>
    );
  }
  return null;
}

const FLAGS_CHUNK = 100; // server caps at 120/request

interface StatsBucket {
  purchases: number; passesBought: number; purchaseUsd: number;
  newAccounts: number; logins: number;
  spins: number; freeDraftsWonFromSpins: number; jpPassesFromSpins: number; hofPassesFromSpins: number;
  draftsFilled: number; draftEntries: number; promosClaimed: number;
}
interface ActivityStats { dayStartIso: string; today: StatsBucket; total: StatsBucket }

const STATS_POLL_MS = 45_000;

/** Read a filter's initial value from the URL so refresh keeps the view. */
function urlParam(key: string): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(key);
}

/** Write filters into the URL (replaceState — no nav, survives refresh/share). */
function persistFiltersToUrl(entries: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(entries)) {
    if (v && v !== 'all' && v !== '') params.set(k, v);
    else params.delete(k);
  }
  // No-op when nothing changed. Critical: this used to fire on MOUNT too,
  // re-writing the URL from a location snapshot taken mid tab-switch (the
  // router.replace hadn't committed yet) — which resurrected the PREVIOUS
  // tab= into the URL and the admin shell then yanked the user to that tab
  // (Boris: "i hit pass purchased and switch tabs, it takes me to the draft
  // page"). The mount-skip lives at the call site; this equality check is
  // the second seatbelt.
  const next = params.toString();
  if (next === new URLSearchParams(window.location.search).toString()) return;
  window.history.replaceState(null, '', `${window.location.pathname}?${next}`);
}

export function LiveActivity({ enabled, hideStats }: { enabled: boolean; hideStats?: boolean }) {
  const { events, isConnected, error } = useActivityStream(enabled ? '/api/admin/activity/stream' : null);
  const { getAccessToken } = usePrivy();

  // Ref the token getter so effects keyed on data never refire on Privy
  // re-renders. See render-loop rule (CLAUDE.md Rule #0).
  const getAccessTokenRef = useRef(getAccessToken);
  useEffect(() => { getAccessTokenRef.current = getAccessToken; }, [getAccessToken]);

  // Filters init from the URL and write back on change — refreshing the page
  // keeps the exact view (Boris 2026-07-03: "if I refresh I should still be
  // in the tab"). Tab + sub-tab were already URL-synced; this covers the pills.
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(() => (urlParam('type') as TypeFilter) || 'all');
  const [walletFilter, setWalletFilter] = useState<WalletFilter>(() => (urlParam('walletType') as WalletFilter) || 'all');
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>(() => (urlParam('pay') as PaymentFilter) || 'all');
  const [search, setSearch] = useState(() => urlParam('q') || '');
  // Persist ONLY after a real filter change — never on mount. The mount run
  // raced the admin shell's router.replace during tab switches and rewrote
  // the URL with the previous tab's params (see persistFiltersToUrl).
  const filtersTouchedRef = useRef(false);
  useEffect(() => {
    if (!filtersTouchedRef.current) { filtersTouchedRef.current = true; return; }
    persistFiltersToUrl({ type: typeFilter, walletType: walletFilter, pay: paymentFilter, q: search });
  }, [typeFilter, walletFilter, paymentFilter, search]);

  // Accurate day/total stats from the server (the live window only holds the
  // latest ~100 events — computing cards from it undercounted, e.g. "7
  // purchases (24h)" when the real day had far more). Polled + nudged by
  // fresh live events (throttled to one refetch per 5s).
  const [stats, setStats] = useState<ActivityStats | null>(null);
  const statsFetchingRef = useRef(false);
  const lastStatsFetchRef = useRef(0);
  const fetchStats = async () => {
    if (statsFetchingRef.current) return;
    if (Date.now() - lastStatsFetchRef.current < 5_000) return;
    statsFetchingRef.current = true;
    lastStatsFetchRef.current = Date.now();
    try {
      const token = await getAccessTokenRef.current();
      const res = await fetch('/api/admin/activity/stats', {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (res.ok) setStats(await res.json() as ActivityStats);
    } catch { /* keep last-known stats */ } finally {
      statsFetchingRef.current = false;
    }
  };
  const fetchStatsRef = useRef(fetchStats);
  fetchStatsRef.current = fetchStats;
  useEffect(() => {
    if (!enabled) return;
    void fetchStatsRef.current();
    const t = setInterval(() => { void fetchStatsRef.current(); }, STATS_POLL_MS);
    return () => clearInterval(t);
  }, [enabled]);
  // New live event → the day numbers just changed → refresh (throttled above).
  const latestEventId = events[0]?.id ?? '';
  useEffect(() => {
    if (!enabled || !latestEventId) return;
    void fetchStatsRef.current();
  }, [enabled, latestEventId]);

  // Full history on demand: the live stream only carries the latest 100
  // events, so older rows (e.g. every pass purchase ever) scroll out of
  // the window. "Load full history" fetches the complete record once and
  // merges it under the live rows — live events keep streaming on top.
  const [history, setHistory] = useState<LiveActivityEvent[] | null>(null);
  const [historyState, setHistoryState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [historyExhaustive, setHistoryExhaustive] = useState(true);
  const loadHistory = async () => {
    setHistoryState('loading');
    try {
      const token = await getAccessToken();
      const res = await fetch('/api/admin/activity/history?type=all', {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const body = (await res.json()) as { events?: LiveActivityEvent[]; exhaustive?: boolean };
      setHistory(body.events ?? []);
      setHistoryExhaustive(body.exhaustive !== false);
      setHistoryState('loaded');
    } catch {
      setHistoryState('error');
    }
  };

  // Live events win on id collision (they're fresher); history fills in
  // everything older than the stream window.
  const allEvents = useMemo(() => {
    if (!history) return events;
    const seen = new Set(events.map((e) => e.id));
    const merged = [...events, ...history.filter((e) => !seen.has(e.id))];
    merged.sort((a, b) => (b.createdAt ?? Date.parse(b.createdAtIso)) - (a.createdAt ?? Date.parse(a.createdAtIso)));
    return merged;
  }, [events, history]);

  // Canonical CURRENT name + NEW/OLD flags for every wallet in view. Events
  // snapshot the username at write time, which goes stale after renames and
  // misses names edited only on the Go profile — resolve live via the admin
  // flags endpoint (same v2 → Go → banana chain user surfaces use). Keyed on
  // the sorted wallet set; merged so known entries never flicker out.
  const [flagsMap, setFlagsMap] = useState<Record<string, UserFlags>>({});
  const walletKey = useMemo(
    () => [...new Set(allEvents.map((e) => (e.walletAddress || '').toLowerCase()).filter((w) => /^0x[0-9a-f]{40}$/.test(w)))].sort().join(','),
    [allEvents],
  );
  useEffect(() => {
    if (!enabled || !walletKey) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessTokenRef.current();
        const wallets = walletKey.split(',');
        const chunks: string[][] = [];
        for (let i = 0; i < wallets.length; i += FLAGS_CHUNK) chunks.push(wallets.slice(i, i + FLAGS_CHUNK));
        const results = await Promise.all(chunks.map(async (chunk) => {
          const res = await fetch('/api/admin/user-flags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify({ wallets: chunk }),
          });
          if (!res.ok) return {};
          return ((await res.json()) as { flags?: Record<string, UserFlags> }).flags ?? {};
        }));
        if (!cancelled) setFlagsMap((prev) => Object.assign({}, prev, ...results));
      } catch { /* cosmetic — stored names still render */ }
    })();
    return () => { cancelled = true; };
  }, [enabled, walletKey]);

  const filtered = useMemo(
    () => allEvents.filter((e) => eventMatchesFilters(e, typeFilter, walletFilter, paymentFilter, search)),
    [allEvents, typeFilter, walletFilter, paymentFilter, search],
  );

  const dayLabel = useMemo(() => {
    if (!stats?.dayStartIso) return 'Today';
    const d = new Date(stats.dayStartIso);
    return `Today (since ${d.toLocaleTimeString('en-US', { hour: 'numeric', timeZone: 'America/Los_Angeles' })} PT)`;
  }, [stats?.dayStartIso]);

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
      {/* Day (3am-PT boundary) + since-launch totals, computed server-side
          over the FULL event record — never the 100-event live window.
          Hidden when embedded in the Dashboard (it renders its own band). */}
      {!hideStats && <>
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">{dayLabel}</p>
        <p className="text-[10px] text-gray-600">all-time = since launch (Jun 23) · live-updating</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        <StatCard
          label="Purchases"
          value={stats ? stats.today.purchases.toString() : '…'}
          sub={stats
            ? `${stats.today.passesBought} passes · $${stats.today.purchaseUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })} — all-time ${stats.total.passesBought} · $${stats.total.purchaseUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
            : 'loading'}
        />
        <StatCard
          label="New accounts"
          value={stats ? stats.today.newAccounts.toString() : '…'}
          sub={stats ? `${stats.today.logins} log-ins today — all-time ${stats.total.newAccounts}` : 'loading'}
        />
        <StatCard
          label="Spins"
          value={stats ? stats.today.spins.toString() : '…'}
          sub={stats ? `all-time ${stats.total.spins}` : 'loading'}
        />
        <StatCard
          label="Won from spins"
          value={stats ? stats.today.freeDraftsWonFromSpins.toString() : '…'}
          sub={stats
            ? `free drafts${(stats.today.jpPassesFromSpins + stats.today.hofPassesFromSpins) > 0 ? ` +${stats.today.jpPassesFromSpins}JP/${stats.today.hofPassesFromSpins}HOF` : ''} — all-time ${stats.total.freeDraftsWonFromSpins} (+${stats.total.jpPassesFromSpins}JP/${stats.total.hofPassesFromSpins}HOF)`
            : 'loading'}
        />
        <StatCard
          label="Drafts filled"
          value={stats ? stats.today.draftsFilled.toString() : '…'}
          sub={stats ? `${stats.today.draftEntries} seats entered — all-time ${stats.total.draftsFilled} filled` : 'loading'}
        />
        <StatCard
          label="Promos claimed"
          value={stats ? stats.today.promosClaimed.toString() : '…'}
          sub={stats ? `all-time ${stats.total.promosClaimed}` : 'loading'}
        />
      </div>
      </>}

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
          onClick={loadHistory}
          disabled={historyState === 'loading' || historyState === 'loaded'}
          className={`ml-auto rounded-md border text-xs px-3 py-1.5 transition ${
            historyState === 'loaded'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 cursor-default'
              : 'border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] text-gray-200'
          }`}
        >
          {historyState === 'loaded'
            ? (historyExhaustive ? '✓ Full history loaded' : '✓ History loaded (last 1,000)')
            : historyState === 'loading' ? 'Loading history…'
            : historyState === 'error' ? 'Retry full history'
            : 'Load full history'}
        </button>
        <button
          onClick={downloadCsv}
          className="rounded-md border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] text-xs text-gray-200 px-3 py-1.5"
          disabled={filtered.length === 0}
        >
          Export CSV ({filtered.length})
        </button>
      </div>

      {/* Filtered-purchases rollup — the "how much have we actually sold"
          line. Only when the purchases filter is active. */}
      {typeFilter === 'pass_purchased' && filtered.length > 0 && (
        <p className="text-[11px] text-gray-400">
          {filtered.length} purchase{filtered.length === 1 ? '' : 's'}
          {' · '}{filtered.reduce((s, e) => s + e.quantity, 0)} passes
          {' · '}${filtered.reduce((s, e) => s + (Number(e.metadata?.totalPrice) || 0), 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} total
          {history === null && <span className="text-gray-600"> — live window only; use “Load full history” for all-time</span>}
        </p>
      )}

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
                          {typeLabelFor(e)}
                        </span>
                        <PresenceChip e={e} />
                      </span>
                    </td>
                    {/* Live canonical name (v2 → Go profile → banana default)
                        + NEW/OLD account chip on every row. Falls back to the
                        event's stored snapshot until flags resolve. */}
                    <td className="px-4 py-3 text-xs text-gray-200">
                      <span className="inline-flex items-center gap-1.5">
                        {flagsMap[(e.walletAddress || '').toLowerCase()]?.name
                          ?? e.username
                          ?? (e.walletAddress ? bananaDefaultName(e.walletAddress) : '—')}
                        <AccountChip flags={flagsMap[(e.walletAddress || '').toLowerCase()]} />
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-400">
                      <WalletLink
                        wallet={e.walletAddress || ''}
                        bare
                        displayName={flagsMap[(e.walletAddress || '').toLowerCase()]?.name ?? e.username ?? (e.walletAddress ? bananaDefaultName(e.walletAddress) : undefined)}
                      />
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
