import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import {
  OPENSEA_API_BASE,
  COLLECTION_SLUG,
  type OfferData,
} from '@/lib/opensea';
import { getServerDraftsApiUrl } from '@/lib/serverDraftsApiUrl';

export const dynamic = 'force-dynamic';

const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || '';

/**
 * GET /api/marketplace/offers?tokenId=123
 *
 * Returns active offers for a specific BBB4 NFT from OpenSea's Seaport orderbook.
 */
export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    const tokenId = getSearchParam(req, 'tokenId');
    if (!tokenId) {
      return jsonError('Missing tokenId parameter', 400);
    }

    const offers: OfferData[] = [];
    const seen = new Set<string>();
    const nowMs = Date.now();

    // Cached state up front: live offers to add later, and consumed hashes to
    // VETO OpenSea's view — it keeps reporting an offer as live for minutes
    // after its on-chain cancel/acceptance; our consumed markers know better.
    const { getCachedOfferState } = await import('@/lib/marketplace/offerCache');
    const cachedState = await getCachedOfferState(tokenId);

    // 1) OpenSea first — the item-offers endpoint carries the real order hash +
    //    protocol address, which Accept/Cancel need. (The old GET on
    //    /v2/orders/.../offers now 405s — OpenSea made that URL POST-only.)
    //    Best-effort: NEVER fail the whole request on an OpenSea error; our own
    //    cache below covers offers made through SBS.
    if (OPENSEA_API_KEY) {
      try {
        const offersRes = await fetch(
          `${OPENSEA_API_BASE}/api/v2/offers/collection/${COLLECTION_SLUG}/nfts/${tokenId}?limit=50`,
          { headers: { accept: 'application/json', 'x-api-key': OPENSEA_API_KEY }, cache: 'no-store' },
        );
        if (offersRes.ok) {
          const offersData = await offersRes.json();
          for (const order of (offersData.offers ?? []) as Array<Record<string, unknown>>) {
            const p = (order.protocol_data as { parameters?: { offerer: string; offer: Array<{ startAmount: string }>; endTime: string } })?.parameters;
            if (!p) continue;
            const hash = order.order_hash as string;
            if (!hash || seen.has(hash) || cachedState.consumedHashes.has(hash)) continue;
            const totalUsdcWei = (p.offer || []).reduce((s: bigint, it: { startAmount: string }) => s + BigInt(it.startAmount || '0'), 0n);
            const expiresAt = new Date(Number(p.endTime) * 1000).toISOString();
            if (new Date(expiresAt) <= new Date()) continue;
            seen.add(hash);
            offers.push({
              orderHash: hash,
              offererAddress: p.offerer,
              offererName: `${p.offerer.slice(0, 6)}...${p.offerer.slice(-4)}`,
              offererPfp: null,
              amount: Number(totalUsdcWei) / 1e6,
              expiresAt,
              protocolAddress: order.protocol_address as string,
            });
          }
        } else {
          console.error('[marketplace/offers] OpenSea error (non-fatal):', offersRes.status);
        }
      } catch (e) { console.error('[marketplace/offers] OpenSea fetch failed (non-fatal):', e); }
    }

    // 2) OUR offer cache — instant supplement so an offer just made through SBS
    //    shows before OpenSea has indexed it (and survives OpenSea outages).
    //    Dedupe by orderHash ONLY (cache hashes are the client-computed Seaport
    //    hash, identical to OpenSea's) — deduping by offerer here would let an
    //    older indexed offer shadow a newer not-yet-indexed one during the lag.
    //    The per-wallet collapse below picks the display winner.
    try {
      for (const c of cachedState.active) {
        if (c.endTimeSec && Number(c.endTimeSec) * 1000 <= nowMs) continue; // expired
        const key = c.orderHash || `${c.tokenId}-${c.offerer}`;
        if (seen.has(key)) continue;
        seen.add(key);
        offers.push({
          orderHash: c.orderHash,
          offererAddress: c.offerer,
          offererName: `${c.offerer.slice(0, 6)}...${c.offerer.slice(-4)}`,
          offererPfp: null,
          amount: c.priceUsd,
          expiresAt: c.endTimeSec ? new Date(Number(c.endTimeSec) * 1000).toISOString() : new Date(nowMs + 7 * 86400000).toISOString(),
          protocolAddress: '',
        });
      }
    } catch (e) { console.error('[marketplace/offers] cache read failed:', e); }

    // Show EVERY live offer (deduped by orderHash above) — each is a separate
    // signed order the owner can accept and the offerer can cancel, so hiding
    // any of them hides a real cancellable/acceptable order.
    offers.sort((a: OfferData, b: OfferData) => b.amount - a.amount); // top offer first

    // Enrich with SBS profiles (same pattern as listings route)
    const DRAFTS_API = getServerDraftsApiUrl();
    try {
      const uniqueOfferers = [...new Set(offers.map((o: OfferData) => o.offererAddress.toLowerCase()))];
      const profiles = new Map<string, { name: string; pfp: string | null }>();

      await Promise.all(
        uniqueOfferers.map(async (addr: string) => {
          try {
            const res = await fetch(`${DRAFTS_API}/owner/${addr}`, {
              signal: AbortSignal.timeout(2500),
            });
            if (!res.ok) return;
            const profile = await res.json();
            if (profile?.pfp?.displayName || profile?.pfp?.imageUrl) {
              profiles.set(addr, {
                name: profile.pfp?.displayName || '',
                pfp: profile.pfp?.imageUrl || null,
              });
            }
          } catch { /* skip */ }
        }),
      );

      for (const offer of offers) {
        const profile = profiles.get(offer.offererAddress.toLowerCase());
        if (profile) {
          if (profile.name) offer.offererName = profile.name;
          if (profile.pfp) offer.offererPfp = profile.pfp;
        }
      }
    } catch { /* enrichment failed — continue with raw data */ }

    return json({ offers });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[marketplace/offers] GET failed:', err);
    return jsonError('Internal Server Error', 500);
  }
}

/**
 * POST /api/marketplace/offers
 *
 * Forwards a signed Seaport offer to OpenSea's offers endpoint.
 * Body: { ...order, protocol_address }
 * Keeps OPENSEA_API_KEY server-side only.
 */
export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    if (!OPENSEA_API_KEY) {
      return jsonError('OpenSea API key not configured', 503);
    }

    const body = await req.json();
    if (!body?.parameters || !body?.signature || !body?.protocol_address) {
      return jsonError('Missing signed order fields', 400);
    }

    // Forward ONLY the order fields to OpenSea — never our internal `_meta`.
    const openSeaBody = { parameters: body.parameters, signature: body.signature, protocol_address: body.protocol_address };
    const postRes = await fetch(
      `${OPENSEA_API_BASE}/api/v2/orders/base/seaport/offers`,
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-api-key': OPENSEA_API_KEY,
        },
        body: JSON.stringify(openSeaBody),
      },
    );

    const text = await postRes.text();
    if (!postRes.ok) {
      console.error('[marketplace/offers] OpenSea POST failed:', postRes.status, text);
      let detail = '';
      try {
        const errJson = JSON.parse(text);
        detail = errJson.errors?.[0] || errJson.detail || errJson.message || text;
      } catch { detail = text; }
      return jsonError(`OpenSea error: ${detail}`, postRes.status >= 500 ? 502 : postRes.status);
    }

    const result = JSON.parse(text);
    // OpenSea's offer response shape has varied — try the known paths, then the
    // client-computed Seaport hash (deterministic, so it equals OpenSea's).
    const metaHash = typeof (body._meta as { orderHash?: unknown })?.orderHash === 'string' ? (body._meta as { orderHash: string }).orderHash : '';
    const orderHash = (result.order?.order_hash || result.order_hash || result.orders?.[0]?.order_hash || metaHash || '') as string;

    // Cache the offer so the detail page shows it instantly. OpenSea's offers
    // feed lags (or silently never returns it), so without a cache a fresh offer
    // never appeared. Prefer the client's explicit `_meta`; fall back to digging
    // the fields out of the signed order. Best-effort.
    try {
      const meta = (body._meta || {}) as { tokenId?: string; priceUsd?: number; offerer?: string; endTimeSec?: string };
      const p = body.parameters as {
        offerer?: string;
        endTime?: string;
        offer?: Array<{ startAmount?: string }>;
        consideration?: Array<{ itemType?: number | string; identifierOrCriteria?: string; identifier?: string }>;
      };
      const nftItem = (p.consideration || []).find(c => Number(c.itemType) === 2 || Number(c.itemType) === 3);
      const tokenId = meta.tokenId || nftItem?.identifierOrCriteria || nftItem?.identifier;
      const offerer = meta.offerer || p.offerer;
      const usdcWei = (p.offer || []).reduce((s, it) => s + BigInt(it.startAmount || '0'), 0n);
      const priceUsd = typeof meta.priceUsd === 'number' ? meta.priceUsd : Number(usdcWei) / 1e6;
      // Record even if OpenSea didn't return an orderHash — the offer cache uses
      // a tokenId+offerer fallback key, so the offer still shows (the owner just
      // can't one-click-accept until a real hash is known; the offer is real).
      if (tokenId && offerer) {
        const { recordOffer } = await import('@/lib/marketplace/offerCache');
        // Store the full signed Seaport parameters too — lets the offerer cancel
        // during OpenSea's indexing lag (cancel route falls back to this).
        await recordOffer({ tokenId: String(tokenId), orderHash, priceUsd, offerer, endTimeSec: meta.endTimeSec || p.endTime || null, parameters: (body.parameters as Record<string, unknown>) || null });
      } else {
        console.error('[marketplace/offers] cache skip — missing tokenId/offerer', { hasMeta: !!body._meta, tokenId, offerer });
      }
    } catch (e) { console.error('[marketplace/offers] cache write failed:', e); }

    return json({ orderHash });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[marketplace/offers] POST failed:', err);
    return jsonError('Internal Server Error', 500);
  }
}
