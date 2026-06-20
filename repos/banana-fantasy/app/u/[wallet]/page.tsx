'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMyNfts } from '@/hooks/useMarketplace';
import type { MarketplaceTeam } from '@/lib/opensea';
import { buildTieredDraftPassUrl } from '@/lib/nftCard';
import { SbsPassThumb } from '@/components/marketplace/SbsPassThumb';
import { UserSearchBox } from '@/app/components/marketplace/UserSearchBox';

// Team card art. Uses a plain <img> (not next/image) so generated card URLs on
// any host render without needing a next.config remotePatterns entry, and falls
// back to the banana thumb if the image 404s.
function TeamThumb({ team }: { team: MarketplaceTeam }) {
  const [errored, setErrored] = useState(false);
  const src = team.fillingWheelLevel
    ? buildTieredDraftPassUrl(team.tokenId, team.fillingWheelLevel)
    : team.imageUrl || '';

  if (!src || errored) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <SbsPassThumb label={`#${team.tokenId}`} size={150} roster={team.roster} />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={`Team #${team.tokenId}`}
      onError={() => setErrored(true)}
      className="absolute inset-0 w-full h-full object-contain"
    />
  );
}

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;
// A username is 3–20 chars of letters/numbers/_.- (matches lib/usernames).
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,20}$/;
const looksLookupable = (s: string) => WALLET_RE.test(s) || USERNAME_RE.test(s);

// Public read-only view of every team a person owns. Reached by clicking a
// person in the marketplace Activity feed, or by typing a username/wallet into
// the lookup box. The URL segment can be a wallet OR a username — we resolve a
// username to its wallet before loading teams.
export default function UserTeamsPage() {
  const params = useParams();
  const raw = (Array.isArray(params?.wallet) ? params.wallet[0] : params?.wallet) ?? '';
  const idParam = decodeURIComponent(raw).trim();

  const isWallet = WALLET_RE.test(idParam);

  // Resolve whatever's in the URL to a wallet (+ display name). A wallet
  // resolves to itself; a username is looked up server-side.
  const [resolved, setResolved] = useState<{ wallet: string; username: string | null } | null>(
    isWallet ? { wallet: idParam.toLowerCase(), username: null } : null,
  );
  const [resolving, setResolving] = useState(!isWallet && USERNAME_RE.test(idParam));
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (isWallet) {
      setResolved({ wallet: idParam.toLowerCase(), username: null });
      setResolving(false);
      setNotFound(false);
      // Also fetch the display name so the header can show it.
      fetch(`/api/marketplace/resolve-user?q=${encodeURIComponent(idParam)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (!cancelled && d?.wallet) setResolved({ wallet: d.wallet, username: d.username ?? null }); })
        .catch(() => {});
      return () => { cancelled = true; };
    }
    if (!USERNAME_RE.test(idParam)) { setResolving(false); setNotFound(false); return; }
    setResolving(true);
    setNotFound(false);
    fetch(`/api/marketplace/resolve-user?q=${encodeURIComponent(idParam)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        if (d?.wallet) setResolved({ wallet: d.wallet, username: d.username ?? idParam });
        else setNotFound(true);
        setResolving(false);
      })
      .catch(() => { if (!cancelled) { setNotFound(true); setResolving(false); } });
    return () => { cancelled = true; };
  }, [idParam, isWallet]);

  const wallet = resolved?.wallet ?? null;
  const { data: teams, isLoading } = useMyNfts(wallet);

  const shortWallet = wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : '';
  const displayName = resolved?.username || shortWallet;

  const headerBusy = resolving || (!resolved && !notFound && looksLookupable(idParam));

  return (
    <div className="w-full px-4 sm:px-8 lg:px-12 py-8">
      <div className="max-w-6xl mx-auto">
        <Link href="/marketplace" className="text-text-muted text-sm hover:text-text-primary transition-colors">← Back to Marketplace</Link>

        {/* People lookup — type a username or wallet to view their teams. */}
        <div className="mt-4 mb-6 flex flex-col sm:flex-row sm:items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
            {headerBusy
              ? 'Loading…'
              : resolved
                ? <>Teams owned by <span className="font-mono text-banana">{displayName}</span></>
                : 'Find a user'}
          </h1>
          <div className="sm:ml-auto w-full sm:w-96">
            <UserSearchBox />
          </div>
        </div>

        {headerBusy ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => <div key={i} className="aspect-[4/5] bg-bg-tertiary rounded-2xl animate-pulse" />)}
          </div>
        ) : notFound ? (
          <p className="text-text-muted text-sm py-12 text-center">No user found for “{idParam}”. Try a different username or wallet.</p>
        ) : !resolved ? (
          <p className="text-text-muted text-sm py-12 text-center">Enter a username or wallet to see all the teams that person owns.</p>
        ) : isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => <div key={i} className="aspect-[4/5] bg-bg-tertiary rounded-2xl animate-pulse" />)}
          </div>
        ) : teams.length === 0 ? (
          <p className="text-text-muted text-sm py-12 text-center">This user doesn’t own any teams.</p>
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
                    <TeamThumb team={team} />
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
