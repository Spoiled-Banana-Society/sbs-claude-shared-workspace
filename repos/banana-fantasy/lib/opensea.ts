/**
 * OpenSea types, constants, and mapping helpers for the BBB4 marketplace.
 */

// ── Constants ───────────────────────────────────────────────────────
export const BBB4_CONTRACT = '0x14065412b3A431a660e6E576A14b104F1b3E463b';
export const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const OPENSEA_API_BASE = 'https://api.opensea.io';
export const COLLECTION_SLUG = 'sbs-draft-pass-bbb4';
export const OPENSEA_CHAIN = 'base';

/**
 * Ask OpenSea to re-fetch a token's metadata (image/name/attrs) from our
 * tokenURI. Fire after we change what the metadata endpoint will return — at
 * mint (so a fresh pass shows the grey card live) and at draft close (so it
 * flips to the team card). Best-effort; rate-limit-friendly small concurrency.
 */
export async function refreshOpenSeaTokens(tokenIds: Array<string | number>): Promise<number> {
  const apiKey = process.env.OPENSEA_API_KEY || '';
  if (!apiKey) return 0;
  const ids = [...new Set(tokenIds.map((t) => String(t).trim()).filter((s) => /^\d+$/.test(s)))];
  let ok = 0;
  const CONCURRENCY = 4;
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(async (id) => {
      try {
        const res = await fetch(
          `${OPENSEA_API_BASE}/api/v2/chain/${OPENSEA_CHAIN}/contract/${BBB4_CONTRACT}/nfts/${id}/refresh`,
          { method: 'POST', headers: { accept: 'application/json', 'x-api-key': apiKey } },
        );
        return res.ok;
      } catch { return false; }
    }));
    ok += results.filter(Boolean).length;
  }
  return ok;
}

// ── OpenSea API Response Types ──────────────────────────────────────

export interface OpenSeaNft {
  identifier: string;
  collection: string;
  contract: string;
  token_standard: string;
  name: string | null;
  description: string | null;
  image_url: string | null;
  display_image_url: string | null;
  metadata_url: string | null;
  traits?: Array<{ trait_type: string; value: string | number }>;
}

export interface OpenSeaListingPrice {
  current: {
    currency: string;
    decimals: number;
    value: string;
  };
}

export interface OpenSeaListing {
  order_hash: string;
  chain: string;
  protocol_address: string;
  protocol_data: {
    parameters: {
      offerer: string;
      offer: Array<{
        itemType: number;
        token: string;
        identifierOrCriteria: string;
        startAmount: string;
        endAmount: string;
      }>;
      consideration: Array<{
        itemType: number;
        token: string;
        identifierOrCriteria: string;
        startAmount: string;
        endAmount: string;
        recipient: string;
      }>;
      [k: string]: unknown;
    };
    signature: string;
  };
  price: OpenSeaListingPrice;
  remaining_quantity?: number;
}

export interface OpenSeaCollectionStats {
  total: {
    volume: number;
    sales: number;
    num_owners: number;
    market_cap: number;
    floor_price: number;
    floor_price_symbol: string;
    average_price: number;
  };
  intervals: Array<{
    interval: string;
    volume: number;
    volume_diff: number;
    volume_change: number;
    sales: number;
    sales_diff: number;
    average_price: number;
  }>;
}

// ── Unified Marketplace Types ───────────────────────────────────────

export type DraftType = 'jackpot' | 'hof' | 'pro';

export interface MarketplaceTeam {
  id: string;
  tokenId: string;
  name: string;
  draftType: DraftType;
  isHof: boolean;
  isJackpot: boolean;
  rank: number;
  points: number;
  weeklyAvg: number;
  playoffOdds: number;
  price: number | null;
  owner: string;
  ownerAddress: string;
  ownerPfp: string | null;
  roster: string[];
  color: string;
  imageUrl: string | null;
  orderHash: string | null;
  protocolAddress: string | null;
  /** Seaport order endTime (Unix seconds string) for an active listing — used to show "expires in X". */
  listingEndTime?: string | null;
  /** Backend leagueId for this team's NFT — lets non-marketplace pages (My Teams) map a league to its token/listing. */
  leagueId?: string | null;
  passType?: 'paid' | 'free';
  /** True iff our SBS Go API has a draft-token record for this NFT
   *  (deterministic cardId match). Lets the Sell tab hide ghost NFTs
   *  that exist on-chain but have no backend purpose. */
  hasBackendRecord?: boolean;
  /** USD price the current owner paid for this team on the marketplace, if we
   *  have a purchase record. Shown as "You paid $X" on the owner's own teams. */
  pricePaid?: number | null;
}

export interface CollectionStats {
  floorPrice: number;
  floorPriceSymbol: string;
  totalVolume: number;
  numOwners: number;
  totalSales: number;
  totalListed: number;
  averagePrice: number;
  weeklyVolumeChange: number | null;
}

// ── Offer Types ─────────────────────────────────────────────────────

export interface OfferData {
  orderHash: string;
  offererAddress: string;
  offererName: string;
  offererPfp: string | null;
  amount: number;
  expiresAt: string;
  protocolAddress: string;
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Convert USDC amount (6 decimals) from raw string to USD number. */
export function priceFromUsdcWei(raw: string): number {
  return Number(raw) / 1e6;
}

/** Shorten an Ethereum address for display. */
function shortenAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/** Get color gradient based on draft type. */
function colorForDraftType(dt: DraftType): string {
  switch (dt) {
    case 'jackpot': return 'from-error to-red-700';
    case 'hof': return 'from-hof to-pink-600';
    case 'pro': return 'from-pro to-blue-600';
  }
}

/** Position trait keys in the order they appear on the NFT. */
const ROSTER_TRAIT_KEYS = [
  'QB1', 'QB2', 'RB1', 'RB2', 'RB3',
  'WR1', 'WR2', 'WR3',
  'TE1', 'TE2', 'TE3', 'TE4',
  'DST1', 'DST2', 'DST3',
];

/** Extract roster, level, and scores from OpenSea NFT traits. */
function parseNftTraits(nft: OpenSeaNft | null | undefined) {
  const roster: string[] = [];
  let level: DraftType = 'pro';
  let rank = 0;
  let points = 0;
  let weeklyAvg = 0;
  let name: string | null = null;

  if (!nft?.traits) return { roster, level, rank, points, weeklyAvg, name };

  for (const trait of nft.traits) {
    const key = trait.trait_type;
    const val = String(trait.value);

    if (ROSTER_TRAIT_KEYS.includes(key)) {
      roster.push(val);
    } else if (key === 'LEVEL') {
      if (val === 'Jackpot') level = 'jackpot';
      else if (val === 'Hall of Fame') level = 'hof';
      else level = 'pro';
    } else if (key === 'RANK' && val !== 'N/A') {
      rank = parseInt(val, 10) || 0;
    } else if (key === 'SEASON-SC0RE' || key === 'SEASON-SCORE') {
      points = parseFloat(val) || 0;
    } else if (key === 'WEEK-SCORE') {
      weeklyAvg = parseFloat(val) || 0;
    } else if (key === 'LEAGUE-NAME') {
      name = val;
    }
  }

  return { roster, level, rank, points, weeklyAvg, name };
}

/** Extract token ID from an OpenSea listing's offer array. */
function tokenIdFromListing(listing: OpenSeaListing): string {
  const nftOffer = listing.protocol_data.parameters.offer.find(o => o.itemType === 2 || o.itemType === 3);
  return nftOffer?.identifierOrCriteria ?? '0';
}

/** Determine if listing price is in USDC (ERC-20, itemType 1). */
function listingPriceUsd(listing: OpenSeaListing): number {
  const value = listing.price?.current?.value;
  const decimals = listing.price?.current?.decimals ?? 18;
  if (!value) return 0;
  return Number(value) / Math.pow(10, decimals);
}

/**
 * Build display name for an NFT.
 * OpenSea often returns bare names like "#1" — we want "Draft Pass #1" for undrafted
 * passes and "Team #1" for drafted teams with a roster.
 */
function nftDisplayName(
  leagueName: string | null,
  openSeaName: string | null | undefined,
  tokenId: string,
  hasRoster: boolean,
): string {
  if (leagueName) return leagueName;
  // Skip OpenSea names that are just "#N" or bare numbers — not useful
  if (openSeaName && !/^#?\d+$/.test(openSeaName.trim())) return openSeaName;
  return hasRoster ? `Team #${tokenId}` : `Draft Pass #${tokenId}`;
}

/**
 * Map an OpenSea listing → MarketplaceTeam.
 * Extracts roster, rank, points from NFT traits when available.
 */
export function mapOpenSeaListingToTeam(listing: OpenSeaListing, nft?: OpenSeaNft | null): MarketplaceTeam {
  const tokenId = nft?.identifier ?? tokenIdFromListing(listing);
  const price = listingPriceUsd(listing);
  const maker = listing.protocol_data.parameters.offerer;
  const traits = parseNftTraits(nft);

  return {
    id: tokenId,
    tokenId,
    name: nftDisplayName(traits.name, nft?.name, tokenId, traits.roster.length > 0),
    draftType: traits.level,
    isHof: traits.level === 'hof',
    isJackpot: traits.level === 'jackpot',
    rank: traits.rank,
    points: traits.points,
    weeklyAvg: traits.weeklyAvg,
    playoffOdds: 0,
    price,
    owner: shortenAddress(maker),
    ownerAddress: maker,
    ownerPfp: null,
    roster: traits.roster,
    color: colorForDraftType(traits.level),
    imageUrl: nft?.display_image_url ?? nft?.image_url ?? null,
    orderHash: listing.order_hash,
    protocolAddress: listing.protocol_address,
  };
}

/**
 * Map an owned OpenSea NFT → MarketplaceTeam (for sell tab).
 * Extracts roster from traits; further enriched by SBS backend data in the hook.
 */
export function mapOpenSeaNftToTeam(nft: OpenSeaNft, ownerAddress: string): MarketplaceTeam {
  const traits = parseNftTraits(nft);

  return {
    id: nft.identifier,
    tokenId: nft.identifier,
    name: nftDisplayName(traits.name, nft.name, nft.identifier, traits.roster.length > 0),
    draftType: traits.level,
    isHof: traits.level === 'hof',
    isJackpot: traits.level === 'jackpot',
    rank: traits.rank,
    points: traits.points,
    weeklyAvg: traits.weeklyAvg,
    playoffOdds: 0,
    price: null,
    owner: shortenAddress(ownerAddress),
    ownerAddress,
    ownerPfp: null,
    roster: traits.roster,
    color: colorForDraftType(traits.level),
    imageUrl: nft.display_image_url ?? nft.image_url ?? null,
    orderHash: null,
    protocolAddress: null,
  };
}

/**
 * Map OpenSea collection stats → our CollectionStats shape.
 */
export function mapCollectionStats(raw: OpenSeaCollectionStats): CollectionStats {
  return {
    floorPrice: raw.total.floor_price,
    floorPriceSymbol: raw.total.floor_price_symbol,
    totalVolume: raw.total.volume,
    numOwners: raw.total.num_owners,
    totalSales: raw.total.sales,
    totalListed: 0,
    averagePrice: raw.total.average_price,
    weeklyVolumeChange: raw.intervals?.[0]?.volume_change ?? null,
  };
}
