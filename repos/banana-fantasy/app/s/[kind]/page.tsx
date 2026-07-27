import type { Metadata } from 'next';
import Link from 'next/link';
import { BADGE_BY_ID } from '@/lib/badges/catalog';

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://banana-fantasy-sbs.vercel.app';

/**
 * OG tags for the public share pages.
 *
 * WHY THIS EXISTS: a tweet's image on DESKTOP comes from the LINKED PAGE's
 * og:image, not from anything the app hands X. The first cut of the share
 * buttons pointed at /exposure and /profile, which carry no OG tags of their
 * own — so they inherited the site-wide og-card.png and every desktop post
 * would have shown a generic SBS image instead of the user's card
 * (Boris caught this in the composer, 2026-07-26).
 *
 * Each card type gets a /s/<kind> URL carrying its payload, and og:image
 * points at the matching /api/og/* route with `w=wide` — X crops link cards
 * to 1.91:1, so the 4:5 version would be sliced in half.
 *
 * Mobile is unaffected either way: the share sheet attaches the real PNG.
 */
export async function generateMetadata(
  { params, searchParams }: {
    params: { kind: string };
    searchParams: Record<string, string | string[] | undefined>;
  },
): Promise<Metadata> {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
  const d = one(searchParams.d);
  const b = one(searchParams.b);
  const n = one(searchParams.n);

  let image = `${SITE}/og-card.png?v=4`;
  let title = 'Banana Best Ball IV';
  let description = '$100K guaranteed. Onchain best-ball fantasy football on SBS.';

  if (params.kind === 'exposure' && d) {
    image = `${SITE}/api/og/exposure?w=wide&d=${encodeURIComponent(d)}`;
    title = 'My BBB4 exposure';
    description = 'Portfolio breakdown across all my teams — Banana Best Ball IV on SBS.';
  } else if (params.kind === 'badge' && b) {
    const badge = BADGE_BY_ID[b];
    const q = new URLSearchParams({ w: 'wide', b });
    if (n) q.set('n', n);
    image = `${SITE}/api/og/badge?${q.toString()}`;
    title = badge ? `${badge.label} unlocked` : 'Badge unlocked';
    description = badge?.description ?? 'Badges show what you’ve done in SBS.';
  } else if (params.kind === 'team' && d) {
    image = `${SITE}/api/og/team-card?w=wide&d=${encodeURIComponent(d)}`;
    title = 'My Banana Best Ball IV team';
    description = 'Onchain best-ball fantasy football. $100K guaranteed.';
  }

  return {
    title,
    description,
    openGraph: { title, description, images: [{ url: image, alt: title }] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

/**
 * Public landing for a shared card. Whoever taps the link in a tweet lands
 * here: the card itself, then one way in. No auth, no app shell — it exists to
 * be the thing X unfurls (generateMetadata above) and to convert the click.
 */
export default function SharePage({
  params, searchParams,
}: {
  params: { kind: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
  const d = one(searchParams.d);
  const b = one(searchParams.b);
  const n = one(searchParams.n);

  // The 4:5 version here — this is a page, not a link card, so nothing crops.
  let img = `${SITE}/og-card.png?v=4`;
  let heading = 'Banana Best Ball IV';
  if (params.kind === 'exposure' && d) {
    img = `${SITE}/api/og/exposure?d=${encodeURIComponent(d)}`;
    heading = 'Portfolio exposure';
  } else if (params.kind === 'badge' && b) {
    const q = new URLSearchParams({ b });
    if (n) q.set('n', n);
    img = `${SITE}/api/og/badge?${q.toString()}`;
    heading = 'Badge unlocked';
  } else if (params.kind === 'team' && d) {
    img = `${SITE}/api/og/team-card?d=${encodeURIComponent(d)}`;
    heading = 'Draft complete';
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col items-center px-4 py-10">
      <div className="text-white/40 text-xs font-bold tracking-[0.3em] uppercase mb-6">{heading}</div>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={img}
        alt={heading}
        className="w-full max-w-[420px] rounded-2xl"
      />

      <div className="mt-8 text-center">
        <div className="text-banana text-2xl sm:text-3xl font-bold">$100K Guaranteed Prize Pool</div>
        <div className="text-white/60 text-sm mt-1 tracking-wide">
          BANANA BEST BALL IV · FANTASY FOOTBALL CONTEST
        </div>
        <Link
          href="/"
          className="mt-6 inline-flex items-center justify-center rounded-full bg-banana px-8 py-3 text-base font-bold text-black hover:brightness-110 transition"
        >
          Draft your team
        </Link>
      </div>
    </div>
  );
}
