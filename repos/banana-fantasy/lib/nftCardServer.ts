// Server-only NFT card metadata/image resolution (firebase-admin + Go API).
// Keep separate from lib/nftCard.ts so the client can import the URL builders.

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { buildDraftPassUrl, buildOgCardUrl } from '@/lib/nftCard';
import { getDraftSummary } from '@/lib/draftApi';
import { logger } from '@/lib/logger';
import type { CardPlayer, CardTier } from '@/components/draft/TeamCardObsidian';
import type { TeamData } from '@/lib/marketplace/teamData';
import { ALL_POSITIONS } from '@/data/nfl-players';
import { classifyToken } from '@/lib/nftPassClassify';

const PLAYER_META = new Map(ALL_POSITIONS.map((p) => [p.playerId, p]));

/**
 * Self-heal PICK numbers when BUILDING a team card. The finalize-doc roster
 * attributes carry no pickNum (→ '-'); the live Go draft summary does. We map
 * draftTokens/{id} → LeagueId + Owner → that owner's picks. This guarantees a
 * card built here (e.g. a team whose client-side post-draft refresh never fired)
 * still gets real picks, server-side, no matter which surface resolves it.
 * Falls back to the pick-less attribute players if the summary is unavailable —
 * never throws, never hangs (5s cap).
 */
async function playersWithPicks(id: string, fallback: CardPlayer[]): Promise<CardPlayer[]> {
  try {
    if (!isFirestoreConfigured() || !/^\d+$/.test(id)) return fallback;
    const dt = await getAdminFirestore().collection('draftTokens').doc(id).get();
    let leagueId = String(dt.get('LeagueId') ?? dt.get('_leagueId') ?? '');
    let owner = String(dt.get('OwnerId') ?? dt.get('_ownerId') ?? '').toLowerCase();
    if (!leagueId || !owner) {
      // Wheel-won JP/HOF tokens have NO draftTokens doc (the Go engine seats
      // special drafts with a synthetic `special-…` token) — their league+owner
      // binding lives in nft_league_map, written by link-wheel-teams.
      const map = await getAdminFirestore().collection('nft_league_map').doc(id).get();
      leagueId = String(map.get('leagueId') ?? '');
      owner = String(map.get('ownerAtMap') ?? '').toLowerCase();
    }
    if (!leagueId || !owner) return fallback;
    const picks: Array<{ playerId: string; pickNum: number }> = [];
    // 1) Live Go summary (fast when the draft is recent / still in Redis).
    try {
      const summary = await Promise.race([
        getDraftSummary(leagueId),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('summary timeout')), 5000)),
      ]);
      for (const it of (summary as Array<{ playerInfo?: { ownerAddress?: string; playerId?: string; pickNum?: number } }>)) {
        const info = it?.playerInfo;
        if (!info?.playerId || (info.ownerAddress || '').toLowerCase() !== owner) continue;
        picks.push({ playerId: info.playerId, pickNum: Number(info.pickNum) || 0 });
      }
    } catch { /* fall through to the durable Firestore summary below */ }
    // 2) DURABLE fallback: the Go summary is EPHEMERAL (drops out of Redis for
    //    older drafts), but the same pick list is persisted forever in Firestore
    //    at drafts/{id}/state/summary (PascalCase fields). This is what makes the
    //    pick self-heal work for EVERY prior league, not just recent ones.
    if (picks.length < 10) {
      picks.length = 0;
      const sumDoc = await getAdminFirestore()
        .collection('drafts').doc(leagueId).collection('state').doc('summary').get();
      const rows = (sumDoc.data()?.Summary ?? []) as Array<{ PlayerInfo?: { PlayerId?: string; OwnerAddress?: string; PickNum?: number } }>;
      for (const row of rows) {
        const info = row?.PlayerInfo;
        if (!info?.PlayerId || (info.OwnerAddress || '').toLowerCase() !== owner) continue;
        picks.push({ playerId: info.PlayerId, pickNum: Number(info.PickNum) || 0 });
      }
    }
    // A partially back-filled summary (e.g. a slow draft whose close routine
    // missed rows) must not DROP roster spots — a 13-row card is worse than a
    // 15-row card without pick numbers. Heal only from a complete pick list.
    if (picks.length < Math.max(10, fallback.length)) return fallback;
    return picks
      .sort((a, b) => a.pickNum - b.pickNum)
      .map((p) => {
        const [tm, ps] = p.playerId.split('-');
        const m = PLAYER_META.get(p.playerId);
        return { team: tm || '', pos: ps || '', bye: m?.byeWeek ?? '-', adp: m?.adp ?? '-', pick: p.pickNum };
      });
  } catch {
    return fallback;
  }
}

function tierFromLevel(level?: string): CardTier {
  const l = (level || '').toLowerCase();
  // 'jackhof' contains 'hof' — must be matched BEFORE the hof check or a
  // dual-type card silently renders as plain HOF.
  if (l.includes('jackhof')) return 'jackhof';
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

/** Team+pos multiset baked into a roster, order-independent. Used to detect a
 *  stored image whose roster no longer matches the token's real roster. */
function rosterKey(players: Array<{ team?: string; pos?: string }>): string {
  return players
    .map((p) => `${(p.team || '').toUpperCase()}-${(p.pos || '').toUpperCase()}`)
    .sort()
    .join(',');
}

/** The roster key baked into an og team-card image URL, or null if it isn't a
 *  decodable og image (→ can't trust it, rebuild). */
function ogRosterKey(url: string): string | null {
  try {
    const d = new URL(url).searchParams.get('d');
    if (!d) return null;
    const parsed = JSON.parse(Buffer.from(d, 'base64url').toString('utf8'));
    return Array.isArray(parsed.players) ? rosterKey(parsed.players) : null;
  } catch { return null; }
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

/** The only slots that exist: playerIds are `${team}-${slot}` with NO digit on
 *  QB/TE/DST ("BAL-QB") and a digit on RB/WR ("LAR-WR2"). */
const CANONICAL_SLOT = /^(QB|RB1|RB2|WR1|WR2|TE|DST)$/;

/** Build card players from the Go-written metadata roster attributes.
 *  bye/ADP from ALL_POSITIONS.
 *
 *  Two facts about these attrs (ticket-3325):
 *  - The trait_type is the ROSTER INDEX ("WR4" = 4th WR drafted, "QB2" = 2nd
 *    QB), NOT the depth-chart slot. The TRUE slot is inside the value.
 *  - The value comes in TWO formats — regular Go finalize docs write
 *    "MIN RB1" (space), the special-draft lane writes playerIds "MIN-RB1"
 *    (dash) — and a single doc can MIX both.
 *  The old parse split the value on whitespace only (a dash value left the
 *  whole "MIN-RB1" as the team → rows rendered "MIN-RB1-RB1") and displayed/
 *  keyed the roster index (→ "LAR-WR2" showed as WR4; "BAL-QB" looked up
 *  "BAL-QB1" and missed PLAYER_META → blank bye/ADP on every QB/TE/DST row). */
function playersFromAttributes(attrs: Array<{ tt: string; val: string }>): CardPlayer[] {
  return attrs
    .filter((a) => ROSTER_TRAIT.test(a.tt))
    .map((a) => {
      const [team = '', valSlot = ''] = a.val.trim().toUpperCase().split(/[\s-]+/);
      // Prefer the value's slot; fall back to the trait's position letters
      // when the value doesn't carry a canonical slot (defensive — a bare
      // "MIN RB" degrades to pos "RB" with '-' bye/ADP instead of lying).
      const slot = CANONICAL_SLOT.test(valSlot) ? valSlot : a.tt.toUpperCase().replace(/\d+$/, '');
      const m = PLAYER_META.get(`${team}-${slot}`);
      return { team, pos: slot, bye: m?.byeWeek ?? '-', adp: m?.adp ?? '-', pick: '-' as const };
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
  let indexPlayers: CardPlayer[] | null = null;
  if (isFirestoreConfigured() && /^\d+$/.test(id)) {
    try {
      const ix = await getAdminFirestore().collection('marketplace_index').doc(id).get();
      if (ix.exists) {
        const d = ix.data() as Record<string, unknown>;
        if (d.status === 'pass') {
          // A pass ALWAYS renders the grey pre-reveal pass art — never a stored
          // image. The index doc can still carry a stale TEAM card image from a
          // prior era (a token that was a team, now reclassified to pass); using
          // it would show a drafted team on a draft pass. Always rebuild grey.
          return { image: buildDraftPassUrl(id), drafted: false, level: 'Pro', players: [] };
        }
        if (d.status === 'team') {
          indexSaysTeam = true;
          indexImage = (d.image as string) || null;
          indexLevel = (d.level as string) || null;
          // Durable stored pick list (incl. pickNum) — lets us rebuild the card
          // from OUR Firestore with NO Go dependency once it's been captured.
          const ps = Array.isArray(d.players) ? (d.players as CardPlayer[]) : null;
          if (ps && ps.length >= 10) indexPlayers = ps;
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
          // Level is AUTHORITATIVE from the index (backfilled from Go's
          // draftTokens._level) when present — the finalize-doc LEVEL attribute
          // can be stale/wrong (e.g. a prior-era Jackpot doc on a token the
          // backend now says is Pro). Only fall back to the attr on index-miss.
          const level = (indexSaysTeam && indexLevel)
            ? (indexLevel === 'jackpot' ? 'Jackpot' : indexLevel === 'hof' ? 'Hall of Fame' : 'Pro')
            : (attrs.find((a) => a.tt.toUpperCase() === 'LEVEL')?.val || 'Pro');
          const leagueNo = leagueNoFromAttrs(attrs);
          const stored = String(d.Image ?? '');
          const useStored = isOgImage(stored) && !isPreRevealOg(stored);
          // PICK-BEARING priority so a plain VIEW never downgrades a captured team
          // back to the pick-less attribute roster (which then re-stamped the index
          // pick-less — the bug that wiped picks/ADP on every view). Order:
          //   1. durable index players that ALREADY carry picks → trust them (+ the
          //      stored image); leaves already-complete teams untouched.
          //   2. else self-heal the pick list from the draft summary (durable
          //      Firestore fallback) and REBUILD the image so picks/ADP/bye show.
          //   3. else (no summary anywhere) keep the pick-less attribute roster.
          const hasPicks = (ps: CardPlayer[] | null): ps is CardPlayer[] =>
            !!ps && ps.length >= 10 && ps.some((p) => p.pick !== '-' && p.pick != null);
          let cardPlayers: CardPlayer[];
          if (hasPicks(indexPlayers)) {
            cardPlayers = indexPlayers;
          } else {
            const healed = await playersWithPicks(id, players);
            cardPlayers = hasPicks(healed) ? healed : players;
          }
          // The image MUST reflect the roster we're returning. A stored og was
          // snapshotted at draft time (client post-draft / refresh-draft write) and
          // could be a PARTIAL roster — reuse it ONLY when its baked roster still
          // matches cardPlayers; otherwise rebuild from truth. This is what stops
          // the card art from silently dropping a 2nd TE / 2nd DST while the roster
          // detail (built from the same cardPlayers) shows them correctly.
          const image = (useStored && ogRosterKey(stored) === rosterKey(cardPlayers))
            ? stored
            : buildOgCardUrl({ tier: tierFromLevel(level), passNo: id, teamNo: id, leagueNo, players: cardPlayers });
          return { image, drafted: true, level, players: cardPlayers };
        }
      }
    } catch { /* fall through to grey pass */ }
  }
  // The chain-anchored index is AUTHORITATIVE: if it says this on-chain id is a
  // team, render a team — even when no roster doc lives at draftTokenMetadata/{id}
  // (on staging the roster was written under a synthetic cardId, so it isn't at
  // the on-chain-id key). Trust the index for status + level; build a card image
  // at the index's level when none is stored. This keeps the team stable (the
  // metadata-route self-heal won't flip it back to a pass) and the level correct.
  if (indexSaysTeam) {
    const level = indexLevel === 'jackpot' ? 'Jackpot' : indexLevel === 'hof' ? 'Hall of Fame' : 'Pro';
    const image = indexImage || buildOgCardUrl({ tier: tierFromLevel(level), passNo: id, teamNo: id, players: [] });
    return { image, drafted: true, level, players: [] };
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
