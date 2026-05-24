'use client';

/**
 * Bulk grant — grant N draft passes to a list of wallets in one click.
 *
 * Two list-source flows:
 *   - "Paste wallets" — admin pastes a list (any format with 0x-prefixed
 *     40-hex strings; we extract all matches and dedupe).
 *   - "All KYC-approved" — server-side resolves the wallet list.
 *
 * Fires through /api/admin/bulk-grant which loops single-grant
 * /api/admin/grant-drafts calls internally — so every individual mint
 * still audits + activity-feeds the same as a one-off grant.
 *
 * Phase 5 of the admin overhaul.
 */

import { useMemo, useState } from 'react';
import { useAdminAuthHeaders } from '@/hooks/admin/useAdminApi';

type Audience = 'paste' | 'kyc-approved';

const WALLET_RE = /0x[0-9a-fA-F]{40}/g;
const MAX_BULK = 200;

interface OneResult { wallet: string; ok: boolean; error?: string }
interface Response {
  ok?: boolean;
  requested?: number;
  okCount?: number;
  failCount?: number;
  results?: OneResult[];
  error?: string;
}

export function BulkGrantPanel() {
  const getHeaders = useAdminAuthHeaders();
  const [audience, setAudience] = useState<Audience>('paste');
  const [walletList, setWalletList] = useState('');
  const [count, setCount] = useState(1);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [response, setResponse] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsedWallets = useMemo(() => {
    const matches = walletList.match(WALLET_RE) ?? [];
    return Array.from(new Set(matches.map((w) => w.toLowerCase())));
  }, [walletList]);

  const canSubmit =
    !submitting &&
    count >= 1 &&
    count <= 50 &&
    (audience === 'kyc-approved' || parsedWallets.length > 0);

  const submit = async () => {
    setError(null);
    setResponse(null);

    let wallets = parsedWallets;
    if (audience === 'kyc-approved') {
      // Resolve KYC-approved server-side first via the broadcast endpoint's
      // audience resolver — same shape, returns just wallet list when we
      // ask for a dry run. Cheaper to call our own bulk-grant endpoint
      // directly with paste mode after a quick lookup.
      try {
        const headers = await getHeaders();
        const res = await fetch('/api/admin/users?limit=200&q=&kycOnly=1', { headers });
        if (!res.ok) throw new Error(`Failed to load KYC users (${res.status})`);
        const json = (await res.json()) as { users?: Array<{ walletAddress: string }> };
        wallets = (json.users ?? []).map((u) => u.walletAddress.toLowerCase());
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return;
      }
    }
    if (wallets.length === 0) {
      setError('No wallets resolved');
      return;
    }
    if (wallets.length > MAX_BULK) {
      setError(`Too many wallets — max ${MAX_BULK} per bulk grant. Got ${wallets.length}.`);
      return;
    }

    if (!window.confirm(
      `Grant ${count} draft pass${count === 1 ? '' : 'es'} to ${wallets.length} wallet${wallets.length === 1 ? '' : 's'}?\n\nFires ${wallets.length} on-chain mints. Irreversible.`,
    )) return;

    setSubmitting(true);
    try {
      const headers = await getHeaders();
      const res = await fetch('/api/admin/bulk-grant', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallets, count, reason: reason.trim() || undefined }),
      });
      const json = (await res.json().catch(() => ({}))) as Response;
      if (!res.ok) setError(json.error || `${res.status}`);
      setResponse(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-white">Bulk grant — passes to many wallets</h3>
        <p className="text-[12px] text-gray-500 mt-0.5">
          Each grant runs the normal single-grant path (on-chain mint + audit + activity feed). Bounded to {MAX_BULK} wallets per call.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div>
            <span className="text-[11px] uppercase text-gray-500 tracking-wider">Wallet source</span>
            <div className="mt-1 space-y-1.5">
              <label className="flex items-center gap-2 text-sm text-gray-200 cursor-pointer">
                <input type="radio" name="bulk-aud" checked={audience === 'paste'} onChange={() => setAudience('paste')} className="accent-banana" />
                Paste wallet list
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-200 cursor-pointer">
                <input type="radio" name="bulk-aud" checked={audience === 'kyc-approved'} onChange={() => setAudience('kyc-approved')} className="accent-banana" />
                All KYC-approved users (first 200)
              </label>
            </div>
          </div>
          {audience === 'paste' && (
            <label className="block">
              <span className="text-[11px] uppercase text-gray-500 tracking-wider">
                Wallets {parsedWallets.length > 0 && <span className="text-banana">({parsedWallets.length} matched)</span>}
              </span>
              <textarea
                value={walletList}
                onChange={(e) => setWalletList(e.target.value)}
                rows={5}
                className="mt-1 w-full px-3 py-2 rounded-md bg-black/40 border border-white/[0.08] text-[11px] text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-banana/40 font-mono resize-y"
                placeholder="One per line, or comma-separated. 0x prefixed."
              />
            </label>
          )}
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-[11px] uppercase text-gray-500 tracking-wider">Passes per wallet</span>
            <input
              type="number"
              min={1}
              max={50}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
              className="mt-1 w-32 px-3 py-2 rounded-md bg-black/40 border border-white/[0.08] text-sm text-white focus:outline-none focus:border-banana/40"
            />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase text-gray-500 tracking-wider">Reason (optional, lands in audit)</span>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              className="mt-1 w-full px-3 py-2 rounded-md bg-black/40 border border-white/[0.08] text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-banana/40"
              placeholder="Onboarding promo · season opener · …"
            />
          </label>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="px-4 py-2 rounded-md bg-banana hover:bg-banana/80 text-black text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? 'Granting…' : 'Grant in bulk'}
        </button>
        {error && <span className="text-[12px] text-red-300">{error}</span>}
      </div>

      {response && (
        <div className="rounded-md border border-white/[0.06] bg-black/30 p-3 space-y-1">
          <p className="text-[11px] uppercase text-gray-500">
            Result · {response.okCount ?? 0}/{response.requested ?? 0} succeeded
          </p>
          {response.failCount && response.failCount > 0 ? (
            <p className="text-[12px] text-red-300">
              {response.failCount} failure{response.failCount === 1 ? '' : 's'} — see browser console / admin Audit log for details.
            </p>
          ) : (
            <p className="text-[12px] text-emerald-300">All grants succeeded.</p>
          )}
        </div>
      )}
    </section>
  );
}
