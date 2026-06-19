'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMyNfts } from '@/hooks/useMarketplace';
import { buildTieredDraftPassUrl } from '@/lib/nftCard';
import { SbsPassThumb } from '@/components/marketplace/SbsPassThumb';

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

// Public read-only view of every team a wallet owns. Reached by clicking a
// wallet in the marketplace Activity feed, or by typing one into the lookup box.
export default function WalletTeamsPage() {
  const params = useParams();
  const router = useRouter();
  const walletParam = (Array.isArray(params?.wallet) ? params.wallet[0] : params?.wallet) ?? '';
  const wallet = decodeURIComponent(walletParam).toLowerCase();
  const valid = WALLET_RE.test(wallet);

  const { data: teams, isLoading } = useMyNfts(valid ? wallet : null);
  const [lookup, setLookup] = useState('');

  const short = valid ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : wallet;

  const goLookup = () => {
    const w = lookup.trim();
    if (WALLET_RE.test(w)) router.push(`/u/${w.toLowerCase()}`);
  };

  return (
    <div className="w-full px-4 sm:px-8 lg:px-12 py-8">
      <div className="max-w-6xl mx-auto">
        <Link href="/marketplace" className="text-text-muted text-sm hover:text-text-primary transition-colors">← Back to Marketplace</Link>

        {/* Wallet lookup — type any 0x address to view its teams. */}
        <div className="mt-4 mb-6 flex flex-col sm:flex-row sm:items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
            {valid ? <>Teams owned by <span className="font-mono text-banana">{short}</span></> : 'Look up a wallet'}
          </h1>
          <div className="sm:ml-auto flex items-center gap-2">
            <input
              value={lookup}
              onChange={(e) => setLookup(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') goLookup(); }}
              placeholder="Paste a wallet (0x…)"
              className="w-full sm:w-80 rounded-full bg-black/30 border border-white/[0.10] focus:border-banana/50 px-4 py-2.5 text-sm font-mono text-text-primary outline-none transition-colors"
            />
            <button
              onClick={goLookup}
              disabled={!WALLET_RE.test(lookup.trim())}
              className="px-5 py-2.5 rounded-full bg-banana hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-black font-semibold text-sm transition-all"
            >
              View
            </button>
          </div>
        </div>

        {!valid ? (
          <p className="text-text-muted text-sm py-12 text-center">Enter a valid wallet address (0x followed by 40 characters) to see all the teams it owns.</p>
        ) : isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => <div key={i} className="aspect-[4/5] bg-bg-tertiary rounded-2xl animate-pulse" />)}
          </div>
        ) : teams.length === 0 ? (
          <p className="text-text-muted text-sm py-12 text-center">This wallet doesn’t own any teams.</p>
        ) : (
          <>
            <p className="text-text-muted text-sm mb-4">{teams.length} {teams.length === 1 ? 'team' : 'teams'}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {teams.map((team) => (
                <Link
                  key={team.tokenId}
                  href={`/marketplace/${team.tokenId}`}
                  className="group rounded-2xl border border-bg-tertiary bg-bg-secondary overflow-hidden hover:border-banana/40 transition-colors"
                >
                  <div className="relative aspect-[4/5] bg-[#0d0d12]">
                    {team.fillingWheelLevel ? (
                      <Image
                        src={buildTieredDraftPassUrl(team.tokenId, team.fillingWheelLevel)}
                        alt={`Pass #${team.tokenId}`}
                        fill sizes="(max-width: 640px) 50vw, 25vw" className="object-contain"
                      />
                    ) : team.imageUrl ? (
                      <Image
                        src={team.imageUrl}
                        alt={`Team #${team.tokenId}`}
                        fill sizes="(max-width: 640px) 50vw, 25vw" className="object-contain"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <SbsPassThumb label={`#${team.tokenId}`} size={150} roster={team.roster} />
                      </div>
                    )}
                    <div className="absolute top-3 left-3 flex items-center gap-1.5 z-10">
                      {team.isJackpot && <span className="px-2 py-0.5 bg-error text-white text-[9px] font-bold uppercase rounded-full">JP</span>}
                      {team.isHof && <span className="px-2 py-0.5 bg-hof text-white text-[9px] font-bold uppercase rounded-full">HOF</span>}
                      {team.price != null && <span className="px-2 py-0.5 bg-banana text-black text-[9px] font-bold rounded-full">${team.price.toFixed(2)}</span>}
                    </div>
                  </div>
                  <div className="px-3.5 py-3">
                    <p className="font-mono font-semibold text-sm text-text-primary truncate">{team.name || `Team #${team.tokenId}`}</p>
                    <p className="font-mono text-[10.5px] text-text-muted truncate">
                      {team.leagueNumber != null ? `League #${team.leagueNumber}` : `Team #${team.tokenId}`}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
