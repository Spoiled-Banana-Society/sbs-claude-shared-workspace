'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MarketplaceTeam, DraftType, OfferData } from '@/lib/opensea';
import type { CollectionStats } from '@/lib/opensea';
import { getOwnerDraftTokens, type ApiDraftToken } from '@/lib/api/owner';

// ── Collection Stats ────────────────────────────────────────────────

interface UseCollectionStatsResult {
  data: CollectionStats | null;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
}

export function useCollectionStats(): UseCollectionStatsResult {
  const [data, setData] = useState<CollectionStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/marketplace/collection');
      if (!res.ok) throw new Error(`Failed to fetch stats: ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 60_000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  return { data, isLoading, error, refetch: fetchStats };
}

// ── All Collection NFTs ──────────────────────────────────────────────

interface UseCollectionNftsResult {
  data: MarketplaceTeam[];
  isLoading: boolean;
  error: unknown;
  hasMore: boolean;
  loadMore: () => void;
  refetch: () => void;
}

// Per-filter cache (all / level / league) so switching tabs paints INSTANTLY from
// memory, and a flaky/empty fetch never blanks a section that already had teams.
const collectionCache = new Map<string, MarketplaceTeam[]>();
const ckey = (level?: string | null, league?: number | null) => `${level ?? ''}|${league ?? ''}`;

export function useCollectionNfts(limit: number = 50, level?: 'jackpot' | 'hof' | null, league?: number | null): UseCollectionNftsResult {
  const [data, setData] = useState<MarketplaceTeam[]>(() => collectionCache.get(ckey(level, league)) ?? []);
  const [isLoading, setIsLoading] = useState(() => !collectionCache.has(ckey(level, league)));
  const [error, setError] = useState<unknown>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const fetchNfts = useCallback(async (append = false, nextCursor?: string | null) => {
    const key = ckey(level, league);
    // Only show the skeleton when we have nothing cached for this filter.
    if (!append && !collectionCache.has(key)) setIsLoading(true);
    try {
      // ALWAYS backend-sourced: the marketplace_index (keyed by on-chain id) is the
      // source of truth for which tokens are teams + level/league/roster/image, and
      // prices come from our own active_listings cache. No OpenSea on the page path
      // (the actual trades still settle on Seaport — that's the only OpenSea piece).
      const p = new URLSearchParams();
      if (level) p.set('level', level);
      if (league != null) p.set('league', String(league));
      const url = `/api/marketplace/teams?${p}`;

      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch collection NFTs: ${res.status}`);
      const json = await res.json();

      const nfts: MarketplaceTeam[] = json.nfts ?? [];
      // A successful EMPTY result for a filter that previously had teams is almost
      // always a transient backend blip — keep the cached cards rather than blanking.
      if (!append && nfts.length === 0 && (collectionCache.get(key)?.length ?? 0) > 0) {
        setData(collectionCache.get(key)!);
      } else {
        if (!append) collectionCache.set(key, nfts);
        setData(prev => append ? [...prev, ...nfts] : nfts);
      }
      setCursor(json.next ?? null);
      setHasMore(!!json.next);
      setError(null);
    } catch (err) {
      // On a failed fetch, keep whatever's on screen — never blank to "No Teams".
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }, [limit, level, league]);

  useEffect(() => {
    fetchNfts(false);
  }, [fetchNfts]);

  const loadMore = useCallback(() => {
    if (cursor) fetchNfts(true, cursor);
  }, [cursor, fetchNfts]);

  const refetch = useCallback(() => {
    fetchNfts(false);
  }, [fetchNfts]);

  return { data, isLoading, error, hasMore, loadMore, refetch };
}

// ── Listings (Buy Tab) ──────────────────────────────────────────────

interface UseListingsResult {
  data: MarketplaceTeam[];
  isLoading: boolean;
  error: unknown;
  hasMore: boolean;
  loadMore: () => void;
  refetch: () => void;
}

export function useListings(
  sort: string = 'price',
  direction: string = 'asc',
  limit: number = 50,
): UseListingsResult {
  const [data, setData] = useState<MarketplaceTeam[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const fetchListings = useCallback(async (append = false, nextCursor?: string | null) => {
    if (!append) setIsLoading(true);
    try {
      const params = new URLSearchParams({
        sort,
        direction,
        limit: String(limit),
      });
      if (nextCursor) params.set('cursor', nextCursor);

      const res = await fetch(`/api/marketplace/listings?${params}`);
      if (!res.ok) throw new Error(`Failed to fetch listings: ${res.status}`);
      const json = await res.json();

      const listings: MarketplaceTeam[] = json.listings ?? [];
      setData(prev => append ? [...prev, ...listings] : listings);
      setCursor(json.next ?? null);
      setHasMore(!!json.next);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }, [sort, direction, limit]);

  useEffect(() => {
    fetchListings(false);
  }, [fetchListings]);

  const loadMore = useCallback(() => {
    if (cursor) fetchListings(true, cursor);
  }, [cursor, fetchListings]);

  const refetch = useCallback(() => {
    fetchListings(false);
  }, [fetchListings]);

  return { data, isLoading, error, hasMore, loadMore, refetch };
}

// ── My NFTs (Sell Tab) ──────────────────────────────────────────────

interface UseMyNftsResult {
  data: MarketplaceTeam[];
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
  /**
   * Optimistically reflect a just-created/cancelled listing in local state.
   * OpenSea takes a few seconds to index a new order, so a plain refetch right
   * after listing still returns the NFT without its orderHash — leaving the UI
   * showing "List for Sale" until a manual refresh. Patch it locally so the
   * button flips immediately; the next natural refetch confirms it.
   */
  patchListing: (tokenId: string, listing: { orderHash: string; price: number } | null) => void;
}

/**
 * Enrich OpenSea NFT data with SBS backend stats (rank, points, roster, level).
 */
function enrichWithBackendData(
  nfts: MarketplaceTeam[],
  tokens: ApiDraftToken[],
): MarketplaceTeam[] {
  return nfts.map(nft => {
    // Match by cardId (token ID)
    const token = tokens.find(t => t.cardId === nft.tokenId);
    if (!token) return nft;

    const level = token.level;
    const draftType: DraftType =
      level === 'Jackpot' ? 'jackpot' : level === 'Hall of Fame' ? 'hof' : 'pro';

    const rank = token.rank ? parseInt(token.rank, 10) : 0;
    const points = token.seasonScore ? Number(token.seasonScore) : 0;
    const weekScore = token.weekScore ? Number(token.weekScore) : 0;

    // Build roster display strings from backend roster data
    const roster: string[] = [];
    if (token.roster) {
      const posOrder = ['QB', 'RB', 'WR', 'TE', 'DST'] as const;
      for (const pos of posOrder) {
        const players = token.roster[pos];
        if (players?.length) {
          players.forEach(p => roster.push(`${p.team} ${p.position}`));
        }
      }
    }

    const colorMap: Record<DraftType, string> = {
      jackpot: 'from-error to-red-700',
      hof: 'from-hof to-pink-600',
      pro: 'from-pro to-blue-600',
    };

    return {
      ...nft,
      draftType,
      isHof: draftType === 'hof' || draftType === 'jackpot',
      isJackpot: draftType === 'jackpot',
      rank: Number.isFinite(rank) ? rank : 0,
      points: Number.isFinite(points) ? points : 0,
      weeklyAvg: Number.isFinite(weekScore) ? weekScore : 0,
      roster: roster.length > 0 ? roster : nft.roster,
      color: colorMap[draftType],
      name: token.leagueDisplayName || nft.name,
      passType: (token.passType === 'free' ? 'free' : 'paid') as 'paid' | 'free',
    };
  });
}

// Last result per wallet — so re-opening the Sell tab paints the cards INSTANTLY
// from memory while a fresh fetch runs silently in the background (no skeleton
// flash). Survives tab switches for the life of the page.
const myNftsCache = new Map<string, MarketplaceTeam[]>();

// localStorage mirror so a HARD refresh paints the teams instantly from the
// last snapshot (then revalidates live), instead of a skeleton + network wait.
const MY_NFTS_LS_PREFIX = 'sbs:my-nfts:';
function getCachedMyNfts(walletAddress: string): MarketplaceTeam[] | undefined {
  const lc = walletAddress.toLowerCase();
  if (myNftsCache.has(lc)) return myNftsCache.get(lc);
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(MY_NFTS_LS_PREFIX + lc);
      if (raw) { const parsed = JSON.parse(raw) as MarketplaceTeam[]; myNftsCache.set(lc, parsed); return parsed; }
    } catch { /* ignore corrupt localStorage */ }
  }
  return undefined;
}
function writeMyNftsCache(walletAddress: string, data: MarketplaceTeam[]): void {
  const lc = walletAddress.toLowerCase();
  myNftsCache.set(lc, data);
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(MY_NFTS_LS_PREFIX + lc, JSON.stringify(data)); } catch { /* quota — non-fatal */ }
  }
}

export function useMyNfts(walletAddress: string | null): UseMyNftsResult {
  const [data, setData] = useState<MarketplaceTeam[]>(() => (walletAddress ? getCachedMyNfts(walletAddress) ?? [] : []));
  // Only show the loading skeleton when we have NOTHING cached to paint.
  const [isLoading, setIsLoading] = useState(() => !(walletAddress && getCachedMyNfts(walletAddress)));
  const [error, setError] = useState<unknown>(null);
  const fetchingRef = useRef<string | null>(null);

  const fetchMyNfts = useCallback(async () => {
    if (!walletAddress) {
      setData([]);
      return;
    }
    // Avoid duplicate fetches
    if (fetchingRef.current === walletAddress) return;
    fetchingRef.current = walletAddress;

    // Only block the UI with a skeleton when we have nothing cached to show.
    if (!getCachedMyNfts(walletAddress)) setIsLoading(true);
    try {
      // Fetch OpenSea NFTs, SBS backend tokens, and free-origin tokenIds in parallel
      const [nftRes, tokens, freeRes] = await Promise.all([
        fetch(`/api/marketplace/nfts?owner=${encodeURIComponent(walletAddress)}`),
        getOwnerDraftTokens(walletAddress).catch(() => [] as ApiDraftToken[]),
        fetch(`/api/pass-origin/free-tokens?wallet=${encodeURIComponent(walletAddress)}`)
          .then((r) => (r.ok ? r.json() : { tokenIds: [] }))
          .catch(() => ({ tokenIds: [] as string[] })),
      ]);

      if (!nftRes.ok) throw new Error(`Failed to fetch NFTs: ${nftRes.status}`);
      const json = await nftRes.json();
      const rawNfts: MarketplaceTeam[] = json.nfts ?? [];

      // Enrich with backend data
      const enriched = enrichWithBackendData(rawNfts, tokens);

      // Overlay pass_origin free-mint detection. Authoritative for any token
      // minted via admin grant / spin / promo — takes precedence over the
      // Go API `passType` field (which is absent for reserveTokens mints).
      const freeTokenIds = new Set<string>(((freeRes as { tokenIds?: string[] }).tokenIds ?? []).map(String));
      const withFree = enriched.map((team) =>
        freeTokenIds.has(String(team.tokenId)) ? { ...team, passType: 'free' as const } : team,
      );

      // Overlay "filling JP/HOF wheel pass" status: a wheel-won JP/HOF pass that's
      // still in a filling queue round is sellable now (the marketplace waives the
      // free-pass listing block for it). Best-effort — a failure just omits it.
      let fillingLevels: Record<string, 'jackpot' | 'hof'> = {};
      const ids = withFree.map((t) => String(t.tokenId)).filter(Boolean);
      if (ids.length > 0) {
        try {
          const wpRes = await fetch(`/api/queues/wheel-pass-filling?tokenIds=${ids.join(',')}`);
          if (wpRes.ok) fillingLevels = ((await wpRes.json()) as { levels?: Record<string, 'jackpot' | 'hof'> }).levels ?? {};
        } catch { /* ignore — non-blocking enrichment */ }
      }
      const finalData = withFree.map((team) => {
        const lvl = fillingLevels[String(team.tokenId)];
        return lvl ? { ...team, fillingWheelLevel: lvl } : team;
      });
      writeMyNftsCache(walletAddress, finalData);
      setData(finalData);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setIsLoading(false);
      fetchingRef.current = null;
    }
  }, [walletAddress]);

  useEffect(() => {
    fetchMyNfts();
  }, [fetchMyNfts]);

  const patchListing = useCallback((tokenId: string, listing: { orderHash: string; price: number } | null) => {
    setData(prev => prev.map(t =>
      String(t.tokenId) === String(tokenId)
        ? { ...t, orderHash: listing?.orderHash ?? null, price: listing ? listing.price : null }
        : t,
    ));
  }, []);

  return { data, isLoading, error, refetch: fetchMyNfts, patchListing };
}

// ── Single NFT Detail ───────────────────────────────────────────────

export function useNftDetail(tokenId: string | null) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const fetchNft = useCallback(async () => {
    if (!tokenId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/marketplace/nft/${tokenId}`);
      if (!res.ok) throw new Error(`Failed to fetch NFT: ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }, [tokenId]);

  useEffect(() => {
    fetchNft();
  }, [fetchNft]);

  return { data, isLoading, error, refetch: fetchNft };
}

// ── NFT Offers ──────────────────────────────────────────────────────

interface UseNftOffersResult {
  offers: OfferData[];
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
  bestOffer: OfferData | null;
}

export function useNftOffers(tokenId: string | null): UseNftOffersResult {
  const [offers, setOffers] = useState<OfferData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const fetchOffers = useCallback(async () => {
    if (!tokenId) {
      setOffers([]);
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch(`/api/marketplace/offers?tokenId=${tokenId}`);
      if (!res.ok) throw new Error(`Failed to fetch offers: ${res.status}`);
      const json = await res.json();
      setOffers(json.offers ?? []);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }, [tokenId]);

  useEffect(() => {
    fetchOffers();
    const interval = setInterval(fetchOffers, 30_000);
    return () => clearInterval(interval);
  }, [fetchOffers]);

  const bestOffer = useMemo(() => {
    if (offers.length === 0) return null;
    return offers.reduce((best, o) => o.amount > best.amount ? o : best, offers[0]);
  }, [offers]);

  return { offers, isLoading, error, refetch: fetchOffers, bestOffer };
}

// ── Activity History ─────────────────────────────────────────────

export interface ActivityEntry {
  id: string;
  type: 'buy' | 'sell' | 'list' | 'cancel' | 'offer_made' | 'offer_accepted';
  walletAddress: string;
  tokenId: string;
  teamName: string;
  price: number | null;
  counterparty: string | null;
  orderHash: string | null;
  txHash: string | null;
  timestamp: string;
}

interface UseActivityHistoryResult {
  activities: ActivityEntry[];
  isLoading: boolean;
  hasMore: boolean;
  loadMore: () => void;
  refetch: () => void;
}

export function useActivityHistory(walletAddress: string | null): UseActivityHistoryResult {
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const fetchActivities = useCallback(async (append = false, nextCursor?: string | null) => {
    if (!walletAddress) {
      setActivities([]);
      return;
    }
    if (!append) setIsLoading(true);
    try {
      const params = new URLSearchParams({ wallet: walletAddress, limit: '20' });
      if (nextCursor) params.set('cursor', nextCursor);

      const res = await fetch(`/api/marketplace/activity?${params}`);
      if (!res.ok) throw new Error(`Failed to fetch activity: ${res.status}`);
      const json = await res.json();

      const items: ActivityEntry[] = json.activities ?? [];
      setActivities(prev => append ? [...prev, ...items] : items);
      setCursor(json.nextCursor ?? null);
      setHasMore(json.hasMore ?? false);
    } catch (err) {
      console.error('[useActivityHistory] error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    fetchActivities(false);
  }, [fetchActivities]);

  const loadMore = useCallback(() => {
    if (cursor) fetchActivities(true, cursor);
  }, [cursor, fetchActivities]);

  const refetch = useCallback(() => {
    fetchActivities(false);
  }, [fetchActivities]);

  return { activities, isLoading, hasMore, loadMore, refetch };
}

// ── Offers on All My NFTs ────────────────────────────────────────

export interface MyNftOffer extends OfferData {
  tokenId: string;
  teamName: string;
  imageUrl?: string;
}

interface UseMyNftOffersResult {
  allOffers: MyNftOffer[];
  isLoading: boolean;
  refetch: () => void;
}

export function useMyNftOffers(
  walletAddress: string | null,
  ownedNfts: MarketplaceTeam[],
): UseMyNftOffersResult {
  const [allOffers, setAllOffers] = useState<MyNftOffer[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchAllOffers = useCallback(async () => {
    // CRITICAL: only fetch offers for teams the user has LISTED for sale.
    // Fanning out one /api/marketplace/offers request per OWNED NFT fired
    // hundreds of requests at once for big holders (~600 passes/teams) and
    // tripped the rate limiter, 429-ing the whole site. Offers on an unlisted
    // team are still visible on that team's detail page (useNftOffers).
    const listed = walletAddress ? ownedNfts.filter((n) => !!n.orderHash) : [];
    if (listed.length === 0) {
      setAllOffers([]);
      return;
    }
    setIsLoading(true);
    try {
      const results = await Promise.all(
        listed.map(async (nft) => {
          try {
            const res = await fetch(`/api/marketplace/offers?tokenId=${nft.tokenId}`);
            if (!res.ok) return [];
            const json = await res.json();
            return (json.offers ?? []).map((o: OfferData) => ({
              ...o,
              tokenId: nft.tokenId,
              teamName: nft.name,
              imageUrl: nft.imageUrl,
            }));
          } catch {
            return [];
          }
        })
      );
      setAllOffers(results.flat().sort((a, b) => b.amount - a.amount));
    } catch (err) {
      console.error('[useMyNftOffers] error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [walletAddress, ownedNfts]);

  useEffect(() => {
    fetchAllOffers();
  }, [fetchAllOffers]);

  return { allOffers, isLoading, refetch: fetchAllOffers };
}

// ── Log Activity Helper ──────────────────────────────────────────

export async function logActivity(data: {
  type: ActivityEntry['type'];
  walletAddress: string;
  tokenId: string;
  teamName?: string;
  price?: number | null;
  counterparty?: string | null;
  orderHash?: string | null;
  txHash?: string | null;
}) {
  try {
    await fetch('/api/marketplace/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch (err) {
    console.error('[logActivity] error:', err);
  }
}

// ── Sold-team detection (drafted leagues no longer owned) ────────

/**
 * Given the wallet's drafted leagues it can't already confirm as owned, returns
 * the subset it has SOLD (no longer owns on-chain). My Teams uses this to hide
 * teams the user drafted but later sold — the draft backend keeps them forever.
 * Deps are scalars only (wallet + sorted id key), per the render-loop rule.
 */
export function useNotOwnedLeagues(wallet: string | null, candidateLeagueIds: string[]): Set<string> {
  const [notOwned, setNotOwned] = useState<Set<string>>(new Set());
  const key = candidateLeagueIds.slice().sort().join(',');

  const fetchIt = useCallback(async () => {
    if (!wallet || !key) { setNotOwned(new Set()); return; }
    try {
      const res = await fetch(`/api/marketplace/league-ownership?wallet=${wallet}&leagues=${encodeURIComponent(key)}`);
      if (!res.ok) { setNotOwned(new Set()); return; }
      const j = await res.json();
      setNotOwned(new Set((j.notOwned ?? []) as string[]));
    } catch {
      setNotOwned(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, key]);

  useEffect(() => { void fetchIt(); }, [fetchIt]);
  return notOwned;
}

// ── Last Sale Prices (batch) ─────────────────────────────────────

interface LastSaleData {
  price: number;
  timestamp: string;
}

export function useLastSales(tokenIds: string[]): Record<string, LastSaleData> {
  const [data, setData] = useState<Record<string, LastSaleData>>({});
  const idsKey = tokenIds.sort().join(',');

  const fetchLastSales = useCallback(async () => {
    if (tokenIds.length === 0) {
      setData({});
      return;
    }

    // Chunk into groups of 30 for Firestore 'in' limit
    const chunks: string[][] = [];
    for (let i = 0; i < tokenIds.length; i += 30) {
      chunks.push(tokenIds.slice(i, i + 30));
    }

    try {
      const results = await Promise.all(
        chunks.map(async (chunk) => {
          const res = await fetch(`/api/marketplace/activity?tokenIds=${chunk.join(',')}`);
          if (!res.ok) return {};
          const json = await res.json();
          return json.lastSales ?? {};
        })
      );

      const merged: Record<string, LastSaleData> = {};
      for (const result of results) {
        Object.assign(merged, result);
      }
      setData(merged);
    } catch (err) {
      console.error('[useLastSales] error:', err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  useEffect(() => {
    fetchLastSales();
  }, [fetchLastSales]);

  return data;
}

// ── Token Sale History ──────────────────────────────────────────

export function useTokenSaleHistory(tokenId: string | null) {
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchHistory = useCallback(async () => {
    if (!tokenId) {
      setActivities([]);
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch(`/api/marketplace/activity?tokenId=${tokenId}&type=buy,sell,list,cancel`);
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const json = await res.json();
      setActivities(json.activities ?? []);
    } catch (err) {
      console.error('[useTokenSaleHistory] error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [tokenId]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return { activities, isLoading, refetch: fetchHistory };
}

// ── Watchlist ────────────────────────────────────────────────────

interface WatchlistItem {
  id: string;
  tokenId: string;
  lastKnownPrice: number | null;
  addedAt: string;
}

interface UseWatchlistResult {
  watchlist: WatchlistItem[];
  watchlistSet: Set<string>;
  toggle: (tokenId: string, price?: number | null) => void;
  refetch: () => void;
  isLoading: boolean;
}

export function useWatchlist(walletAddress: string | null): UseWatchlistResult {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchWatchlist = useCallback(async () => {
    if (!walletAddress) {
      setWatchlist([]);
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch(`/api/marketplace/watchlist?wallet=${encodeURIComponent(walletAddress)}`);
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const json = await res.json();
      setWatchlist(json.items ?? []);
    } catch (err) {
      console.error('[useWatchlist] error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    fetchWatchlist();
  }, [fetchWatchlist]);

  const watchlistSet = useMemo(
    () => new Set(watchlist.map(w => w.tokenId)),
    [watchlist],
  );

  const toggle = useCallback(
    (tokenId: string, price?: number | null) => {
      if (!walletAddress) return;

      const isWatchlisted = watchlistSet.has(tokenId);

      if (isWatchlisted) {
        // Optimistic remove
        setWatchlist(prev => prev.filter(w => w.tokenId !== tokenId));
        fetch('/api/marketplace/watchlist', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet: walletAddress, tokenId }),
        }).catch(() => fetchWatchlist());
      } else {
        // Optimistic add
        setWatchlist(prev => [
          { id: `temp-${tokenId}`, tokenId, lastKnownPrice: price ?? null, addedAt: new Date().toISOString() },
          ...prev,
        ]);
        fetch('/api/marketplace/watchlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet: walletAddress, tokenId, price }),
        }).catch(() => fetchWatchlist());
      }
    },
    [walletAddress, watchlistSet, fetchWatchlist],
  );

  return { watchlist, watchlistSet, toggle, refetch: fetchWatchlist, isLoading };
}

// ── Firestore Notification Helpers ───────────────────────────────

async function postNotification(data: {
  wallet: string;
  type: string;
  title: string;
  message: string;
  link?: string;
}) {
  try {
    await fetch('/api/marketplace/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch (err) {
    console.error('[postNotification] error:', err);
  }
}

/** Notify seller that their item was sold */
export function notifySeller(data: {
  sellerWallet: string;
  tokenId: string;
  teamName: string;
  price: number;
  buyerWallet: string;
}) {
  postNotification({
    wallet: data.sellerWallet,
    type: 'sale_complete',
    title: 'Your Team Was Sold!',
    message: `${data.teamName} sold for $${data.price.toFixed(2)}`,
    link: `/marketplace/${data.tokenId}`,
  });
}

/** Notify NFT owner that someone made an offer */
export function notifyOwnerOfOffer(data: {
  ownerWallet: string;
  tokenId: string;
  teamName: string;
  offerAmount: number;
  offererWallet: string;
}) {
  postNotification({
    wallet: data.ownerWallet,
    type: 'offer_received',
    title: 'New Offer Received',
    message: `$${data.offerAmount.toFixed(2)} offer on ${data.teamName}`,
    link: `/marketplace/${data.tokenId}`,
  });
}

/** Notify offerer that their offer was accepted */
export function notifyOffererOfAcceptance(data: {
  offererWallet: string;
  tokenId: string;
  teamName: string;
  offerAmount: number;
}) {
  postNotification({
    wallet: data.offererWallet,
    type: 'offer_accepted',
    title: 'Your Offer Was Accepted!',
    message: `Your $${data.offerAmount.toFixed(2)} offer on ${data.teamName} was accepted.`,
    link: `/marketplace/${data.tokenId}`,
  });
}

// ── Firestore Notifications Hook (for the bell) ─────────────────

export interface FirestoreNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

interface UseFirestoreNotificationsResult {
  notifications: FirestoreNotification[];
  isLoading: boolean;
  markAllRead: () => void;
  refetch: () => void;
}

export function useFirestoreNotifications(walletAddress: string | null): UseFirestoreNotificationsResult {
  const [notifications, setNotifications] = useState<FirestoreNotification[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchNotifications = useCallback(async () => {
    if (!walletAddress) {
      setNotifications([]);
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch(`/api/marketplace/notifications?wallet=${encodeURIComponent(walletAddress)}`);
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const json = await res.json();
      setNotifications(json.notifications ?? []);
    } catch (err) {
      console.error('[useFirestoreNotifications] error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    fetchNotifications();
    // Poll every 30s for new notifications
    const interval = setInterval(fetchNotifications, 30_000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  const markAllRead = useCallback(async () => {
    if (!walletAddress) return;
    setNotifications([]);
    try {
      await fetch('/api/marketplace/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: walletAddress, all: true }),
      });
    } catch (err) {
      console.error('[markAllRead] error:', err);
    }
  }, [walletAddress]);

  return { notifications, isLoading, markAllRead, refetch: fetchNotifications };
}
