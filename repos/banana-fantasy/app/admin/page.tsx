'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSendUsdcOnBase } from '@/hooks/useSendUsdcOnBase';
import * as Sentry from '@sentry/nextjs';
import { useAuth } from '@/hooks/useAuth';
import { isWalletAdmin } from '@/lib/adminAllowlist';
import { useToast } from '@/components/ui/Toast';
import {
  useAdminWithdrawals,
  useAdminDrafts,
  useAdminPromos,
  useUpdateWithdrawalStatus,
  useAdminAuthHeaders,
  AdminApiError,
  type AdminWithdrawalItem,
  type AdminPromoItem,
} from '@/hooks/admin/useAdminApi';
import { useAdminNotifications, type NotifCategory } from '@/hooks/admin/useAdminNotifications';
import { UsersTable } from '@/components/admin/UsersTable';
import { KycAttemptsViewer } from '@/components/admin/KycAttemptsViewer';
import { OfframpAttemptsViewer } from '@/components/admin/OfframpAttemptsViewer';
import { OnrampAttemptsViewer } from '@/components/admin/OnrampAttemptsViewer';
import { ActivityCombined } from '@/components/admin/ActivityCombined';
import { LiveActivity } from '@/components/admin/LiveActivity';
import { MetricsDashboard } from '@/components/admin/MetricsDashboard';
import { LogsTab } from '@/components/admin/LogsTab';
import { SupportInbox } from '@/components/admin/SupportInbox';
import { AuditLog } from '@/components/admin/AuditLog';
import { AdminTools } from '@/components/admin/AdminTools';
import { SpectateBrowser } from '@/components/admin/SpectateBrowser';
import { CompletedDraftsList } from '@/components/admin/CompletedDraftsList';
import { FounderScheduleEditor } from '@/components/admin/FounderScheduleEditor';

type TabKey = 'metrics' | 'logs' | 'support' | 'kyc' | 'offramp' | 'onramp' | 'users' | 'drafts' | 'withdrawals' | 'promos' | 'live' | 'activity' | 'audit' | 'tools' | 'spectate' | 'founder';

interface NavItem {
  key: TabKey;
  label: string;
  group: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'metrics', label: 'Metrics', group: 'Monitoring' },
  { key: 'logs', label: 'Logs', group: 'Monitoring' },
  { key: 'support', label: 'Support', group: 'Monitoring' },
  { key: 'kyc', label: 'KYC Attempts', group: 'Monitoring' },
  { key: 'offramp', label: 'Offramps', group: 'Monitoring' },
  { key: 'onramp', label: 'Onramps', group: 'Monitoring' },
  { key: 'users', label: 'Users', group: 'Manage' },
  { key: 'drafts', label: 'Drafts', group: 'Manage' },
  { key: 'withdrawals', label: 'Withdrawals', group: 'Manage' },
  { key: 'promos', label: 'Promos', group: 'Manage' },
  { key: 'live', label: 'Live Activity', group: 'Records' },
  { key: 'activity', label: 'Admin + Signups', group: 'Records' },
  { key: 'audit', label: 'Audit Log', group: 'Records' },
  { key: 'spectate', label: 'Spectate', group: 'Records' },
  { key: 'founder', label: 'Founder', group: 'Records' },
  { key: 'tools', label: 'Tools', group: 'Records' },
];

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatWallet(value: string): string {
  if (!value) return '—';
  return value.length < 12 ? value : `${value.slice(0, 6)}…${value.slice(-4)}`;
}


export default function AdminPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { walletAddress, isLoading } = useAuth();
  const { show } = useToast();

  // Hydrate the active tab from the URL (?tab=onramp) so a refresh
  // keeps the admin on the page they were on. Falls back to 'metrics'
  // when the param is missing or doesn't match a known tab.
  const isValidTabKey = (v: string | null): v is TabKey => {
    if (!v) return false;
    return NAV_ITEMS.some((n) => n.key === v);
  };
  const initialTab: TabKey = (() => {
    const fromUrl = searchParams?.get('tab') ?? null;
    // Legacy bookmarks: the old separate error tabs merged into 'logs'.
    if (fromUrl === 'errors' || fromUrl === 'sentry') return 'logs';
    return isValidTabKey(fromUrl) ? fromUrl : 'metrics';
  })();
  const [activeTab, setActiveTabRaw] = useState<TabKey>(initialTab);

  // Wrap setActiveTab so every click also updates the URL. router.replace
  // (not push) keeps the back button useful — pressing back leaves admin
  // entirely instead of cycling through every tab the user visited.
  const setActiveTab = (key: TabKey) => {
    setActiveTabRaw(key);
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('tab', key);
    router.replace(`/admin?${params.toString()}`, { scroll: false });
  };
  const [isAuthorized, setIsAuthorized] = useState(false);
  // Mobile drawer state. Closed by default; tapping the hamburger opens
  // it as an overlay. Tapping the backdrop or a nav item closes it.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Notification badges next to each nav item. Tab → category map; tabs
  // not in the map get no badge.
  const TAB_NOTIF_CATEGORY: Partial<Record<TabKey, NotifCategory>> = {
    support: 'support',
    logs: 'logs',
    kyc: 'kyc',
    offramp: 'offramp',
    onramp: 'onramp',
    withdrawals: 'withdrawals',
    drafts: 'drafts',
  };
  const { counts: notifCounts, total: notifTotal, markSeen: markNotifSeen, markAllSeen: markAllNotifSeen } = useAdminNotifications({
    enabled: isAuthorized,
    useAuthHeaders: useAdminAuthHeaders,
  });

  // Note: opening a tab does NOT auto-clear the badge — Boris wants to
  // press an explicit "Mark as read" button inside each tab page after
  // he's actually looked at the data. Implicit clear made it ambiguous
  // whether the badge meant "unseen" or "already-clicked-but-not-read."

  const groups = useMemo(() => {
    const seen = new Map<string, NavItem[]>();
    for (const item of NAV_ITEMS) {
      if (!seen.has(item.group)) seen.set(item.group, []);
      seen.get(item.group)!.push(item);
    }
    return [...seen.entries()];
  }, []);

  useEffect(() => {
    if (isLoading) return;
    if (!walletAddress || !isWalletAdmin(walletAddress)) {
      router.replace('/');
      return;
    }
    setIsAuthorized(true);
  }, [isLoading, router, walletAddress]);

  // Lazy-load each tab's data only when visible
  const withdrawalsQuery = useAdminWithdrawals(isAuthorized && activeTab === 'withdrawals');
  const draftsQuery = useAdminDrafts(isAuthorized && activeTab === 'drafts');
  const promosQuery = useAdminPromos(isAuthorized && activeTab === 'promos');

  useEffect(() => {
    for (const q of [withdrawalsQuery, draftsQuery, promosQuery]) {
      if (q.isError && q.error) {
        const e = q.error as AdminApiError;
        Sentry.captureException(e, { tags: { admin: true }, extra: { requestId: e.requestId } });
        show({ level: 'error', message: e.message || 'Admin request failed', requestId: e.requestId });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withdrawalsQuery.isError, draftsQuery.isError, promosQuery.isError]);

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
        {(() => {
          const cat = TAB_NOTIF_CATEGORY[activeTab];
          const badge = cat ? notifCounts[cat] : 0;
          const dismissable = cat !== undefined
            && cat !== 'support'
            && cat !== 'withdrawals'
            && badge > 0;
          if (!dismissable) {
            return <span className="text-lg shrink-0">🍌</span>;
          }
          return (
            <button
              type="button"
              onClick={() => markNotifSeen(cat!)}
              className="shrink-0 px-2 py-1 rounded-md bg-banana text-black text-[10px] font-semibold"
              aria-label={`Mark ${badge} as read`}
            >
              Read {badge > 99 ? '99+' : badge}
            </button>
          );
        })()}
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

          <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
            {groups.map(([group, items]) => (
              <div key={group}>
                <p className="px-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5">
                  {group}
                </p>
                <div className="space-y-0.5">
                  {items.map((item) => {
                    const cat = TAB_NOTIF_CATEGORY[item.key];
                    const badge = cat ? notifCounts[cat] : 0;
                    return (
                      <button
                        key={item.key}
                        onClick={() => {
                          setActiveTab(item.key);
                          // Auto-close drawer on mobile after selecting.
                          // No-op on desktop where the sidebar is always visible.
                          setSidebarOpen(false);
                        }}
                        className={`w-full flex items-center justify-between gap-2 text-left px-3 py-2 md:py-1.5 rounded-md text-sm transition-colors ${
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
                </div>
              </div>
            ))}
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
          {/* Desktop-only sticky header. Mobile uses the top bar above. */}
          <header className="hidden md:flex sticky top-0 z-10 border-b border-white/[0.06] bg-[#0a0a0b]/80 backdrop-blur px-8 py-4 items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">{current.label}</h1>
              <p className="text-[12px] text-gray-500 mt-0.5">{current.group}</p>
            </div>
            {(() => {
              const cat = TAB_NOTIF_CATEGORY[activeTab];
              const badge = cat ? notifCounts[cat] : 0;
              // "Mark as read" only on tabs where it's meaningful —
              // categories Boris controls (errors, kyc, etc.). Support
              // and withdrawals clear from their own real state.
              const dismissable = cat !== undefined
                && cat !== 'support'
                && cat !== 'withdrawals'
                && badge > 0;
              if (!dismissable) return null;
              return (
                <button
                  type="button"
                  onClick={() => markNotifSeen(cat!)}
                  className="shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-white/[0.08] hover:border-banana text-xs text-gray-300 hover:text-white transition-colors"
                >
                  Mark {badge > 99 ? '99+' : badge} as read
                </button>
              );
            })()}
          </header>

          <div className="px-4 sm:px-6 md:px-8 py-4 md:py-6 max-w-[1400px]">
          {activeTab === 'metrics' && <MetricsDashboard enabled={isAuthorized} />}
          {activeTab === 'logs' && <LogsTab enabled={isAuthorized} />}
          {activeTab === 'support' && <SupportInbox enabled={isAuthorized} />}
          {activeTab === 'kyc' && <KycAttemptsViewer enabled={isAuthorized} />}
          {activeTab === 'offramp' && <OfframpAttemptsViewer enabled={isAuthorized} />}
          {activeTab === 'onramp' && <OnrampAttemptsViewer enabled={isAuthorized} />}
          {activeTab === 'users' && <UsersTable enabled={isAuthorized} />}
          {activeTab === 'drafts' && <CompletedDraftsList enabled={isAuthorized} />}
          {activeTab === 'withdrawals' && <WithdrawalsPanel items={withdrawalsQuery.data ?? []} />}
          {activeTab === 'promos' && <PromosPanel items={promosQuery.data?.promos ?? []} />}
          {activeTab === 'live' && <LiveActivity enabled={isAuthorized} />}
          {activeTab === 'activity' && <ActivityCombined enabled={isAuthorized} />}
          {activeTab === 'audit' && <AuditLog enabled={isAuthorized} />}
          {activeTab === 'spectate' && <SpectateBrowser enabled={isAuthorized} />}
          {activeTab === 'founder' && <FounderScheduleEditor enabled={isAuthorized} />}
          {activeTab === 'tools' && <AdminTools enabled={isAuthorized} />}
        </div>
      </main>
      </div>
    </div>
  );
}

/* ──────────── Withdrawals ──────────── */

function WithdrawalsPanel({ items }: { items: AdminWithdrawalItem[] }) {
  const update = useUpdateWithdrawalStatus();
  const { show } = useToast();
  const sendUsdc = useSendUsdcOnBase();
  // Track per-row send state so the row's button can show progress
  // ("Sending…" → "Confirming…") without blocking other rows.
  const [sendingRowId, setSendingRowId] = useState<string | null>(null);

  const handle = async (id: string, status: 'approved' | 'denied' | 'paid', txHash?: string) => {
    try {
      const res = await update.mutateAsync({ id, status, txHash });
      const verb = status === 'paid' ? 'marked paid' : status;
      show({ level: 'success', message: `Withdrawal ${verb}`, requestId: res.requestId });
    } catch (err) {
      const e = err as AdminApiError;
      Sentry.captureException(e, {
        tags: { admin: true, action: 'withdrawal-status' },
        extra: { id, status, requestId: e.requestId },
      });
      show({ level: 'error', message: e.message, requestId: e.requestId });
    }
  };

  const handleMarkPaid = async (id: string) => {
    // Prompt for the Gnosis batch tx hash so it lands in audit + on the
    // user's activity event. Optional — admin can skip if they need to.
    const txHash = window.prompt(
      'Gnosis Safe tx hash (optional — leave blank if not available):',
      '',
    );
    if (txHash === null) return; // cancelled
    if (!window.confirm('Confirm: USDC has actually landed in the user\'s wallet on-chain?')) return;
    await handle(id, 'paid', txHash.trim() || undefined);
  };

  // Approved-but-not-yet-paid items are the queue ready for the next
  // Gnosis Safe batch. Helper produces a CSV the admin can paste into
  // the Gnosis Safe CSV Airdrop tool — the most common batch USDC sender.
  const readyToPay = items.filter((w) => w.status === 'approved');
  const readyTotal = readyToPay.reduce((sum, w) => sum + (w.amount || 0), 0);
  const USDC_BASE_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

  const copyCsv = async (kind: 'airdrop' | 'simple') => {
    if (readyToPay.length === 0) {
      show({ level: 'error', message: 'No approved withdrawals to copy' });
      return;
    }
    const lines: string[] = [];
    if (kind === 'airdrop') {
      // Format for Gnosis Safe CSV Airdrop app:
      //   token_type,token_address,receiver,amount,id
      lines.push('token_type,token_address,receiver,amount,id');
      for (const w of readyToPay) {
        lines.push(`erc20,${USDC_BASE_ADDRESS},${w.walletAddress},${w.amount},`);
      }
    } else {
      // Plain "wallet,amount" — easy to eyeball or paste anywhere.
      lines.push('wallet,amount');
      for (const w of readyToPay) {
        lines.push(`${w.walletAddress},${w.amount}`);
      }
    }
    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      show({
        level: 'success',
        message: `Copied ${readyToPay.length} payouts ($${readyTotal.toLocaleString()}) — ${kind === 'airdrop' ? 'Gnosis CSV Airdrop format' : 'plain CSV'}`,
      });
    } catch {
      // Fallback: open in a new tab so admin can copy manually
      const win = window.open('', '_blank');
      if (win) {
        win.document.write(`<pre style="font-family:monospace;padding:20px;background:#000;color:#fff;">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`);
      }
      show({ level: 'error', message: 'Clipboard blocked — opened in new tab to copy manually' });
    }
  };

  const handleMarkAllPaid = async () => {
    if (readyToPay.length === 0) return;
    const txHash = window.prompt(
      `Gnosis Safe batch tx hash for all ${readyToPay.length} payouts ($${readyTotal.toLocaleString()}):`,
      '',
    );
    if (txHash === null) return;
    if (!window.confirm(`Mark all ${readyToPay.length} approved withdrawals as paid? This fires user activity notifications.`)) return;
    const trimmed = txHash.trim() || undefined;
    let ok = 0;
    let fail = 0;
    for (const w of readyToPay) {
      try {
        await update.mutateAsync({ id: w.id, status: 'paid', txHash: trimmed });
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    show({
      level: fail === 0 ? 'success' : 'error',
      message: `Marked ${ok} paid${fail ? `, ${fail} failed` : ''}`,
    });
  };

  // ─── One-click send + mark paid ────────────────────────────
  // Triggers the admin's connected wallet to send USDC on Base for
  // the exact recipient + amount, waits for the tx receipt, then
  // marks the withdrawal paid with the hash. Replaces the 5-step
  // dance of (open MetaMask → find address → send → copy hash →
  // paste in admin) with a single click.

  const handleSendAndPay = async (w: AdminWithdrawalItem) => {
    if (!w.walletAddress) {
      show({ level: 'error', message: 'No recipient wallet on this withdrawal' });
      return;
    }
    if (!window.confirm(
      `Send $${w.amount.toLocaleString()} USDC to ${w.walletAddress.slice(0, 10)}…${w.walletAddress.slice(-6)} on Base?\n\nThis is a real on-chain transfer from your connected wallet.`,
    )) return;

    setSendingRowId(w.id);
    sendUsdc.reset();
    try {
      const { txHash } = await sendUsdc.send(w.walletAddress, w.amount);
      // Tx confirmed on-chain — now record it in the app and fire
      // the user-facing activity event.
      await update.mutateAsync({ id: w.id, status: 'paid', txHash });
      show({
        level: 'success',
        message: `Sent $${w.amount.toLocaleString()} → ${w.walletAddress.slice(0, 6)}…${w.walletAddress.slice(-4)} (paid)`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Send failed';
      show({ level: 'error', message: msg });
    } finally {
      setSendingRowId(null);
    }
  };

  const handleSendAllAndPay = async () => {
    if (readyToPay.length === 0) return;
    if (!window.confirm(
      `Send ${readyToPay.length} payouts totalling $${readyTotal.toLocaleString()} USDC on Base?\n\nThis triggers ${readyToPay.length} on-chain transfers from your connected wallet — each will need to be approved in the wallet.`,
    )) return;

    let ok = 0;
    let fail = 0;
    for (const w of readyToPay) {
      if (!w.walletAddress) {
        fail += 1;
        continue;
      }
      setSendingRowId(w.id);
      try {
        const { txHash } = await sendUsdc.send(w.walletAddress, w.amount);
        await update.mutateAsync({ id: w.id, status: 'paid', txHash });
        ok += 1;
      } catch {
        fail += 1;
        // If the user cancels in their wallet, stop the whole batch —
        // they probably want to abort, not just skip one.
        if (sendUsdc.error && /cancelled/i.test(sendUsdc.error)) break;
      }
    }
    setSendingRowId(null);
    show({
      level: fail === 0 ? 'success' : 'error',
      message: `Sent ${ok}/${readyToPay.length} payouts${fail ? `, ${fail} failed/skipped` : ''}`,
    });
  };

  const sendStatusLabel = (() => {
    switch (sendUsdc.status) {
      case 'connecting': return 'Connecting…';
      case 'switching': return 'Switching to Base…';
      case 'signing': return 'Sign in wallet…';
      case 'pending': return 'Confirming on-chain…';
      default: return 'Send & mark paid';
    }
  })();

  return (
    <div className="space-y-4">
      {readyToPay.length > 0 && (
        <div className="rounded-xl border border-banana/30 bg-banana/[0.03] p-4">
          <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
            <div>
              <h3 className="text-sm font-semibold text-banana">
                Ready to pay — {readyToPay.length} approved {readyToPay.length === 1 ? 'request' : 'requests'} · ${readyTotal.toLocaleString()} total
              </h3>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Approved, awaiting payout. Click <span className="text-banana">Send & mark paid</span> to dispatch
                from your connected wallet. {sendUsdc.walletAddress && (
                  <span className="font-mono">From {sendUsdc.walletAddress.slice(0, 6)}…{sendUsdc.walletAddress.slice(-4)}</span>
                )}
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={handleSendAllAndPay}
                disabled={sendingRowId !== null}
                className="px-3 py-1.5 rounded-md bg-banana hover:bg-banana/80 text-black text-xs font-semibold disabled:opacity-50"
                title="Send USDC from your connected wallet to every recipient sequentially, marking each paid as it confirms"
              >
                Send all & mark paid
              </button>
              <button
                onClick={handleMarkAllPaid}
                disabled={update.isPending || sendingRowId !== null}
                className="px-3 py-1.5 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-gray-200 text-xs disabled:opacity-50"
                title="If you've already sent payouts via Gnosis Safe or another tool, mark them paid with a single tx hash"
              >
                Mark all paid (already sent)
              </button>
              <button
                onClick={() => copyCsv('airdrop')}
                className="px-3 py-1.5 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-gray-200 text-xs"
                title="For Gnosis Safe CSV Airdrop tool"
              >
                Copy CSV
              </button>
            </div>
          </div>
          <div className="rounded-md bg-black/30 border border-white/[0.04] divide-y divide-white/[0.04] text-[12px] max-h-72 overflow-y-auto">
            {readyToPay.map((w) => {
              const isThisRow = sendingRowId === w.id;
              return (
                <div key={w.id} className="px-3 py-2 flex items-center justify-between gap-3">
                  <span className="font-mono text-gray-300 text-[11px] truncate">{w.walletAddress}</span>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-gray-200 font-medium">${w.amount.toLocaleString()}</span>
                    <button
                      onClick={() => handleSendAndPay(w)}
                      disabled={sendingRowId !== null}
                      className="px-2.5 py-1 rounded bg-banana hover:bg-banana/80 text-black text-[10px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Send USDC from your connected wallet to this recipient, then mark paid"
                    >
                      {isThisRow ? sendStatusLabel : 'Send & mark paid'}
                    </button>
                    <button
                      onClick={() => handleMarkPaid(w.id)}
                      disabled={update.isPending || sendingRowId !== null}
                      className="px-2 py-1 rounded bg-white/[0.06] hover:bg-white/[0.12] text-gray-300 text-[10px] disabled:opacity-50"
                      title="If you've already sent the USDC outside the app, just mark this paid with the existing tx hash"
                    >
                      Mark paid
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <WithdrawalSection
        title="Pending review"
        subtitle="Newly requested. Approve to queue for the next Gnosis batch, or deny."
        items={items.filter((w) => w.status === 'pending')}
        emptyMessage="No pending requests"
        renderActions={(w) => (
          <div className="flex gap-1.5">
            <button
              onClick={() => handle(w.id, 'approved')}
              disabled={update.isPending}
              className="px-2.5 py-1 rounded-md bg-green-600/80 hover:bg-green-500 text-white text-xs disabled:opacity-50"
            >
              Approve
            </button>
            <button
              onClick={() => handle(w.id, 'denied')}
              disabled={update.isPending}
              className="px-2.5 py-1 rounded-md bg-red-600/80 hover:bg-red-500 text-white text-xs disabled:opacity-50"
            >
              Deny
            </button>
          </div>
        )}
      />

      <WithdrawalSection
        title="Paid"
        subtitle="Completed — USDC delivered. Most recent first."
        items={items.filter((w) => w.status === 'paid' || w.status === 'completed')}
        emptyMessage="No paid withdrawals yet"
        collapsedByDefault
      />

      <WithdrawalSection
        title="Denied"
        subtitle="Rejected by an admin. Kept for audit."
        items={items.filter((w) => w.status === 'denied')}
        emptyMessage="No denied withdrawals"
        collapsedByDefault
      />
    </div>
  );
}

function WithdrawalSection({
  title,
  subtitle,
  items,
  emptyMessage,
  renderActions,
  collapsedByDefault = false,
}: {
  title: string;
  subtitle?: string;
  items: AdminWithdrawalItem[];
  emptyMessage: string;
  renderActions?: (w: AdminWithdrawalItem) => ReactNode;
  collapsedByDefault?: boolean;
}) {
  const [expanded, setExpanded] = useState(!collapsedByDefault);
  const total = items.reduce((s, w) => s + (w.amount || 0), 0);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-white/[0.02]"
      >
        <div>
          <h3 className="text-sm font-semibold text-gray-100">
            {title}{' '}
            <span className="text-gray-500 font-normal">
              · {items.length} {items.length === 1 ? 'item' : 'items'}{items.length > 0 ? ` · $${total.toLocaleString()}` : ''}
            </span>
          </h3>
          {subtitle && <p className="text-[11px] text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
        <span className="text-gray-500 text-sm">{expanded ? '−' : '+'}</span>
      </button>
      {expanded && (
        <div className="overflow-x-auto border-t border-white/[0.04]">
        <table className="w-full text-left text-sm min-w-[640px]">
          <thead className="bg-white/[0.03] text-[11px] uppercase text-gray-500 tracking-wider">
            <tr>
              <th className="px-4 py-2.5 font-medium">Created</th>
              <th className="px-4 py-2.5 font-medium">Wallet</th>
              <th className="px-4 py-2.5 font-medium text-right">Amount</th>
              {renderActions && <th className="px-4 py-2.5 font-medium">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={renderActions ? 4 : 3} className="px-4 py-6 text-center text-gray-500 text-xs">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              items.map((w) => (
                <tr key={w.id} className="border-t border-white/[0.04]">
                  <td className="px-4 py-2.5 text-xs text-gray-500">{formatDate(w.createdAt)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-300">{formatWallet(w.walletAddress)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-200">${w.amount.toLocaleString()}</td>
                  {renderActions && <td className="px-4 py-2.5">{renderActions(w)}</td>}
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}

/* ──────────── Promos ──────────── */

function PromosPanel({ items }: { items: AdminPromoItem[] }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <div className="overflow-x-auto">
      <table className="w-full text-left text-sm min-w-[640px]">
        <thead className="bg-white/[0.03] text-[11px] uppercase text-gray-500 tracking-wider">
          <tr>
            <th className="px-4 py-3 font-medium">Code</th>
            <th className="px-4 py-3 font-medium text-right">Discount</th>
            <th className="px-4 py-3 font-medium text-right">Uses</th>
            <th className="px-4 py-3 font-medium">Active</th>
            <th className="px-4 py-3 font-medium">Expires</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-10 text-center text-gray-500">
                No promos yet
              </td>
            </tr>
          ) : (
            items.map((p) => (
              <tr key={p.id} className="border-t border-white/[0.04]">
                <td className="px-4 py-3 font-mono text-xs text-gray-200">{p.code}</td>
                <td className="px-4 py-3 text-right text-gray-300">{p.discountPercent}%</td>
                <td className="px-4 py-3 text-right text-xs text-gray-400">
                  {p.currentUses}
                  {p.maxUses ? `/${p.maxUses}` : ''}
                </td>
                <td className="px-4 py-3">
                  {p.active ? (
                    <span className="text-green-400 text-xs">●</span>
                  ) : (
                    <span className="text-gray-600 text-xs">○</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">{formatDate(p.expiresAt)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}
