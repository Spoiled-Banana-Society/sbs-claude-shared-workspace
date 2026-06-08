import { OPENSEA_API_BASE, COLLECTION_SLUG, type OpenSeaListing } from '@/lib/opensea';

/**
 * Shared, short-cached map of the collection's active OpenSea listings, keyed by
 * tokenId. The marketplace overlays price/owner from this on top of our backend
 * index on EVERY browse/filter request — fetching it fresh each time added ~1s
 * (e.g. the Jackpot filter). One 15s in-memory cache makes every section fast
 * and keeps price data fresh enough for a browse view (a buy/list still reads
 * live state at the detail/checkout step).
 */
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || '';
const TTL_MS = 15_000;

let cache: { ts: number; byId: Map<string, OpenSeaListing> } | null = null;
let inflight: Promise<Map<string, OpenSeaListing>> | null = null;

export async function getCollectionListings(): Promise<Map<string, OpenSeaListing>> {
  if (cache && Date.now() - cache.ts < TTL_MS) return cache.byId;
  if (inflight) return inflight;

  inflight = (async () => {
    const byId = new Map<string, OpenSeaListing>();
    try {
      if (OPENSEA_API_KEY) {
        const res = await fetch(
          `${OPENSEA_API_BASE}/api/v2/listings/collection/${COLLECTION_SLUG}/all?limit=50`,
          { headers: { accept: 'application/json', 'x-api-key': OPENSEA_API_KEY }, cache: 'no-store' },
        );
        if (res.ok) {
          const data = await res.json();
          for (const l of (data.listings ?? []) as OpenSeaListing[]) {
            const off = l.protocol_data.parameters.offer.find(
              (o: { itemType: number }) => o.itemType === 2 || o.itemType === 3,
            ) as { identifierOrCriteria?: string } | undefined;
            if (off?.identifierOrCriteria) byId.set(off.identifierOrCriteria, l);
          }
          cache = { ts: Date.now(), byId };
        }
      }
    } catch {
      /* best-effort overlay — return whatever we have (possibly empty) */
    }
    inflight = null;
    return byId;
  })();
  return inflight;
}
