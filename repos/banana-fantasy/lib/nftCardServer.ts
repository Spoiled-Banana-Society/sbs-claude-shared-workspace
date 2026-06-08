// Server-only NFT card metadata/image resolution (firebase-admin + Go API).
// Keep separate from lib/nftCard.ts so the client can import the URL builders.

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { buildDraftPassUrl, buildOgCardUrl } from '@/lib/nftCard';
import { logger } from '@/lib/logger';
import type { CardPlayer, CardTier } from '@/components/draft/TeamCardObsidian';
import type { TeamData } from '@/lib/marketplace/teamData';
import { ALL_POSITIONS } from '@/data/nfl-players';
import { classifyToken } from '@/lib/nftPassClassify';

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

function playersFromTeamData(team: TeamData): CardPlayer[] {
  return team.roster.map((p) => ({ team: p.team || '', pos: p.position || '', pick: '-' as const }));
}

export interface ResolvedCard { image: string; drafted: boolean; level: string; players: CardPlayer[]; passType?: string }

const ROSTER_TRAIT = /^(QB|RB|WR|TE|DST)\d+$/i;

/** Pull the numeric league id out of the Go-written LEAGUE-NAME / LEAGUE attr.
 *  The id is the number AFTER the '#': "Playoffs Rd 2: #29" → 29, "BBB #1381" →
 *  1381. NEVER the first number in the string (that grabbed the "2" out of
 *  "Playoffs Rd 2: #29", colliding a playoff team onto league #2). Only fall back
 *  to a bare number when the WHOLE value is just "BBB N"/"League N"/"N". Special
 *  named leagues ("BBB 2025 FINALS", "Hall of Fame Sprint") have no clean id → ''. */
function leagueNoFromAttrs(attrs: Array<{ tt: string; val: string }>): string {
  const raw = attrs.find((a) => /^league(-?name)?$/i.test(a.tt.trim()))?.val || '';
  const hash = raw.match(/#\s*(\d+)/);
  if (hash) return hash[1];
  const simple = raw.trim().match(/^(?:bbb\s*)?(?:league\s*)?(\d+)$/i);
  return simple ? simple[1] : '';
}

/** Build card players from the Go-written metadata roster attributes
 *  (trait_type "RB1", value "MIN RB1"). bye/ADP from ALL_POSITIONS. */
function playersFromAttributes(attrs: Array<{ tt: string; val: string }>): CardPlayer[] {
  return attrs
    .filter((a) => ROSTER_TRAIT.test(a.tt))
    .map((a) => {
      const parts = a.val.trim().split(/\s+/);
      const team = parts[0] || '';
      const pos = parts.slice(1).join('') || a.tt;
      const m = PLAYER_META.get(`${team}-${pos}`);
      return { team, pos, bye: m?.byeWeek ?? '-', adp: m?.adp ?? '-', pick: '-' as const };
    });
}

/**
 * Resolve a token's card from Firestore `draftTokenMetadata/{id}` — ONE fast
 * read, scalable for a per-token metadata endpoint (no slow per-owner Go fetch).
 *
 * Drafted iff the doc has real roster attributes (Go writes these on draft).
 * The mint-write seeds an empty-roster doc (→ grey pass) which the draft
 * overwrites with a roster (→ team). No doc → un-drafted → grey pass.
 * Image: a stored full-data TEAM og (roster-page write, has picks) wins; else
 * built from the roster attributes; un-drafted → grey pass.
 */
export async function resolveCard(tokenId: string, owner?: string | null): Promise<ResolvedCard> {
  const id = String(tokenId).trim();

  // Authoritative index FIRST = the backend source of truth, keyed by the
  // on-chain id and rebuilt from Go's LIVE `draftTokens._leagueId` (drafted iff
  // set; cleared on leave). It's GLOBAL, not owner-scoped, so it can't be fooled
  // by who currently holds the NFT or by a stale `available`/finalize row at a
  // reused id. Index miss → fall back to the owner-scoped classify below.
  let indexSaysTeam = false;
  let indexImage: string | null = null;
  let indexLevel: string | null = null;
  if (isFirestoreConfigured() && /^\d+$/.test(id)) {
    try {
      const ix = await getAdminFirestore().collection('marketplace_index').doc(id).get();
      if (ix.exists) {
        const d = ix.data() as Record<string, unknown>;
        if (d.status === 'pass') {
          return { image: (d.image as string) || buildDraftPassUrl(id), drafted: false, level: 'Pro', players: [] };
        }
        if (d.status === 'team') {
          indexSaysTeam = true;
          indexImage = (d.image as string) || null;
          indexLevel = (d.level as string) || null;
        }
      }
    } catch { /* fall through */ }
  }

  // Owner-scoped pass check — ONLY when the index didn't already say "team"
  // (the index is authoritative; this is the fallback for un-indexed tokens).
  if (!indexSaysTeam) {
    try {
      const cls = await classifyToken(id, owner);
      if (cls.isPass) {
        return { image: buildDraftPassUrl(id), drafted: false, level: 'Pro', players: [], passType: cls.passType };
      }
    } catch { /* Go unavailable — fall through to Firestore */ }
  }

  if (isFirestoreConfigured() && /^\d+$/.test(id)) {
    try {
      const snap = await getAdminFirestore().collection('draftTokenMetadata').doc(id).get();
      if (snap.exists) {
        const d = snap.data() as Record<string, unknown>;
        const rawAttrs = (d.Attributes ?? d.attributes ?? []) as Array<Record<string, unknown>>;
        const attrs = rawAttrs.map((a) => ({ tt: String(a.Trait_Type ?? a.trait_type ?? ''), val: String(a.Value ?? a.value ?? '') }));
        const players = playersFromAttributes(attrs);
        if (players.length >= 10) {
          const level = attrs.find((a) => a.tt.toUpperCase() === 'LEVEL')?.val || 'Pro';
          const leagueNo = leagueNoFromAttrs(attrs);
          const stored = String(d.Image ?? '');
          const image = (isOgImage(stored) && !isPreRevealOg(stored))
            ? stored
            : buildOgCardUrl({ tier: tierFromLevel(level), passNo: id, teamNo: id, leagueNo, players });
          return { image, drafted: true, level, players };
        }
      }
    } catch { /* fall through to grey pass */ }
  }
  // Index says team but the finalize doc had no roster (rare) — honor the
  // authoritative team status with the index's stored card image.
  if (indexSaysTeam && indexImage) {
    return { image: indexImage, drafted: true, level: tierFromLevel(indexLevel || 'pro') === 'jackpot' ? 'Jackpot' : tierFromLevel(indexLevel || 'pro') === 'hof' ? 'Hall of Fame' : 'Pro', players: [] };
  }
  return { image: buildDraftPassUrl(id), drafted: false, level: 'Pro', players: [] };
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
