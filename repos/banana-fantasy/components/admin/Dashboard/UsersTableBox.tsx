'use client';

/**
 * Every-user table on the admin dashboard.
 *
 * Boris's spec: "i want a database with users their wallets and name
 * showcasing how many promos theyve done. how many spins how many
 * claimed. how many didnt even do any promos. how many are just in
 * limbo. every user new user that joins → table at the bottom →
 * filter to see who drafted a lot but never did a promo etc."
 *
 * One source of truth: /api/admin/users-aggregate. Filters + search +
 * sort all run client-side because SBS user count fits in memory
 * comfortably (~200 today, several thousand in a few years).
 *
 * Filter chips:
 *   - All                — every user
 *   - Drafters w/o promo — entered ≥1 draft, never claimed a promo
 *   - Promo in limbo     — started a multi-step promo, didn't finish
 *   - Big spenders       — spent ≥ $1
 *   - Never logged back  — zero logins recorded beyond signup
 *
 * Sortable columns: spend · drafts · spins · promos claimed · signup.
 */

import { useMemo, useState } from 'react';
import { useUsersAggregate, type AggregateUser } from '@/hooks/admin/useAdminApi';
import { WalletLink } from '@/components/admin/WalletLink';

/**
 * Avatar — three-tier fallback, in this order:
 *   1. user-supplied src (custom PFP they uploaded; Go API returns this)
 *   2. on-error → /banana-profile.png (the same default banana the
 *      drafting UI uses everywhere else — matches what the user sees
 *      in-app when they haven't customized)
 *
 * No more colored-initial circles — Boris's spec: "default should show
 * their banana default image, not a letter circle."
 */
function Avatar({ src }: { src: string | null }) {
  const [errored, setErrored] = useState(false);
  const url = errored || !src ? '/banana-profile.png' : src;
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={url}
      alt=""
      className="h-7 w-7 shrink-0 rounded-full border border-white/10 object-cover bg-gray-900"
      loading="lazy"
      onError={() => setErrored(true)}
    />
  );
}

type FilterKey =
  | 'all'
  | 'drafters_no_promo'
  | 'promo_limbo'
  | 'big_spenders'
  | 'in_progress_promo'
  | 'active_week'
  | 'inactive_14d';
type SortKey = 'spend' | 'drafts' | 'spins' | 'promos' | 'signup' | 'last_active';

// Activity-window predicates. lastActiveAt is an ISO string set by
// lib/userEvents.recordActivityAndDetectLogin on every authenticated
// API call (5-min throttled). Backfilled from v2_activity_events for
// existing users.
const WEEK_MS = 7 * 24 * 3600 * 1000;
const FORTNIGHT_MS = 14 * 24 * 3600 * 1000;
const lastActiveMs = (u: AggregateUser) => (u.lastActiveAt ? Date.parse(u.lastActiveAt) : 0);

const FILTERS: { key: FilterKey; label: string; predicate: (u: AggregateUser) => boolean }[] = [
  { key: 'all', label: 'All', predicate: () => true },
  {
    key: 'active_week',
    label: 'Active 7d',
    predicate: (u) => lastActiveMs(u) >= Date.now() - WEEK_MS,
  },
  {
    key: 'inactive_14d',
    label: 'Inactive 14d+',
    // Users who exist but haven't done anything in 14+ days. Excludes
    // never-active (lastActiveMs===0) since those are signups that
    // ghosted — surfaced via the 'drafters_no_promo' family already.
    predicate: (u) => lastActiveMs(u) > 0 && lastActiveMs(u) < Date.now() - FORTNIGHT_MS,
  },
  {
    key: 'drafters_no_promo',
    label: 'Drafters · no promo',
    predicate: (u) => u.activity.draftsEntered > 0 && u.activity.promosClaimed === 0,
  },
  {
    key: 'promo_limbo',
    label: 'Promo in limbo',
    predicate: (u) => u.promos.pendingTypes.length > 0,
  },
  {
    key: 'in_progress_promo',
    label: 'Promo started',
    predicate: (u) => u.promos.hasStartedAny,
  },
  {
    key: 'big_spenders',
    label: 'Big spenders',
    predicate: (u) => u.activity.spendUsd >= 1,
  },
];

const SORTS: { key: SortKey; label: string; pick: (u: AggregateUser) => number }[] = [
  { key: 'spend', label: 'Spend', pick: (u) => u.activity.spendUsd },
  { key: 'drafts', label: 'Drafts', pick: (u) => u.activity.draftsEntered },
  { key: 'spins', label: 'Spins', pick: (u) => u.activity.spinsWon },
  { key: 'promos', label: 'Promos', pick: (u) => u.activity.promosClaimed },
  { key: 'last_active', label: 'Last active', pick: lastActiveMs },
  { key: 'signup', label: 'Newest', pick: (u) => u.createdAt ? Date.parse(u.createdAt) : 0 },
];

// Compact "Xm/h/d ago" for the Last active column. Returns '—' for
// users with no recorded activity.
function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  const days = Math.floor(sec / 86400);
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

interface Props {
  enabled: boolean;
}

export function UsersTableBox({ enabled }: Props) {
  const q = useUsersAggregate(enabled);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [sort, setSort] = useState<SortKey>('signup');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

  const all = q.data?.users ?? [];

  // Counts for each filter chip (so admins see "Drafters · no promo · 12"
  // without having to click).
  const filterCounts = useMemo(() => {
    const m: Record<FilterKey, number> = {
      all: 0,
      active_week: 0,
      inactive_14d: 0,
      drafters_no_promo: 0,
      promo_limbo: 0,
      big_spenders: 0,
      in_progress_promo: 0,
    };
    for (const u of all) for (const f of FILTERS) if (f.predicate(u)) m[f.key] += 1;
    return m;
  }, [all]);

  const filtered = useMemo(() => {
    const predicate = FILTERS.find((f) => f.key === filter)!.predicate;
    const q = search.trim().toLowerCase();
    const base = all.filter(predicate);
    if (!q) return base;
    return base.filter((u) =>
      u.wallet.toLowerCase().includes(q) ||
      (u.username ?? '').toLowerCase().includes(q),
    );
  }, [all, filter, search]);

  const sorted = useMemo(() => {
    const pick = SORTS.find((s) => s.key === sort)!.pick;
    return [...filtered].sort((a, b) => pick(b) - pick(a));
  }, [filtered, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageRows = sorted.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const showingFrom = sorted.length === 0 ? 0 : page * PAGE_SIZE + 1;
  const showingTo = Math.min(sorted.length, (page + 1) * PAGE_SIZE);

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02]">
      <div className="px-5 py-3 border-b border-white/[0.06] flex items-baseline justify-between gap-2 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-white">All users</h3>
          <p className="text-[11px] text-gray-500">
            {q.isLoading ? 'Loading…' : `${all.length.toLocaleString()} total · ${sorted.length.toLocaleString()} match current filter`}
          </p>
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          placeholder="Search wallet or name…"
          className="px-3 py-1.5 rounded-md bg-white/[0.04] border border-white/[0.08] text-xs text-white placeholder:text-gray-500 focus:outline-none focus:border-banana/60 w-64"
        />
      </div>

      {/* Filter chips */}
      <div className="px-5 py-2 border-b border-white/[0.06] flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const count = filterCounts[f.key];
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => { setFilter(f.key); setPage(0); }}
              className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] border transition-colors ${
                active
                  ? 'bg-banana text-black border-banana font-semibold'
                  : count === 0
                    ? 'border-white/[0.06] text-gray-600'
                    : 'border-white/[0.08] text-gray-300 hover:text-white hover:border-white/[0.20]'
              }`}
            >
              {f.label}
              <span className={`ml-1.5 ${active ? 'text-black/70' : 'text-gray-500'}`}>{count}</span>
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-1.5 text-[11px] text-gray-500">
          <span>Sort by:</span>
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSort(s.key)}
              className={`px-2 py-0.5 rounded transition-colors ${
                sort === s.key ? 'text-white font-semibold underline underline-offset-4 decoration-banana' : 'text-gray-400 hover:text-white'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead className="text-[10px] uppercase tracking-[0.1em] text-gray-500">
            <tr>
              <th className="px-5 pt-3 pb-2 text-left font-medium">User</th>
              <th className="pt-3 pb-2 text-right font-medium">Drafts</th>
              <th className="pt-3 pb-2 text-right font-medium">Bought</th>
              <th className="pt-3 pb-2 text-right font-medium">Spend</th>
              <th className="pt-3 pb-2 text-right font-medium">Spins</th>
              <th className="pt-3 pb-2 text-right font-medium">Free won</th>
              <th className="pt-3 pb-2 text-right font-medium">Promos</th>
              <th className="pt-3 pb-2 text-right font-medium">In&nbsp;limbo</th>
              <th className="pt-3 pb-2 text-right font-medium">Last&nbsp;active</th>
              <th className="px-5 pt-3 pb-2 text-right font-medium">Joined</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {q.isLoading ? (
              <tr><td colSpan={10} className="px-5 py-10 text-center text-xs text-gray-500">Loading users…</td></tr>
            ) : pageRows.length === 0 ? (
              <tr><td colSpan={10} className="px-5 py-10 text-center text-xs text-gray-500">
                No users match this filter.
              </td></tr>
            ) : (
              pageRows.map((u) => {
                const inLimbo = u.promos.pendingTypes.length;
                // Name resolution order:
                //   1. displayName the user chose on the Profile page
                //   2. auto-generated username (e.g. "BananaKing99",
                //      "User-0x01aB")
                //   3. derived default "Banana #XXXX" using the last 4
                //      hex chars of the wallet — so older accounts that
                //      have neither field still get a recognizable
                //      label instead of duplicating the wallet on both
                //      lines of the cell.
                const fallback = `Banana #${u.wallet.slice(-4).toUpperCase()}`;
                const name = u.displayName || u.username || fallback;
                const nameIsFallback = !u.displayName && !u.username;
                return (
                  <tr key={u.wallet} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                    <td className="px-5 py-2 min-w-0">
                      <div className="flex items-center gap-2.5">
                        <Avatar src={u.avatar} />
                        <div className="min-w-0">
                          <p className={`text-xs truncate leading-tight ${nameIsFallback ? 'text-gray-400 italic' : 'text-white'}`} title={name}>{name}</p>
                          <WalletLink wallet={u.wallet} bare className="!text-[10px] !text-gray-500 hover:!text-banana" />
                        </div>
                      </div>
                    </td>
                    <td className={`py-2 text-right ${u.activity.draftsEntered > 0 ? 'text-blue-300' : 'text-gray-600'}`}>{u.activity.draftsEntered}</td>
                    <td className={`py-2 text-right ${u.activity.passesBought > 0 ? 'text-emerald-300' : 'text-gray-600'}`}>{u.activity.passesBought}</td>
                    <td className={`py-2 text-right ${u.activity.spendUsd > 0 ? 'text-emerald-300' : 'text-gray-600'}`}>
                      {u.activity.spendUsd > 0 ? `$${Math.round(u.activity.spendUsd).toLocaleString()}` : '—'}
                    </td>
                    <td className={`py-2 text-right ${u.activity.spinsWon > 0 ? 'text-[#F3E216]' : 'text-gray-600'}`}>{u.activity.spinsWon}</td>
                    <td className={`py-2 text-right ${u.activity.freeDraftsWon > 0 ? 'text-purple-300' : 'text-gray-600'}`}>{u.activity.freeDraftsWon}</td>
                    <td className={`py-2 text-right ${u.activity.promosClaimed > 0 ? 'text-pink-300' : 'text-gray-600'}`}>{u.activity.promosClaimed}</td>
                    <td className={`py-2 text-right ${inLimbo > 0 ? 'text-amber-300' : 'text-gray-600'}`} title={u.promos.pendingTypes.join(', ')}>{inLimbo}</td>
                    <td
                      className={`py-2 text-right text-[11px] ${
                        u.lastActiveAt
                          ? Date.now() - Date.parse(u.lastActiveAt) < WEEK_MS
                            ? 'text-emerald-300'
                            : Date.now() - Date.parse(u.lastActiveAt) < FORTNIGHT_MS
                              ? 'text-gray-300'
                              : 'text-amber-400/80'
                          : 'text-gray-600'
                      }`}
                      title={u.lastActiveAt ? new Date(u.lastActiveAt).toLocaleString() : 'No recorded activity'}
                    >
                      {timeAgo(u.lastActiveAt)}
                    </td>
                    <td className="px-5 py-2 text-right text-[11px] text-gray-500">
                      {u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {sorted.length > PAGE_SIZE && (
        <div className="px-5 py-2 border-t border-white/[0.06] flex items-center justify-between text-[11px] text-gray-500">
          <span>Showing {showingFrom.toLocaleString()} – {showingTo.toLocaleString()} of {sorted.length.toLocaleString()}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="px-2 py-1 rounded text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
            >← prev</button>
            <span className="px-2 text-gray-400 tabular-nums">{page + 1} / {totalPages}</span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="px-2 py-1 rounded text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
            >next →</button>
          </div>
        </div>
      )}
    </div>
  );
}
