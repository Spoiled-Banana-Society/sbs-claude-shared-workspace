'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as Sentry from '@sentry/nextjs';
import { useAuth } from '@/hooks/useAuth';
import { isWalletAdmin } from '@/lib/adminAllowlist';
import { useToast } from '@/components/ui/Toast';
import {
  useAdminWithdrawals,
  useAdminDrafts,
  useAdminPromos,
  useUpdateWithdrawalStatus,
  AdminApiError,
  type AdminWithdrawalItem,
  type AdminPromoItem,
} from '@/hooks/admin/useAdminApi';
import { UsersTable } from '@/components/admin/UsersTable';
import { KycAttemptsViewer } from '@/components/admin/KycAttemptsViewer';
import { OfframpAttemptsViewer } from '@/components/admin/OfframpAttemptsViewer';
import { ActivityCombined } from '@/components/admin/ActivityCombined';
import { LiveActivity } from '@/components/admin/LiveActivity';
import { MetricsDashboard } from '@/components/admin/MetricsDashboard';
import { ErrorLog } from '@/components/admin/ErrorLog';
import { SentryIssues } from '@/components/admin/SentryIssues';
import { SupportInbox } from '@/components/admin/SupportInbox';
import { AuditLog } from '@/components/admin/AuditLog';
import { AdminTools } from '@/components/admin/AdminTools';
import { SpectateBrowser } from '@/components/admin/SpectateBrowser';
import { CompletedDraftsList } from '@/components/admin/CompletedDraftsList';
import { FounderScheduleEditor } from '@/components/admin/FounderScheduleEditor';

type TabKey = 'metrics' | 'errors' | 'sentry' | 'support' | 'kyc' | 'offramp' | 'users' | 'drafts' | 'withdrawals' | 'promos' | 'live' | 'activity' | 'audit' | 'tools' | 'spectate' | 'founder';

interface NavItem {
  key: TabKey;
  label: string;
  group: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'metrics', label: 'Metrics', group: 'Monitoring' },
  { key: 'errors', label: 'Server Errors', group: 'Monitoring' },
  { key: 'sentry', label: 'Frontend Errors', group: 'Monitoring' },
  { key: 'support', label: 'Support', group: 'Monitoring' },
  { key: 'kyc', label: 'KYC Attempts', group: 'Monitoring' },
  { key: 'offramp', label: 'Offramps', group: 'Monitoring' },
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

function statusPill(status: string): string {
  const s = status.toLowerCase();
  if (['approved', 'completed', 'finished', 'active'].includes(s)) return 'bg-green-500/10 text-green-300 border-green-500/30';
  if (['denied', 'failed', 'cancelled', 'banned'].includes(s)) return 'bg-red-500/10 text-red-300 border-red-500/30';
  return 'bg-yellow-500/10 text-yellow-300 border-yellow-500/30';
}

export default function AdminPage() {
  const router = useRouter();
  const { walletAddress, isLoading } = useAuth();
  const { show } = useToast();

  const [activeTab, setActiveTab] = useState<TabKey>('metrics');
  const [isAuthorized, setIsAuthorized] = useState(false);

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
    <div className="min-h-screen bg-[#0a0a0b] text-white flex">
      {/* ─── Sidebar ─── */}
      <aside className="w-60 shrink-0 border-r border-white/[0.06] bg-black/20 backdrop-blur flex flex-col sticky top-0 h-screen">
        <div className="px-5 py-5 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <span className="text-xl">🍌</span>
            <div>
              <p className="text-sm font-semibold tracking-tight">SBS Admin</p>
              <p className="text-[10px] text-gray-500 font-mono">{formatWallet(walletAddress ?? '')}</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {groups.map(([group, items]) => (
            <div key={group}>
              <p className="px-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5">
                {group}
              </p>
              <div className="space-y-0.5">
                {items.map((item) => (
                  <button
                    key={item.key}
                    onClick={() => setActiveTab(item.key)}
                    className={`w-full text-left px-3 py-1.5 rounded-md text-sm transition-colors ${
                      activeTab === item.key
                        ? 'bg-white/[0.08] text-white font-medium'
                        : 'text-gray-400 hover:text-white hover:bg-white/[0.03]'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
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
        <header className="sticky top-0 z-10 border-b border-white/[0.06] bg-[#0a0a0b]/80 backdrop-blur px-8 py-4">
          <h1 className="text-xl font-semibold tracking-tight">{current.label}</h1>
          <p className="text-[12px] text-gray-500 mt-0.5">{current.group}</p>
        </header>

        <div className="px-8 py-6 max-w-[1400px]">
          {activeTab === 'metrics' && <MetricsDashboard enabled={isAuthorized} />}
          {activeTab === 'errors' && <ErrorLog enabled={isAuthorized} />}
          {activeTab === 'sentry' && <SentryIssues enabled={isAuthorized} />}
          {activeTab === 'support' && <SupportInbox enabled={isAuthorized} />}
          {activeTab === 'kyc' && <KycAttemptsViewer enabled={isAuthorized} />}
          {activeTab === 'offramp' && <OfframpAttemptsViewer enabled={isAuthorized} />}
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
  );
}

/* ──────────── Withdrawals ──────────── */

function WithdrawalsPanel({ items }: { items: AdminWithdrawalItem[] }) {
  const update = useUpdateWithdrawalStatus();
  const { show } = useToast();

  const handle = async (id: string, status: 'approved' | 'denied') => {
    try {
      const res = await update.mutateAsync({ id, status });
      show({ level: 'success', message: `Withdrawal ${status}`, requestId: res.requestId });
    } catch (err) {
      const e = err as AdminApiError;
      Sentry.captureException(e, {
        tags: { admin: true, action: 'withdrawal-status' },
        extra: { id, status, requestId: e.requestId },
      });
      show({ level: 'error', message: e.message, requestId: e.requestId });
    }
  };

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <table className="w-full text-left text-sm">
        <thead className="bg-white/[0.03] text-[11px] uppercase text-gray-500 tracking-wider">
          <tr>
            <th className="px-4 py-3 font-medium">Created</th>
            <th className="px-4 py-3 font-medium">Wallet</th>
            <th className="px-4 py-3 font-medium text-right">Amount</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-10 text-center text-gray-500">
                No withdrawals
              </td>
            </tr>
          ) : (
            items.map((w) => (
              <tr key={w.id} className="border-t border-white/[0.04]">
                <td className="px-4 py-3 text-xs text-gray-500">{formatDate(w.createdAt)}</td>
                <td className="px-4 py-3 font-mono text-xs text-gray-300">{formatWallet(w.walletAddress)}</td>
                <td className="px-4 py-3 text-right text-gray-200">${w.amount.toLocaleString()}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] border ${statusPill(w.status)}`}>
                    {w.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {w.status === 'pending' && (
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
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ──────────── Promos ──────────── */

function PromosPanel({ items }: { items: AdminPromoItem[] }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <table className="w-full text-left text-sm">
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
  );
}
