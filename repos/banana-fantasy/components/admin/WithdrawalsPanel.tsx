'use client';

/**
 * Withdrawals admin panel — Pending / Ready to pay / Paid / Denied.
 *
 * Extracted out of app/admin/page.tsx during Phase 3 tab reorg so the
 * Money tab (new in May 2026) can compose Withdrawals + Onramps +
 * Offramps + Promos as sub-tabs. Behavior is unchanged — same APIs,
 * same actions, same Gnosis Safe CSV format.
 */

import { useState, type ReactNode } from 'react';
import * as Sentry from '@sentry/nextjs';
import { useToast } from '@/components/ui/Toast';
import { useSendUsdcOnBase } from '@/hooks/useSendUsdcOnBase';
import {
  useAdminWithdrawals,
  useUpdateWithdrawalStatus,
  AdminApiError,
  type AdminWithdrawalItem,
} from '@/hooks/admin/useAdminApi';
import { WalletLink } from '@/components/admin/WalletLink';

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function WithdrawalsPanel({ enabled }: { enabled: boolean }) {
  const query = useAdminWithdrawals(enabled);
  const items = query.data ?? [];
  const update = useUpdateWithdrawalStatus();
  const { show } = useToast();
  const sendUsdc = useSendUsdcOnBase();
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
    const txHash = window.prompt(
      'Gnosis Safe tx hash (optional — leave blank if not available):',
      '',
    );
    if (txHash === null) return;
    if (!window.confirm('Confirm: USDC has actually landed in the user\'s wallet on-chain?')) return;
    await handle(id, 'paid', txHash.trim() || undefined);
  };

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
      lines.push('token_type,token_address,receiver,amount,id');
      for (const w of readyToPay) {
        lines.push(`erc20,${USDC_BASE_ADDRESS},${w.walletAddress},${w.amount},`);
      }
    } else {
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
                  <WalletLink wallet={w.walletAddress} bare className="truncate" />
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
                    <td className="px-4 py-2.5 text-xs">
                      <WalletLink wallet={w.walletAddress} />
                    </td>
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
