'use client';

import { useState } from 'react';
import {
  useOnrampAttempts,
  AdminApiError,
  type OnrampAttemptEntry,
  type OnrampAttemptStatus,
  type OnrampProvider,
} from '@/hooks/admin/useAdminApi';
import { WalletLink } from '@/components/admin/WalletLink';

const STATUS_FILTERS: { value: OnrampAttemptStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'session_created', label: 'Opened popup' },
  { value: 'tx_pending', label: 'Tx pending' },
  { value: 'tx_completed', label: 'Purchase complete' },
  { value: 'tx_failed', label: 'Failed' },
  { value: 'abandoned', label: "Didn't transact" },
];

const PROVIDER_FILTERS: { value: OnrampProvider | ''; label: string }[] = [
  { value: '', label: 'All providers' },
  { value: 'coinbase', label: 'Coinbase' },
  { value: 'moonpay', label: 'MoonPay' },
];

function statusClasses(status: OnrampAttemptStatus): string {
  switch (status) {
    case 'tx_completed':
      return 'bg-green-500/15 text-green-300 border-green-500/40';
    case 'tx_pending':
      return 'bg-yellow-500/15 text-yellow-300 border-yellow-500/40';
    case 'session_created':
      return 'bg-blue-500/15 text-blue-300 border-blue-500/40';
    case 'tx_failed':
      return 'bg-red-500/15 text-red-300 border-red-500/40';
    case 'abandoned':
      return 'bg-gray-500/15 text-gray-300 border-gray-500/40';
  }
}

function statusShortLabel(status: OnrampAttemptStatus): string {
  switch (status) {
    case 'session_created': return 'opened popup';
    case 'tx_pending': return 'tx pending';
    case 'tx_completed': return 'purchase complete';
    case 'tx_failed': return 'failed';
    case 'abandoned': return "didn't transact";
  }
}

function providerLabel(p: OnrampProvider): string {
  return p === 'coinbase' ? 'Coinbase' : 'MoonPay';
}

function providerClasses(p: OnrampProvider): string {
  return p === 'coinbase'
    ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40'
    : 'bg-purple-500/15 text-purple-300 border-purple-500/40';
}

function failureReasonExplanation(reason: string): string {
  switch (reason.toUpperCase()) {
    case 'LIMIT_EXCEEDED':
    case 'BUY_LIMIT_EXCEEDED':
    case 'WEEKLY_LIMIT_EXCEEDED':
      return "User hit Coinbase's $500 weekly purchase limit. They'll need to use MoonPay or wait for the rolling window to reset.";
    case 'PAYMENT_DECLINED':
    case 'CARD_DECLINED':
      return "User's card was declined by Coinbase. Could be insufficient funds, fraud check, or expired card.";
    case 'CANCELED':
    case 'CANCELLED':
    case 'USER_CANCELED':
      return 'User cancelled the Coinbase popup before completing payment.';
    case 'KYC_REQUIRED':
    case 'IDENTITY_VERIFICATION_REQUIRED':
      return 'Coinbase required additional identity verification. User would need to complete CB KYC or switch providers.';
    case 'GEO_RESTRICTED':
    case 'REGION_NOT_SUPPORTED':
      return "Coinbase isn't available in the user's region for this purchase type.";
    default:
      return `Coinbase reported failure with reason "${reason}". Check Coinbase dashboard for more.`;
  }
}

function formatRelative(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

interface RowProps {
  attempt: OnrampAttemptEntry;
  isExpanded: boolean;
  onToggle: () => void;
}

function AttemptRow({ attempt, isExpanded, onToggle }: RowProps) {
  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/60 hover:bg-gray-800/80 p-3 transition-colors">
      <button onClick={onToggle} className="w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${statusClasses(attempt.status)}`}>
                {statusShortLabel(attempt.status)}
              </span>
              <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${providerClasses(attempt.provider)}`}>
                {providerLabel(attempt.provider)}
              </span>
              <span className="text-[11px] text-gray-500">{formatRelative(attempt.timestamp)}</span>
            </div>
            <p className="text-sm text-white font-medium">
              {attempt.amount != null ? `$${attempt.amount.toFixed(2)} USDC` : 'amount unknown'}
              {attempt.passQuantity ? (
                <span className="text-gray-400 font-normal text-[12px] ml-2">
                  · {attempt.passQuantity} {attempt.passQuantity === 1 ? 'pass' : 'passes'}
                </span>
              ) : null}
            </p>
            <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-500 font-mono flex-wrap">
              <WalletLink wallet={attempt.walletAddress || attempt.userId} bare className="hover:!text-banana" />
              {attempt.failureReason && (
                <span className="text-red-300 font-sans normal-case">{attempt.failureReason}</span>
              )}
            </div>
          </div>
          <span className="text-xs text-gray-500 shrink-0">{isExpanded ? '−' : '+'}</span>
        </div>
      </button>

      {isExpanded && (
        <div className="mt-3 pt-3 border-t border-gray-700 space-y-2 text-[12px]">
          {attempt.status === 'tx_failed' && attempt.failureReason && (
            <div className="rounded-md bg-red-500/10 border border-red-500/30 px-3 py-2">
              <p className="text-red-300 font-medium text-[12px] mb-1">
                Why this failed: {attempt.failureReason}
              </p>
              <p className="text-red-200/80 text-[11px]">
                {failureReasonExplanation(attempt.failureReason)}
              </p>
              {attempt.failureMessage && (
                <p className="text-red-200/70 text-[11px] mt-2 italic">
                  Shown to user: &ldquo;{attempt.failureMessage}&rdquo;
                </p>
              )}
              {attempt.nextAvailableAt && (
                <p className="text-red-200/70 text-[11px] mt-1">
                  Coinbase resets for them: {new Date(attempt.nextAvailableAt).toLocaleString()}
                </p>
              )}
            </div>
          )}

          <dl className="space-y-0.5">
            <KvRow label="User ID" value={attempt.userId} mono />
            {attempt.walletAddress && <KvRow label="Wallet" value={attempt.walletAddress} mono />}
            <KvRow label="Provider" value={providerLabel(attempt.provider)} />
            <KvRow label="Status" value={attempt.status} />
            {attempt.amount != null && <KvRow label="Amount" value={`$${attempt.amount.toFixed(2)} USDC`} />}
            {attempt.passQuantity != null && <KvRow label="Passes" value={String(attempt.passQuantity)} />}
            {attempt.partnerUserId && <KvRow label="Partner user ID" value={attempt.partnerUserId} mono />}
            {attempt.coinbaseTxId && <KvRow label="Coinbase tx ID" value={attempt.coinbaseTxId} mono />}
            {attempt.coinbaseTxStatus && <KvRow label="Coinbase status" value={attempt.coinbaseTxStatus} />}
            {attempt.mintTxHash && <KvRow label="Mint tx hash" value={attempt.mintTxHash} mono />}
            <KvRow label="Started" value={attempt.timestamp} />
            {attempt.txCompletedAt && <KvRow label="Completed" value={attempt.txCompletedAt} />}
            <KvRow label="Last update" value={attempt.updatedAt} />
          </dl>
        </div>
      )}
    </div>
  );
}

function KvRow({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div className="flex gap-2 text-[12px]">
      <dt className="text-gray-500 w-32 shrink-0">{label}</dt>
      <dd className={`text-gray-200 break-all ${mono ? 'font-mono text-[11px]' : ''}`}>{value || '—'}</dd>
    </div>
  );
}

export function OnrampAttemptsViewer({ enabled }: { enabled: boolean }) {
  const [statusFilter, setStatusFilter] = useState<OnrampAttemptStatus | ''>('');
  const [providerFilter, setProviderFilter] = useState<OnrampProvider | ''>('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const query = useOnrampAttempts(enabled, statusFilter, 100);

  // Provider filter applied client-side (the API supports server-side
  // too but combining filters there requires composite Firestore
  // indexes; client-side filter from a 100-item page is fine).
  const attempts = (query.data?.attempts ?? []).filter((a) =>
    !providerFilter || a.provider === providerFilter,
  );

  const summary = (() => {
    const t = { total: attempts.length, completed: 0, failed: 0, pending: 0, abandoned: 0, volume: 0 };
    for (const a of attempts) {
      if (a.status === 'tx_completed') {
        t.completed += 1;
        if (typeof a.amount === 'number') t.volume += a.amount;
      } else if (a.status === 'tx_failed') t.failed += 1;
      else if (a.status === 'session_created' || a.status === 'tx_pending') t.pending += 1;
      else if (a.status === 'abandoned') t.abandoned += 1;
    }
    return t;
  })();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Onramp / Purchase attempts</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Every draft-pass purchase attempt — Coinbase + MoonPay. Click a row to see why a failure happened.
          </p>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Auto-refreshes every 30s · {query.isFetching ? 'refreshing…' : `${attempts.length} shown`}
            {summary.completed > 0 && (
              <span className="text-green-300 ml-2">
                {summary.completed} complete · ${summary.volume.toFixed(2)} volume
              </span>
            )}
            {summary.failed > 0 && <span className="text-red-300 ml-2">{summary.failed} failed</span>}
            {summary.pending > 0 && <span className="text-yellow-300 ml-2">{summary.pending} in-flight</span>}
            {summary.abandoned > 0 && <span className="text-gray-400 ml-2">{summary.abandoned} abandoned</span>}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as OnrampAttemptStatus | '')}
            className="text-xs bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-gray-200"
          >
            {STATUS_FILTERS.map((f) => (
              <option key={f.value || 'all'} value={f.value}>{f.label}</option>
            ))}
          </select>
          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value as OnrampProvider | '')}
            className="text-xs bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-gray-200"
          >
            {PROVIDER_FILTERS.map((f) => (
              <option key={f.value || 'all'} value={f.value}>{f.label}</option>
            ))}
          </select>
          <button
            onClick={() => query.refetch()}
            className="text-xs text-gray-400 hover:text-white underline underline-offset-2"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {query.isError && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 text-red-200 text-sm px-4 py-3">
          {(query.error as AdminApiError)?.message || 'Failed to load onramp attempts'}
        </div>
      )}

      {!query.isError && attempts.length === 0 && !query.isLoading ? (
        <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-8 text-center text-gray-500 text-sm">
          No onramp attempts {statusFilter || providerFilter ? 'matching filters' : 'yet'}.
        </div>
      ) : (
        <div className="space-y-2">
          {attempts.map((a) => (
            <AttemptRow
              key={a.id}
              attempt={a}
              isExpanded={expandedId === a.id}
              onToggle={() => setExpandedId(expandedId === a.id ? null : a.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
