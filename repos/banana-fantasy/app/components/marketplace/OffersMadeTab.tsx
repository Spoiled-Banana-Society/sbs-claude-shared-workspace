'use client';

import { useEffect, useState, useCallback } from 'react';

interface MadeOffer {
  tokenId: string;
  priceUsd: number;
  orderHash: string;
  endTimeSec: string | null;
}

interface OffersMadeTabProps {
  walletAddress: string | null;
  /** Cancel the given offers in ONE transaction. Resolves true on success. */
  onCancelOffers: (orderHashes: string[]) => Promise<boolean>;
}

function expiresLabel(endTimeSec: string | null): string {
  if (!endTimeSec) return '';
  const ms = Number(endTimeSec) * 1000 - Date.now();
  if (ms <= 0) return 'expired';
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days}d left`;
  const hrs = Math.max(1, Math.floor(ms / 3_600_000));
  return `${hrs}h left`;
}

/**
 * "My Offers" — every active offer the wallet has made, across all teams, with
 * one-transaction Cancel All. Outstanding offers are a live liability (the NFT's
 * owner can accept them anytime), so users need a single place to clear them.
 * Seaport cancels an array of orders in ONE tx, so Cancel All is one signature.
 */
export function OffersMadeTab({ walletAddress, onCancelOffers }: OffersMadeTabProps) {
  const [offers, setOffers] = useState<MadeOffer[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | 'all' | null>(null);

  const load = useCallback(async () => {
    if (!walletAddress) { setOffers([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/marketplace/offers/mine?address=${walletAddress}`);
      if (res.ok) {
        const json = await res.json();
        const list = (json.offers ?? []) as MadeOffer[];
        // Only offers with a real order hash can be cancelled on-chain.
        setOffers(list.filter(o => o.orderHash).sort((a, b) => b.priceUsd - a.priceUsd));
      }
    } catch { /* best-effort */ } finally { setLoading(false); }
  }, [walletAddress]);

  useEffect(() => { void load(); }, [load]);

  const cancelOne = async (o: MadeOffer) => {
    setBusy(o.orderHash);
    const ok = await onCancelOffers([o.orderHash]);
    if (ok) setOffers(prev => prev.filter(x => x.orderHash !== o.orderHash));
    setBusy(null);
  };

  const cancelAll = async () => {
    if (offers.length === 0) return;
    setBusy('all');
    const ok = await onCancelOffers(offers.map(o => o.orderHash));
    if (ok) setOffers([]);
    setBusy(null);
  };

  if (!walletAddress) {
    return <div className="text-center py-20 text-text-secondary text-sm">Log in to see the offers you&apos;ve made.</div>;
  }

  if (loading && offers.length === 0) {
    return (
      <div className="space-y-3 max-w-2xl mx-auto">
        {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-bg-tertiary rounded-xl animate-pulse" />)}
      </div>
    );
  }

  if (offers.length === 0) {
    return (
      <div className="text-center py-20">
        <div className="text-4xl mb-4">🍌</div>
        <h3 className="text-text-primary font-semibold text-lg mb-2">No active offers</h3>
        <p className="text-text-secondary text-sm">Offers you make on teams show up here so you can manage and cancel them.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-text-primary font-semibold">
          Your Offers <span className="text-text-muted font-normal">({offers.length})</span>
        </h2>
        {offers.length >= 2 && (
          <button
            onClick={cancelAll}
            disabled={busy != null}
            className="px-4 py-2 rounded-lg text-sm font-semibold border border-error/40 text-error hover:bg-error/10 transition-all disabled:opacity-50"
          >
            {busy === 'all' ? 'Cancelling…' : `Cancel all (${offers.length})`}
          </button>
        )}
      </div>
      <p className="text-text-muted text-xs mb-4">
        An offer stays live until you cancel it or it expires — the team&apos;s owner can accept it anytime. Cancelling all is one transaction (gas covered on SBS wallets).
      </p>
      <div className="space-y-2">
        {offers.map(o => (
          <div key={o.orderHash} className="flex items-center justify-between p-3 rounded-xl bg-bg-primary border border-bg-tertiary">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-bg-tertiary flex items-center justify-center text-base flex-shrink-0">🍌</div>
              <div className="min-w-0">
                <a href={`/marketplace/${o.tokenId}`} className="text-text-primary font-medium text-sm hover:text-banana transition-colors">Team #{o.tokenId}</a>
                <p className="text-text-muted text-[11px] font-mono">${o.priceUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} offer{o.endTimeSec ? ` · ${expiresLabel(o.endTimeSec)}` : ''}</p>
              </div>
            </div>
            <button
              onClick={() => cancelOne(o)}
              disabled={busy != null}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-error/40 text-error hover:bg-error/10 transition-all disabled:opacity-50 flex-shrink-0"
            >
              {busy === o.orderHash ? 'Cancelling…' : 'Cancel'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
