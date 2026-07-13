'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAdminAuthHeaders } from '@/hooks/admin/useAdminApi';
import { useToast } from '@/components/ui/Toast';

/**
 * Admin tool: withdraw the BBB4 contract's accumulated mint USDC to the cold
 * treasury. Runs the SAME server-side skim as the cron (contract → ops wallet →
 * cold treasury), but triggered by a human from the admin panel.
 *
 * Why this exists instead of "connect MetaMask on Basescan": the contract owner
 * is the backend mint wallet, and loading that key into a browser wallet risks
 * an EIP-7702 upgrade that breaks minting (it did, Apr 2026). This button signs
 * server-side, so the key never touches a wallet. Fully manual — nothing is
 * scheduled; funds only move when you click.
 */

interface Snapshot {
  opsWallet: string;
  treasury: string;
  contractUsdc: string;
  opsUsdc: string;
  treasuryUsdc: string;
  owedReserve: string;
}

interface WithdrawResult {
  ok: boolean;
  contractUsdcBefore: string;
  transferredToTreasury: string;
  owedReserve: string;
  withdrawTxHash: string | null;
  transferTxHash: string | null;
  treasury: string;
  note: string;
}

const usd = (raw: string | undefined) => {
  if (!raw) return '$0.00';
  try {
    return `$${(Number(BigInt(raw)) / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  } catch {
    return '$0.00';
  }
};
const short = (a: string) => (a && a.length >= 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const txLink = (h: string) => `https://basescan.org/tx/${h}`;

export function ContractTreasuryPanel({ enabled }: { enabled: boolean }) {
  const getHeaders = useAdminAuthHeaders();
  const { show } = useToast();

  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<WithdrawResult | null>(null);

  // Rule #0: keep the auth callback in a ref so the load effect's deps stay
  // scalar-only (getHeaders derives from usePrivy → unstable identity).
  const getHeadersRef = useRef(getHeaders);
  useEffect(() => { getHeadersRef.current = getHeaders; }, [getHeaders]);

  const loadBalances = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const headers = await getHeadersRef.current();
      const res = await fetch('/api/admin/withdraw-contract-usdc', { headers, cache: 'no-store' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to read balances (${res.status})`);
      }
      setSnap((await res.json()) as Snapshot);
    } catch (err) {
      setLoadErr((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Single fetch on open — no polling (Rule #0). Re-fetch is manual.
  useEffect(() => {
    if (!enabled) return;
    void loadBalances();
  }, [enabled, loadBalances]);

  const contractAmt = snap?.contractUsdc ?? '0';
  const reserve = snap?.owedReserve ?? '0';
  let willMove = '0';
  try {
    // contract balance + whatever already sits in ops, minus the held reserve.
    const gross = BigInt(snap?.contractUsdc ?? '0') + BigInt(snap?.opsUsdc ?? '0');
    const r = BigInt(reserve);
    willMove = (gross > r ? gross - r : 0n).toString();
  } catch { /* keep 0 */ }

  const nothingToMove = (() => { try { return BigInt(willMove) === 0n; } catch { return true; } })();

  const runWithdraw = async () => {
    setRunning(true);
    setResult(null);
    try {
      const headers = await getHeadersRef.current();
      const res = await fetch('/api/admin/withdraw-contract-usdc', { method: 'POST', headers, cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Withdrawal failed (${res.status})`);
      setResult(body as WithdrawResult);
      const moved = (body as WithdrawResult).transferredToTreasury;
      if (BigInt(moved || '0') > 0n) {
        show({ level: 'success', message: `Withdrew ${usd(moved)} to treasury` });
      } else {
        show({ level: 'info', message: (body as WithdrawResult).note || 'Nothing to withdraw' });
      }
      await loadBalances();
    } catch (err) {
      show({ level: 'error', message: (err as Error).message || 'Withdrawal failed' });
    } finally {
      setRunning(false);
      setConfirming(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-4 space-y-4 max-w-xl">
      <div>
        <h4 className="text-xs font-semibold text-white uppercase tracking-wider">
          Contract Treasury — Withdraw Mint USDC
        </h4>
        <p className="text-[11px] text-gray-500 mt-0.5">
          Pulls the BBB4 contract&apos;s accumulated mint revenue to your cold treasury
          (contract → owner wallet → treasury). Signs server-side — the owner key never touches a
          wallet. Manual only; nothing is scheduled.
        </p>
      </div>

      {loadErr ? (
        <div className="text-[11px] text-red-400 border border-red-900/50 bg-red-950/30 rounded p-2">
          {loadErr}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Row label="In contract (withdrawable)" value={usd(contractAmt)} strong />
          <Row label="Owner/ops wallet" value={usd(snap?.opsUsdc)} />
          <Row label="Cold treasury (current)" value={usd(snap?.treasuryUsdc)} />
          <Row label="Held back (buyer refunds)" value={usd(reserve)} muted={reserve === '0'} />
        </div>
      )}

      {/* Boris's canonical "how much do we actually have": contract + treasury.
          Non-prize funds were withdrawn from the Safe 7/12, so no adjustment. */}
      {snap && !loadErr && (
        <div className="flex items-baseline justify-between rounded-lg border border-banana/30 bg-banana/5 px-3 py-2">
          <span className="text-xs font-semibold text-banana uppercase tracking-wider">Actual total</span>
          <span className="text-lg font-bold text-banana tabular-nums">
            {(() => {
              try {
                const net = BigInt(snap.contractUsdc ?? '0') + BigInt(snap.treasuryUsdc ?? '0');
                return usd(net.toString());
              } catch { return '—'; }
            })()}
          </span>
        </div>
      )}

      {snap && (
        <div className="text-[11px] text-gray-500 font-mono space-y-0.5 border-t border-gray-700 pt-2">
          <div>owner: {short(snap.opsWallet)}</div>
          <div>treasury → {short(snap.treasury)}</div>
        </div>
      )}

      <div className="border-t border-gray-700 pt-3">
        {!confirming ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setConfirming(true)}
              disabled={loading || running || nothingToMove}
              className="flex-1 py-2 rounded bg-yellow-500 hover:bg-yellow-400 text-black text-sm font-semibold disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              {nothingToMove ? 'Nothing to withdraw' : `Withdraw ${usd(willMove)} to treasury`}
            </button>
            <button
              onClick={() => void loadBalances()}
              disabled={loading || running}
              className="px-3 py-2 rounded bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium disabled:opacity-40 transition-colors"
              title="Refresh balances"
            >
              {loading ? '…' : '↻'}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-yellow-300">
              Move <span className="font-semibold">{usd(willMove)}</span> to your cold treasury{' '}
              <span className="font-mono">{short(snap?.treasury ?? '')}</span>? This sends real USDC on Base.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => void runWithdraw()}
                disabled={running}
                className="flex-1 py-2 rounded bg-green-600 hover:bg-green-500 text-white text-sm font-semibold disabled:opacity-40 transition-colors"
              >
                {running ? 'Withdrawing…' : 'Confirm withdrawal'}
              </button>
              <button
                onClick={() => setConfirming(false)}
                disabled={running}
                className="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium disabled:opacity-40 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {result && (
        <div className="text-[11px] border-t border-gray-700 pt-2 space-y-1">
          <div className="text-green-400">
            ✓ Moved {usd(result.transferredToTreasury)} to treasury
            {BigInt(result.owedReserve || '0') > 0n ? ` (held ${usd(result.owedReserve)} for refunds)` : ''}
          </div>
          {result.withdrawTxHash && (
            <a href={txLink(result.withdrawTxHash)} target="_blank" rel="noopener noreferrer" className="block text-blue-400 hover:underline font-mono">
              withdraw tx: {short(result.withdrawTxHash)} ↗
            </a>
          )}
          {result.transferTxHash && (
            <a href={txLink(result.transferTxHash)} target="_blank" rel="noopener noreferrer" className="block text-blue-400 hover:underline font-mono">
              transfer tx: {short(result.transferTxHash)} ↗
            </a>
          )}
          {result.note && <div className="text-gray-500">{result.note}</div>}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <>
      <div className={`text-[11px] ${muted ? 'text-gray-600' : 'text-gray-400'} self-center`}>{label}</div>
      <div className={`text-right font-mono ${strong ? 'text-white font-semibold' : muted ? 'text-gray-600' : 'text-gray-200'}`}>{value}</div>
    </>
  );
}
