'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,20}$/;
const looksLookupable = (s: string) => WALLET_RE.test(s) || USERNAME_RE.test(s);

// Bare /u entry — type a username or wallet to see all the teams that person
// owns. Submitting routes to /u/[id], which resolves it and renders the grid.
export default function UserLookupPage() {
  const router = useRouter();
  const [lookup, setLookup] = useState('');

  const goLookup = () => {
    const w = lookup.trim();
    if (looksLookupable(w)) router.push(`/u/${encodeURIComponent(WALLET_RE.test(w) ? w.toLowerCase() : w)}`);
  };

  return (
    <div className="w-full px-4 sm:px-8 lg:px-12 py-8">
      <div className="max-w-2xl mx-auto">
        <Link href="/marketplace" className="text-text-muted text-sm hover:text-text-primary transition-colors">← Back to Marketplace</Link>

        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-text-primary">Find a user</h1>
        <p className="text-text-muted text-sm mt-1">Enter a username or wallet to see all the teams that person owns.</p>

        <div className="mt-5 flex items-center gap-2">
          <input
            value={lookup}
            onChange={(e) => setLookup(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') goLookup(); }}
            placeholder="Username or wallet"
            className="w-full rounded-full bg-black/30 border border-white/[0.10] focus:border-banana/50 px-4 py-2.5 text-sm text-text-primary outline-none transition-colors"
          />
          <button
            onClick={goLookup}
            disabled={!looksLookupable(lookup.trim())}
            className="px-5 py-2.5 rounded-full bg-banana hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-black font-semibold text-sm transition-all shrink-0"
          >
            View
          </button>
        </div>
      </div>
    </div>
  );
}
