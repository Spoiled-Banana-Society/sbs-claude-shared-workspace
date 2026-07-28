'use client';

/**
 * Prize-pool pill in the admin top bar — always visible, so Richard can see
 * "how much are we at" from any tab.
 *
 * Prize pool = Safe (cold treasury) + BBB4 contract USDC, minus the $75 of
 * Richard's own money still on-chain from testing the deposit/Add Funds flow
 * (2026-07-27). Drop the adjustment once that $75 is actually withdrawn.
 *
 * Same source as the Money tab's "Actual total" (GET /api/admin/withdraw-contract-usdc).
 */

import { useTreasurySnapshot } from '@/hooks/admin/useAdminApi';

const TEST_DEPOSIT_ADJUSTMENT_USD = 75;

export function PrizePoolPill({ enabled }: { enabled: boolean }) {
  const q = useTreasurySnapshot(enabled);

  let amount: string | null = null;
  if (q.data) {
    try {
      const raw = BigInt(q.data.contractUsdc ?? '0') + BigInt(q.data.treasuryUsdc ?? '0');
      const usd = Number(raw) / 1e6 - TEST_DEPOSIT_ADJUSTMENT_USD;
      amount = `$${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    } catch {
      /* keep null → em dash */
    }
  }

  return (
    <div
      className="shrink-0 inline-flex items-center gap-2 px-3 h-9 rounded-md border border-banana/30 bg-banana/5 text-banana text-xs"
      title="Prize pool — Safe + contract USDC, minus the $75 deposit-flow test"
    >
      <span className="uppercase tracking-wider text-[10px] text-banana/70 font-semibold">Prize pool</span>
      <span className="font-bold tabular-nums">{amount ?? (q.isLoading ? '…' : '—')}</span>
    </div>
  );
}
