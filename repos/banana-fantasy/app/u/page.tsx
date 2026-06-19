'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

// Bare /u entry — type any wallet to see all the teams it owns. Submitting
// routes to /u/[wallet], which renders the grid (and the same lookup box).
export default function WalletLookupPage() {
  const router = useRouter();
  const [lookup, setLookup] = useState('');

  const goLookup = () => {
    const w = lookup.trim();
    if (WALLET_RE.test(w)) router.push(`/u/${w.toLowerCase()}`);
  };

  return (
    <div className="w-full px-4 sm:px-8 lg:px-12 py-8">
      <div className="max-w-2xl mx-auto">
        <Link href="/marketplace" className="text-text-muted text-sm hover:text-text-primary transition-colors">← Back to Marketplace</Link>

        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-text-primary">Look up a wallet</h1>
        <p className="text-text-muted text-sm mt-1">Paste any wallet address to see all the teams it owns.</p>

        <div className="mt-5 flex items-center gap-2">
          <input
            value={lookup}
            onChange={(e) => setLookup(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') goLookup(); }}
            placeholder="Paste a wallet (0x…)"
            className="w-full rounded-full bg-black/30 border border-white/[0.10] focus:border-banana/50 px-4 py-2.5 text-sm font-mono text-text-primary outline-none transition-colors"
          />
          <button
            onClick={goLookup}
            disabled={!WALLET_RE.test(lookup.trim())}
            className="px-5 py-2.5 rounded-full bg-banana hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-black font-semibold text-sm transition-all shrink-0"
          >
            View
          </button>
        </div>
      </div>
    </div>
  );
}
