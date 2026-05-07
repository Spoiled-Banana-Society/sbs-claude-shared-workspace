'use client';

import { useMemo, useState } from 'react';
import {
  useKycAttempts,
  AdminApiError,
  type KycAttemptEntry,
  type KycAttemptStatus,
} from '@/hooks/admin/useAdminApi';

const STATUS_FILTERS: { value: KycAttemptStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'approved', label: 'Approved' },
  { value: 'didit_declined', label: 'Didit declined' },
  { value: 'name_mismatch', label: 'Name mismatch' },
  { value: 'dob_mismatch', label: 'DOB mismatch' },
  { value: 'blocked', label: 'Blocked (rules)' },
  { value: 'error', label: 'Error' },
  { value: 'invalid_input', label: 'Invalid input' },
];

function statusClasses(status: KycAttemptStatus): string {
  switch (status) {
    case 'approved':
      return 'bg-green-500/15 text-green-300 border-green-500/40';
    case 'didit_declined':
    case 'name_mismatch':
    case 'dob_mismatch':
      return 'bg-orange-500/15 text-orange-300 border-orange-500/40';
    case 'blocked':
      return 'bg-red-500/15 text-red-300 border-red-500/40';
    case 'error':
      return 'bg-red-500/15 text-red-300 border-red-500/40';
    case 'invalid_input':
      return 'bg-gray-500/15 text-gray-300 border-gray-500/40';
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

function shortHash(h?: string): string {
  if (!h) return '—';
  return `${h.slice(0, 8)}…${h.slice(-4)}`;
}

function shortWallet(w?: string): string {
  if (!w) return '—';
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
}

interface AttemptRowProps {
  attempt: KycAttemptEntry;
  isExpanded: boolean;
  isCollision: boolean;
  collisionUserIds: string[];
  onToggle: () => void;
}

function AttemptRow({ attempt, isExpanded, isCollision, collisionUserIds, onToggle }: AttemptRowProps) {
  const fullName = `${attempt.formData.firstName} ${attempt.formData.lastName}`.trim() || '—';

  return (
    <div
      className={`rounded-xl border p-3 transition-colors ${
        isCollision
          ? 'border-yellow-500/60 bg-yellow-500/5'
          : 'border-gray-700 bg-gray-800/60 hover:bg-gray-800/80'
      }`}
    >
      <button
        onClick={onToggle}
        className="w-full text-left"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span
                className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${statusClasses(
                  attempt.status,
                )}`}
              >
                {attempt.status.replace(/_/g, ' ')}
              </span>
              {isCollision && (
                <span
                  className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border border-yellow-500/60 bg-yellow-500/15 text-yellow-200"
                  title={`Same identity hash as ${collisionUserIds.length} other user(s)`}
                >
                  ⚠ multi-account
                </span>
              )}
              <span className="text-[11px] text-gray-500">{formatRelative(attempt.timestamp)}</span>
            </div>
            <p className="text-sm text-white font-medium truncate">{fullName}</p>
            <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-500 font-mono">
              <span title={attempt.walletAddress || ''}>wallet {shortWallet(attempt.walletAddress)}</span>
              <span title={attempt.identityHash || ''}>id-hash {shortHash(attempt.identityHash)}</span>
              {attempt.formData.state && <span>{attempt.formData.state}</span>}
              {attempt.imageSizeKb ? <span>{attempt.imageSizeKb}KB</span> : null}
              {attempt.durationMs ? <span>{(attempt.durationMs / 1000).toFixed(1)}s</span> : null}
            </div>
          </div>
          <span className="text-xs text-gray-500 shrink-0">{isExpanded ? '−' : '+'}</span>
        </div>
      </button>

      {isExpanded && (
        <div className="mt-3 pt-3 border-t border-gray-700 space-y-3 text-[12px]">
          {(attempt.blockReason || attempt.errorMessage) && (
            <div className="rounded-md bg-red-500/10 border border-red-500/30 px-3 py-2">
              <p className="text-red-300 font-medium">
                {attempt.blockReason || attempt.errorMessage}
              </p>
              {attempt.blockCode && (
                <p className="text-red-400/80 text-[10px] font-mono mt-1">
                  block code: {attempt.blockCode}
                </p>
              )}
            </div>
          )}

          {attempt.didit?.warnings && attempt.didit.warnings.length > 0 && (
            <div className="rounded-md bg-orange-500/10 border border-orange-500/30 px-3 py-2">
              <p className="text-orange-300 font-medium text-[11px] mb-1">Didit warnings</p>
              <ul className="list-disc list-inside text-orange-200/90 text-[11px]">
                {attempt.didit.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Form values (typed)</p>
              <dl className="space-y-0.5">
                <KvRow label="Name" value={fullName} />
                <KvRow label="DOB" value={attempt.formData.dateOfBirth} />
                <KvRow
                  label="Address"
                  value={[
                    attempt.formData.street,
                    attempt.formData.city,
                    attempt.formData.state,
                    attempt.formData.zip,
                    attempt.formData.country,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                />
              </dl>
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Didit extracted</p>
              {attempt.didit ? (
                <dl className="space-y-0.5">
                  <KvRow label="Status" value={attempt.didit.status} />
                  <KvRow
                    label="Name on ID"
                    value={
                      [attempt.didit.extractedFirstName, attempt.didit.extractedLastName]
                        .filter(Boolean)
                        .join(' ') || '—'
                    }
                  />
                  <KvRow label="DOB on ID" value={attempt.didit.extractedDob} />
                  <KvRow label="Doc type" value={attempt.didit.documentType} />
                  <KvRow label="Doc #" value={attempt.didit.documentNumber} />
                  <KvRow label="Request ID" value={attempt.didit.requestId} mono />
                </dl>
              ) : (
                <p className="text-gray-500 italic">Didit not called (rejected before)</p>
              )}
            </div>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Diagnostics</p>
            <dl className="space-y-0.5">
              <KvRow label="User ID" value={attempt.userId} mono />
              {attempt.walletAddress && <KvRow label="Wallet" value={attempt.walletAddress} mono />}
              <KvRow label="Identity hash" value={attempt.identityHash} mono />
              <KvRow label="Timestamp" value={attempt.timestamp} />
              {isCollision && (
                <KvRow
                  label="⚠ Other userIds with same hash"
                  value={collisionUserIds.join(', ')}
                  mono
                />
              )}
            </dl>
          </div>
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

export function KycAttemptsViewer({ enabled }: { enabled: boolean }) {
  const [statusFilter, setStatusFilter] = useState<KycAttemptStatus | ''>('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const query = useKycAttempts(enabled, statusFilter, 100);

  const attempts = query.data?.attempts ?? [];

  // Build a map of identity-hash → list of distinct userIds. Anything with
  // >1 distinct userId is a sybil candidate (same person, multiple accounts).
  const collisionMap = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const a of attempts) {
      if (!a.identityHash || a.status !== 'approved') continue;
      const existing = m.get(a.identityHash);
      if (existing) {
        existing.add(a.userId);
      } else {
        m.set(a.identityHash, new Set([a.userId]));
      }
    }
    return m;
  }, [attempts]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">KYC Verification Attempts</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Auto-refreshes every 30s · {query.isFetching ? 'refreshing…' : `${attempts.length} shown`}
            {collisionMap.size > 0 &&
              Array.from(collisionMap.values()).some((s) => s.size > 1) && (
                <span className="text-yellow-300 ml-2">
                  ⚠ {Array.from(collisionMap.values()).filter((s) => s.size > 1).length} multi-account hash(es)
                </span>
              )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as KycAttemptStatus | '')}
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
          {(query.error as AdminApiError)?.message || 'Failed to load KYC attempts'}
        </div>
      )}

      {!query.isError && attempts.length === 0 && !query.isLoading ? (
        <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-8 text-center text-gray-500 text-sm">
          No KYC attempts {statusFilter ? `matching "${statusFilter.replace(/_/g, ' ')}"` : 'yet'}.
        </div>
      ) : (
        <div className="space-y-2">
          {attempts.map((a) => {
            const otherUserIds = a.identityHash
              ? Array.from(collisionMap.get(a.identityHash) ?? []).filter((u) => u !== a.userId)
              : [];
            const isCollision = otherUserIds.length > 0;
            return (
              <AttemptRow
                key={a.id}
                attempt={a}
                isExpanded={expandedId === a.id}
                isCollision={isCollision}
                collisionUserIds={otherUserIds}
                onToggle={() => setExpandedId(expandedId === a.id ? null : a.id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
