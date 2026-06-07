// Server-only NFT card metadata writes (firebase-admin). Keep separate from
// lib/nftCard.ts so the client (roster page) can import the URL builders without
// pulling in firebase-admin.

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { buildDraftPassUrl, buildOgCardUrl } from '@/lib/nftCard';
import { logger } from '@/lib/logger';
import type { CardTier } from '@/components/draft/TeamCardObsidian';
import type { TeamData } from '@/lib/marketplace/teamData';

function tierFromLevel(level?: string): CardTier {
  const l = (level || '').toLowerCase();
  if (l.includes('jackpot')) return 'jackpot';
  if (l.includes('hof') || l.includes('hall of fame')) return 'hof';
  return 'pro';
}

/**
 * The obsidian card image URL for a token, used by our marketplace + metadata.
 * Prefers the stored `draftTokenMetadata/{tokenId}.Image` (full bye/ADP/pick,
 * written by mint / draft-close / the roster page); else builds it live from
 * the Go-API team (drafted → obsidian team, un-drafted → grey draft pass).
 */
export function isOgImage(url: string | undefined): boolean {
  return !!url && url.includes('/api/og/team-card');
}

/** Synchronous obsidian card image from a Go-API team (no Firestore read) —
 *  for list/grid thumbnails. Drafted → tier team, else → grey draft pass. */
export function ogImageFromTeam(team: TeamData | null | undefined, tokenId: string | number): string {
  if (team && Array.isArray(team.roster) && team.roster.length >= 10) {
    const players = team.roster.map((p) => ({ team: p.team || '', pos: p.position || '', pick: '-' as const }));
    return buildOgCardUrl({ tier: tierFromLevel(team.level), players });
  }
  return buildDraftPassUrl(String(tokenId));
}

export async function resolveTokenImage(tokenId: string, team?: TeamData | null): Promise<string> {
  const id = String(tokenId).trim();
  // Only a stored og URL (our own write, with full bye/ADP/pick) is trusted.
  // The Go server also writes draftTokenMetadata with the OLD GCS image — never
  // serve that; always (re)build the obsidian card instead.
  if (isFirestoreConfigured() && /^\d+$/.test(id)) {
    try {
      const snap = await getAdminFirestore().collection('draftTokenMetadata').doc(id).get();
      const img = snap.exists ? String((snap.data() as Record<string, unknown>).Image ?? '') : '';
      if (isOgImage(img)) return img;
    } catch { /* fall through to live build */ }
  }
  if (team && Array.isArray(team.roster) && team.roster.length >= 10) {
    const players = team.roster.map((p) => ({ team: p.team || '', pos: p.position || '', pick: '-' as const }));
    return buildOgCardUrl({ tier: tierFromLevel(team.level), players });
  }
  return buildDraftPassUrl(id);
}

/**
 * On mint, give each freshly-minted token the grey pre-reveal "draft pass"
 * image (keyed on the real token id, so the DRAFT PASS # is always accurate).
 *
 * Uses `create()` — if a metadata doc already exists (token already minted, or
 * already drafted into a team), it is left untouched. We never overwrite a
 * revealed team card with the pre-reveal pass.
 */
export async function writeDraftPassMetadata(tokenIds: Array<string | number>): Promise<void> {
  const db = getAdminFirestore();
  await Promise.all(
    tokenIds.map(async (raw) => {
      const id = String(raw).trim();
      if (!/^\d+$/.test(id)) return;
      try {
        await db.collection('draftTokenMetadata').doc(id).create({
          Name: `Banana Best Ball IV — Draft Pass #${id}`,
          Description: 'A Banana Best Ball IV draft pass. Reveals into your Digital Team after you draft.',
          Image: buildDraftPassUrl(id),
          Attributes: [],
        });
      } catch {
        // Doc already exists — already a pass or already a revealed team. Skip.
      }
    }),
  ).catch((err) => logger.warn('nft.draft_pass_metadata_failed', { error: String(err) }));
}
