'use client';

import { useState } from 'react';
import { useGrantPrize, AdminApiError } from '@/hooks/admin/useAdminApi';
import { useToast } from '@/components/ui/Toast';

const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/**
 * Admin tool: grant a synthetic prize to a wallet for testing.
 * Surfaces in /prizes for the target wallet identical to a real win,
 * so the full withdraw flow can be exercised end-to-end without
 * running an actual draft.
 */
export function GrantPrizeForm() {
  const grant = useGrantPrize();
  const { show } = useToast();

  const [wallet, setWallet] = useState('');
  const [amount, setAmount] = useState('');
  const [contestName, setContestName] = useState('');
  const [note, setNote] = useState('');
  const [lastGranted, setLastGranted] = useState<{ wallet: string; amount: number; prizeId: string } | null>(null);

  const trimmedWallet = wallet.trim();
  const validWallet = ETH_ADDRESS_RE.test(trimmedWallet);
  const numericAmount = parseFloat(amount);
  const validAmount = Number.isFinite(numericAmount) && numericAmount > 0 && numericAmount <= 100000;

  const canSubmit = validWallet && validAmount && !grant.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      const res = await grant.mutateAsync({
        walletAddress: trimmedWallet,
        amount: numericAmount,
        contestName: contestName.trim() || undefined,
        note: note.trim() || undefined,
      });
      setLastGranted({
        wallet: trimmedWallet,
        amount: numericAmount,
        prizeId: res.prize.id,
      });
      show({
        level: 'success',
        message: `Granted $${numericAmount.toLocaleString()} to ${trimmedWallet.slice(0, 6)}…${trimmedWallet.slice(-4)}`,
      });
      // Reset for next grant — keep wallet so admin can grant multiple
      // amounts to the same target without retyping.
      setAmount('');
      setContestName('');
      setNote('');
    } catch (err) {
      const e = err as AdminApiError;
      show({
        level: 'error',
        message: e.message || 'Grant failed',
        requestId: e.requestId,
      });
    }
  };

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-white">Grant test prize</h3>
        <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
          Adds a synthetic win to the target wallet&apos;s <code className="text-gray-400">/prizes</code> page.
          Tests the full withdrawal flow end-to-end without running a real draft.
          Synthetic prizes are clearly tagged in the data and can be cleaned up later.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1">
            Target wallet
          </label>
          <input
            type="text"
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            placeholder="0x…"
            spellCheck={false}
            autoComplete="off"
            className={`w-full rounded-lg bg-bg-tertiary/60 border px-3 py-2 text-sm text-white font-mono placeholder:text-gray-600 outline-none transition-colors ${
              wallet && !validWallet
                ? 'border-error/50 focus:border-error'
                : 'border-bg-tertiary focus:border-banana/50'
            }`}
          />
          {wallet && !validWallet && (
            <p className="text-[11px] text-error/80 mt-1">Must be a valid Ethereum address</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1">
              Amount (USD)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="100"
                className={`w-full rounded-lg bg-bg-tertiary/60 border pl-7 pr-3 py-2 text-sm text-white placeholder:text-gray-600 outline-none transition-colors ${
                  amount && !validAmount
                    ? 'border-error/50 focus:border-error'
                    : 'border-bg-tertiary focus:border-banana/50'
                }`}
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1">
              Contest name <span className="text-gray-600 normal-case">(optional)</span>
            </label>
            <input
              type="text"
              value={contestName}
              onChange={(e) => setContestName(e.target.value)}
              placeholder="Test prize"
              className="w-full rounded-lg bg-bg-tertiary/60 border border-bg-tertiary focus:border-banana/50 px-3 py-2 text-sm text-white placeholder:text-gray-600 outline-none transition-colors"
            />
          </div>
        </div>

        <div>
          <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1">
            Note <span className="text-gray-600 normal-case">(optional, internal)</span>
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. testing balance withdraw flow"
            className="w-full rounded-lg bg-bg-tertiary/60 border border-bg-tertiary focus:border-banana/50 px-3 py-2 text-sm text-white placeholder:text-gray-600 outline-none transition-colors"
          />
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <button
            type="submit"
            disabled={!canSubmit}
            className="px-4 py-2 rounded-lg bg-banana hover:bg-banana/80 active:scale-[0.98] text-black text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {grant.isPending ? 'Granting…' : 'Grant prize'}
          </button>

          {lastGranted && (
            <p className="text-[11px] text-gray-500">
              Last: <span className="text-success">✓ ${lastGranted.amount.toLocaleString()}</span> →{' '}
              <span className="font-mono">{lastGranted.wallet.slice(0, 6)}…{lastGranted.wallet.slice(-4)}</span>
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
