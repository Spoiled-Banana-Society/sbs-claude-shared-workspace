import type { Metadata } from 'next';
import { OPENSEA_API_BASE, OPENSEA_CHAIN, BBB4_CONTRACT, COLLECTION_SLUG } from '@/lib/opensea';

const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || '';

interface NftTrait {
  trait_type: string;
  value: string | number;
}

async function fetchNftMeta(tokenId: string) {
  if (!OPENSEA_API_KEY) return null;

  try {
    const res = await fetch(
      `${OPENSEA_API_BASE}/api/v2/chain/${OPENSEA_CHAIN}/contract/${BBB4_CONTRACT}/nfts/${tokenId}`,
      {
        headers: { accept: 'application/json', 'x-api-key': OPENSEA_API_KEY },
        next: { revalidate: 300 },
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const nft = data.nft ?? data;

    // Get league name from traits
    const leagueName = (nft.traits ?? []).find((t: NftTrait) => t.trait_type === 'LEAGUE-NAME')?.value as string | undefined;
    const level = (nft.traits ?? []).find((t: NftTrait) => t.trait_type === 'LEVEL')?.value as string | undefined;
    const rank = (nft.traits ?? []).find((t: NftTrait) => t.trait_type === 'RANK')?.value as string | undefined;

    // Try to get listing price
    let price: number | null = null;
    try {
      const listingsRes = await fetch(
        `${OPENSEA_API_BASE}/api/v2/listings/collection/${COLLECTION_SLUG}/all?limit=50`,
        { headers: { accept: 'application/json', 'x-api-key': OPENSEA_API_KEY }, next: { revalidate: 60 } },
      );
      if (listingsRes.ok) {
        const listingsData = await listingsRes.json();
        interface ListingEntry {
          protocol_data: { parameters: { offer: Array<{ itemType: number; identifierOrCriteria: string }> } };
          price: { current: { value: string; decimals: number } };
        }
        const listing = (listingsData.listings ?? []).find((l: ListingEntry) => {
          const nftOffer = l.protocol_data.parameters.offer.find(
            (o: { itemType: number }) => o.itemType === 2 || o.itemType === 3,
          );
          return nftOffer?.identifierOrCriteria === tokenId;
        }) as ListingEntry | undefined;
        if (listing?.price?.current) {
          price = Number(listing.price.current.value) / Math.pow(10, listing.price.current.decimals ?? 18);
        }
      }
    } catch { /* optional */ }

    const name = leagueName || nft.name || `Team #${tokenId}`;
    const imageUrl = nft.display_image_url || nft.image_url || null;

    return { name, imageUrl, level, rank, price };
  } catch {
    return null;
  }
}

export async function generateMetadata(
  { params }: { params: { tokenId: string } },
): Promise<Metadata> {
  const { tokenId } = params;
  const nft = await fetchNftMeta(tokenId);

  if (!nft) {
    return { title: `Team #${tokenId}` };
  }

  const priceStr = nft.price ? ` - $${nft.price.toFixed(2)}` : '';
  const levelStr = nft.level && nft.level !== 'Pro' ? ` (${nft.level})` : '';
  const title = `${nft.name}${priceStr}`;
  const description = `${nft.name}${levelStr}${nft.rank && nft.rank !== 'N/A' ? ` | Rank #${nft.rank}` : ''}${priceStr} on SBS Marketplace. Buy and trade fantasy football teams onchain.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      ...(nft.imageUrl ? { images: [{ url: nft.imageUrl, alt: nft.name }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(nft.imageUrl ? { images: [nft.imageUrl] } : {}),
    },
  };
}

export default function TokenLayout({ children }: { children: React.ReactNode }) {
  return children;
}
