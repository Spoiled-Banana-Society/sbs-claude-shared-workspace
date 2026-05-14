'use client';

import { useState } from 'react';
import { useRecoverDraftCard, AdminApiError } from '@/hooks/admin/useAdminApi';
import { useToast } from '@/components/ui/Toast';

const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const DRAFT_ID_RE = /^\d{4}-(?:fast|slow)-draft-\d+$/;

/**
 * Admin tool: re-run the per-card close-draft flow for one user. Use when
 * the original close partially failed (image-gen 500, network blip) and a
 * user's card is stuck with the default placeholder image or empty roster.
 *
 * Idempotent — safe to click multiple times on a healthy card too.
 *
 * The daily reconciliation cron handles the common case automatically; this
 * form is the human-in-the-loop path for one-off recoveries from a specific
 * Server Errors entry.
 */
export function RecoverDraftCardForm() {
  const recover = useRecoverDraftCard();
  const { show } = useToast();

  const [draftId, setDraftId] = useState('');
  const [wallet, setWallet] = useState('');
  const [lastResult, setLastResult] = useState<{ draftId: string; wallet: string } | null>(null);

  const trimmedDraft = draftId.trim();
  const trimmedWallet = wallet.trim().toLowerCase();
  const validDraft = DRAFT_ID_RE.test(trimmedDraft);
  const validWallet = ETH_ADDRESS_RE.test(trimmedWallet);
  const canSubmit = validDraft && validWallet && !recover.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      await recover.mutateAsync({ draftId: trimmedDraft, walletAddress: trimmedWallet });
      setLastResult({ draftId: trimmedDraft, wallet: trimmedWallet });
      show({
        level: 'success',
        message: `Recovered ${trimmedWallet.slice(0, 6)}…${trimmedWallet.slice(-4)} in ${trimmedDraft}`,
      });
    } catch (err) {
      const e = err as AdminApiError;
      show({ level: 'error', message: e.message || 'Recovery failed' });
    }
  };

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-4 space-y-3">
      <div>
        <h4 className="text-xs font-semibold text-white uppercase tracking-wider">
          Recover Stuck Draft Card
        </h4>
        <p className="text-[11px] text-gray-500 mt-0.5">
          Re-runs the close-draft per-card flow. Use when a user&apos;s card is missing the rendered
          team image or has an empty roster after draft completion. Idempotent — safe to run on a
          healthy card.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-2">
        <div>
          <label className="block text-[10px] uppercase text-gray-500 tracking-wider mb-1">
            Draft ID
          </label>
          <input
            type="text"
            value={draftId}
            onChange={(e) => setDraftId(e.target.value)}
            placeholder="2024-fast-draft-753"
            className="w-full px-3 py-2 rounded bg-gray-900 border border-gray-700 text-sm font-mono focus:outline-none focus:border-yellow-500"
          />
          {draftId && !validDraft && (
            <div className="text-[10px] text-red-400 mt-1">
              Expected shape: 2024-fast-draft-N or 2024-slow-draft-N
            </div>
          )}
        </div>

        <div>
          <label className="block text-[10px] uppercase text-gray-500 tracking-wider mb-1">
            Wallet
          </label>
          <input
            type="text"
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            placeholder="0x…"
            className="w-full px-3 py-2 rounded bg-gray-900 border border-gray-700 text-sm font-mono focus:outline-none focus:border-yellow-500"
          />
          {wallet && !validWallet && (
            <div className="text-[10px] text-red-400 mt-1">
              Expected 0x-prefixed 40-hex-char address
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full py-2 rounded bg-yellow-500 hover:bg-yellow-400 text-black text-sm font-semibold disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          {recover.isPending ? 'Recovering…' : 'Recover Card'}
        </button>
      </form>

      {lastResult && (
        <div className="text-[11px] text-green-400 border-t border-gray-700 pt-2">
          ✓ Last recovery:{' '}
          <span className="font-mono">
            {lastResult.wallet.slice(0, 6)}…{lastResult.wallet.slice(-4)}
          </span>{' '}
          in <span className="font-mono">{lastResult.draftId}</span>
        </div>
      )}
    </div>
  );
}
