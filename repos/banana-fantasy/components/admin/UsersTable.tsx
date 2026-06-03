'use client';

import { useState, useEffect } from 'react';
import {
  useAdminUsers,
  useGrantDrafts,
  useBanUser,
  useMarkKycVerified,
  useResetUser,
  useZeroFreeDrafts,
  useReconcilePasses,
  useReturningWalletSet,
  AdminApiError,
  type AdminUser,
} from '@/hooks/admin/useAdminApi';
import { useToast } from '@/components/ui/Toast';
import { WalletLink } from '@/components/admin/WalletLink';
import { Bbb3HoldersCard } from '@/components/admin/Bbb3HoldersCard';
import { ViewAsToggle, PreviewBannersToggle, ResetAppBannerButton } from '@/components/admin/ViewAsToggle';

const LIMIT = 50;

function formatWallet(v: string) {
  if (!v) return '—';
  return v.length < 12 ? v : `${v.slice(0, 6)}…${v.slice(-4)}`;
}
function formatDate(v: string | null) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function UsersTable({ enabled }: { enabled: boolean }) {
  const [offset, setOffset] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');

  // Debounce search input by 350ms
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(searchInput);
      setOffset(0);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const query = useAdminUsers(enabled, offset, LIMIT, q);
  const users = query.data?.users ?? [];
  const total = query.data?.pagination.total ?? 0;
  const { set: returningSet } = useReturningWalletSet(enabled);

  return (
    <div className="space-y-4">
      <ViewAsToggle />
      <PreviewBannersToggle />
      <ResetAppBannerButton />
      <Bbb3HoldersCard enabled={enabled} />
      <ZeroFreeDraftsBanner />
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Search by wallet, username, or email…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="flex-1 px-4 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-[#F3E216]/50"
        />
        <span className="text-sm text-gray-500">
          {query.isLoading ? 'Loading…' : query.isError ? 'Error' : `${total.toLocaleString()} total`}
        </span>
      </div>

      {query.isError && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 text-red-200 text-sm px-4 py-3">
          {(query.error as AdminApiError)?.message || 'Failed to load users'}
          <button
            onClick={() => query.refetch()}
            className="ml-3 underline underline-offset-2 text-red-100 hover:text-white"
          >
            Retry
          </button>
        </div>
      )}

      <div className="rounded-xl border border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-left text-sm min-w-[720px]">
          <thead className="bg-gray-800/80 text-gray-400 text-xs uppercase tracking-wider">
            <tr>
              <th className="px-4 py-3">Wallet</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Username</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3 text-right">Paid</th>
              <th className="px-4 py-3 text-right">Free</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3 min-w-[220px]">Grant</th>
              <th className="px-4 py-3">KYC</th>
              <th className="px-4 py-3">Reset</th>
              <th className="px-4 py-3">Sync</th>
              <th className="px-4 py-3">Ban</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && !query.isLoading ? (
              <tr>
                <td colSpan={13} className="px-4 py-8 text-center text-gray-500">
                  {q ? `No users match "${q}"` : 'No users found'}
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  returning={returningSet.has((u.walletAddress || '').toLowerCase())}
                />
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>

      {!q && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">
            {users.length === 0 ? 0 : offset + 1}–{Math.min(offset + users.length, total)} of {total.toLocaleString()}
          </p>
          <div className="flex gap-2">
            <button
              disabled={offset === 0 || query.isFetching}
              onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              className="px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-800 text-xs disabled:opacity-40"
            >
              ← Prev
            </button>
            <button
              disabled={offset + users.length >= total || query.isFetching}
              onClick={() => setOffset(offset + LIMIT)}
              className="px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-800 text-xs disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function UserRow({ user, returning }: { user: AdminUser; returning: boolean }) {
  return (
    <tr className="border-t border-gray-800/50 hover:bg-gray-800/30 transition-colors">
      <td className="px-4 py-3 font-mono text-xs">
        <WalletLink wallet={user.walletAddress} bare className="hover:text-banana" />
      </td>
      <td className="px-4 py-3 text-xs">
        {returning ? (
          <span className="inline-flex rounded-full px-2 py-0.5 border border-[#F3E216]/40 bg-[#F3E216]/10 text-[#F3E216]">
            Returning
          </span>
        ) : (
          <span className="inline-flex rounded-full px-2 py-0.5 border border-gray-600/50 bg-gray-700/20 text-gray-300">
            New
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-gray-300 text-xs">{user.username || '—'}</td>
      <td className="px-4 py-3 text-gray-300 text-xs">{user.email || '—'}</td>
      <td className="px-4 py-3 text-right font-semibold text-white">{user.paidDrafts}</td>
      <td className="px-4 py-3 text-right font-semibold text-[#F3E216]">{user.freeDrafts}</td>
      <td className="px-4 py-3 text-xs">
        {user.banned ? (
          <span className="inline-flex rounded-full px-2 py-0.5 border border-red-500/40 bg-red-500/10 text-red-300">
            Banned
          </span>
        ) : (
          <span className="text-green-400">Active</span>
        )}
      </td>
      <td className="px-4 py-3 text-gray-400 text-xs">{formatDate(user.createdAt)}</td>
      <td className="px-4 py-3">
        <GrantInline userId={user.id} />
      </td>
      <td className="px-4 py-3">
        <KycButton userId={user.id} />
      </td>
      <td className="px-4 py-3">
        <ResetButton userId={user.id} />
      </td>
      <td className="px-4 py-3">
        <SyncButton wallet={user.walletAddress} />
      </td>
      <td className="px-4 py-3">
        <BanButton userId={user.id} banned={user.banned} />
      </td>
    </tr>
  );
}

function SyncButton({ wallet }: { wallet: string }) {
  const reconcile = useReconcilePasses();
  const { show } = useToast();
  const handle = async () => {
    try {
      const res = await reconcile.mutateAsync({ wallet });
      show({
        level: 'success',
        message: `Synced ${formatWallet(wallet)} — ${res.beforeCounter} → ${res.afterCounter} (on-chain: ${res.onChainCount})`,
        requestId: res.requestId,
      });
    } catch (err) {
      const e = err as AdminApiError;
      show({ level: 'error', message: e.message, requestId: e.requestId });
    }
  };
  return (
    <button
      onClick={handle}
      disabled={reconcile.isPending || !/^0x[0-9a-fA-F]{40}$/.test(wallet)}
      className="px-2 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white text-xs disabled:opacity-50"
      title="Reconcile Firestore + Go API to match on-chain BBB4 ownership"
    >
      {reconcile.isPending ? '…' : 'Sync'}
    </button>
  );
}

function GrantInline({ userId }: { userId: string }) {
  const [count, setCount] = useState('1');
  const grant = useGrantDrafts();
  const { show } = useToast();

  const handle = async () => {
    const n = Number(count);
    if (!Number.isInteger(n) || n === 0) {
      show({ level: 'warn', message: 'Enter a non-zero integer' });
      return;
    }
    try {
      const res = await grant.mutateAsync({ identifier: userId, count: n });
      const who = res.username || res.walletAddress || res.userId;
      const message = res.mintOnChain && res.txHash
        ? `✓ Minted ${n} NFT${n !== 1 ? 's' : ''} on Base to ${who} (now ${res.freeDrafts} free)`
        : `Granted ${n > 0 ? '+' : ''}${n} to ${who} — now ${res.freeDrafts}`;
      show({
        level: 'success',
        message,
        requestId: res.requestId,
        ...(res.txHash
          ? {
              action: {
                label: 'View on BaseScan ↗',
                onClick: () => window.open(`https://basescan.org/tx/${res.txHash}`, '_blank', 'noopener'),
              },
            }
          : {}),
      });
    } catch (err) {
      const e = err as AdminApiError;
      show({
        level: 'error',
        message: e.message || 'Grant failed',
        requestId: e.requestId,
      });
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        value={count}
        onChange={(e) => setCount(e.target.value)}
        className="w-16 px-2 py-1 rounded bg-gray-900 border border-gray-700 text-xs text-right"
      />
      <button
        onClick={handle}
        disabled={grant.isPending}
        className="px-3 py-1 rounded bg-[#F3E216] hover:bg-[#F3E216]/90 text-black text-xs font-semibold disabled:opacity-50"
      >
        {grant.isPending ? '…' : 'Grant'}
      </button>
    </div>
  );
}

function KycButton({ userId }: { userId: string }) {
  const kyc = useMarkKycVerified();
  const { show } = useToast();
  const handle = async () => {
    try {
      const res = await kyc.mutateAsync({ userId, tier: 'tier1', verified: true });
      show({
        level: 'success',
        message: `KYC Tier 1 verified for ${formatWallet(userId)}`,
        requestId: res.requestId,
      });
    } catch (err) {
      const e = err as AdminApiError;
      show({ level: 'error', message: e.message, requestId: e.requestId });
    }
  };
  return (
    <button
      onClick={handle}
      disabled={kyc.isPending}
      className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs disabled:opacity-50"
      title="Mark user as KYC Tier 1 verified (admin override)"
    >
      {kyc.isPending ? '…' : 'Verify'}
    </button>
  );
}

function ResetButton({ userId }: { userId: string }) {
  const reset = useResetUser();
  const { show } = useToast();
  const handle = async () => {
    if (!window.confirm(`Reset ${formatWallet(userId)}? Clears draftPasses, freeDrafts, wheelSpins, cardPurchaseCount, JP/HOF entries, onboarding flags (hasSpunWheel, firstPurchaseBonusGranted, firstPurchasePromoUnlocked), AND re-enables the New User promo (clears the X-link claim) so the full new-user flow can re-run.`)) {
      return;
    }
    try {
      const res = await reset.mutateAsync({ userId });
      show({
        level: 'success',
        message: `Reset ${formatWallet(userId)}`,
        requestId: res.requestId,
      });
    } catch (err) {
      const e = err as AdminApiError;
      show({ level: 'error', message: e.message, requestId: e.requestId });
    }
  };
  return (
    <button
      onClick={handle}
      disabled={reset.isPending}
      className="px-2 py-1 rounded bg-orange-600 hover:bg-orange-500 text-white text-xs disabled:opacity-50"
      title="Clear user's counters so flows can be re-run"
    >
      {reset.isPending ? '…' : 'Reset'}
    </button>
  );
}

function ZeroFreeDraftsBanner() {
  const zero = useZeroFreeDrafts();
  const { show } = useToast();

  const handle = async () => {
    if (
      !window.confirm(
        'Zero ALL users freeDrafts counters? This clears every ghost free-draft that isn\'t backed by a real BBB4 NFT. Cannot be undone. Continue?',
      )
    ) {
      return;
    }
    try {
      const res = await zero.mutateAsync();
      show({
        level: 'success',
        message: `Cleared ${res.totalFreeDraftsCleared} free drafts across ${res.zeroedUsers} user${res.zeroedUsers !== 1 ? 's' : ''}.`,
        requestId: res.requestId,
      });
    } catch (err) {
      const e = err as AdminApiError;
      show({ level: 'error', message: e.message, requestId: e.requestId });
    }
  };

  return (
    <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 px-4 py-3 flex items-center justify-between gap-3">
      <div className="text-xs text-orange-200/90 leading-snug">
        <span className="font-semibold text-orange-100">Danger zone:</span> zero every user&apos;s{' '}
        <code className="font-mono">freeDrafts</code> counter. Use once to clear pre-NFT ghost passes — from this point on the counter is dual-written with on-chain mints.
      </div>
      <button
        onClick={handle}
        disabled={zero.isPending}
        className="shrink-0 px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-xs font-semibold disabled:opacity-50"
      >
        {zero.isPending ? 'Zeroing…' : 'Zero All Free Drafts'}
      </button>
    </div>
  );
}

function BanButton({ userId, banned }: { userId: string; banned: boolean }) {
  const ban = useBanUser();
  const { show } = useToast();
  const handle = async () => {
    try {
      const res = await ban.mutateAsync({ userId, banned: !banned });
      show({
        level: 'success',
        message: res.banned ? `Banned ${formatWallet(userId)}` : `Unbanned ${formatWallet(userId)}`,
        requestId: res.requestId,
      });
    } catch (err) {
      const e = err as AdminApiError;
      show({ level: 'error', message: e.message, requestId: e.requestId });
    }
  };
  return (
    <button
      onClick={handle}
      disabled={ban.isPending}
      className={`px-2 py-1 rounded text-white text-xs disabled:opacity-50 ${banned ? 'bg-green-600 hover:bg-green-500' : 'bg-red-600 hover:bg-red-500'}`}
    >
      {ban.isPending ? '…' : banned ? 'Unban' : 'Ban'}
    </button>
  );
}
