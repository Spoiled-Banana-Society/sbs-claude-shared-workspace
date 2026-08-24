/**
 * BANANA ZONE — the cold-zone free-draft ladder (Richard 2026-08-22).
 *
 * Problem it solves: the rolling Jackpot window shows odds climbing from 1%
 * right after a hit to 100% at draft 100, so drafters camp the hot end and the
 * first ~70 drafts of every window fill at the same slow baseline (8/22 data:
 * human joins are FLAT from position 0 to 70, then 13/hr, 61/hr, 746/hr). The
 * real fix (flat per-draft odds) is next year; this makes the cold zone the
 * best deal on the site until then.
 *
 * The ladder, by the Jackpot window position of the draft you ENTER (Richard
 * 8/22 FINAL — three deadlines, no flat stretch longer than 20, every later
 * draft strictly worse than the one before):
 *   positions  1–20  →  Buy 1 Get 1   (every eligible paid entry earns 1 free draft)
 *   positions 21–40  →  Buy 2 Get 1   (earns ½)   credits bank per WINDOW in sixths
 *   positions 41–60  →  Buy 3 Get 1   (earns ⅓)   (½=3, ⅓=2) and mint at 6; leftovers
 *   positions 61+    →  nothing        die when the Jackpot hits
 * Cost ≈ 0.36+0.16+0.06 ≈ 0.58 free passes per human paid seat (1–20 holds
 * ~36% of all drafts, 21–40 ~32%, 41–60 ~19%). Cutoffs are config
 * (--tiers 20 40 60).
 *
 * Rules (all Richard's, 8/22):
 *   • PAID entries only. Free passes never earn free passes.
 *   • The tier is set by the draft's REAL window position when it FILLS (its
 *     own "BBB #N" relative to the window it lands in — same anchoring as the
 *     jackpot draw), NOT by what the pill showed at entry. Richard 8/22: "if
 *     you enter 20 fast drafts and a slow draft fills in between, only 19
 *     land inside the band" — entry-locking would pay all 20. Entry records
 *     eligibility + the projected tier for the UI only. Leave the lobby =
 *     nothing pays.
 *   • NO per-wallet cap.
 *   • Pass-level eligibility: a pass bought AFTER launch is eligible unless that
 *     purchase used the new-user or First Purchase promo; passes bought BEFORE
 *     launch are eligible only if on the grandfather list (the 19 "plain"
 *     purchases that earned no promo — see GRANDFATHERED_TOKEN_IDS).
 *   • Fast + slow BBB drafts both count (they share the Jackpot lane). Special
 *     seat drafts (Jackpot/HOF/JackHOF passes) and private leagues do not.
 *   • Replaces the Jackpot Hit spin promo (promo 4): while the zone is ON the
 *     spin draw pays nothing and its bells/card are swapped for Banana Zone.
 *
 * ⚠️ SHIPS DARK. Nothing here pays, locks, bells or renders until
 * system_config/bonusZone.enabled === true (or env BONUS_ZONE=1). Flip with
 * scripts/_bonus-zone-toggle.mjs. The /preview/bonus-zone page renders every
 * visual with mock data regardless of the switch.
 *
 * Reveal safety: the live position is read the same way the header pill reads
 * it (reveal-gated `pre` window while a Jackpot hit's slot hasn't landed), so
 * the zone can never move before the slot machine does and never spoils it.
 */

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from '@/lib/logger';
import { isRollingActive, replayJpLane, lanePosition, computeJpCycle } from '@/lib/rollingLanes';

// ── Tiers ───────────────────────────────────────────────────────────────────

export const BZ_TIER1_THROUGH = 20;
export const BZ_TIER2_THROUGH = 40;
export const BZ_TIER3_THROUGH = 60;
/** Credits bank in sixths so ½ (tier 2) and ⅓ (tier 3) add up cleanly. */
export const BZ_UNITS_PER_PASS = 6;

export type BonusZoneTier = 1 | 2 | 3;

export interface BonusZoneTierInfo {
  tier: BonusZoneTier;
  /** "Buy 1 Get 1" / "Buy 2 Get 1" */
  label: string;
  /** Upper-case pill form. */
  short: string;
  /** Free drafts earned per eligible paid FILL: 1, ½ or ⅓. */
  credit: number;
  /** Same thing in sixths: 6 / 3 / 2. */
  units: number;
  /** Last window position this tier covers. */
  through: number;
}

type TierCfg = Pick<BonusZoneConfig, 'tier1Through' | 'tier2Through' | 'tier3Through'>;

export function tierInfo(tier: BonusZoneTier, cfg?: Partial<TierCfg>): BonusZoneTierInfo {
  const t1 = cfg?.tier1Through ?? BZ_TIER1_THROUGH;
  const t2 = cfg?.tier2Through ?? BZ_TIER2_THROUGH;
  const t3 = cfg?.tier3Through ?? BZ_TIER3_THROUGH;
  // The "1" you get is a FREE SPIN on the Banana Wheel (Richard 8/22) — paid
  // like every other promo (claimable on the card), and every promo spin wins
  // at least 1 free draft.
  if (tier === 1) return { tier: 1, label: 'Buy 1 Get 1 Spin', short: 'BUY 1 GET 1 SPIN', credit: 1, units: 6, through: t1 };
  if (tier === 2) return { tier: 2, label: 'Buy 2 Get 1 Spin', short: 'BUY 2 GET 1 SPIN', credit: 0.5, units: 3, through: t2 };
  return { tier: 3, label: 'Buy 3 Get 1 Spin', short: 'BUY 3 GET 1 SPIN', credit: 1 / 3, units: 2, through: t3 };
}

/** Which tier a 1-indexed Jackpot window position falls in (null = none). */
export function bonusZoneTierForPosition(position: number, cfg?: Partial<TierCfg>): BonusZoneTierInfo | null {
  const t1 = cfg?.tier1Through ?? BZ_TIER1_THROUGH;
  const t2 = cfg?.tier2Through ?? BZ_TIER2_THROUGH;
  const t3 = cfg?.tier3Through ?? BZ_TIER3_THROUGH;
  if (!Number.isFinite(position) || position < 1) return null;
  if (position <= t1) return tierInfo(1, cfg);
  if (position <= t2) return tierInfo(2, cfg);
  if (position <= t3) return tierInfo(3, cfg);
  return null;
}

// ── Live view (what the pill / bot / entry modal show) ───────────────────────

export interface BonusZoneView {
  enabled: boolean;
  /** Live tier for the NEXT draft to fill, null when the zone is closed. */
  tier: BonusZoneTier | null;
  label: string | null;
  short: string | null;
  credit: number | null;
  /** 1-indexed window position the NEXT fill lands on. */
  position: number;
  /** Drafts (counting the next one) still inside the live tier. */
  draftsLeftInTier: number;
  /** Drafts (counting the next one) until the zone closes entirely. */
  draftsLeftInZone: number;
  windowStart: number;
  tier1Through: number;
  tier2Through: number;
  tier3Through: number;
  /** JackHOF seats hidden in this tier's packs — stamped by the stream ONLY
   *  while the zone packs switch is on (same gate as the card row), absent
   *  otherwise so the header can never advertise packs early. */
  packSeats?: number | null;
}

/**
 * Pure view math. `revealedFilled` = FilledLeaguesCount minus fills whose slot
 * hasn't landed — the same number the header's % uses — so the pill, the bot
 * and the entry lock always agree and none of them can front-run a reveal.
 */
export function bonusZoneViewForLane(
  windowStart: number,
  revealedFilled: number,
  cfg: Pick<BonusZoneConfig, 'enabled'> & Partial<TierCfg>,
): BonusZoneView {
  const position = lanePosition(revealedFilled, windowStart) + 1;
  const t = cfg.enabled ? bonusZoneTierForPosition(position, cfg) : null;
  return {
    enabled: cfg.enabled,
    tier: t?.tier ?? null,
    label: t?.label ?? null,
    short: t?.short ?? null,
    credit: t?.credit ?? null,
    position,
    draftsLeftInTier: t ? Math.max(0, t.through - position + 1) : 0,
    draftsLeftInZone: Math.max(0, (cfg.tier3Through ?? BZ_TIER3_THROUGH) - position + 1),
    windowStart,
    tier1Through: cfg.tier1Through ?? BZ_TIER1_THROUGH,
    tier2Through: cfg.tier2Through ?? BZ_TIER2_THROUGH,
    tier3Through: cfg.tier3Through ?? BZ_TIER3_THROUGH,
  };
}

// ── Config / switch ─────────────────────────────────────────────────────────

export interface BonusZoneConfig {
  enabled: boolean;
  /** Purchases at/after this instant are eligible (ISO). Null = not launched. */
  launchAtIso: string | null;
  tier1Through: number;
  tier2Through: number;
  tier3Through: number;
  /** Pre-launch passes that still qualify (token ids as strings). */
  grandfatherTokenIds: string[];
}

/**
 * The 19 "plain" pre-launch purchases (Richard 8/22): paid passes bought with
 * NO promo reward attached, by person. Everyone else's pre-launch passes had a
 * promo and must buy new ones. VagBros (team wallet, tokens 2160/2168) left out
 * on Richard's call. Source: scripts/_chk-paid-passes-promo-origin.mjs census.
 */
export const GRANDFATHERED_TOKEN_IDS: readonly string[] = [
  // Forzie — 8 for $200, 8/10
  '6803', '6804', '6805', '6806', '6807', '6808', '6809', '6810',
  // Vertig0 — 3 for $75 on 8/21 + 3 for $75 on 8/22
  '9117', '9118', '9119', '9336', '9337', '9338',
  // Bombsicle — 2 for $50, 8/15
  '7943', '7944',
  // Kiely — 8/20
  '8919',
  // NickW — 8/20
  '8993',
  // TheBestBanana — 8/17
  '8422',
];

export const BONUS_ZONE_CONFIG_DOC = 'bonusZone';
const CONFIG_TTL_MS = 20_000;
let cfgCache: { at: number; cfg: BonusZoneConfig } | null = null;

function defaultConfig(): BonusZoneConfig {
  return {
    enabled: false,
    launchAtIso: null,
    tier1Through: BZ_TIER1_THROUGH,
    tier2Through: BZ_TIER2_THROUGH,
    tier3Through: BZ_TIER3_THROUGH,
    grandfatherTokenIds: [...GRANDFATHERED_TOKEN_IDS],
  };
}

/** Env override for emergencies: BONUS_ZONE=1 forces ON, =0 forces OFF. */
function envOverride(): boolean | null {
  const v = process.env.BONUS_ZONE;
  if (v === '1') return true;
  if (v === '0') return false;
  return null;
}

export async function readBonusZoneConfig(opts: { fresh?: boolean } = {}): Promise<BonusZoneConfig> {
  const now = Date.now();
  if (!opts.fresh && cfgCache && now - cfgCache.at < CONFIG_TTL_MS) return cfgCache.cfg;
  const cfg = defaultConfig();
  if (isFirestoreConfigured()) {
    try {
      const snap = await getAdminFirestore().collection('system_config').doc(BONUS_ZONE_CONFIG_DOC).get();
      const d = (snap.exists ? snap.data() : null) as Partial<BonusZoneConfig> | null;
      if (d) {
        if (typeof d.enabled === 'boolean') cfg.enabled = d.enabled;
        if (typeof d.launchAtIso === 'string' && d.launchAtIso) cfg.launchAtIso = d.launchAtIso;
        if (Number.isFinite(d.tier1Through) && (d.tier1Through as number) > 0) cfg.tier1Through = Number(d.tier1Through);
        if (Number.isFinite(d.tier2Through) && (d.tier2Through as number) >= cfg.tier1Through) cfg.tier2Through = Number(d.tier2Through);
        // Absent → the code default (60). (A leftover "collapse to tier 2" rule
        // from the two-band draft shipped live for ~10 min on 8/22 and closed the
        // zone at 40 — config now pins all three explicitly, belt and braces.)
        if (Number.isFinite(d.tier3Through) && (d.tier3Through as number) >= cfg.tier2Through) cfg.tier3Through = Number(d.tier3Through);
        if (cfg.tier3Through < cfg.tier2Through) cfg.tier3Through = cfg.tier2Through;
        if (Array.isArray(d.grandfatherTokenIds)) {
          cfg.grandfatherTokenIds = Array.from(new Set([...cfg.grandfatherTokenIds, ...d.grandfatherTokenIds.map(String)]));
        }
      }
    } catch (err) {
      logger.warn('bonus_zone.config_read_failed', { err: (err as Error).message });
    }
  }
  const ov = envOverride();
  if (ov !== null) cfg.enabled = ov;
  // An enabled zone with no launch stamp would make every old pass ineligible
  // except the grandfather list — that is the intended "never launched" state,
  // but it's almost certainly a toggle mistake, so shout.
  if (cfg.enabled && !cfg.launchAtIso) logger.warn('bonus_zone.enabled_without_launch_stamp');
  cfgCache = { at: now, cfg };
  return cfg;
}

export async function isBonusZoneEnabled(): Promise<boolean> {
  return (await readBonusZoneConfig()).enabled;
}

// ── Live lane view off the tracker (reveal-gated like the header) ───────────

const REVEAL_OFFSET_SEC = 39; // slot lands at DraftStartTime-39s (batchProgress/stream)

interface TrackerDoc {
  FilledLeaguesCount?: number;
  RollingStartDraft?: number;
  JackpotLeagueIds?: number[];
  RecentFills?: Array<{ Id?: number; StartTime?: number }>;
}

/**
 * Mirrors buildPayload in app/api/league/batchProgress/stream/route.ts: fills
 * whose slot hasn't landed are excluded from the window replay AND from the
 * revealed count, so this returns exactly the window the pill is showing.
 */
export function laneViewFromTracker(d: TrackerDoc | undefined, nowMs = Date.now()): { windowStart: number; revealedFilled: number; filled: number; rolling: boolean } {
  const filled = Number(d?.FilledLeaguesCount ?? 0) || 0;
  const rollingStart = Number(d?.RollingStartDraft ?? 0) || 0;
  const rolling = isRollingActive(rollingStart, filled);
  if (!rolling) return { windowStart: 0, revealedFilled: filled, filled, rolling: false };
  const jpIds = Array.isArray(d?.JackpotLeagueIds) ? d!.JackpotLeagueIds!.map(Number) : [];
  const stById = new Map<number, number>();
  for (const rf of Array.isArray(d?.RecentFills) ? d!.RecentFills! : []) {
    const id = Number(rf?.Id ?? 0) || 0;
    const st = Number(rf?.StartTime ?? 0) || 0;
    if (!id) continue;
    if (!stById.has(id) || st > (stById.get(id) as number)) stById.set(id, st);
  }
  const unrevealed = new Set<number>();
  for (const [id, st] of stById) {
    if (id > filled || id < rollingStart) continue;
    const atMs = st > 0 ? (st - REVEAL_OFFSET_SEC) * 1000 : nowMs + 3_600_000;
    if (atMs > nowMs) unrevealed.add(id);
  }
  const { windowStart } = replayJpLane(jpIds.filter((id) => !unrevealed.has(id)), rollingStart, filled);
  return { windowStart, revealedFilled: filled - unrevealed.size, filled, rolling: true };
}

export async function readBonusZoneView(): Promise<BonusZoneView> {
  const cfg = await readBonusZoneConfig();
  if (!isFirestoreConfigured()) return bonusZoneViewForLane(0, 0, { ...cfg, enabled: false });
  const snap = await getAdminFirestore().collection('drafts').doc('draftTracker').get();
  const lane = laneViewFromTracker(snap.data() as TrackerDoc | undefined);
  if (!lane.rolling) return bonusZoneViewForLane(0, 0, { ...cfg, enabled: false });
  return bonusZoneViewForLane(lane.windowStart, lane.revealedFilled, cfg);
}

// ── Pass eligibility (token level) ──────────────────────────────────────────

export type IneligibleReason =
  | 'free_pass'          // not a paid pass
  | 'pre_launch'         // bought before the zone launched and not grandfathered
  | 'first_purchase'     // that purchase used the new-user / First Purchase promo
  | 'granted'            // wheel / admin pass — never purchased (card fee reward passes DO count, Richard 8/22)
  | 'transferred'        // bought by a different wallet
  | 'no_purchase_record' // no pass_purchased row — not a real purchase
  | 'unknown_token';

export interface PassEligibility {
  tokenId: string;
  eligible: boolean;
  reason: 'grandfathered' | 'post_launch' | IneligibleReason;
}

export const BONUS_ZONE_TOKEN_FLAGS = 'bonus_zone_token_flags';

/**
 * Stamp purchased tokens at checkout so eligibility is a fact, not a heuristic.
 * Called from the card-mint route + its NY twin right after incrementMintPromos:
 * `excluded` when the purchase earned First Purchase spins (the new-user promo
 * pays a FREE pass, so it's already out by pass type).
 */
export async function stampPurchasedTokens(input: {
  tokenIds: string[];
  wallet: string;
  excluded: boolean;
  reason: string;
  purchasedAtIso?: string;
}): Promise<void> {
  if (!isFirestoreConfigured() || input.tokenIds.length === 0) return;
  const db = getAdminFirestore();
  const batch = db.batch();
  for (const t of input.tokenIds) {
    batch.set(db.collection(BONUS_ZONE_TOKEN_FLAGS).doc(String(t)), {
      tokenId: String(t),
      wallet: input.wallet.toLowerCase(),
      excluded: input.excluded,
      reason: input.reason,
      purchasedAtIso: input.purchasedAtIso ?? new Date().toISOString(),
    }, { merge: true });
  }
  await batch.commit().catch((err) => logger.warn('bonus_zone.stamp_failed', { err: (err as Error).message }));
}

/**
 * Classify ONE token for `wallet`. `passType` is the engine's stamp for the
 * token (from Go's /owner/{w}/draftToken/all or validDraftTokens.PassType).
 */
export async function classifyPassForBonusZone(
  wallet: string,
  tokenId: string,
  passType: 'paid' | 'free' | null,
  cfg: BonusZoneConfig,
): Promise<PassEligibility> {
  const w = wallet.toLowerCase();
  const tid = String(tokenId);
  if (passType !== 'paid') return { tokenId: tid, eligible: false, reason: passType === 'free' ? 'free_pass' : 'unknown_token' };
  if (cfg.grandfatherTokenIds.includes(tid)) return { tokenId: tid, eligible: true, reason: 'grandfathered' };
  if (!isFirestoreConfigured()) return { tokenId: tid, eligible: false, reason: 'no_purchase_record' };
  const db = getAdminFirestore();

  // Reward / wheel / admin passes carry a pass_origin doc — never purchased.
  const origin = await db.collection('pass_origin').doc(tid).get().catch(() => null);
  if (origin?.exists) return { tokenId: tid, eligible: false, reason: 'granted' };

  // Checkout stamp (post-launch purchases) — the authoritative answer.
  const flag = await db.collection(BONUS_ZONE_TOKEN_FLAGS).doc(tid).get().catch(() => null);
  const f = flag?.exists ? (flag.data() as { wallet?: string; excluded?: boolean; purchasedAtIso?: string }) : null;
  if (f) {
    if (f.wallet && f.wallet !== w) return { tokenId: tid, eligible: false, reason: 'transferred' };
    if (f.excluded) return { tokenId: tid, eligible: false, reason: 'first_purchase' };
    if (cfg.launchAtIso && f.purchasedAtIso && f.purchasedAtIso < cfg.launchAtIso) {
      return { tokenId: tid, eligible: false, reason: 'pre_launch' };
    }
    return { tokenId: tid, eligible: true, reason: 'post_launch' };
  }

  // No stamp: find the purchase row (tokenIds array-contains, single-field
  // index only — type is filtered in memory so no composite index is needed).
  const rows = await db.collection('v2_activity_events')
    .where('tokenIds', 'array-contains', tid).limit(5).get().catch(() => null);
  const events = rows?.docs.map((d) => d.data() as { type?: string; userId?: string; walletAddress?: string; createdAtIso?: string; metadata?: { source?: string } }) ?? [];
  // Card fee reward passes count like a purchase (Richard 8/22: "card fees
  // should count") — they're earned by paying, registered 'paid', no pass_origin.
  const purchase = events.find((e) => e.type === 'pass_purchased')
    ?? events.find((e) => e.type === 'pass_granted' && e.metadata?.source === 'card_fee_reward');
  if (!purchase) return { tokenId: tid, eligible: false, reason: 'no_purchase_record' };
  const buyer = String(purchase.userId ?? purchase.walletAddress ?? '').toLowerCase();
  if (buyer && buyer !== w) return { tokenId: tid, eligible: false, reason: 'transferred' };
  const at = String(purchase.createdAtIso ?? '');
  if (!cfg.launchAtIso || !at || at < cfg.launchAtIso) return { tokenId: tid, eligible: false, reason: 'pre_launch' };
  // Post-launch but unstamped (stamp write lost) — trust the purchase row.
  return { tokenId: tid, eligible: true, reason: 'post_launch' };
}

interface GoToken { _cardId?: string | number; _leagueId?: string; passType?: string; _level?: string; _draftType?: string }

async function fetchGoTokens(wallet: string): Promise<{ active: GoToken[]; available: GoToken[] } | null> {
  const baseUrl = (process.env.STAGING_DRAFTS_API_URL || 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app').replace(/\/$/, '');
  try {
    const res = await fetch(`${baseUrl}/owner/${encodeURIComponent(wallet.toLowerCase())}/draftToken/all`, {
      cache: 'no-store', signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { active?: GoToken[]; available?: GoToken[] };
    return { active: body.active ?? [], available: body.available ?? [] };
  } catch {
    return null;
  }
}

/** The token a wallet is sitting in `draftId` with, straight from the engine. */
export async function resolveTokenInDraft(wallet: string, draftId: string): Promise<{ tokenId: string; passType: 'paid' | 'free' | null } | null> {
  const toks = await fetchGoTokens(wallet);
  if (!toks) return null;
  const tok = [...toks.active, ...toks.available].find((t) => String(t._leagueId ?? '') === draftId);
  if (!tok) return null;
  const pt = String(tok.passType ?? '');
  return { tokenId: String(tok._cardId ?? ''), passType: pt === 'paid' ? 'paid' : pt === 'free' ? 'free' : null };
}

/** Eligibility of every UNUSED paid pass in the wallet (for the entry modal). */
export async function classifyAvailablePasses(wallet: string, cfg: BonusZoneConfig): Promise<{ paidTotal: number; eligible: PassEligibility[]; ineligible: PassEligibility[] }> {
  const toks = await fetchGoTokens(wallet);
  const paid = (toks?.available ?? []).filter((t) => String(t.passType ?? '') === 'paid'
    && !/jackpot|hall of fame|jackhof/i.test(String(t._level ?? '')));
  const out = await Promise.all(paid.map((t) => classifyPassForBonusZone(wallet, String(t._cardId ?? ''), 'paid', cfg)));
  return { paidTotal: paid.length, eligible: out.filter((e) => e.eligible), ineligible: out.filter((e) => !e.eligible) };
}

// ── Entries: lock at entry, void on leave, pay at fill ──────────────────────

export const BONUS_ZONE_ENTRIES = 'bonus_zone_entries';
/** House-bot registry (lib/botMint) — read here by name so the zone never imports the on-chain mint graph. */
const BOT_COLLECTION = 'botWallets';
export const BONUS_ZONE_PROGRESS = 'bonus_zone_progress';

export type BonusEntryStatus = 'pending' | 'ineligible' | 'left' | 'settling' | 'paid' | 'half' | 'grant_failed' | 'closed' | 'position_unresolved';

export interface BonusZoneEntry {
  draftId: string;
  wallet: string;
  tokenId: string;
  /** PROJECTED tier at entry (what the pill showed) — UI only. The paid tier
   *  is decided at fill from the draft's real window position. */
  tier: BonusZoneTier;
  label: string;
  credit: number;
  /** Sixths of a free draft the projected tier would bank (6 / 3 / 2). */
  units: number;
  position: number;
  windowStart: number;
  lockedAtIso: string;
  /** Fill-time truth (set at settlement). */
  fillDraftNo?: number;
  fillPosition?: number;
  fillWindowStart?: number;
  paidTier?: BonusZoneTier | null;
  paidLabel?: string;
  status: BonusEntryStatus;
  eligible: boolean;
  reason: string;
  /** Fill-time outcome. */
  settledAtIso?: string;
  /** Free Spins credited (claimable on the card). */
  spins?: number;
  /** For partial credits: banked sixths after this fill (6 = minted). */
  unitsAfter?: number;
  error?: string;
  /** Lock was created at FILL by healMissingBonusZoneLocks (no client lock ever landed). */
  healedAtFill?: boolean;
}

export function entryDocId(draftId: string, wallet: string): string {
  return `${draftId}__${wallet.toLowerCase()}`;
}

/** Drafts the zone applies to: BBB fast/slow lobbies only. */
export function isBonusZoneDraftId(draftId: string): boolean {
  return /^2026-(fast|slow)-draft-\d+$/.test(draftId);
}

export interface LockResult {
  locked: boolean;
  entry?: BonusZoneEntry;
  view?: BonusZoneView;
  skipped?: 'disabled' | 'not_rolling' | 'not_bbb_draft' | 'free_pass' | 'token_unresolved';
}

/**
 * Called from /api/owner/use-pass (joined:true) — the seat is already taken by
 * Go. Records THIS (draft, wallet) with the exact token the engine consumed,
 * its eligibility, and the PROJECTED tier (what the pill shows) for the row
 * glyph / leave warning. The paid tier is decided at fill. Ineligible passes
 * get an entry too (status 'ineligible') so the UI can say why nothing will
 * pay. Re-entry overwrites the doc — never a second payout.
 */
export async function lockBonusZoneEntry(input: { wallet: string; draftId: string; passTypeHint: 'paid' | 'free' }): Promise<LockResult> {
  const cfg = await readBonusZoneConfig();
  if (!cfg.enabled) return { locked: false, skipped: 'disabled' };
  if (!isBonusZoneDraftId(input.draftId)) return { locked: false, skipped: 'not_bbb_draft' };
  const wallet = input.wallet.toLowerCase();
  const view = await readBonusZoneView();
  if (!view.enabled || view.windowStart <= 0) return { locked: false, skipped: 'not_rolling', view };
  // Zone closed on the pill: still record the seat — a Jackpot hit before this
  // lobby fills resets the window and the fill could land at position 1.
  const tok = await resolveTokenInDraft(wallet, input.draftId);
  const passType = tok?.passType ?? input.passTypeHint;
  if (passType === 'free') return { locked: false, skipped: 'free_pass', view };
  if (!tok?.tokenId) return { locked: false, skipped: 'token_unresolved', view };

  const elig = await classifyPassForBonusZone(wallet, tok.tokenId, 'paid', cfg);
  const t = tierInfo(view.tier ?? 3, cfg);
  const entry: BonusZoneEntry = {
    draftId: input.draftId,
    wallet,
    tokenId: tok.tokenId,
    tier: view.tier ?? t.tier,
    label: view.tier ? t.label : 'Zone closed',
    credit: view.tier ? t.credit : 0,
    units: view.tier ? t.units : 0,
    position: view.position,
    windowStart: view.windowStart,
    lockedAtIso: new Date().toISOString(),
    status: elig.eligible ? 'pending' : 'ineligible',
    eligible: elig.eligible,
    reason: elig.reason,
  };
  await getAdminFirestore().collection(BONUS_ZONE_ENTRIES).doc(entryDocId(input.draftId, wallet)).set(entry);
  logger.info('bonus_zone.recorded', { context: { draftId: input.draftId, wallet, tokenId: tok.tokenId, projectedTier: view.tier, position: view.position, eligible: elig.eligible, reason: elig.reason } });
  return { locked: true, entry, view };
}

/** Leaving the lobby forfeits the lock (pass is refunded, nothing pays). */
export async function voidBonusZoneEntryOnLeave(wallet: string, draftId: string): Promise<void> {
  if (!isFirestoreConfigured()) return;
  const ref = getAdminFirestore().collection(BONUS_ZONE_ENTRIES).doc(entryDocId(draftId, wallet));
  await ref.set({ status: 'left', leftAtIso: new Date().toISOString() }, { merge: true }).catch(() => {});
}

export async function getBonusZoneEntry(wallet: string, draftId: string): Promise<BonusZoneEntry | null> {
  if (!isFirestoreConfigured()) return null;
  const snap = await getAdminFirestore().collection(BONUS_ZONE_ENTRIES).doc(entryDocId(draftId, wallet)).get();
  return snap.exists ? (snap.data() as BonusZoneEntry) : null;
}

// ── Credit (the Free Spin) ──────────────────────────────────────────────────

export const BANANA_ZONE_PROMO_ID = 'bonus-zone';

/**
 * Credit `count` Free Spins as CLAIMABLE on the user's Banana Zone promo card —
 * the same path every other promo pays through (claimPromo's generic branch:
 * claimable + claimCount → wheelSpins). Creates the per-user promo doc from
 * the seed if the lazy backfill hasn't run for them yet.
 */
export async function creditBananaZoneSpins(wallet: string, count: number, reason: string): Promise<{ claimCount: number }> {
  const db = getAdminFirestore();
  const w = wallet.toLowerCase();
  const { ensureUserSeeded } = await import('@/lib/db-firestore');
  await ensureUserSeeded(w);
  const ref = db.collection('v2_users').doc(w).collection('promos').doc(BANANA_ZONE_PROMO_ID);
  const claimCount = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    let promo: Record<string, unknown>;
    if (snap.exists) promo = snap.data() as Record<string, unknown>;
    else {
      const { getDefaultPromos } = await import('@/lib/api/seed');
      const seed = getDefaultPromos().find((p) => p.id === BANANA_ZONE_PROMO_ID);
      promo = seed ? JSON.parse(JSON.stringify(seed)) : { id: BANANA_ZONE_PROMO_ID, type: 'bonus-zone', modalContent: {} };
    }
    const next = Number(promo.claimCount ?? 0) + count;
    tx.set(ref, { ...promo, claimable: true, claimCount: next, progressCurrent: 1, updatedAt: new Date().toISOString(), lastCreditReason: reason }, { merge: true });
    return next;
  });
  const { pushStreamEventBg } = await import('@/lib/userEventStream');
  pushStreamEventBg(w, 'notification', { source: 'banana-zone-credit' });
  return { claimCount };
}

// ── Fill position (the truth the payout keys off) ───────────────────────────

/**
 * The draft's own window position, anchored to its "BBB #N" display name —
 * never the live filled count (that's how BBB #349 over-paid the jackpot
 * draw). Go writes DisplayName a beat after the fill, so this retries.
 */
export async function fillPositionForDraft(draftId: string, cfg: BonusZoneConfig): Promise<{ draftNo: number; position: number; windowStart: number; tier: BonusZoneTierInfo | null } | null> {
  const db = getAdminFirestore();
  let draftNo: number | null = null;
  for (let i = 0; i < 6 && draftNo === null; i++) {
    const info = await db.collection('drafts').doc(draftId).collection('state').doc('info').get().catch(() => null);
    const m = /BBB\s*#\s*(\d+)/.exec(String(info?.data()?.DisplayName ?? ''));
    if (m) draftNo = Number(m[1]);
    else await new Promise((r) => setTimeout(r, 2000));
  }
  if (draftNo === null) return null;
  const t = (await db.collection('drafts').doc('draftTracker').get()).data() as TrackerDoc | undefined;
  const filled = Number(t?.FilledLeaguesCount ?? 0) || 0;
  const rollingStart = Number(t?.RollingStartDraft ?? 0) || 0;
  if (!isRollingActive(rollingStart, filled) || draftNo < rollingStart) return null;
  const jpIds = Array.isArray(t?.JackpotLeagueIds) ? t!.JackpotLeagueIds!.map(Number) : [];
  // computeJpCycle excludes hits at/after draftNo, so the draft lands in the
  // window it actually filled into (even when it IS the jackpot that closes it).
  const cyc = computeJpCycle(jpIds, rollingStart, Math.max(filled, draftNo), draftNo);
  return { draftNo, position: cyc.position, windowStart: cyc.windowStart, tier: bonusZoneTierForPosition(cyc.position, cfg) };
}

// ── Fill settlement ─────────────────────────────────────────────────────────

export interface SettleOutcome {
  wallet: string;
  outcome: 'no_entry' | 'not_pending' | 'token_mismatch' | 'paid' | 'half' | 'grant_failed' | 'outside_zone' | 'position_unresolved' | 'error';
  spins?: number;
  units?: number;
  error?: string;
}

/**
 * Seats taken with NO zone lock at all. The lock is written by the client's
 * post-join /api/owner/use-pass call, which never fires when the Go join
 * succeeds but the client's 20s timeout wins the race (Apevine, BBB #870: the
 * engine seated them at 00:21:06, the client logged "join timed out ×3, nothing
 * spent", the draft filled with them in it) or when the non-blocking
 * bookkeeping request is simply dropped (Bananza, BBB #874). Both paid drafts
 * earned nothing from the zone. The seat is real either way, so record the
 * lock HERE at fill time from engine truth — the paid tier is decided at fill
 * anyway, so nothing is lost by locking late.
 *
 * HUMANS ONLY: house bots join straight through Go and have never held a lock
 * (0 of 154 entries on 8/24) — creating one would start paying bots zone
 * spins. Free passes never pay, so only a resolved PAID token gets a record.
 * `create()` (not set) so a concurrent client lock can never be clobbered.
 */
async function healMissingBonusZoneLocks(draftId: string, wallets: string[], cfg: BonusZoneConfig): Promise<void> {
  const db = getAdminFirestore();
  let view: BonusZoneView | null = null;
  for (const raw of wallets) {
    const wallet = raw.toLowerCase();
    const ref = db.collection(BONUS_ZONE_ENTRIES).doc(entryDocId(draftId, wallet));
    if ((await ref.get()).exists) continue;
    const bot = await db.collection(BOT_COLLECTION).doc(wallet).get().catch(() => null);
    if (bot?.exists && (bot.data() as { isBot?: boolean }).isBot === true) continue;
    const tok = await resolveTokenInDraft(wallet, draftId);
    if (!tok?.tokenId || tok.passType !== 'paid') continue;
    const elig = await classifyPassForBonusZone(wallet, tok.tokenId, 'paid', cfg);
    if (!view) view = await readBonusZoneView();
    const t = tierInfo(view.tier ?? 3, cfg);
    const entry: BonusZoneEntry = {
      draftId,
      wallet,
      tokenId: tok.tokenId,
      tier: view.tier ?? t.tier,
      label: view.tier ? t.label : 'Zone closed',
      credit: view.tier ? t.credit : 0,
      units: view.tier ? t.units : 0,
      position: view.position,
      windowStart: view.windowStart,
      lockedAtIso: new Date().toISOString(),
      status: elig.eligible ? 'pending' : 'ineligible',
      eligible: elig.eligible,
      reason: elig.reason,
      healedAtFill: true,
    };
    try {
      await ref.create(entry);
      logger.info('bonus_zone.lock_healed_at_fill', { context: { draftId, wallet, tokenId: tok.tokenId, eligible: elig.eligible, reason: elig.reason } });
    } catch {
      /* already exists — a client lock landed between our read and create; theirs wins */
    }
  }
}

/**
 * Called from the draft-filled webhook (the one RELIABLE fill observer). The
 * tier is decided HERE from the draft's real window position. For every wallet
 * with a pending record on this draft: verify the engine still has that wallet
 * in the draft with the recorded token, then pay — tier 1 mints a free pass
 * now; tiers 2/3 bank sixths in the FILL window's progress doc and mint at 6.
 * Idempotent: pending → settling is a transaction, so a backstop re-fire can
 * never pay twice.
 */
export async function settleBonusZoneFill(draftId: string, wallets: string[]): Promise<SettleOutcome[]> {
  const cfg = await readBonusZoneConfig();
  if (!cfg.enabled || !isFirestoreConfigured() || !isBonusZoneDraftId(draftId)) return [];
  const db = getAdminFirestore();
  const out: SettleOutcome[] = [];

  // Seats with NO lock at all get one here, from engine truth (see
  // healMissingBonusZoneLocks) — BEFORE the cheap exit so they settle below.
  await healMissingBonusZoneLocks(draftId, wallets, cfg).catch((err) => {
    logger.warn('bonus_zone.lock_heal_failed', { context: { draftId, err: (err as Error).message } });
  });

  // Any settleable records at all? (cheap exit for lobbies nobody recorded on).
  // Parked (position_unresolved) records count — the minute cron re-runs them.
  // 'ineligible' is included so no_purchase_record locks (instant-seat race —
  // the purchase row lands seconds after the join) get re-classified below.
  const pendingSnap = await db.collection(BONUS_ZONE_ENTRIES).where('draftId', '==', draftId).where('status', 'in', ['pending', 'position_unresolved', 'ineligible']).limit(1).get();
  if (pendingSnap.empty) return [];

  const fill = await fillPositionForDraft(draftId, cfg);
  if (!fill) {
    // DisplayName not there yet — park the records; the minute cron re-runs
    // settlement for position_unresolved entries. Park ONLY currently-pending
    // entries: a blanket write here would overwrite 'left'/'ineligible' locks
    // into a payable status.
    const parkable = await db.collection(BONUS_ZONE_ENTRIES).where('draftId', '==', draftId).where('status', '==', 'pending').get().catch(() => null);
    const batch = db.batch();
    for (const d of parkable?.docs ?? []) batch.set(d.ref, { status: 'position_unresolved', retryable: true }, { merge: true });
    await batch.commit().catch(() => {});
    logger.warn('bonus_zone.position_unresolved', { context: { draftId } });
    return wallets.map((w) => ({ wallet: w.toLowerCase(), outcome: 'position_unresolved' as const }));
  }
  const paidTier = fill.tier;

  for (const raw of wallets) {
    const wallet = raw.toLowerCase();
    const ref = db.collection(BONUS_ZONE_ENTRIES).doc(entryDocId(draftId, wallet));
    try {
      // Instant-seat race heal: the lock classifies at join time, but that
      // flow writes the pass_purchased row seconds later (after USDC
      // collection), so the lock can land 'no_purchase_record' on a real
      // purchase. By fill time the truth exists — re-classify instead of
      // trusting the stale verdict. Other ineligible reasons stand.
      const pre = await ref.get();
      const preData = pre.exists ? (pre.data() as BonusZoneEntry) : null;
      if (preData?.status === 'ineligible' && preData.reason === 'no_purchase_record') {
        const elig = await classifyPassForBonusZone(wallet, preData.tokenId, 'paid', cfg);
        if (elig.eligible) {
          await ref.set({ status: 'pending', eligible: true, reason: elig.reason, reclassifiedAtIso: new Date().toISOString() }, { merge: true });
          logger.info('bonus_zone.reclassified', { context: { draftId, wallet, tokenId: preData.tokenId, reason: elig.reason } });
        }
      }
      // Claim (pending OR parked position_unresolved).
      const claimed = await db.runTransaction(async (tx) => {
        const s = await tx.get(ref);
        if (!s.exists) return null;
        const e = s.data() as BonusZoneEntry;
        if (e.status !== 'pending' && e.status !== 'position_unresolved') return { e, claimed: false };
        tx.update(ref, { status: 'settling', settlingAtIso: new Date().toISOString(), fillDraftNo: fill.draftNo, fillPosition: fill.position, fillWindowStart: fill.windowStart, paidTier: paidTier?.tier ?? null, paidLabel: paidTier?.label ?? 'Zone closed' });
        return { e, claimed: true };
      });
      if (!claimed) { out.push({ wallet, outcome: 'no_entry' }); continue; }
      if (!claimed.claimed) { out.push({ wallet, outcome: 'not_pending' }); continue; }
      const e = claimed.e;

      // The seat must still be held with the locked token (leave → re-enter
      // with another pass rewrites the lock, so a mismatch here is a leave
      // whose refund call never landed). Fail closed: nothing pays.
      const tok = await resolveTokenInDraft(wallet, draftId);
      if (!tok || tok.tokenId !== e.tokenId || tok.passType !== 'paid') {
        await ref.set({ status: 'closed', closedReason: 'token_mismatch', seenTokenId: tok?.tokenId ?? null, settledAtIso: new Date().toISOString() }, { merge: true });
        out.push({ wallet, outcome: 'token_mismatch' });
        continue;
      }

      // Filled past the zone (entered at 58, filled at 63): nothing pays.
      if (!paidTier) {
        await ref.set({ status: 'closed', closedReason: 'filled_outside_zone', settledAtIso: new Date().toISOString() }, { merge: true });
        out.push({ wallet, outcome: 'outside_zone' });
        continue;
      }

      if (paidTier.tier === 1) {
        try {
          await creditBananaZoneSpins(wallet, 1, `t1:${draftId}`);
          await ref.set({ status: 'paid', spins: 1, settledAtIso: new Date().toISOString() }, { merge: true });
          await notifyBonusPaid(wallet, draftId, 1, paidTier.label);
          out.push({ wallet, outcome: 'paid', spins: 1 });
        } catch (err) {
          await ref.set({ status: 'grant_failed', error: (err as Error).message, retryable: true, owed: 1, settledAtIso: new Date().toISOString() }, { merge: true });
          logger.error('bonus_zone.grant_failed', { context: { draftId, wallet, err: (err as Error).message } });
          out.push({ wallet, outcome: 'grant_failed', error: (err as Error).message });
        }
        continue;
      }

      // Tiers 2/3: bank sixths (½ = 3, ⅓ = 2) in the FILL window's progress
      // doc; mint when it reaches 6. Halves and thirds mix freely. Leftovers
      // die with the window (Richard 8/22: same window only).
      const progRef = db.collection(BONUS_ZONE_PROGRESS).doc(`${wallet}__${fill.windowStart}`);
      const add = paidTier.units;
      const after = await db.runTransaction(async (tx) => {
        const s = await tx.get(progRef);
        const cur = s.exists ? Number((s.data() as { units?: number }).units ?? 0) : 0;
        const next = cur + add;
        if (next >= BZ_UNITS_PER_PASS) {
          tx.set(progRef, { wallet, windowStart: fill.windowStart, units: next - BZ_UNITS_PER_PASS, minted: FieldValue.increment(1), updatedAtIso: new Date().toISOString(), lastDraftId: draftId }, { merge: true });
          return next;
        }
        tx.set(progRef, { wallet, windowStart: fill.windowStart, units: next, updatedAtIso: new Date().toISOString(), lastDraftId: draftId }, { merge: true });
        return next;
      });
      if (after < BZ_UNITS_PER_PASS) {
        await ref.set({ status: 'half', unitsAfter: after, settledAtIso: new Date().toISOString() }, { merge: true });
        await notifyBonusPartial(wallet, draftId, fill.windowStart, paidTier.label, after);
        out.push({ wallet, outcome: 'half', units: after });
        continue;
      }
      try {
        await creditBananaZoneSpins(wallet, 1, `t${paidTier.tier}:${draftId}`);
        await ref.set({ status: 'paid', unitsAfter: after, spins: 1, settledAtIso: new Date().toISOString() }, { merge: true });
        await notifyBonusPaid(wallet, draftId, 1, paidTier.label);
        out.push({ wallet, outcome: 'paid', spins: 1, units: after });
      } catch (err) {
        await ref.set({ status: 'grant_failed', unitsAfter: after, error: (err as Error).message, retryable: true, owed: 1, settledAtIso: new Date().toISOString() }, { merge: true });
        logger.error('bonus_zone.grant_failed', { context: { draftId, wallet, err: (err as Error).message } });
        out.push({ wallet, outcome: 'grant_failed', error: (err as Error).message });
      }
    } catch (err) {
      logger.error('bonus_zone.settle_error', { context: { draftId, wallet, err: (err as Error).message } });
      out.push({ wallet, outcome: 'error', error: (err as Error).message });
    }
  }
  if (out.some((o) => o.outcome === 'paid' || o.outcome === 'half')) {
    logger.info('bonus_zone.settled', { context: { draftId, outcomes: out.map((o) => `${o.wallet.slice(0, 8)}:${o.outcome}`) } });
  }
  return out;
}

/** Retry grants that failed at fill (mint hiccups) and re-settle records whose
 *  draft number wasn't readable at fill time. Runs from the minute cron. */
export async function retryFailedBonusZoneGrants(max = 5): Promise<number> {
  if (!isFirestoreConfigured()) return 0;
  const cfg = await readBonusZoneConfig();
  if (!cfg.enabled) return 0;
  const db = getAdminFirestore();
  // Parked fills: DisplayName should exist by now — settle them properly.
  const parked = await db.collection(BONUS_ZONE_ENTRIES).where('status', '==', 'position_unresolved').limit(max).get();
  const byDraft = new Map<string, string[]>();
  for (const d of parked.docs) { const e = d.data() as BonusZoneEntry; byDraft.set(e.draftId, [...(byDraft.get(e.draftId) ?? []), e.wallet]); }
  for (const [draftId, ws] of byDraft) await settleBonusZoneFill(draftId, ws).catch(() => []);
  const snap = await db.collection(BONUS_ZONE_ENTRIES).where('status', '==', 'grant_failed').limit(max).get();
  let done = 0;
  for (const doc of snap.docs) {
    const e = doc.data() as BonusZoneEntry & { owed?: number; attempts?: number };
    if ((e.attempts ?? 0) >= 8) continue;
    const claimed = await db.runTransaction(async (tx) => {
      const s = await tx.get(doc.ref);
      if ((s.data() as BonusZoneEntry).status !== 'grant_failed') return false;
      tx.update(doc.ref, { status: 'settling', attempts: FieldValue.increment(1) });
      return true;
    });
    if (!claimed) continue;
    try {
      await creditBananaZoneSpins(e.wallet, e.owed ?? 1, `retry:${e.draftId}`);
      await doc.ref.set({ status: 'paid', spins: e.owed ?? 1, settledAtIso: new Date().toISOString(), error: FieldValue.delete() }, { merge: true });
      await notifyBonusPaid(e.wallet, e.draftId, e.owed ?? 1, e.paidLabel ?? e.label);
      done++;
    } catch (err) {
      await doc.ref.set({ status: 'grant_failed', error: (err as Error).message }, { merge: true });
    }
  }
  return done;
}

// ── Notifications ───────────────────────────────────────────────────────────

async function notifyBonusPaid(wallet: string, draftId: string, count: number, label: string): Promise<void> {
  try {
    const { createNotification } = await import('@/lib/queueNotifications');
    await createNotification(wallet, {
      type: 'promo',
      title: count === 1 ? '🍌 Banana Zone: Free Spin earned' : `🍌 Banana Zone: ${count} Free Spins earned`,
      message: `Your ${label} draft filled. Claim your Free Spin on the Banana Zone card.`,
      link: '/promos?promo=bonus-zone',
      dedupeKey: `bonus-zone-paid-${draftId}`,
      icon: 'sparkles',
    });
  } catch (err) {
    logger.warn('bonus_zone.notify_failed', { wallet, err: (err as Error).message });
  }
}

/** "1 of 2", "2 of 3", or a percentage when halves and thirds are mixed. */
export function progressCopy(units: number): string {
  if (units <= 0) return '0 toward a Free Spin';
  if (units === 3) return '1 of 2 toward a Free Spin';
  if (units === 2) return '1 of 3 toward a Free Spin';
  if (units === 4) return '2 of 3 toward a Free Spin';
  return `${Math.round((units / BZ_UNITS_PER_PASS) * 100)}% of the way to a Free Spin`;
}

async function notifyBonusPartial(wallet: string, draftId: string, windowStart: number, label: string, units: number): Promise<void> {
  try {
    const { createNotification } = await import('@/lib/queueNotifications');
    const left = BZ_UNITS_PER_PASS - units;
    const more = left <= 2 ? 'One more Buy 3 Get 1 Spin draft' : left <= 3 ? 'One more Buy 2 Get 1 Spin draft (or two Buy 3 Get 1 Spin)' : 'A couple more Banana Zone drafts';
    await createNotification(wallet, {
      type: 'promo',
      title: `🍌 Banana Zone: ${progressCopy(units)}`,
      message: `Your ${label} draft filled. ${more} before the Jackpot hits and the Free Spin is yours.`,
      link: '/promos?promo=bonus-zone',
      dedupeKey: `bonus-zone-part-${draftId}-${windowStart}`,
      icon: 'sparkles',
    });
  } catch (err) {
    logger.warn('bonus_zone.notify_failed', { wallet, err: (err as Error).message });
  }
}

// ── Per-wallet status (entry modal, My Drafts, promo card) ──────────────────

export interface BonusZoneWalletStatus {
  view: BonusZoneView;
  passes: { paidTotal: number; eligibleCount: number; ineligibleReasons: Record<string, number> } | null;
  /** Live locks on lobbies still filling. */
  pending: Array<{ draftId: string; tier: BonusZoneTier; label: string; credit: number; position: number; eligible: boolean; reason: string; status: BonusEntryStatus }>;
  /** Sixths of a free draft banked in the CURRENT window (0–5). */
  unitsThisWindow: number;
  /** Free drafts earned all-time from the zone. */
  earned: number;
  history: Array<{ draftId: string; label: string; status: BonusEntryStatus; settledAtIso?: string; unitsAfter?: number }>;
}

export async function getBonusZoneWalletStatus(wallet: string, opts: { includePasses?: boolean } = {}): Promise<BonusZoneWalletStatus> {
  const cfg = await readBonusZoneConfig();
  const view = await readBonusZoneView();
  const w = wallet.toLowerCase();
  const empty: BonusZoneWalletStatus = { view, passes: null, pending: [], unitsThisWindow: 0, earned: 0, history: [] };
  if (!cfg.enabled || !isFirestoreConfigured()) return empty;
  const db = getAdminFirestore();
  const [entriesSnap, progSnap, passes] = await Promise.all([
    db.collection(BONUS_ZONE_ENTRIES).where('wallet', '==', w).limit(200).get(),
    view.windowStart > 0 ? db.collection(BONUS_ZONE_PROGRESS).doc(`${w}__${view.windowStart}`).get() : Promise.resolve(null),
    opts.includePasses ? classifyAvailablePasses(w, cfg) : Promise.resolve(null),
  ]);
  const entries = entriesSnap.docs.map((d) => d.data() as BonusZoneEntry);
  const pending = entries
    .filter((e) => e.status === 'pending' || e.status === 'ineligible' || e.status === 'position_unresolved')
    .map((e) => ({ draftId: e.draftId, tier: e.tier, label: e.label, credit: e.credit, position: e.position, eligible: e.eligible, reason: e.reason, status: e.status }));
  const settled = entries
    .filter((e) => e.status === 'paid' || e.status === 'half' || e.status === 'grant_failed')
    .sort((a, b) => String(b.settledAtIso ?? '').localeCompare(String(a.settledAtIso ?? '')));
  const earned = settled.reduce((s, e) => s + (e.status === 'paid' ? (e.spins ?? 1) : 0), 0);
  // History shows the tier that actually PAID (fill position), not the projection.
  for (const e of settled) if (e.paidLabel) e.label = e.paidLabel;
  const reasons: Record<string, number> = {};
  for (const p of passes?.ineligible ?? []) reasons[p.reason] = (reasons[p.reason] ?? 0) + 1;
  return {
    view,
    passes: passes ? { paidTotal: passes.paidTotal, eligibleCount: passes.eligible.length, ineligibleReasons: reasons } : null,
    pending,
    unitsThisWindow: progSnap?.exists ? Number((progSnap.data() as { units?: number }).units ?? 0) : 0,
    earned,
    history: settled.slice(0, 30).map((e) => ({ draftId: e.draftId, label: e.label, status: e.status, settledAtIso: e.settledAtIso, unitsAfter: e.unitsAfter })),
  };
}

/** Plain-English reason for an ineligible pass (entry modal / row tooltip). */
export function ineligibleReasonCopy(reason: string): string {
  switch (reason) {
    case 'free_pass': return 'Free passes never earn Banana Zone spins.';
    case 'pre_launch': return 'This pass was bought before Banana Zone started.';
    case 'first_purchase': return 'This pass came with the First Purchase promo.';
    case 'granted': return 'This pass came from the wheel or a grant, not a purchase.';
    case 'transferred': return 'This pass was bought by a different wallet.';
    case 'no_purchase_record': return 'This pass has no purchase on record.';
    default: return 'This pass is not Banana Zone eligible.';
  }
}
