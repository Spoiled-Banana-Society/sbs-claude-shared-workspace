// Server-only NFT card metadata/image resolution (firebase-admin + Go API).
// Keep separate from lib/nftCard.ts so the client can import the URL builders.

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { buildDraftPassUrl, buildOgCardUrl } from '@/lib/nftCard';
import { logger } from '@/lib/logger';
import type { CardPlayer, CardTier } from '@/components/draft/TeamCardObsidian';
import { getTeamForToken, getOwnerForToken, type TeamData } from '@/lib/marketplace/teamData';
import { ALL_POSITIONS } from '@/data/nfl-players';

const DRAFTS_API_BASE = process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL
  || 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
const POS_KEYS = ['QB', 'RB', 'WR', 'TE', 'DST'] as const;
const PLAYER_META = new Map(ALL_POSITIONS.map((p) => [p.playerId, p]));

function tierFromLevel(level?: string): CardTier {
  const l = (level || '').toLowerCase();
  if (l.includes('jackpot')) return 'jackpot';
  if (l.includes('hof') || l.includes('hall of fame')) return 'hof';
  return 'pro';
}

export function isOgImage(url: string | undefined): boolean {
  return !!url && url.includes('/api/og/team-card');
}

function isPreRevealOg(url: string): boolean {
  try {
    const d = new URL(url).searchParams.get('d');
    if (!d) return false;
    return !!JSON.parse(Buffer.from(d, 'base64url').toString('utf8')).preReveal;
  } catch { return false; }
}

interface GoToken { realTokenId?: string | number; _level?: string; roster?: Record<string, Array<{ playerId?: string; team?: string }> | null> }

/**
 * Fetch the owner's full token list from the Go API.
 * Returns `null` ONLY when the fetch genuinely fails (so callers can tell
 * "fetch failed" apart from "token not in list"). Retries once for cold starts.
 */
async function getOwnerTokens(owner: string | null): Promise<GoToken[] | null> {
  if (!owner) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${DRAFTS_API_BASE}/owner/${owner.toLowerCase()}/draftToken/all`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const d = await res.json();
      return [...(Array.isArray(d?.active) ? d.active : []), ...(Array.isArray(d?.available) ? d.available : [])];
    } catch { /* retry */ }
  }
  return null;
}

function playersFromGoRoster(roster?: GoToken['roster']): CardPlayer[] {
  const out: CardPlayer[] = [];
  for (const pos of POS_KEYS) {
    for (const p of (roster?.[pos] || [])) {
      const pid = p?.playerId || '';
      const [tm, ps] = pid.split('-');
      const m = PLAYER_META.get(pid);
      out.push({ team: tm || p?.team || '', pos: ps || pos, bye: m?.byeWeek ?? '-', adp: m?.adp ?? '-', pick: '-' });
    }
  }
  return out;
}

function playersFromTeamData(team: TeamData): CardPlayer[] {
  return team.roster.map((p) => ({ team: p.team || '', pos: p.position || '', pick: '-' as const }));
}

export interface ResolvedCard { image: string; drafted: boolean; level: string; players: CardPlayer[] }

/**
 * Resolve a token's card. The EXACT realTokenId token is authoritative:
 * an existing token with an EMPTY roster is minted-but-undrafted → grey pass
 * (never a false team via the cardId heuristic). Only when no exact match
 * exists (traded/legacy) do we fall back to getTeamForToken.
 * Image: a stored full-data TEAM og (roster-page write, has picks) wins for
 * drafted teams; else built deterministically; un-drafted → grey pass.
 */
export async function resolveCard(tokenId: string, owner: string | null): Promise<ResolvedCard> {
  const id = String(tokenId).trim();
  let drafted = false;
  let level = 'Pro';
  let players: CardPlayer[] = [];

  // Always resolve the owner (the metadata route is called by OpenSea with no
  // context) so the authoritative exact-token check can run.
  let resolvedOwner = owner;
  if (!resolvedOwner) {
    try { resolvedOwner = await getOwnerForToken(id); } catch { /* ignore */ }
  }

  const toks = await getOwnerTokens(resolvedOwner);
  const exact = toks ? toks.find((t) => String(t.realTokenId ?? '') === id) : undefined;

  if (toks && exact) {
    // Authoritative: this IS the token. Drafted iff it has a real roster;
    // empty roster = minted-but-undrafted → grey pass (no heuristic fall-through).
    const p = playersFromGoRoster(exact.roster);
    if (p.length >= 10) { drafted = true; players = p; level = exact._level || 'Pro'; }
  } else {
    // Token not in this owner's list (traded/legacy) OR the Go fetch failed →
    // fall back to the heuristic resolver.
    const team = await getTeamForToken(id, resolvedOwner);
    if (team && Array.isArray(team.roster) && team.roster.length >= 10) {
      drafted = true; players = playersFromTeamData(team); level = team.level || 'Pro';
    }
  }

  let image = drafted ? buildOgCardUrl({ tier: tierFromLevel(level), passNo: id, players }) : buildDraftPassUrl(id);
  if (drafted && isFirestoreConfigured() && /^\d+$/.test(id)) {
    try {
      const snap = await getAdminFirestore().collection('draftTokenMetadata').doc(id).get();
      const stored = snap.exists ? String((snap.data() as Record<string, unknown>).Image ?? '') : '';
      if (isOgImage(stored) && !isPreRevealOg(stored)) image = stored;
    } catch { /* keep built image */ }
  }
  return { image, drafted, level, players };
}

export async function resolveTokenImage(tokenId: string, owner: string | null): Promise<string> {
  return (await resolveCard(tokenId, owner)).image;
}

/** Synchronous obsidian image from a Go-API team (list/grid thumbnails). */
export function ogImageFromTeam(team: TeamData | null | undefined, tokenId: string | number): string {
  if (team && Array.isArray(team.roster) && team.roster.length >= 10) {
    return buildOgCardUrl({ tier: tierFromLevel(team.level), players: playersFromTeamData(team) });
  }
  return buildDraftPassUrl(String(tokenId));
}

/**
 * On mint, give each freshly-minted token the grey pre-reveal "draft pass"
 * image (keyed on the real token id). create() leaves any existing doc
 * untouched — never overwrite a revealed team.
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
        // Doc already exists — already a pass or a revealed team. Skip.
      }
    }),
  ).catch((err) => logger.warn('nft.draft_pass_metadata_failed', { error: String(err) }));
}
