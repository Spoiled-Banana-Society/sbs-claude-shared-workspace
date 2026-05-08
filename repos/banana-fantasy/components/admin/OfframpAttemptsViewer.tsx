'use client';

import { useMemo, useState } from 'react';
import {
  useOfframpAttempts,
  AdminApiError,
  type OfframpAttemptEntry,
  type OfframpAttemptStatus,
  type OfframpSource,
} from '@/hooks/admin/useAdminApi';

const STATUS_FILTERS: { value: OfframpAttemptStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'session_created', label: 'Opened Coinbase' },
  { value: 'tx_pending', label: 'Cashout in progress' },
  { value: 'tx_completed', label: 'Money sent' },
  { value: 'tx_failed', label: 'Cashout failed' },
  { value: 'abandoned', label: "Didn't transact" },
];

// Plain-language explanation of each stage so an operator can tell a user
// where they are without needing to read the code.
function statusExplanation(status: OfframpAttemptStatus, source: OfframpSource): string {
  if (source === 'coinbase_offramp') {
    switch (status) {
      case 'session_created':
        return "User opened Coinbase popup. Hasn't picked an amount or signed the USDC tx yet (or hasn't returned to confirm).";
      case 'tx_pending':
        return 'Coinbase saw the USDC arrive. Converting to USD and waiting for bank deposit.';
      case 'tx_completed':
        return 'Money has landed in the user’s linked bank or Coinbase wallet. Done.';
      case 'tx_failed':
        return 'Coinbase rejected or canceled the cashout. Check error message and ask user to retry or contact Coinbase support.';
      case 'abandoned':
        return 'User opened the Coinbase popup but never sent USDC within 1 hour. Probably closed the popup or got stuck on Coinbase verification.';
    }
  }
  // Direct USDC / direct bank
  switch (status) {
    case 'session_created':
      return 'Direct withdrawal record opened (unusual — direct withdrawals normally land at tx_pending or later immediately).';
    case 'tx_pending':
      return 'Direct withdrawal queued. Waiting on backend payout job.';
    case 'tx_completed':
      return 'USDC sent to user wallet (or bank received funds). Done.';
    case 'tx_failed':
      return 'Backend payout failed. Check error message; may need ops intervention.';
    case 'abandoned':
      return 'Direct withdrawals shouldn’t be marked abandoned — log a bug if you see this.';
  }
  return '';
}

function statusShortLabel(status: OfframpAttemptStatus): string {
  switch (status) {
    case 'session_created':
      return 'opened coinbase';
    case 'tx_pending':
      return 'in progress';
    case 'tx_completed':
      return 'money sent';
    case 'tx_failed':
      return 'failed';
    case 'abandoned':
      return "didn't transact";
  }
}

function statusClasses(status: OfframpAttemptStatus): string {
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
    default:
      return 'bg-gray-500/15 text-gray-300 border-gray-500/40';
  }
}

function sourceLabel(s: OfframpSource): string {
  switch (s) {
    case 'coinbase_offramp':
      return 'Coinbase';
    case 'direct_usdc':
      return 'Direct USDC';
    case 'direct_bank':
      return 'Direct bank';
    default:
      return s;
  }
}

function sourceClasses(s: OfframpSource): string {
  switch (s) {
    case 'coinbase_offramp':
      return 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40';
    case 'direct_usdc':
      return 'bg-purple-500/15 text-purple-300 border-purple-500/40';
    case 'direct_bank':
      return 'bg-teal-500/15 text-teal-300 border-teal-500/40';
    default:
      return 'bg-gray-500/15 text-gray-300 border-gray-500/40';
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
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortWallet(w?: string): string {
  if (!w) return '—';
  return w.length < 12 ? w : `${w.slice(0, 6)}…${w.slice(-4)}`;
}

function durationBetween(a?: string, b?: string): string | null {
  if (!a || !b) return null;
  const da = Date.parse(a);
  const db = Date.parse(b);
  if (!Number.isFinite(da) || !Number.isFinite(db)) return null;
  const ms = Math.max(0, db - da);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  return `${Math.floor(ms / 3_600_000)}h`;
}

interface RowProps {
  attempt: OfframpAttemptEntry;
  isExpanded: boolean;
  onToggle: () => void;
}

function AttemptRow({ attempt, isExpanded, onToggle }: RowProps) {
  const sessionToTx = durationBetween(attempt.timestamp, attempt.txDetectedAt);
  const txToComplete = durationBetween(attempt.txDetectedAt, attempt.txCompletedAt);

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/60 hover:bg-gray-800/80 p-3 transition-colors">
      <button onClick={onToggle} className="w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span
                className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${statusClasses(
                  attempt.status,
                )}`}
              >
                {statusShortLabel(attempt.status)}
              </span>
              <span
                className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${sourceClasses(
                  attempt.source,
                )}`}
              >
                {sourceLabel(attempt.source)}
              </span>
              <span className="text-[11px] text-gray-500">{formatRelative(attempt.timestamp)}</span>
            </div>
            <p className="text-sm text-white font-medium">
              {attempt.amount != null ? `$${attempt.amount.toFixed(2)} USDC` : 'amount unknown'}
              {attempt.paymentMethod && (
                <span className="text-gray-400 font-normal text-[12px] ml-2">
                  via {attempt.paymentMethod}
                </span>
              )}
            </p>
            <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-500 font-mono flex-wrap">
              <span title={attempt.walletAddress || attempt.userId}>
                {shortWallet(attempt.walletAddress || attempt.userId)}
              </span>
              {sessionToTx && <span>session→tx {sessionToTx}</span>}
              {txToComplete && <span>tx→done {txToComplete}</span>}
              {attempt.draftId && <span>draft {attempt.draftId.slice(0, 8)}…</span>}
            </div>
          </div>
          <span className="text-xs text-gray-500 shrink-0">{isExpanded ? '−' : '+'}</span>
        </div>
      </button>

      {isExpanded && (
        <div className="mt-3 pt-3 border-t border-gray-700 space-y-2 text-[12px]">
          <div className="rounded-md bg-blue-500/10 border border-blue-500/30 px-3 py-2">
            <p className="text-blue-200 text-[12px] leading-relaxed">
              {statusExplanation(attempt.status, attempt.source)}
            </p>
          </div>

          {attempt.errorMessage && (
            <div className="rounded-md bg-red-500/10 border border-red-500/30 px-3 py-2">
              <p className="text-red-300 font-medium">{attempt.errorMessage}</p>
            </div>
          )}

          <dl className="space-y-0.5">
            <KvRow label="User ID" value={attempt.userId} mono />
            {attempt.walletAddress && <KvRow label="Wallet" value={attempt.walletAddress} mono />}
            <KvRow label="Source" value={sourceLabel(attempt.source)} />
            <KvRow label="Status" value={attempt.status} />
            {attempt.amount != null && <KvRow label="Amount" value={`$${attempt.amount.toFixed(2)}`} />}
            {attempt.paymentMethod && <KvRow label="Payment method" value={attempt.paymentMethod} />}
            {attempt.partnerUserId && <KvRow label="Partner user ID" value={attempt.partnerUserId} mono />}
            {attempt.coinbaseTxId && <KvRow label="Coinbase tx ID" value={attempt.coinbaseTxId} mono />}
            {attempt.coinbaseTxStatus && (
              <KvRow label="Coinbase tx status" value={attempt.coinbaseTxStatus} />
            )}
            {attempt.withdrawalId && <KvRow label="Withdrawal ID" value={attempt.withdrawalId} mono />}
            {attempt.draftId && <KvRow label="Draft ID" value={attempt.draftId} mono />}
            <KvRow label="Started" value={attempt.timestamp} />
            {attempt.txDetectedAt && <KvRow label="Tx detected" value={attempt.txDetectedAt} />}
            {attempt.txCompletedAt && <KvRow label="Tx completed" value={attempt.txCompletedAt} />}
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

export function OfframpAttemptsViewer({ enabled }: { enabled: boolean }) {
  const [statusFilter, setStatusFilter] = useState<OfframpAttemptStatus | ''>('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const query = useOfframpAttempts(enabled, statusFilter, 100);

  const attempts = query.data?.attempts ?? [];

  const summary = useMemo(() => {
    const totals = {
      total: attempts.length,
      completed: 0,
      pending: 0,
      failed: 0,
      abandoned: 0,
      volumeCompleted: 0,
    };
    for (const a of attempts) {
      if (a.status === 'tx_completed') {
        totals.completed += 1;
        if (typeof a.amount === 'number') totals.volumeCompleted += a.amount;
      } else if (a.status === 'tx_pending' || a.status === 'session_created') {
        totals.pending += 1;
      } else if (a.status === 'tx_failed') {
        totals.failed += 1;
      } else if (a.status === 'abandoned') {
        totals.abandoned += 1;
      }
    }
    return totals;
  }, [attempts]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Offramp / Cashout Attempts</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Every cashout attempt — Coinbase popup, direct USDC, future bank rail. Click a row for stage explanation.
          </p>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Auto-refreshes every 30s · {query.isFetching ? 'refreshing…' : `${attempts.length} shown`}
            {summary.completed > 0 && (
              <span className="text-green-300 ml-2">
                {summary.completed} completed · ${summary.volumeCompleted.toFixed(2)} volume
              </span>
            )}
            {summary.pending > 0 && (
              <span className="text-yellow-300 ml-2">{summary.pending} in-flight</span>
            )}
            {summary.failed > 0 && (
              <span className="text-red-300 ml-2">{summary.failed} failed</span>
            )}
            {summary.abandoned > 0 && (
              <span className="text-gray-400 ml-2">{summary.abandoned} abandoned</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as OfframpAttemptStatus | '')}
            className="text-xs bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-gray-200"
          >
            {STATUS_FILTERS.map((f) => (
              <option key={f.value || 'all'} value={f.value}>
                {f.label}
              </option>
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
          {(query.error as AdminApiError)?.message || 'Failed to load offramp attempts'}
        </div>
      )}

      {!query.isError && attempts.length === 0 && !query.isLoading ? (
        <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-8 text-center text-gray-500 text-sm">
          No offramp attempts {statusFilter ? `matching "${statusFilter.replace(/_/g, ' ')}"` : 'yet'}.
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
