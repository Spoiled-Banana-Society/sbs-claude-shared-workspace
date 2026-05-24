'use client';

/**
 * Inline action panel for User Lookup. Reuses the existing mutations
 * from useAdminApi.ts (UsersTable's grant/ban/reset/reconcile/kyc-verify)
 * so admin actions taken here are 100% equivalent to the ones from the
 * Users table — no parallel implementation.
 *
 * Each action is a small composable button + optional input. Confirmation
 * lives at the button level (window.confirm) since these are admin tools
 * used by a known operator, not end users.
 */

import { useState } from 'react';
import {
  useAdminAuthHeaders,
  useGrantDrafts,
  useResetUser,
  useReconcilePasses,
  useBanUser,
  useMarkKycVerified,
} from '@/hooks/admin/useAdminApi';
import { useQueryClient } from '@tanstack/react-query';

interface Props {
  wallet: string;
  banned: boolean;
  kycApproved: boolean;
}

export function ActionsPanel({ wallet, banned, kycApproved }: Props) {
  return (
    <section
      className="rounded-xl border border-[#F3E216]/30 bg-[#F3E216]/[0.04] p-4 md:sticky md:top-4"
      aria-label="User actions"
    >
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[#F3E216]/90">
        Actions
      </h3>
      <div className="mt-3 space-y-3">
        <GrantDraftsControl wallet={wallet} />
        <SendUsdcControl wallet={wallet} />
        <SendTestPingControl wallet={wallet} />
        <div className="flex flex-wrap gap-2">
          <ReconcileBtn wallet={wallet} />
          <ResetBtn wallet={wallet} />
          {!kycApproved && <KycBtn wallet={wallet} />}
          <BanBtn wallet={wallet} banned={banned} />
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────── Grant drafts */

function GrantDraftsControl({ wallet }: { wallet: string }) {
  const [count, setCount] = useState('1');
  const grant = useGrantDrafts();
  return (
    <form
      className="space-y-1"
      onSubmit={async (e) => {
        e.preventDefault();
        const n = Number.parseInt(count, 10);
        if (!Number.isFinite(n) || n === 0 || grant.isPending) return;
        if (!window.confirm(`Grant ${n} free draft${n === 1 ? '' : 's'} to ${wallet}?`))
          return;
        try {
          await grant.mutateAsync({ identifier: wallet, count: n });
          setCount('1');
        } catch {
          /* error surfaces below */
        }
      }}
    >
      <Label>Grant free drafts (negative = subtract)</Label>
      <div className="flex gap-2">
        <input
          type="number"
          value={count}
          onChange={(e) => setCount(e.target.value)}
          min={-1000}
          max={1000}
          className="w-16 rounded-md border border-gray-700 bg-gray-950/60 px-2 py-1 text-sm text-white outline-none focus:border-[#F3E216]/50"
        />
        <button
          type="submit"
          disabled={grant.isPending}
          className="flex-1 rounded-md bg-[#F3E216] px-3 py-1 text-xs font-semibold text-black transition-opacity disabled:opacity-40"
        >
          {grant.isPending ? 'Granting…' : 'Grant'}
        </button>
      </div>
      {grant.error && <FieldErr>{grant.error.message}</FieldErr>}
      {grant.data && (
        <p className="text-[11px] text-emerald-300">
          ✓ {grant.data.granted > 0 ? '+' : ''}
          {grant.data.granted} — now {grant.data.freeDrafts} free
          {grant.data.txHash && (
            <span className="ml-1 text-gray-500">tx {grant.data.txHash.slice(0, 8)}…</span>
          )}
        </p>
      )}
    </form>
  );
}

/* ─────────────────────────────────────── Send USDC (NEW endpoint stub) */

function SendUsdcControl({ wallet }: { wallet: string }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const getHeaders = useAdminAuthHeaders();
  const qc = useQueryClient();
  return (
    <form
      className="space-y-1"
      onSubmit={async (e) => {
        e.preventDefault();
        const n = Number(amount);
        if (!Number.isFinite(n) || n <= 0 || busy) return;
        const r = reason.trim();
        if (!r) {
          setResult('Reason required (logged in audit).');
          return;
        }
        if (!window.confirm(`Send $${n.toFixed(2)} USDC to ${wallet}?\n\nReason: ${r}`))
          return;
        setBusy(true);
        setResult(null);
        try {
          const headers = await getHeaders();
          const res = await fetch('/api/admin/send-usdc', {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ wallet, amount: n, reason: r }),
          });
          const data = (await res.json()) as {
            ok?: boolean;
            txHash?: string;
            error?: string;
          };
          if (!res.ok || !data.ok) {
            setResult(`failed: ${data.error ?? res.status}`);
          } else {
            setResult(`✓ sent · ${data.txHash?.slice(0, 10)}…`);
            setAmount('');
            setReason('');
            qc.invalidateQueries({ queryKey: ['admin', 'user-lookup', wallet.toLowerCase()] });
            qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
          }
        } catch (err) {
          setResult(`failed: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Label>Send USDC (refund / comp / bonus)</Label>
      <div className="flex gap-2">
        <input
          type="number"
          step="0.01"
          min={0}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="$"
          className="w-20 rounded-md border border-gray-700 bg-gray-950/60 px-2 py-1 text-sm text-white outline-none focus:border-[#F3E216]/50"
        />
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (logged)"
          className="flex-1 rounded-md border border-gray-700 bg-gray-950/60 px-2 py-1 text-sm text-white outline-none focus:border-[#F3E216]/50"
        />
        <button
          type="submit"
          disabled={busy || !amount || !reason.trim()}
          className="rounded-md border border-emerald-500/40 bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-200 transition-opacity disabled:opacity-40"
        >
          {busy ? '…' : 'Send'}
        </button>
      </div>
      {result && (
        <p
          className={`text-[11px] ${
            result.startsWith('✓') ? 'text-emerald-300' : 'text-red-300'
          }`}
        >
          {result}
        </p>
      )}
    </form>
  );
}

/* ─────────────────────────────────────── Send test ping */

function SendTestPingControl({ wallet }: { wallet: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const getHeaders = useAdminAuthHeaders();
  return (
    <div>
      <Label>Send test notification</Label>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setResult(null);
          try {
            const headers = await getHeaders();
            const res = await fetch('/api/admin/notifications/test-ping', {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({ wallet }),
            });
            const data = (await res.json()) as {
              ok?: boolean;
              report?: {
                channels?: {
                  channel: string;
                  status: string;
                  recipients?: number;
                  reason?: string;
                }[];
              };
              error?: string;
            };
            if (!res.ok || !data.ok) {
              setResult(`failed: ${data.error ?? res.status}`);
            } else {
              const channels = data.report?.channels ?? [];
              setResult(
                channels
                  .map((c) =>
                    c.status === 'sent'
                      ? `${c.channel}:✓${c.recipients !== undefined ? `(${c.recipients})` : ''}`
                      : `${c.channel}:${c.status}`,
                  )
                  .join(' · '),
              );
            }
          } catch (e) {
            setResult(`failed: ${e instanceof Error ? e.message : String(e)}`);
          } finally {
            setBusy(false);
          }
        }}
        className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-1 text-xs text-gray-200 transition-colors hover:border-[#F3E216]/50 hover:text-[#F3E216] disabled:opacity-40"
      >
        {busy ? 'Sending…' : 'Fire test (all channels)'}
      </button>
      {result && (
        <p className="mt-1 break-words text-[10px] font-mono text-gray-400">{result}</p>
      )}
    </div>
  );
}

/* ─────────────────────────────────────── Small button mutations */

function ReconcileBtn({ wallet }: { wallet: string }) {
  const m = useReconcilePasses();
  return (
    <SmallBtn
      label={m.isPending ? 'Syncing…' : 'Reconcile passes'}
      onClick={() =>
        window.confirm(`Reconcile on-chain pass count for ${wallet}?`) &&
        m.mutate({ wallet })
      }
      busy={m.isPending}
      result={m.data && `now ${m.data.afterCounter}`}
      error={m.error?.message}
    />
  );
}

function ResetBtn({ wallet }: { wallet: string }) {
  const m = useResetUser();
  return (
    <SmallBtn
      tone="danger"
      label={m.isPending ? 'Resetting…' : 'Reset counters'}
      onClick={() =>
        window.confirm(
          `Zero ALL counters for ${wallet}? (free, passes, spins, JP/HOF, purchases)`,
        ) && m.mutate({ userId: wallet })
      }
      busy={m.isPending}
      result={m.data?.success ? 'reset ✓' : undefined}
      error={m.error?.message}
    />
  );
}

function KycBtn({ wallet }: { wallet: string }) {
  const m = useMarkKycVerified();
  return (
    <SmallBtn
      label={m.isPending ? '…' : 'Mark KYC verified'}
      onClick={() =>
        window.confirm(`Mark Tier 1 KYC verified for ${wallet}? (admin override)`) &&
        m.mutate({ userId: wallet, tier: 'tier1', verified: true })
      }
      busy={m.isPending}
      result={m.data?.success ? 'verified ✓' : undefined}
      error={m.error?.message}
    />
  );
}

function BanBtn({ wallet, banned }: { wallet: string; banned: boolean }) {
  const m = useBanUser();
  return (
    <SmallBtn
      tone={banned ? undefined : 'danger'}
      label={m.isPending ? '…' : banned ? 'Unban' : 'Ban'}
      onClick={() =>
        window.confirm(`${banned ? 'Unban' : 'BAN'} ${wallet}?`) &&
        m.mutate({ userId: wallet, banned: !banned })
      }
      busy={m.isPending}
      error={m.error?.message}
    />
  );
}

/* ─────────────────────────────────────── Tiny shared bits */

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[10px] uppercase tracking-wider text-gray-500">
      {children}
    </label>
  );
}

function FieldErr({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-red-300">{children}</p>;
}

function SmallBtn({
  label,
  onClick,
  busy,
  tone,
  result,
  error,
}: {
  label: string;
  onClick: () => void;
  busy: boolean;
  tone?: 'danger';
  result?: string;
  error?: string;
}) {
  const baseStyle =
    tone === 'danger'
      ? 'border-red-500/40 bg-red-500/10 text-red-200 hover:bg-red-500/15'
      : 'border-gray-700 bg-gray-800 text-gray-200 hover:border-[#F3E216]/40 hover:text-[#F3E216]';
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className={`rounded-md border px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-40 ${baseStyle}`}
      >
        {label}
      </button>
      {result && <span className="mt-0.5 text-[10px] text-emerald-300">✓ {result}</span>}
      {error && <span className="mt-0.5 text-[10px] text-red-300">{error}</span>}
    </div>
  );
}
