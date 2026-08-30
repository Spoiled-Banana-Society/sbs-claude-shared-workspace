'use client';

/**
 * Prize-pool pill in the admin top bar — always visible, so Richard can see
 * "how much are we at" from any tab.
 *
 * Prize pool = Safe (cold treasury) + BBB4 contract USDC + off-platform
 * collections (system_config/prizePoolAdjustment — PayPal $578, Boris 2026-08-30).
 * (The old $75 deposit-flow-test adjustment was settled 2026-08-03 — Boris
 * received $100, $25 went into the Safe — matching the Money tab's row.)
 *
 * Same source as the Money tab's "Actual total" (GET /api/admin/withdraw-contract-usdc).
 */

import { useTreasurySnapshot } from '@/hooks/admin/useAdminApi';

export function PrizePoolPill({ enabled }: { enabled: boolean }) {
  const q = useTreasurySnapshot(enabled);

  let amount: string | null = null;
  if (q.data) {
    try {
      const raw = BigInt(q.data.contractUsdc ?? '0') + BigInt(q.data.treasuryUsdc ?? '0');
      // Plus off-platform collections (PayPal etc.) from system_config/prizePoolAdjustment.
      const usd = Number(raw) / 1e6 + (Number((q.data as { offPlatformUsd?: number }).offPlatformUsd ?? 0) || 0);
      amount = `$${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    } catch {
      /* keep null → em dash */
    }
  }

  return (
    <div
      className="shrink-0 inline-flex items-center gap-2 px-3 h-9 rounded-md border border-banana/30 bg-banana/5 text-banana text-xs"
      title="Prize pool — Safe + contract USDC + off-platform (PayPal)"
    >
      <span className="uppercase tracking-wider text-[10px] text-banana/70 font-semibold">Prize pool</span>
      <span className="font-bold tabular-nums">{amount ?? (q.isLoading ? '…' : '—')}</span>
    </div>
  );
}
