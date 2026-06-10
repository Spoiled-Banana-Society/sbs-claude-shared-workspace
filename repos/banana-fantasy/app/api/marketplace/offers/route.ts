import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import {
  OPENSEA_API_BASE,
  BBB4_CONTRACT,
  type OfferData,
} from '@/lib/opensea';

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
    if (!OPENSEA_API_KEY) {
      return jsonError('OpenSea API key not configured', 503);
    }

    const tokenId = getSearchParam(req, 'tokenId');
    if (!tokenId) {
      return jsonError('Missing tokenId parameter', 400);
    }

    // Fetch offers from OpenSea orderbook
    const params = new URLSearchParams({
      asset_contract_address: BBB4_CONTRACT,
      token_ids: tokenId,
      order_by: 'eth_price',
      order_direction: 'desc',
      limit: '50',
    });

    const offersRes = await fetch(
      `${OPENSEA_API_BASE}/api/v2/orders/base/seaport/offers?${params}`,
      {
        headers: {
          accept: 'application/json',
          'x-api-key': OPENSEA_API_KEY,
        },
        cache: 'no-store',
      },
    );

    if (!offersRes.ok) {
      const text = await offersRes.text();
      console.error('[marketplace/offers] OpenSea error:', offersRes.status, text);
      return jsonError('Failed to fetch offers', offersRes.status >= 500 ? 502 : offersRes.status);
    }

    const offersData = await offersRes.json();
    const orders = offersData.orders ?? [];

    // Parse each offer
    const offers: OfferData[] = orders
      .filter((order: Record<string, unknown>) => {
        // Only include active/valid offers
        const cancelled = order.cancelled as boolean;
        const finalized = order.finalized as boolean;
        return !cancelled && !finalized;
      })
      .map((order: Record<string, unknown>) => {
        const protocolData = order.protocol_data as {
          parameters: {
            offerer: string;
            offer: Array<{ startAmount: string; token: string }>;
            endTime: string;
          };
        };
        const params = protocolData.parameters;

        // Sum USDC amounts from the offer array (the USDC the offerer is putting up)
        const totalUsdcWei = params.offer.reduce((sum: bigint, item: { startAmount: string }) => {
          return sum + BigInt(item.startAmount);
        }, 0n);

        // Convert from USDC wei (6 decimals) to dollars
        const amount = Number(totalUsdcWei) / 1e6;

        const expiresAt = new Date(Number(params.endTime) * 1000).toISOString();

        return {
          orderHash: order.order_hash as string,
          offererAddress: params.offerer,
          offererName: `${params.offerer.slice(0, 6)}...${params.offerer.slice(-4)}`,
          offererPfp: null,
          amount,
          expiresAt,
          protocolAddress: order.protocol_address as string,
        };
      })
      .filter((offer: OfferData) => {
        // Filter out expired offers
        return new Date(offer.expiresAt) > new Date();
      });

    // Bridge OpenSea's offer indexing lag: add any cached offer for this token
    // that OpenSea hasn't surfaced yet (deduped by orderHash). Without this a
    // fresh offer silently didn't appear for minutes. Best-effort.
    try {
      const { getRecentCachedOffers } = await import('@/lib/marketplace/offerCache');
      const cached = await getRecentCachedOffers(tokenId);
      const seen = new Set(offers.map((o: OfferData) => o.orderHash));
      const nowMs = Date.now();
      for (const c of cached) {
        if (seen.has(c.orderHash)) continue;
        if (c.endTimeSec && Number(c.endTimeSec) * 1000 <= nowMs) continue; // expired
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
      offers.sort((a: OfferData, b: OfferData) => b.amount - a.amount); // top offer first
    } catch { /* best-effort overlay */ }

    // Enrich with SBS profiles (same pattern as listings route)
    const DRAFTS_API = process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL
      || 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
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

    const postRes = await fetch(
      `${OPENSEA_API_BASE}/api/v2/orders/base/seaport/offers`,
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-api-key': OPENSEA_API_KEY,
        },
        body: JSON.stringify(body),
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
    const orderHash = result.order?.order_hash || '';

    // Cache the offer so the detail page shows it instantly. OpenSea's offers
    // feed lags ~5-15s and offers had no cache, so a fresh offer silently didn't
    // appear (and the owner couldn't act on it). Best-effort.
    try {
      const p = body.parameters as {
        offerer?: string;
        endTime?: string;
        offer?: Array<{ startAmount?: string }>;
        consideration?: Array<{ itemType?: number; identifierOrCriteria?: string }>;
      };
      // In a Seaport offer (bid), `offer` is the USDC the bidder puts up and
      // `consideration` is the NFT they want — so the tokenId lives there.
      const nftItem = (p.consideration || []).find(c => c.itemType === 2 || c.itemType === 3);
      const tokenId = nftItem?.identifierOrCriteria;
      const usdcWei = (p.offer || []).reduce((s, it) => s + BigInt(it.startAmount || '0'), 0n);
      if (orderHash && tokenId && p.offerer) {
        const { recordOffer } = await import('@/lib/marketplace/offerCache');
        await recordOffer({ tokenId: String(tokenId), orderHash, priceUsd: Number(usdcWei) / 1e6, offerer: p.offerer, endTimeSec: p.endTime ?? null });
      }
    } catch { /* best-effort cache write */ }

    return json({ orderHash });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[marketplace/offers] POST failed:', err);
    return jsonError('Internal Server Error', 500);
  }
}
