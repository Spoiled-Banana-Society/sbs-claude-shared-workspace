'use client';

import { useEffect, useRef, useState } from 'react';
import { type Address } from 'viem';
import { useAuth } from '@/hooks/useAuth';
import { useMintDraftPass } from '@/hooks/useMintDraftPass';
import { waitForUsdcArrival } from '@/lib/contracts/bbb4';
import { readResumeRecord, clearResumeRecord, type CardResumeRecord } from '@/lib/purchaseFlow';
import { clientLog } from '@/lib/clientLog';
import { reportClientError } from '@/lib/clientErrors';
import { LOG_SOURCES } from '@/lib/logSources';

// "Leave and come back" window. If the user returns to the app within this many
// minutes and their USDC has arrived, we finish the mint. Beyond it the record
// is treated as stale (their USDC is still safe in their wallet either way).
const RESUME_TTL_MS = 45 * 60_000;
// How long to watch for the USDC once we start resuming (it's almost always
// already there, since they paid before the tab died — this is just a ceiling).
const RESUME_WAIT_MS = 90_000;

// Module-level guard so a remount / strict-mode double-invoke can't kick off a
// second resume attempt in the same page load.
let resumeClaimed = false;

/**
 * Finishes a CARD draft-pass purchase that was interrupted — e.g. mobile killed
 * our backgrounded tab while the user was in the MoonPay window. Mounted
 * app-wide (renders nothing). On load it checks for a persisted "card purchase
 * in flight" marker and, if found, completes the mint silently so the user's
 * pass just appears when they return.
 *
 * Cheap by default: this outer component only does a localStorage read. The
 * heavier useMintDraftPass hook (which eagerly reads the contract) is mounted
 * via <ResumeWorker> ONLY when a valid record actually exists.
 *
 * Double-mint safe: ResumeWorker only mints if the USDC is still sitting
 * un-pulled in the wallet — if the original tab already completed, the funds are
 * gone and the resume no-ops. The server also serializes + nonce-guards the
 * mint as defense-in-depth.
 */
export function PurchaseResumeRunner() {
  const { walletAddress } = useAuth();
  const [record, setRecord] = useState<CardResumeRecord | null>(null);

  useEffect(() => {
    if (resumeClaimed || record) return;
    if (!walletAddress) return;
    const rec = readResumeRecord();
    if (!rec) return;
    if (rec.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) return;
    if (Date.now() - rec.ts > RESUME_TTL_MS) { clearResumeRecord(); return; }
    resumeClaimed = true;
    setRecord(rec);
  }, [walletAddress, record]);

  if (!record) return null;
  return <ResumeWorker record={record} />;
}

function ResumeWorker({ record }: { record: CardResumeRecord }) {
  const { walletAddress, refreshBalance } = useAuth();
  const { mint, tokenPrice } = useMintDraftPass();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    if (!walletAddress || !tokenPrice) return; // wait for the on-chain price to load
    startedRef.current = true;

    void (async () => {
      try {
        const value = tokenPrice * BigInt(record.quantity);
        // Only resume if the USDC is genuinely still in the wallet (un-pulled).
        // If the original tab already minted, the funds are gone → this times
        // out and we never double-mint.
        const funded = await waitForUsdcArrival(walletAddress as Address, value, {
          timeoutMs: RESUME_WAIT_MS,
        });
        if (!funded) { clearResumeRecord(); return; }

        clientLog('payment', 'resume_card_mint_start', { wallet: walletAddress, quantity: record.quantity });
        await mint(record.quantity, { paymentMethod: 'card', cardProvider: 'moonpay' });
        clearResumeRecord();
        await refreshBalance();
        clientLog('payment', 'resume_card_mint_done', { wallet: walletAddress, quantity: record.quantity });
      } catch (err) {
        // Leave the record in place so a later load can retry within the TTL;
        // surface to admins. The user's USDC is never at risk — it's in their
        // wallet until a mint pulls it.
        reportClientError({
          source: LOG_SOURCES.payment.CARD_PURCHASE_TRACKING_FAILED,
          message: err instanceof Error ? err.message : String(err),
          route: 'purchase-resume',
          actor: walletAddress,
          context: { quantity: record.quantity },
        });
      }
    })();
  }, [walletAddress, tokenPrice, mint, refreshBalance, record.quantity]);

  return null;
}
