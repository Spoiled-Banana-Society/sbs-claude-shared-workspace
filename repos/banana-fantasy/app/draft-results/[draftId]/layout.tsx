import type { Metadata } from 'next';

const DRAFTS_API = process.env.NEXT_PUBLIC_STAGING_API_URL
  || 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';

async function fetchDraftMeta(draftId: string) {
  try {
    // Fetch draft info for display name
    const infoRes = await fetch(`${DRAFTS_API}/draft/${draftId}/state/info`, {
      next: { revalidate: 60 },
    });
    if (!infoRes.ok) return null;
    const info = await infoRes.json();
    const displayName = info.displayName || `Draft #${draftId}`;
    const level = info.draftLevel || info.level || 'Pro';

    // Fetch rosters to find a real user's wallet (non-bot)
    let cardImageUrl: string | null = null;
    try {
      const rostersRes = await fetch(`${DRAFTS_API}/draft/${draftId}/state/rosters`, {
        next: { revalidate: 60 },
      });
      if (rostersRes.ok) {
        const rosters = await rostersRes.json();
        // Find a real user (0x address, not bot)
        const realUser = Object.keys(rosters).find(k => k.startsWith('0x'));
        if (realUser) {
          // Fetch their tokens to find the card image
          const tokensRes = await fetch(`${DRAFTS_API}/owner/${realUser}/draftToken/all`, {
            next: { revalidate: 60 },
          });
          if (tokensRes.ok) {
            const tokens = await tokensRes.json();
            const active = tokens.active || [];
            const match = active.find(
              (t: Record<string, string>) => t._leagueId?.toLowerCase() === draftId.toLowerCase()
            );
            if (match?._imageUrl && !match._imageUrl.includes('draft-token-image-default')) {
              cardImageUrl = match._imageUrl;
            }
          }
        }
      }
    } catch { /* optional — OG image just won't show */ }

    return { displayName, level, cardImageUrl };
  } catch {
    return null;
  }
}

export async function generateMetadata(
  { params }: { params: { draftId: string } },
): Promise<Metadata> {
  const { draftId } = params;
  const meta = await fetchDraftMeta(draftId);

  if (!meta) {
    return { title: `Draft Results` };
  }

  const title = `${meta.displayName} — Draft Complete`;
  const description = `Check out my ${meta.level} draft team on Banana Best Ball! #BBB4`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      ...(meta.cardImageUrl ? { images: [{ url: meta.cardImageUrl, alt: meta.displayName }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(meta.cardImageUrl ? { images: [meta.cardImageUrl] } : {}),
    },
  };
}

export default function DraftResultsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
