'use client';

/**
 * Admin shell.
 *
 * Phase 3 reorg (May 2026): collapsed 16 top-level tabs into 9, grouped
 * into 4 categories that match the actual support workflow:
 *
 *   Daily       — Dashboard · Logs · Support
 *   Users       — User Lookup · Users
 *   Operations  — Money (Withdrawals/Onramps/Offramps/Promos) · Drafts (Active/Completed/Spectate/Founder)
 *   System      — Audit (Admin actions/User signups/KYC/Full log) · Tools
 *
 * Old tab keys are honored via redirect logic in `initialTab` so existing
 * bookmarks (`?tab=onramp`, `?tab=spectate`, etc.) land on the new home
 * with the correct sub-tab pre-selected. Nothing was deleted.
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { isWalletAdmin } from '@/lib/adminAllowlist';
import { useAdminAuthHeaders } from '@/hooks/admin/useAdminApi';
import { useAdminNotifications, type NotifCategory } from '@/hooks/admin/useAdminNotifications';
import { UsersTable } from '@/components/admin/UsersTable';
import { LiveActivity } from '@/components/admin/LiveActivity';
import { LogsTab } from '@/components/admin/LogsTab';
import { SupportInbox } from '@/components/admin/SupportInbox';
import { AdminTools } from '@/components/admin/AdminTools';
import { UserLookupPanel } from '@/components/admin/UserLookup/UserLookupPanel';
import { DashboardPanel } from '@/components/admin/DashboardPanel';
import { MoneyTab } from '@/components/admin/MoneyTab';
import { DraftsTab } from '@/components/admin/DraftsTab';
import { AuditTab } from '@/components/admin/AuditTab';
import { GlobalSearch } from '@/components/admin/TopBar/GlobalSearch';
import { QuickActions } from '@/components/admin/TopBar/QuickActions';
import { HealthPill } from '@/components/admin/TopBar/HealthPill';

/* ─────────────────────────── Nav schema ─────────────────────────── */

type TabKey =
  | 'dashboard'
  | 'activity'
  | 'logs'
  | 'support'
  | 'user-lookup'
  | 'users'
  | 'money'
  | 'drafts'
  | 'audit'
  | 'tools';

interface NavItem {
  key: TabKey;
  label: string;
  group: string;
  /** Not shown in the sidebar (still a valid ?tab= for deep links). */
  hidden?: boolean;
}

// FLAT sidebar, no group headers, Boris's exact order (2026-07-03: "take
// away all those top headers... put this in order"). `group` is vestigial
// (kept for the mobile header subtitle only).
const NAV_ITEMS: NavItem[] = [
  { key: 'drafts', label: 'Drafts', group: 'Admin' },
  { key: 'user-lookup', label: 'User Lookup', group: 'Admin' },
  { key: 'activity', label: 'Live Activity', group: 'Admin' },
  { key: 'dashboard', label: 'Dashboard', group: 'Admin' },
  { key: 'support', label: 'Support', group: 'Admin' },
  { key: 'logs', label: 'Logs', group: 'Admin' },
  { key: 'tools', label: 'Tools', group: 'Admin' },
  { key: 'money', label: 'Money', group: 'Admin' },
  { key: 'audit', label: 'Audit', group: 'Admin' },
  // Users table page: not in Boris's sidebar list — the same table lives at
  // the bottom of the Dashboard. Kept as a valid tab so ?tab=users links
  // (and the Dashboard's "open full page" affordances) still work.
  { key: 'users', label: 'Users', group: 'Admin', hidden: true },
];

/**
 * Maps legacy `?tab=…` values to the new (tab, sub) pair. Lets every
 * bookmark from before the reorg keep working without surprise. Returns
 * null when the legacy key has no mapping (handled as "unknown → dashboard").
 */
function resolveLegacyTab(legacy: string | null): { tab: TabKey; sub?: string } | null {
  if (!legacy) return null;
  switch (legacy) {
    case 'metrics':
    case 'live':
      return { tab: 'dashboard' };
    case 'errors':
    case 'sentry':
      return { tab: 'logs' };
    case 'withdrawals':
      return { tab: 'money', sub: 'withdrawals' };
    case 'onramp':
      return { tab: 'money', sub: 'onramps' };
    case 'offramp':
      return { tab: 'money', sub: 'offramps' };
    case 'promos':
      return { tab: 'money', sub: 'promos' };
    case 'spectate':
      return { tab: 'drafts', sub: 'spectate' };
    case 'founder':
      return { tab: 'drafts', sub: 'founder' };
    case 'kyc':
      return { tab: 'audit', sub: 'kyc' };
    case 'activity':
      return { tab: 'audit', sub: 'admin-actions' };
    default:
      return null;
  }
}

function formatWallet(value: string): string {
  if (!value) return '—';
  return value.length < 12 ? value : `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/* ─────────────────────────── Page ─────────────────────────── */

export default function AdminPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { walletAddress, isLoading } = useAuth();

  const isValidTabKey = (v: string | null): v is TabKey => {
    if (!v) return false;
    return NAV_ITEMS.some((n) => n.key === v);
  };

  // Resolve the initial tab from URL. Honors new keys directly, redirects
  // legacy keys to the new home (with sub-tab pre-set), falls back to
  // 'drafts' for unknown/absent values (Boris 2026-07-03: "the default
  // should land on drafts not dashboard").
  const initialTab: TabKey = useMemo(() => {
    const fromUrl = searchParams?.get('tab') ?? null;
    if (isValidTabKey(fromUrl)) return fromUrl;
    const legacy = resolveLegacyTab(fromUrl);
    return legacy?.tab ?? 'drafts';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [activeTab, setActiveTabRaw] = useState<TabKey>(initialTab);

  // ❶ Keep activeTab in sync with the URL on every searchParams change.
  // Without this, clicking a <Link href="/admin?tab=logs"> elsewhere
  // (HealthCard's "Logs →", LiveActivityWidget's "See all →", a sidebar
  // pill rendered as a Link, etc.) would update the URL but the page
  // would still render the old tab. ALSO handles legacy tab keys — we
  // canonicalize them via router.replace so refresh + share survive.
  useEffect(() => {
    const fromUrl = searchParams?.get('tab') ?? null;
    if (isValidTabKey(fromUrl)) {
      if (fromUrl !== activeTab) setActiveTabRaw(fromUrl);
      return;
    }
    // Unknown / legacy → rewrite the URL to the canonical (tab,sub) pair
    // AND flip activeTab to match. Single combined effect so we don't
    // briefly render the wrong tab in between two re-renders.
    const legacy = resolveLegacyTab(fromUrl);
    if (legacy) {
      if (legacy.tab !== activeTab) setActiveTabRaw(legacy.tab);
      const params = new URLSearchParams(searchParams?.toString() ?? '');
      params.set('tab', legacy.tab);
      if (legacy.sub) params.set('sub', legacy.sub);
      router.replace(`/admin?${params.toString()}`, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const setActiveTab = (key: TabKey) => {
    setActiveTabRaw(key);
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('tab', key);
    // Picking a top-level tab clears any sub-selection from the previous
    // tab — otherwise the SubTabBar shows a sub-key that isn't valid for
    // the new tab. Each consolidated tab defaults to its first sub.
    params.delete('sub');
    router.replace(`/admin?${params.toString()}`, { scroll: false });
  };

  const [isAuthorized, setIsAuthorized] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Notification badges per tab. Categories that previously had their
  // own tab now live inside a consolidated tab — we still surface a
  // badge on the parent, even though the actual unseen items live in
  // a sub. E.g. KYC notifications badge "Audit" since that's where KYC
  // now lives.
  const TAB_NOTIF_CATEGORY: Partial<Record<TabKey, NotifCategory[]>> = {
    support: ['support'],
    logs: ['logs'],
    money: ['withdrawals', 'onramp', 'offramp'],
    drafts: ['drafts'],
    audit: ['kyc'],
  };
  const { counts: notifCounts, total: notifTotal, markAllSeen: markAllNotifSeen } = useAdminNotifications({
    enabled: isAuthorized,
    useAuthHeaders: useAdminAuthHeaders,
  });
  const badgeForTab = (key: TabKey): number => {
    const cats = TAB_NOTIF_CATEGORY[key];
    if (!cats) return 0;
    return cats.reduce((sum, c) => sum + (notifCounts[c] ?? 0), 0);
  };

  const visibleNavItems = useMemo(() => NAV_ITEMS.filter((n) => !n.hidden), []);

  useEffect(() => {
    if (isLoading) return;
    if (!walletAddress || !isWalletAdmin(walletAddress)) {
      router.replace('/');
      return;
    }
    setIsAuthorized(true);
  }, [isLoading, router, walletAddress]);

  if (isLoading || !isAuthorized) {
    return (
      <div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center">
        <p className="text-gray-500 text-sm">Loading…</p>
      </div>
    );
  }

  const current = NAV_ITEMS.find((n) => n.key === activeTab)!;

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-white">
      {/* ─── Mobile-only top bar with hamburger ─── */}
      <header className="md:hidden sticky top-0 z-30 border-b border-white/[0.06] bg-[#0a0a0b]/90 backdrop-blur px-4 py-3 flex items-center justify-between gap-3">
        <button
          onClick={() => setSidebarOpen(true)}
          className="p-2 -ml-2 -my-1 rounded-md hover:bg-white/[0.05] active:bg-white/[0.08] transition-colors"
          aria-label="Open menu"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="18" x2="20" y2="18" />
          </svg>
        </button>
        <div className="flex-1 min-w-0 text-center">
          <p className="text-sm font-semibold truncate">{current.label}</p>
          <p className="text-[10px] text-gray-500 -mt-0.5">{current.group}</p>
        </div>
        <HealthPill enabled={isAuthorized} />
      </header>

      <div className="flex">
        {/* ─── Mobile drawer backdrop ─── */}
        {sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(false)}
            className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            aria-label="Close menu"
          />
        )}

        {/* ─── Sidebar ─── */}
        <aside
          className={`
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
            md:translate-x-0
            fixed md:sticky top-0 left-0 z-50 md:z-auto
            w-72 md:w-60 shrink-0 h-screen
            border-r border-white/[0.06]
            bg-[#0a0a0b]/95 md:bg-black/20 backdrop-blur
            flex flex-col
            transition-transform duration-200 md:transition-none
          `}
        >
          <div className="px-5 py-5 border-b border-white/[0.06] flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xl shrink-0">🍌</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold tracking-tight">SBS Admin</p>
                <p className="text-[10px] text-gray-500 font-mono truncate">{formatWallet(walletAddress ?? '')}</p>
              </div>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="md:hidden p-1.5 -mr-1 rounded-md hover:bg-white/[0.05] text-gray-400"
              aria-label="Close menu"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          </div>

          {notifTotal > 0 && (
            <div className="px-5 pt-3">
              <button
                type="button"
                onClick={markAllNotifSeen}
                className="w-full text-[11px] text-gray-400 hover:text-white py-1.5 rounded-md border border-white/[0.06] hover:border-white/[0.15] transition-colors"
              >
                Mark all {notifTotal > 99 ? '99+' : notifTotal} as read
              </button>
            </div>
          )}

          {/* Flat list, no group headers, generous breathing room between
              items (Boris 2026-07-03). */}
          <nav className="flex-1 overflow-y-auto px-3 py-5 space-y-3">
            {visibleNavItems.map((item) => {
              const badge = badgeForTab(item.key);
              return (
                <button
                  key={item.key}
                  onClick={() => {
                    setActiveTab(item.key);
                    setSidebarOpen(false);
                  }}
                  className={`w-full flex items-center justify-between gap-2 text-left px-3 py-2 rounded-md text-sm transition-colors ${
                    activeTab === item.key
                      ? 'bg-white/[0.08] text-white font-medium'
                      : 'text-gray-400 hover:text-white hover:bg-white/[0.03]'
                  }`}
                >
                  <span className="truncate">{item.label}</span>
                  {badge > 0 && (
                    <span className="shrink-0 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-banana text-black text-[10px] font-bold">
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="px-5 py-4 border-t border-white/[0.06]">
            <button
              onClick={() => router.push('/')}
              className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
            >
              ← Back to app
            </button>
          </div>
        </aside>

        {/* ─── Main ─── */}
        <main className="flex-1 min-w-0">
          {/* Desktop sticky header — title left, search + quick actions + health right */}
          <header className="hidden md:flex sticky top-0 z-10 border-b border-white/[0.06] bg-[#0a0a0b]/80 backdrop-blur px-8 py-3 items-center justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight">{current.label}</h1>
              <p className="text-[12px] text-gray-500 mt-0.5">{current.group}</p>
            </div>
            <div className="flex items-center gap-3 flex-1 max-w-2xl">
              <GlobalSearch enabled={isAuthorized} />
              <QuickActions />
              <HealthPill enabled={isAuthorized} />
            </div>
          </header>

          <div className="px-4 sm:px-6 md:px-8 py-4 md:py-6 max-w-[1400px]">
            {activeTab === 'dashboard' && <DashboardPanel enabled={isAuthorized} />}
            {activeTab === 'activity' && <LiveActivity enabled={isAuthorized} />}
            {activeTab === 'logs' && <LogsTab enabled={isAuthorized} />}
            {activeTab === 'support' && <SupportInbox enabled={isAuthorized} />}
            {activeTab === 'user-lookup' && <UserLookupPanel enabled={isAuthorized} />}
            {activeTab === 'users' && <UsersTable enabled={isAuthorized} />}
            {activeTab === 'money' && <MoneyTab enabled={isAuthorized} />}
            {activeTab === 'drafts' && <DraftsTab enabled={isAuthorized} />}
            {activeTab === 'audit' && <AuditTab enabled={isAuthorized} />}
            {activeTab === 'tools' && <AdminTools enabled={isAuthorized} />}
          </div>
        </main>
      </div>
    </div>
  );
}
