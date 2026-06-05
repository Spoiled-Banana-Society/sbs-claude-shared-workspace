// Server-only NFT card metadata writes (firebase-admin). Keep separate from
// lib/nftCard.ts so the client (roster page) can import the URL builders without
// pulling in firebase-admin.

import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { buildDraftPassUrl } from '@/lib/nftCard';
import { logger } from '@/lib/logger';

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
