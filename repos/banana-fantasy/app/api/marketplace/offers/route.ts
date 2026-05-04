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
