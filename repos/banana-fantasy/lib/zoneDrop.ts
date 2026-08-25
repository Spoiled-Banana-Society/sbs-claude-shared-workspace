/**
 * ZONE PACKS — JackHOF seats hidden in Banana Zone packs (Richard 2026-08-23).
 *
 * Replaces THE DROP (final night 2026-08-23, see lib/dropRates
 * DROP_FINAL_NIGHT_ID). Every PAID seat in a draft that fills inside the
 * Banana Zone earns one sealed pack. Each batch of packs hides a fixed
 * number of JackHOF seats. Richard's final numbers (8/23):
 *
 *   drafts 1–25  → 6 JackHOF seats      (zone tier 1 · Buy 1 Get 1 Spin)
 *   drafts 26–50 → 4 JackHOF seats      (zone tier 2 · Buy 2 Get 1 Spin)
 *
 * 10 per window — one full JackHOF league. Descending, never flat: join
 * rates are FLAT across the zone, so the gradient isn't a toughness wage —
 * it's what makes waiting always lose, mirroring the BOGO ladder. Band
 * bounds come from the LIVE zone tier config (green light re-tiers it to
 * 25/50/50 — the collapsed third tier produces no band). Band membership =
 * the draft's REAL fill position (fillPositionForDraft), same anchor as the
 * zone spin tiers.
 *
 * A band LOCKS when its last draft fills (or early, when the Jackpot hits and
 * resets the window — the live band resolves with the packs it has, so a hit
 * never voids anyone's seats; unborn bands simply never exist). Lock assigns
 * the seats from randomness committed before the band's first pack (same
 * sealed-seed scheme as THE DROP), and packs are openable the INSTANT the
 * batch is done — Richard killed the 9pm wait (8/23). There is no /drop
 * destination either: people earn, watch, and rip their packs INSIDE the
 * Banana Zone promo (card + modal), and the old page redirects there.
 * "Golden Tickets" as a name is DEAD (Richard 8/23: call them what they
 * are) — user-facing copy says JackHOF seats, hidden in packs.
 *
 * SHIPS FULLY DARK: NOTHING runs — not even earning — until
 * `system_config/zoneDrop.enabled` (flip with scripts/_zone-drop-toggle.mjs
 * after Richard's green light). Earning is deliberately NOT accrued while
 * dark, unlike THE DROP: the band map depends on the zone tier config, and
 * Richard re-tiered the design mid-build — packs banked under a stale tier
 * map would land in the wrong bands. Green-light order instead:
 * re-tier the zone (25/50/50) → flip this switch → run
 * scripts/_zone-drop-backfill.mjs --execute, which credits the whole current
 * window from the fill events under the final tiers. Idempotent against the
 * live webhook, so the ordering has no gap and no double-credit.
 *
 * ⚠️ Cost math includes bots: bots earn packs and can win seats (standing
 * rules — see feedback_promo_odds_math_must_include_bots). A batch of 25
 * drafts ≈ 250 paid seats ≈ 250 packs, roughly half bots on the plateau.
 *
 * ── INSTANT MODE (Richard 2026-08-25) ──────────────────────────────────────
 * "I want people to open the packs right when it fills so they don't have to
 * wait." Bands created while `system_config/zoneDrop.instant` is on deal
 * DRAFT BY DRAFT instead of at the batch lock:
 *
 *   • When the band is born, the seed picks WHICH DRAFT POSITIONS carry the
 *     band's seats (`seatPositions`, distinct, sealed — derived from the
 *     period's committed salt + VRF, verifiable after the period reveals).
 *   • Each fill resolves its own draft (resolveZoneDraft): if the position
 *     holds a seat, the seed picks which of THAT draft's packs gets it; every
 *     other pack in the draft is stamped empty. Packs are openable the moment
 *     their draft is dealt — seconds after the fill, no batch wait.
 *   • Jackpot hits early → every seat still hidden lands in the packs of the
 *     draft that hit (Richard's ELI5 8/25: "draft 7 hits, the 2 leftover
 *     seats go into 2 of its 10 packs; drafts 1 to 6 are untouched"). The
 *     later band, never born, never exists — same as batch mode.
 *   • A seat whose draft has no paid packs (or more seats than packs at the
 *     hit) ROLLS to the next draft instead of vanishing — never voids.
 *   • The header / card print SEATS LEFT (tickets − dealt) via
 *     `config.liveSeats`, stamped at every deal so the stream needs no band
 *     read. Yes, the dead stretch is visible once every seat has landed —
 *     Richard chose the instant rip over the sealed batch (8/25).
 *
 * Richard's numbers for this mode: zone 1 to 30 (Buy 1 Get 1 Spin, 3 seats)
 * + 31 to 60 (Buy 2 Get 1 Spin, 7 seats). Still 10 per window. The change
 * is STAGED (`config.next`) and applies itself at the first fill of the next
 * window (scripts/_zone-drop-stage-next.mjs) — re-tiering mid-window would
 * remap the live batch band. Existing batch-mode bands keep batch semantics
 * to the end; the mode is stamped on the band doc, never inferred.
 */

import crypto from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { getSealedDrawSeed } from '@/lib/jackpotDrawProof';
import { assignGoldenTickets, type PackRef, type Prize } from '@/lib/dropMath';
import { nightSeedDigest } from '@/lib/drop';
import { readBonusZoneConfig, readBonusZoneView, type BonusZoneConfig } from '@/lib/bonusZone';

const BANDS = 'zone_drop_bands';
const PACKS = 'packs';
const USERS = 'v2_users';
const LEDGER = 'zoneDropLedger';
const CONFIG_DOC = 'zoneDrop';
const CONFIG_TTL_MS = 20_000;

/** JackHOF seats per batch — the BATCH-mode default (Richard 8/23: zone =
 *  1–25 and 26–50, SIX in the first band, FOUR in the second, 10 per window).
 *  `config.seatsByBand` overrides it (instant mode ships 3 + 7 over 30/60,
 *  Richard 8/25). A third tier, if config ever brings one back, carries no
 *  tickets and produces no band. */
export const TICKETS_BY_BAND = [6, 4, 0] as const;

/** Instant-mode default: how hard the seat positions lean toward the END of
 *  each batch (Richard 8/25: "snowball to the end of the batches naturally").
 *  0 = flat, 1 = linear (last third of a band holds ~56% of its seats), 2 =
 *  quadratic (~70%). Nothing is faked: the sealed seed still decides, only
 *  the weighting of the positions changes. ⚠️ NOT stated anywhere
 *  user-facing (Richard 8/25: "no we're hiding it"). */
export const SEAT_RAMP_DEFAULT = 1;

// ── Switch ──────────────────────────────────────────────────────────────────

/** A tier + seat change waiting for the next window (never applied mid-window). */
export interface StagedZoneConfig {
  instant: boolean;
  seatsByBand: number[];
  /** [tier1Through, tier2Through, tier3Through] written to system_config/bonusZone. */
  tiers: [number, number, number];
  seatRamp: number;
  /** The window live when it was staged — applies once windowStart moves past it. */
  stagedWindowStart: number;
  stagedAtIso: string;
}

export interface ZoneDropConfig {
  enabled: boolean;
  /** Stamped by the toggle script on the first flip to ON. */
  sinceIso: string | null;
  /** Bands born from now on deal draft by draft (see module header). */
  instant: boolean;
  seatsByBand: readonly number[];
  seatRamp: number;
  next: StagedZoneConfig | null;
  /** Stamped at every instant-mode deal — the header's "N SEATS LEFT" reads
   *  this off the cached config instead of hitting the band doc per tick. */
  liveSeats: { windowStart: number; band: number; dealt: number; tickets: number } | null;
}

let cfgCache: { at: number; cfg: ZoneDropConfig } | null = null;

/** Env override for emergencies: ZONE_DROP=1 forces ON, =0 forces OFF. */
function envOverride(): boolean | null {
  const v = process.env.ZONE_DROP;
  if (v === '1') return true;
  if (v === '0') return false;
  return null;
}

const isSeatList = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length > 0 && v.every((n) => Number.isInteger(n) && n >= 0);

export async function readZoneDropConfig(opts: { fresh?: boolean } = {}): Promise<ZoneDropConfig> {
  const now = Date.now();
  if (!opts.fresh && cfgCache && now - cfgCache.at < CONFIG_TTL_MS) return cfgCache.cfg;
  const cfg: ZoneDropConfig = {
    enabled: false, sinceIso: null, instant: false, seatsByBand: TICKETS_BY_BAND,
    seatRamp: SEAT_RAMP_DEFAULT, next: null, liveSeats: null,
  };
  if (isFirestoreConfigured()) {
    try {
      const snap = await getAdminFirestore().collection('system_config').doc(CONFIG_DOC).get();
      const d = (snap.exists ? snap.data() : null) as Partial<ZoneDropConfig> | null;
      if (d) {
        if (typeof d.enabled === 'boolean') cfg.enabled = d.enabled;
        if (typeof d.sinceIso === 'string' && d.sinceIso) cfg.sinceIso = d.sinceIso;
        if (typeof d.instant === 'boolean') cfg.instant = d.instant;
        if (isSeatList(d.seatsByBand)) cfg.seatsByBand = [...d.seatsByBand, 0, 0].slice(0, 3);
        if (typeof d.seatRamp === 'number' && d.seatRamp >= 0) cfg.seatRamp = d.seatRamp;
        if (d.next && typeof d.next === 'object' && isSeatList(d.next.seatsByBand) && Array.isArray(d.next.tiers)) {
          cfg.next = {
            instant: d.next.instant === true,
            seatsByBand: [...d.next.seatsByBand, 0, 0].slice(0, 3),
            tiers: [Number(d.next.tiers[0]), Number(d.next.tiers[1]), Number(d.next.tiers[2] ?? d.next.tiers[1])],
            seatRamp: typeof d.next.seatRamp === 'number' ? d.next.seatRamp : SEAT_RAMP_DEFAULT,
            stagedWindowStart: Number(d.next.stagedWindowStart) || 0,
            stagedAtIso: String(d.next.stagedAtIso ?? ''),
          };
        }
        if (d.liveSeats && typeof d.liveSeats === 'object' && typeof d.liveSeats.windowStart === 'number') {
          cfg.liveSeats = {
            windowStart: d.liveSeats.windowStart, band: Number(d.liveSeats.band) || 0,
            dealt: Number(d.liveSeats.dealt) || 0, tickets: Number(d.liveSeats.tickets) || 0,
          };
        }
      }
    } catch (err) {
      logger.warn('zone_drop.config_read_failed', { err: (err as Error).message });
    }
  }
  const ov = envOverride();
  if (ov !== null) cfg.enabled = ov;
  cfgCache = { at: now, cfg };
  return cfg;
}

/** Does the staged change apply for this window? Pure — the window must have
 *  MOVED PAST the one it was staged in (a hit since), never the same window. */
export function stagedApplies(next: StagedZoneConfig | null, windowStart: number): boolean {
  return !!next && windowStart > 0 && windowStart > next.stagedWindowStart;
}

/**
 * Apply the staged tiers + seats + mode once a new window has started. Called
 * from the fill webhook BEFORE the first award of the window (so draft 1's
 * band is born under the new rules) and from the cron tick as backstop.
 * Transactional on the config doc so two instances can't both apply.
 */
export async function applyStagedZoneConfig(windowStart: number): Promise<boolean> {
  if (!isFirestoreConfigured()) return false;
  const cfg = await readZoneDropConfig({ fresh: true });
  if (!stagedApplies(cfg.next, windowStart)) return false;
  const db = getAdminFirestore();
  const zdRef = db.collection('system_config').doc(CONFIG_DOC);
  const bzRef = db.collection('system_config').doc('bonusZone');
  let applied = false;
  await db.runTransaction(async (tx) => {
    const fresh = (await tx.get(zdRef)).data() as { next?: StagedZoneConfig } | undefined;
    const next = fresh?.next;
    if (!next || !(windowStart > Number(next.stagedWindowStart))) return;
    const nowIso = new Date().toISOString();
    tx.set(bzRef, {
      tier1Through: next.tiers[0], tier2Through: next.tiers[1], tier3Through: next.tiers[2] ?? next.tiers[1],
      updatedAtIso: nowIso,
    }, { merge: true });
    tx.set(zdRef, {
      instant: next.instant === true,
      seatsByBand: next.seatsByBand,
      seatRamp: typeof next.seatRamp === 'number' ? next.seatRamp : SEAT_RAMP_DEFAULT,
      next: FieldValue.delete(),
      liveSeats: FieldValue.delete(),
      appliedAtIso: nowIso,
      appliedWindowStart: windowStart,
      applied: FieldValue.arrayUnion({ at: nowIso, windowStart, tiers: next.tiers, seatsByBand: next.seatsByBand, instant: next.instant === true }),
    }, { merge: true });
    applied = true;
  });
  if (applied) {
    cfgCache = null;
    await readBonusZoneConfig({ fresh: true }).catch(() => undefined);
    logger.info('zone_drop.staged_config_applied', { windowStart });
  }
  return applied;
}

// ── Bands ───────────────────────────────────────────────────────────────────

export interface BandSpec {
  band: 1 | 2 | 3;
  fromPos: number;
  toPos: number;
  tickets: number;
}

/** The ticket bands, derived from the LIVE zone tier config so a tier resize
 *  moves them with it — the two ladders can never drift. Zero-ticket or
 *  zero-width bands (e.g. the collapsed third tier under the 25/50 config)
 *  simply don't exist. */
export function bandSpecs(cfg: BonusZoneConfig, seats: readonly number[] = TICKETS_BY_BAND): BandSpec[] {
  return ([
    { band: 1 as const, fromPos: 1, toPos: cfg.tier1Through, tickets: seats[0] ?? 0 },
    { band: 2 as const, fromPos: cfg.tier1Through + 1, toPos: cfg.tier2Through, tickets: seats[1] ?? 0 },
    { band: 3 as const, fromPos: cfg.tier2Through + 1, toPos: cfg.tier3Through, tickets: seats[2] ?? 0 },
  ]).filter((b) => b.tickets > 0 && b.toPos >= b.fromPos);
}

/** Seats hidden in the packs of the given zone tier (null = no band / closed).
 *  Header pill + phone strip print this next to the deal (Richard 8/24). */
export function packSeatsForTier(tier: 1 | 2 | 3 | null, cfg: BonusZoneConfig, seats: readonly number[] = TICKETS_BY_BAND): number | null {
  if (!tier) return null;
  return bandSpecs(cfg, seats).find((b) => b.band === tier)?.tickets ?? null;
}

/**
 * INSTANT mode: seats STILL HIDDEN in the live tier's drafts ahead — what the
 * header counts down (Richard 8/25). Reads the deal counter the resolver
 * stamps on the config doc, so the stream pays no band read. Null in batch
 * mode (the pill prints the plain total there) or when the tier has no band.
 */
export function packSeatsLeftForTier(
  tier: 1 | 2 | 3 | null, windowStart: number, cfg: BonusZoneConfig, zd: ZoneDropConfig,
): number | null {
  if (!tier || !zd.instant) return null;
  const total = packSeatsForTier(tier, cfg, zd.seatsByBand);
  if (total === null) return null;
  const live = zd.liveSeats;
  if (live && live.windowStart === windowStart && live.band === tier) return Math.max(0, live.tickets - live.dealt);
  return total;
}

export function bandForPosition(position: number, cfg: BonusZoneConfig, seats: readonly number[] = TICKETS_BY_BAND): BandSpec | null {
  return bandSpecs(cfg, seats).find((b) => position >= b.fromPos && position <= b.toPos) ?? null;
}

// ── Instant-mode pure math (unit-tested) ────────────────────────────────────

/**
 * Which draft positions of a band carry its seats — decided once, when the
 * band is born, from the sealed seed. Distinct positions (one seat per draft
 * at most, so "a seat is in the next N drafts" always means N chances).
 * `ramp` leans the draw toward the END of the band: weight(p) = (p − from +
 * 1)^ramp. Deterministic: hashing (seed, bandId, i) → uniform → inverse CDF
 * over the still-unused positions; anyone with the revealed seed recomputes
 * the same list. Capped at the band width.
 */
export function sealedSeatPositions(
  seedHex: string, bandId: string, fromPos: number, toPos: number, seats: number, ramp: number = SEAT_RAMP_DEFAULT,
): number[] {
  const width = Math.max(0, toPos - fromPos + 1);
  const want = Math.min(Math.max(0, Math.floor(seats)), width);
  const seed = seedHex.replace(/^0x/, '');
  const chosen: number[] = [];
  for (let i = 0; chosen.length < want && i < 10_000; i++) {
    const pool = Array.from({ length: width }, (_, k) => fromPos + k).filter((p) => !chosen.includes(p));
    const weights = pool.map((p) => Math.pow(p - fromPos + 1, ramp));
    const total = weights.reduce((s, w) => s + w, 0);
    const h = crypto.createHash('sha256').update(`${seed}:zone-seat:${bandId}:${i}`).digest();
    const u = h.readUInt32BE(0) / 0x1_0000_0000; // [0, 1)
    let acc = 0;
    let pick = pool[pool.length - 1];
    for (let k = 0; k < pool.length; k++) {
      acc += weights[k] / total;
      if (u < acc) { pick = pool[k]; break; }
    }
    chosen.push(pick);
  }
  return chosen.sort((a, b) => a - b);
}

export interface InstantBandState {
  seatPositions: number[];
  /** Positions already dealt (key = String(position)). */
  resolved: Record<string, { seats: number }>;
  /** Seat positions whose seat was pulled forward into the hit draft. */
  absorbedPositions: number[];
  /** Seats carried forward because their draft had no packs for them. */
  rollover: number;
}

/**
 * How many seats this draft deals. Its own sealed seat (if any, once) + any
 * rollover + — on the draft that HIT the Jackpot — every seat still hidden
 * in the band. Pure; the resolver caps at the draft's pack count and rolls
 * the overflow forward.
 */
export function seatsToDealAt(band: InstantBandState, position: number, isHit: boolean): { seats: number; absorbs: number[] } {
  if (band.resolved[String(position)]) return { seats: 0, absorbs: [] };
  const landed = (p: number) => !!band.resolved[String(p)] || band.absorbedPositions.includes(p);
  const own = band.seatPositions.includes(position) && !band.absorbedPositions.includes(position) ? 1 : 0;
  const absorbs = isHit ? band.seatPositions.filter((p) => p !== position && !landed(p)) : [];
  return { seats: own + absorbs.length + Math.max(0, band.rollover), absorbs };
}

export function bandIdFor(windowStart: number, band: number): string {
  return `${windowStart}__b${band}`;
}

/**
 * The zone card's modal rules while ZONE PACKS is live — built from the LIVE
 * tier config so the copy can never drift from what the batches actually
 * pay. /api/promos overlays this at read time only while the switch is on;
 * the seeded pre-packs copy stays untouched for the dark state.
 * Copy rule: no dashes ("1 to 25", never "1–25").
 */
export function zonePackRulesExplanation(cfg: BonusZoneConfig, zd?: Pick<ZoneDropConfig, 'instant' | 'seatsByBand' | 'seatRamp'>): string {
  const specs = bandSpecs(cfg, zd?.seatsByBand ?? TICKETS_BY_BAND);
  const spinLine = (band: number, from: number, to: number) =>
    `• Drafts ${from} to ${to}: Buy ${band} Get 1 Spin. Every paid draft you enter earns ${band === 1 ? 'a Free Spin' : band === 2 ? 'half a Free Spin' : 'a third of a Free Spin'} when it fills.`;
  const seatLines = specs.map((s) =>
    `• The packs from drafts ${s.fromPos} to ${s.toPos} hide ${s.tickets} JACKHOF SEATS.`);
  const zoneEnd = specs[specs.length - 1]?.toPos ?? cfg.tier2Through;
  if (zd?.instant) {
    // INSTANT copy (Richard 8/25): open at fill, seats land draft by draft,
    // the counter shows what is still hidden, an early hit dumps the rest
    // into the hitting draft. Plain words, no dashes.
    const total = specs.reduce((n, s) => n + s.tickets, 0);
    const seatSentence = specs.length === 2
      ? `• ${specs[0].tickets} JackHOF seats are hidden in drafts ${specs[0].fromPos} to ${specs[0].toPos}. ${specs[1].tickets} more are hidden in drafts ${specs[1].fromPos} to ${specs[1].toPos}. That is ${total} seats every window, one full JackHOF league.`
      : seatLines.join('\n');
    // ⚠️ The end-of-batch lean (seatRamp) is deliberately NOT mentioned
    // anywhere user-facing (Richard 8/25: "no we're hiding it").
    return 'THE BANANA ZONE\n'
      + `• The Jackpot window counts up from 1 after every Jackpot hit. The Banana Zone is the first ${zoneEnd} drafts of every window.\n`
      + specs.map((s) => spinLine(s.band, s.fromPos, s.toPos)).join('\n') + '\n'
      + '• Halves add up inside the same window. The moment they make a whole spin, you get it. Leftovers are lost when the Jackpot hits.\n'
      + `• Draft ${zoneEnd + 1} and up: no bonus. The Jackpot odds sell themselves from here.\n`
      + '\n'
      + '📦 PACKS AND JACKHOF SEATS\n'
      + '• Fill a paid draft in the zone and you get 1 pack. It opens right here, the moment the draft fills. No waiting.\n'
      + seatSentence + '\n'
      + '• Every pack can hold a JackHOF seat. The counter shows how many seats have been found so far and how many are still hidden in the drafts ahead.\n'
      + '• Which drafts hold a seat was decided before the window began, from randomness committed on chain. Nobody knows which drafts they are until they fill. When one of them fills, the seat lands in one of its packs.\n'
      + '• More paid drafts = more packs = more shots at a seat.\n'
      + '• Jackpot hits early? Every seat still hidden lands in the packs of the draft that hit. A hit never voids a seat.\n'
      + '• Packs never expire.\n'
      + '\n'
      + '• Your tier is set by the position the draft FILLS at, not where you enter. Leave the lobby and nothing pays.\n'
      + '• Paid passes only. Free passes earn no spins and no packs. Passes bought with the First Purchase promo do not count.\n'
      + '• Fast and slow drafts both count. Wheel drafts and private leagues do not.';
  }
  return 'THE BANANA ZONE\n'
    + `• The Jackpot window counts up from 1 after every Jackpot hit. The Banana Zone is the first ${zoneEnd} drafts of every window.\n`
    + specs.map((s) => spinLine(s.band, s.fromPos, s.toPos)).join('\n') + '\n'
    + '• Halves add up inside the same window. The moment they make a whole spin, you get it. Leftovers are lost when the Jackpot hits.\n'
    + `• Draft ${zoneEnd + 1} and up: no bonus. The Jackpot odds sell themselves from here.\n`
    + '\n'
    + '📦 PACKS\n'
    + '• Every paid draft that fills in the zone also earns 1 sealed pack. Open your packs right here on this card.\n'
    + seatLines.join('\n') + '\n'
    + `• Packs unlock the moment their batch is done, OR the moment the Jackpot hits, whichever comes first. Draft ${specs[0]?.toPos ?? 25} fills and the first batch opens; draft ${zoneEnd} fills and the second opens. No set times.\n`
    + '• Jackpot hits early? The live batch opens right then with the packs it has, all its seats still inside. A hit never voids anything.\n'
    + '• Seats are dealt from randomness committed before the batch began. Opening only reveals what was already decided.\n'
    + '• Sealed packs never expire.\n'
    + '\n'
    + '• Your tier is set by the position the draft FILLS at, not where you enter. Leave the lobby and nothing pays.\n'
    + '• Paid passes only. Free passes earn no spins and no packs. Passes bought with the First Purchase promo do not count.\n'
    + '• Fast and slow drafts both count. Wheel drafts and private leagues do not.';
}

export interface BandDoc {
  bandId: string;
  windowStart: number;
  band: 1 | 2 | 3;
  fromPos: number;
  toPos: number;
  tickets: number;
  status: 'earning' | 'locked';
  packCount?: number;
  /** Sealed-randomness commitment, stamped before the first pack exists. */
  saltHash?: string;
  periodNumber?: number;
  lockedAt?: string;
  lockReason?: 'band-complete' | 'window-reset' | 'manual';
  seedDigest?: string;
  /** The lock instant — packs are openable from this moment (no 9pm gate). */
  revealAtMs?: number;
  winners?: Array<{ packId: string; userId: string }>;
  /** 'instant' bands deal draft by draft (module header). Absent = batch. */
  mode?: 'batch' | 'instant';
  /** Instant: the sealed positions that carry this band's seats. Server-only. */
  seatPositions?: number[];
  seedSource?: 'period' | 'fallback-random';
  seatRamp?: number;
  /** Instant: per-position deal record. */
  resolved?: Record<string, { draftId: string; seats: number; at: string; hit?: boolean }>;
  absorbedPositions?: number[];
  rollover?: number;
  seatsDealt?: number;
  /** Instant orphan handling: first tick that saw the window move on. */
  hitNoticedAtIso?: string;
}

export interface ZonePackDoc {
  packId: string;
  userId: string;
  bandId: string;
  windowStart: number;
  band: number;
  /** Draft that earned it. */
  source: string;
  position: number;
  passType: 'paid';
  earnedAt: string;
  prize: Prize | null;
  opened: boolean;
  openedAt?: string;
  /** Earned after its batch had already dealt — always empty by construction. */
  lateAfterLock?: boolean;
  /** Instant: the Jackpot-hit draft's packs stay sealed until the hit itself
   *  is revealed on the lane (never front-run a reveal). */
  openableAtMs?: number;
}

/** Per-pack openability — one rule for the API, the room and the badge. */
export function packOpenable(band: Pick<BandDoc, 'mode' | 'status' | 'revealAtMs'>, pack: Pick<ZonePackDoc, 'prize' | 'opened' | 'openableAtMs'>, nowMs = Date.now()): boolean {
  if (pack.opened) return false;
  if (band.mode === 'instant') {
    return pack.prize !== null && pack.prize !== undefined && (typeof pack.openableAtMs !== 'number' || nowMs >= pack.openableAtMs);
  }
  return band.status === 'locked' && (typeof band.revealAtMs !== 'number' || nowMs >= band.revealAtMs);
}

/** Create the band doc on first use, stamping the sealed-seed commitment
 *  BEFORE any pack exists in it. Idempotent (create-or-exists, so two
 *  concurrent first fills can't stamp two different seat lists). Instant
 *  bands also draw their sealed seat positions here. */
async function ensureBand(windowStart: number, spec: BandSpec, zd: ZoneDropConfig): Promise<string> {
  const bandId = bandIdFor(windowStart, spec.band);
  const ref = getAdminFirestore().collection(BANDS).doc(bandId);
  if ((await ref.get()).exists) return bandId;
  const seed = await getSealedDrawSeed();
  const doc: BandDoc = {
    bandId, windowStart, band: spec.band,
    fromPos: spec.fromPos, toPos: spec.toPos, tickets: spec.tickets,
    status: 'earning',
    mode: zd.instant ? 'instant' : 'batch',
    ...(seed ? { saltHash: seed.saltHash, periodNumber: seed.periodNumber } : {}),
  };
  if (zd.instant) {
    // No sealed period → still deal (never block a live fill), but from
    // process randomness and say so on the doc. Same "never predictable"
    // bar, just not publicly recomputable for this band.
    const seedHex = seed ? nightSeedDigest(seed, bandId) : crypto.randomBytes(32).toString('hex');
    doc.seedDigest = seedHex;
    doc.seedSource = seed ? 'period' : 'fallback-random';
    doc.seatRamp = zd.seatRamp;
    doc.seatPositions = sealedSeatPositions(seedHex, bandId, spec.fromPos, spec.toPos, spec.tickets, zd.seatRamp);
    doc.resolved = {};
    doc.absorbedPositions = [];
    doc.rollover = 0;
    doc.seatsDealt = 0;
    if (!seed) logger.warn('zone_drop.instant_band_fallback_seed', { bandId });
  }
  try {
    await ref.create(doc);
    if (zd.instant) logger.info('zone_drop.instant_band_born', { bandId, tickets: spec.tickets, seedSource: doc.seedSource });
  } catch (err) {
    if ((err as { code?: number }).code !== 6) throw err; // 6 = ALREADY_EXISTS — lost the race, fine
  }
  return bandId;
}

// ── Earning ─────────────────────────────────────────────────────────────────

/**
 * Award one zone pack for a PAID seat in a zone fill.
 *
 * Called from the draft-filled webhook only (entry is refundable → farmable,
 * same stance as every fill-credited promo). Idempotent per (band, user,
 * draft) via the user's zoneDropLedger. Fully switch-gated — while dark the
 * band map isn't final, so nothing may bank (see the module header); the
 * green-light backfill covers the window retroactively.
 */
export async function awardGoldenPacksForFill(opts: {
  userId: string;
  draftId: string;
  passType: 'free' | 'paid';
  position: number;
  windowStart: number;
  nowMs?: number;
  /** Bell on LIVE fills only — backfills pass false. Only rings while ON. */
  notify?: boolean;
}): Promise<{ awarded: number; bandId: string | null }> {
  if (!isFirestoreConfigured()) return { awarded: 0, bandId: null };
  if (opts.passType !== 'paid') return { awarded: 0, bandId: null };
  const zd = await readZoneDropConfig();
  if (!zd.enabled) return { awarded: 0, bandId: null };
  const zoneCfg = await readBonusZoneConfig();
  const spec = bandForPosition(opts.position, zoneCfg, zd.seatsByBand);
  if (!spec) return { awarded: 0, bandId: null };

  const userId = opts.userId.toLowerCase();
  const nowMs = opts.nowMs ?? Date.now();
  const bandId = await ensureBand(opts.windowStart, spec, zd);
  const db = getAdminFirestore();
  const bandRef = db.collection(BANDS).doc(bandId);

  const dedupeId = `${bandId}__${userId}__${opts.draftId}`.replace(/[/\\\s]+/g, '_').slice(0, 1400);
  const ledgerRef = db.collection(USERS).doc(userId).collection(LEDGER).doc(dedupeId);
  const packId = dedupeId;

  let instantBand = false;
  try {
    await db.runTransaction(async (tx) => {
      if ((await tx.get(ledgerRef)).exists) throw new Error('ALREADY_AWARDED');
      // A locked band's seats are already dealt. A fill that lands AFTER the
      // deal (early lock, late webhook) still earns a pack — sealed, rippable,
      // and known-empty (Richard 8/24: "just give them packs, they'll be empty
      // whatever"). Nothing to double-pay; they get the reveal moment.
      // Instant bands: same rule per DRAFT — a pack landing after its draft
      // was already dealt (retried webhook) is empty by construction.
      const bandSnap = await tx.get(bandRef);
      const band = bandSnap.data() as BandDoc | undefined;
      instantBand = band?.mode === 'instant';
      const lateAfterLock = instantBand
        ? (band?.status !== 'earning' || !!band?.resolved?.[String(opts.position)])
        : band?.status !== 'earning';
      tx.set(ledgerRef, {
        userId, bandId, draftId: opts.draftId, position: opts.position,
        windowStart: opts.windowStart, at: new Date(nowMs).toISOString(),
        ...(lateAfterLock ? { lateAfterLock: true } : {}),
      });
      tx.set(bandRef.collection(PACKS).doc(packId), {
        packId, userId, bandId, windowStart: opts.windowStart, band: spec.band,
        source: opts.draftId, position: opts.position, passType: 'paid',
        earnedAt: new Date(nowMs).toISOString(),
        prize: lateAfterLock ? { kind: 'none' } : null, opened: false,
        ...(lateAfterLock ? { lateAfterLock: true } : {}),
      } satisfies ZonePackDoc);
      tx.set(bandRef, { packCount: FieldValue.increment(1) }, { merge: true });
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'ALREADY_AWARDED') return { awarded: 0, bandId };
    logger.error('zone_drop.award_failed', { userId, draftId: opts.draftId, err: msg });
    return { awarded: 0, bandId };
  }

  // Instant bands bell once per DRAFT after the deal ("your pack is ready"),
  // from resolveZoneDraft — not here, where it isn't openable yet.
  if (opts.notify && !instantBand && (await readZoneDropConfig()).enabled) {
    void writePackEarnedNoti(userId, bandId, spec).catch((err) =>
      logger.warn('zone_drop.noti_failed', { userId, err: (err as Error).message }));
  }
  return { awarded: 1, bandId };
}

async function writePackEarnedNoti(userId: string, bandId: string, spec: BandSpec): Promise<void> {
  const db = getAdminFirestore();
  const total = (await db.collection(BANDS).doc(bandId).collection(PACKS)
    .where('userId', '==', userId).count().get()).data().count;
  const docId = `${userId}__zone-drop-earned-${bandId}-${total}`.replace(/[/\\\s]+/g, '_').slice(0, 1400);
  await db.collection('marketplace_notifications').doc(docId).create({
    wallet: userId,
    type: 'promo',
    icon: '🎫',
    title: '📦 Pack earned — Banana Zone',
    message: `Your Banana Zone draft filled and earned a sealed pack. ${spec.tickets} JackHOF seat${spec.tickets === 1 ? '' : 's'} are hiding in the packs from drafts ${spec.fromPos} to ${spec.toPos}. You hold ${total} pack${total === 1 ? '' : 's'} in this batch. Packs open the moment draft ${spec.toPos} fills, or instantly if the Jackpot hits first.`,
    link: '/promos?promo=bonus-zone',
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  }).catch((err: { code?: number }) => {
    if (err?.code === 6) return; // retried webhook — already written
    throw err;
  });
}

// ── Locking ─────────────────────────────────────────────────────────────────

/**
 * Lock a batch and deal its JackHOF seats. Runs when the batch's last draft
 * fills, or early on a window reset (Jackpot hit) — the band resolves with
 * whatever packs it has, tickets capped at the pack count so a two-pack band
 * can't deal three seats. Packs are openable immediately after the lock.
 */
export async function lockZoneBand(bandId: string, opts: {
  reason: BandDoc['lockReason'];
  nowMs?: number;
} ): Promise<{ ok: boolean; reason?: string; winners?: number }> {
  if (!isFirestoreConfigured()) return { ok: false, reason: 'no-firestore' };
  const nowMs = opts.nowMs ?? Date.now();
  const db = getAdminFirestore();
  const bandRef = db.collection(BANDS).doc(bandId);
  const snap = await bandRef.get();
  if (!snap.exists) return { ok: false, reason: 'no-band' };
  const band = snap.data() as BandDoc;
  if (band.status !== 'earning') return { ok: true, reason: 'already-locked' };
  // Instant bands never batch-deal: their seats already landed draft by
  // draft. "Lock" there = deal whatever is still undealt, then close.
  if (band.mode === 'instant') return finalizeInstantBand(bandId, opts.reason ?? 'manual', nowMs);

  // Same stance as THE DROP: no sealed randomness, no assignment — retry on
  // the next tick rather than fall back to anything predictable.
  const seed = await getSealedDrawSeed();
  if (!seed) return { ok: false, reason: 'no-sealed-seed' };
  const seedHex = nightSeedDigest(seed, bandId);

  const packSnap = await bandRef.collection(PACKS).get();
  const refs: PackRef[] = packSnap.docs.map((d) => {
    const p = d.data() as ZonePackDoc;
    return { packId: p.packId, userId: p.userId };
  });
  if (refs.length === 0) {
    // A band doc only exists once a pack landed, so this is a repair path.
    await bandRef.set({ status: 'locked', lockedAt: new Date(nowMs).toISOString(), lockReason: opts.reason, seedDigest: seedHex, packCount: 0, winners: [] }, { merge: true });
    return { ok: true, reason: 'no-packs', winners: 0 };
  }

  const tickets = Math.min(band.tickets, refs.length);
  const assignments = assignGoldenTickets(refs, seedHex, bandId, tickets);
  const winners = assignments.filter((a) => a.prize.kind === 'jackhof')
    .map((a) => ({ packId: a.packId, userId: a.userId }));
  // Packs open the INSTANT the batch is done (Richard 8/23: no 9pm wait —
  // "they unlock when the batch is done"). revealAtMs kept as the lock
  // instant so the open gate and winner exposure share one timestamp.
  const revealAtMs = nowMs;

  try {
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(bandRef);
      if ((fresh.data() as BandDoc | undefined)?.status !== 'earning') throw new Error('ALREADY_LOCKED');
      tx.set(bandRef, {
        status: 'locked',
        lockedAt: new Date(nowMs).toISOString(),
        lockReason: opts.reason,
        seedDigest: seedHex,
        packCount: refs.length,
        revealAtMs,
        winners,
      }, { merge: true });
    });
  } catch (err) {
    if ((err as Error).message === 'ALREADY_LOCKED') return { ok: true, reason: 'already-locked' };
    throw err;
  }

  const CHUNK = 400;
  for (let i = 0; i < assignments.length; i += CHUNK) {
    const batch = db.batch();
    for (const a of assignments.slice(i, i + CHUNK)) {
      batch.set(bandRef.collection(PACKS).doc(a.packId), { prize: a.prize }, { merge: true });
    }
    await batch.commit();
  }

  logger.info('zone_drop.band_locked', {
    bandId, reason: opts.reason, packCount: refs.length, tickets,
    winners: winners.map((w) => w.userId),
  });

  // One neutral bell per holder — never winners-only (the bell must not spoil
  // the reveal; Boris 2026-08-02, same rule as THE DROP's 8pm ping).
  void notifyBandLocked(bandId, band, refs).catch((err) =>
    logger.warn('zone_drop.lock_noti_failed', { bandId, err: (err as Error).message }));

  return { ok: true, winners: winners.length };
}

async function notifyBandLocked(bandId: string, band: BandDoc, refs: PackRef[]): Promise<void> {
  if (!(await readZoneDropConfig()).enabled) return;
  const db = getAdminFirestore();
  const holders = [...new Set(refs.map((r) => r.userId))];
  await Promise.allSettled(holders.map((w) => {
    const docId = `${w}__zone-drop-locked-${bandId}`.replace(/[/\\\s]+/g, '_').slice(0, 1400);
    return db.collection('marketplace_notifications').doc(docId).create({
      wallet: w,
      type: 'promo',
      icon: '📦',
      title: '📦 Your packs are ready',
      message: `Drafts ${band.fromPos} to ${band.toPos} are done. ${band.tickets} JackHOF seat${band.tickets === 1 ? '' : 's'} are sealed in this batch's packs and yours open RIGHT NOW. Rip them.`,
      link: '/promos?promo=bonus-zone',
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    }).catch((err: { code?: number }) => {
      if (err?.code === 6) return;
      throw err;
    });
  }));
}

/** Lock every band of `windowStart` whose last draft has filled. Fired from
 *  the fill webhook after the zone settles; switch-gated so nothing can be
 *  won while dark. */
export async function maybeLockDueBands(windowStart: number, position: number): Promise<void> {
  const zd = await readZoneDropConfig();
  if (!zd.enabled) return;
  const zoneCfg = await readBonusZoneConfig();
  for (const spec of bandSpecs(zoneCfg, zd.seatsByBand)) {
    if (position < spec.toPos) continue;
    const bandId = bandIdFor(windowStart, spec.band);
    const snap = await getAdminFirestore().collection(BANDS).doc(bandId).get();
    if (!snap.exists || (snap.data() as BandDoc).status !== 'earning') continue;
    await lockZoneBand(bandId, { reason: 'band-complete' })
      .catch((err) => logger.error('zone_drop.lock_failed', { bandId, err: (err as Error).message }));
  }
}

/**
 * Cron backstop (piggybacks THE DROP's tick): locks due bands the webhook
 * missed, and resolves ORPHAN bands — a Jackpot hit resets the window, and
 * any band of a previous window still earning locks immediately with the
 * packs it has (a hit must never void anyone's tickets — Richard 8/23).
 */
export async function zoneDropTick(): Promise<Record<string, unknown>> {
  const cfg = await readZoneDropConfig();
  if (!cfg.enabled || !isFirestoreConfigured()) return { enabled: cfg.enabled };
  const out: Record<string, unknown> = { enabled: true };
  try {
    const view = await readBonusZoneView();
    const windowStart = (view as { windowStart?: number }).windowStart;
    // ⚠️ view.position is the NEXT draft's position (the header's "1 left"
    // number), NOT the last filled one. Passing it straight through locked
    // batch 1 of window #867 one draft early (at 24 fills, 8/24 4:16pm) and
    // left draft #891's players packless. Lock on the last FILLED position.
    const nextPosition = (view as { position?: number }).position ?? 0;
    const lastFilled = Math.max(0, nextPosition - 1);
    if (typeof windowStart === 'number' && windowStart > 0) {
      // Staged re-tier/mode change lands with the new window (webhook is the
      // primary applier; this is the backstop).
      if (cfg.next && (await applyStagedZoneConfig(windowStart))) out.stagedApplied = windowStart;
      await maybeLockDueBands(windowStart, lastFilled);
      out.window = { windowStart, lastFilled };
    }
    const earning = await getAdminFirestore().collection(BANDS).where('status', '==', 'earning').get();
    for (const d of earning.docs) {
      const band = d.data() as BandDoc;
      if (typeof windowStart === 'number' && band.windowStart !== windowStart) {
        out[`orphan:${band.bandId}`] = await lockZoneBand(band.bandId, { reason: 'window-reset' });
      } else if (band.mode === 'instant') {
        // Backstop: a draft whose webhook died between award and deal leaves
        // packs with prize null. Deal them (only packs older than 2 minutes,
        // so a fill mid-award isn't dealt with half its packs).
        const dealt = await resolveStrayInstantPacks(band.bandId, false);
        if (dealt.length) out[`stray:${band.bandId}`] = dealt;
      }
    }
  } catch (err) {
    logger.error('zone_drop.tick_failed', { err: (err as Error).message });
    out.error = (err as Error).message;
  }
  return out;
}

// ── Instant mode: deal a draft the moment it fills ──────────────────────────

/** Stamp the deal counter on the config doc so the header's SEATS LEFT reads
 *  off the cached config. Best-effort. */
async function stampLiveSeats(band: BandDoc, dealt: number): Promise<void> {
  await getAdminFirestore().collection('system_config').doc(CONFIG_DOC).set({
    liveSeats: { windowStart: band.windowStart, band: band.band, dealt, tickets: band.tickets, atIso: new Date().toISOString() },
  }, { merge: true }).catch((err) => logger.warn('zone_drop.live_seats_stamp_failed', { err: (err as Error).message }));
  cfgCache = null;
}

/**
 * Deal one draft of an instant band: its packs get their contents NOW and
 * become openable. Idempotent per (band, position). Runs from the fill
 * webhook right after that draft's packs were awarded; the cron backstop
 * re-runs it for anything the webhook missed.
 *
 * `isHit` = this draft is the Jackpot hit that closes the window → every
 * seat still hidden in the band lands here too (capped at the draft's pack
 * count; the overflow, if any, is what "never voids" can't save — logged).
 * `openableAtMs` keeps the hit draft's packs sealed until the hit itself is
 * revealed on the lane.
 */
export async function resolveZoneDraft(opts: {
  windowStart: number;
  position: number;
  draftId: string;
  isHit: boolean;
  openableAtMs?: number | null;
  nowMs?: number;
  notify?: boolean;
}): Promise<{ ok: boolean; reason?: string; seats?: number; winners?: string[]; packs?: number }> {
  if (!isFirestoreConfigured()) return { ok: false, reason: 'no-firestore' };
  const zd = await readZoneDropConfig();
  if (!zd.enabled) return { ok: false, reason: 'not-live' };
  const zoneCfg = await readBonusZoneConfig();
  const spec = bandForPosition(opts.position, zoneCfg, zd.seatsByBand);
  if (!spec) return { ok: false, reason: 'no-band-for-position' };
  const nowMs = opts.nowMs ?? Date.now();
  const db = getAdminFirestore();
  const bandId = bandIdFor(opts.windowStart, spec.band);
  const bandRef = db.collection(BANDS).doc(bandId);

  let dealtSeats = 0;
  let winners: string[] = [];
  let packCount = 0;
  const after: { band: BandDoc | null } = { band: null };
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(bandRef);
      if (!snap.exists) throw new Error('NO_BAND');
      const band = snap.data() as BandDoc;
      if (band.mode !== 'instant') throw new Error('NOT_INSTANT');
      if (band.status !== 'earning') throw new Error('ALREADY_LOCKED');
      const key = String(opts.position);
      if (band.resolved?.[key]) throw new Error('ALREADY_RESOLVED');

      const packSnap = await tx.get(bandRef.collection(PACKS).where('source', '==', opts.draftId));
      const refs: PackRef[] = packSnap.docs
        .map((d) => d.data() as ZonePackDoc)
        .filter((p) => p.prize === null || p.prize === undefined)
        .map((p) => ({ packId: p.packId, userId: p.userId }));
      packCount = refs.length;

      const state: InstantBandState = {
        seatPositions: band.seatPositions ?? [],
        resolved: band.resolved ?? {},
        absorbedPositions: band.absorbedPositions ?? [],
        rollover: band.rollover ?? 0,
      };
      const want = seatsToDealAt(state, opts.position, opts.isHit);
      if (refs.length === 0 && opts.isHit && want.seats > 0) {
        // The hit draft's packs aren't in yet (webhook still awarding, or it
        // died). Don't burn the seats — leave the position unresolved; the
        // orphan finalize retries and, failing that, falls back.
        throw new Error('HIT_NO_PACKS');
      }
      const seats = Math.min(want.seats, refs.length);
      const overflow = want.seats - seats;
      if (!band.seedDigest) throw new Error('NO_SEED');
      const assignments = seats > 0 || refs.length > 0
        ? assignGoldenTickets(refs, band.seedDigest, `${bandId}:p${opts.position}`, seats)
        : [];
      winners = assignments.filter((a) => a.prize.kind === 'jackhof').map((a) => a.userId);
      dealtSeats = seats;

      for (const a of assignments) {
        tx.set(bandRef.collection(PACKS).doc(a.packId), {
          prize: a.prize,
          dealtAt: new Date(nowMs).toISOString(),
          ...(typeof opts.openableAtMs === 'number' && opts.openableAtMs > nowMs ? { openableAtMs: opts.openableAtMs } : {}),
        }, { merge: true });
      }
      const done = opts.isHit || opts.position >= band.toPos;
      // Overflow rolls forward (a later draft deals it); on the hit there is
      // no later draft — it's the one case the rule can't cover.
      const rolloverNext = opts.isHit ? 0 : overflow;
      if (opts.isHit && overflow > 0) logger.error('zone_drop.hit_overflow_lost', { bandId, position: opts.position, overflow });
      const patch: Record<string, unknown> = {
        [`resolved.${key}`]: { draftId: opts.draftId, seats, at: new Date(nowMs).toISOString(), ...(opts.isHit ? { hit: true } : {}), ...(overflow > 0 ? { overflow } : {}) },
        seatsDealt: FieldValue.increment(seats),
        rollover: rolloverNext,
        ...(want.absorbs.length ? { absorbedPositions: FieldValue.arrayUnion(...want.absorbs) } : {}),
        ...(winners.length ? { winners: FieldValue.arrayUnion(...assignments.filter((a) => a.prize.kind === 'jackhof').map((a) => ({ packId: a.packId, userId: a.userId }))) } : {}),
        ...(done ? { status: 'locked', lockedAt: new Date(nowMs).toISOString(), lockReason: opts.isHit ? 'window-reset' : 'band-complete', revealAtMs: nowMs } : {}),
      };
      tx.update(bandRef, patch);
      after.band = { ...band, seatsDealt: (band.seatsDealt ?? 0) + seats };
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (['ALREADY_RESOLVED', 'ALREADY_LOCKED', 'NOT_INSTANT', 'NO_BAND'].includes(msg)) return { ok: true, reason: msg.toLowerCase() };
    if (msg === 'HIT_NO_PACKS') return { ok: false, reason: 'hit-no-packs' };
    logger.error('zone_drop.resolve_failed', { bandId, position: opts.position, draftId: opts.draftId, err: msg });
    return { ok: false, reason: msg };
  }

  logger.info('zone_drop.draft_dealt', {
    bandId, position: opts.position, draftId: opts.draftId, packs: packCount, seats: dealtSeats, hit: opts.isHit, winners,
  });
  const bandAfter = after.band;
  if (bandAfter) await stampLiveSeats(bandAfter, bandAfter.seatsDealt ?? 0);
  if (opts.notify !== false && packCount > 0 && bandAfter) {
    void notifyDraftDealt(bandId, bandAfter, opts).catch((err) =>
      logger.warn('zone_drop.dealt_noti_failed', { bandId, err: (err as Error).message }));
  }
  return { ok: true, seats: dealtSeats, winners, packs: packCount };
}

/** One neutral bell per holder of this draft's packs — never winners-only
 *  (the bell must not spoil the rip; same rule as THE DROP's 8pm ping). */
async function notifyDraftDealt(bandId: string, band: BandDoc, opts: { draftId: string; position: number; isHit: boolean; openableAtMs?: number | null }): Promise<void> {
  if (!(await readZoneDropConfig()).enabled) return;
  const db = getAdminFirestore();
  const packs = await db.collection(BANDS).doc(bandId).collection(PACKS).where('source', '==', opts.draftId).select('userId').get();
  const holders = [...new Set(packs.docs.map((d) => String((d.data() as { userId?: string }).userId ?? '').toLowerCase()).filter(Boolean))];
  const found = Math.min(band.tickets, band.seatsDealt ?? 0);
  const left = Math.max(0, band.tickets - found);
  const sealedUntilReveal = typeof opts.openableAtMs === 'number' && opts.openableAtMs > Date.now();
  const message = opts.isHit
    ? `The Jackpot hit on your draft. Every JackHOF seat still hidden in this batch landed in this draft's packs. ${sealedUntilReveal ? 'Yours opens the moment the hit is revealed.' : 'Rip yours now.'}`
    : `Your Banana Zone draft filled and your pack is ready to rip. ${found} of ${band.tickets} JackHOF seats found so far in drafts ${band.fromPos} to ${band.toPos}${left > 0 ? `, ${left} still hidden in the next ${Math.max(0, band.toPos - opts.position)} drafts. Every paid draft you fill = 1 more pack. Jackpot hits first? The draft that hits it splits the rest.` : '. Every seat in this batch has landed.'}`;
  await Promise.allSettled(holders.map((w) => {
    const docId = `${w}__zone-drop-dealt-${bandId}-${opts.position}`.replace(/[/\\\s]+/g, '_').slice(0, 1400);
    return db.collection('marketplace_notifications').doc(docId).create({
      wallet: w,
      type: 'promo',
      icon: '📦',
      title: opts.isHit ? '📦 Jackpot hit. Your pack is loaded' : '📦 Your pack is ready',
      message,
      link: '/promos?promo=bonus-zone',
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    }).catch((err: { code?: number }) => {
      if (err?.code === 6) return;
      throw err;
    });
  }));
}

/** Deal every undealt (prize null) draft in an instant band. `onlyStale`
 *  skips packs younger than 2 minutes (a fill mid-award). Returns the
 *  positions dealt. */
async function resolveStrayInstantPacks(bandId: string, forHit: boolean, hitPosition: number | null = null, onlyStale = true): Promise<number[]> {
  const db = getAdminFirestore();
  const bandRef = db.collection(BANDS).doc(bandId);
  const band = (await bandRef.get()).data() as BandDoc | undefined;
  if (!band || band.mode !== 'instant' || band.status !== 'earning') return [];
  const undealt = await bandRef.collection(PACKS).where('prize', '==', null).get();
  const cutoff = Date.now() - 2 * 60_000;
  const byPos = new Map<number, string>();
  for (const d of undealt.docs) {
    const p = d.data() as ZonePackDoc;
    if (onlyStale && p.earnedAt > new Date(cutoff).toISOString()) continue;
    if (!byPos.has(p.position)) byPos.set(p.position, p.source);
  }
  const positions = [...byPos.keys()].sort((a, b) => a - b);
  const dealt: number[] = [];
  for (const position of positions) {
    const isHit = forHit && hitPosition === position;
    const r = await resolveZoneDraft({ windowStart: band.windowStart, position, draftId: byPos.get(position)!, isHit });
    if (r.ok && r.reason === undefined) dealt.push(position);
  }
  return dealt;
}

/**
 * Close an instant band. 'band-complete' (its last draft filled): deal any
 * stragglers and lock. 'window-reset' (Jackpot hit): find the hit draft —
 * the smallest Jackpot id at/after the band's window — deal everything
 * still hidden into ITS packs (the ELI5 rule), lock. If the hit draft's
 * packs aren't in yet, wait (up to 20 min of ticks); after that, fall back
 * to the band's still-sealed packs, highest position first, so the seats
 * still go to real packs rather than nowhere.
 */
async function finalizeInstantBand(bandId: string, reason: NonNullable<BandDoc['lockReason']>, nowMs = Date.now()): Promise<{ ok: boolean; reason?: string; winners?: number }> {
  const db = getAdminFirestore();
  const bandRef = db.collection(BANDS).doc(bandId);
  const band = (await bandRef.get()).data() as BandDoc | undefined;
  if (!band) return { ok: false, reason: 'no-band' };
  if (band.status !== 'earning') return { ok: true, reason: 'already-locked' };

  if (reason !== 'window-reset') {
    await resolveStrayInstantPacks(bandId, false, null, false);
    await bandRef.set({ status: 'locked', lockedAt: new Date(nowMs).toISOString(), lockReason: reason, revealAtMs: nowMs }, { merge: true });
    logger.info('zone_drop.instant_band_closed', { bandId, reason, seatsDealt: band.seatsDealt ?? 0 });
    return { ok: true, winners: band.winners?.length ?? 0 };
  }

  // Which draft hit? The first Jackpot id at/after this band's window.
  const t = (await db.collection('drafts').doc('draftTracker').get()).data() as { JackpotLeagueIds?: unknown[] } | undefined;
  const jpIds = (Array.isArray(t?.JackpotLeagueIds) ? t!.JackpotLeagueIds!.map(Number) : []).filter((n) => n >= band.windowStart).sort((a, b) => a - b);
  const hitNo = jpIds[0] ?? null;
  const hitPosition = hitNo !== null ? hitNo - band.windowStart + 1 : null;
  if (!band.hitNoticedAtIso) await bandRef.set({ hitNoticedAtIso: new Date(nowMs).toISOString() }, { merge: true });
  const noticedMs = band.hitNoticedAtIso ? Date.parse(band.hitNoticedAtIso) : nowMs;

  const state: InstantBandState = {
    seatPositions: band.seatPositions ?? [], resolved: band.resolved ?? {},
    absorbedPositions: band.absorbedPositions ?? [], rollover: band.rollover ?? 0,
  };
  const hidden = state.seatPositions.filter((p) => !state.resolved[String(p)] && !state.absorbedPositions.includes(p)).length + state.rollover;

  // Hit position inside this band and its packs present → the normal rule.
  if (hitPosition !== null && hitPosition >= band.fromPos && hitPosition <= band.toPos) {
    if (state.resolved[String(hitPosition)]) {
      // Dealt as a normal draft before anyone knew it was the hit (reveal
      // gating) — the leftover seats have nowhere sealed to go inside that
      // draft; fall through to the fallback below.
    } else {
      await resolveStrayInstantPacks(bandId, true, hitPosition, false);
      const after = (await bandRef.get()).data() as BandDoc | undefined;
      if (after?.status === 'locked') return { ok: true, winners: after.winners?.length ?? 0 };
      if (nowMs - noticedMs < 20 * 60_000) return { ok: false, reason: 'waiting-for-hit-packs' };
    }
  } else if (hidden > 0 && nowMs - noticedMs < 20 * 60_000) {
    return { ok: false, reason: 'waiting-for-hit-packs' };
  }

  // Fallback. First deal every straggler draft normally (so no pack is left
  // prize-null behind a locked band), then: nothing hidden → just close;
  // otherwise deal the hidden seats into the band's still-sealed packs,
  // highest position first (the hit draft's own packs, if they came in late).
  await resolveStrayInstantPacks(bandId, false, null, false);
  const cur = ((await bandRef.get()).data() as BandDoc | undefined) ?? band;
  const curResolved = cur.resolved ?? {};
  const curAbsorbed = cur.absorbedPositions ?? [];
  const stillHidden = (cur.seatPositions ?? []).filter((p) => !curResolved[String(p)] && !curAbsorbed.includes(p));
  const hiddenNow = stillHidden.length + (cur.rollover ?? 0);
  if (hiddenNow === 0) {
    await bandRef.set({ status: 'locked', lockedAt: new Date(nowMs).toISOString(), lockReason: 'window-reset', revealAtMs: nowMs }, { merge: true });
    return { ok: true, winners: cur.winners?.length ?? 0 };
  }
  const sealed = await bandRef.collection(PACKS).where('opened', '==', false).get();
  const refs = sealed.docs.map((d) => d.data() as ZonePackDoc)
    .filter((p) => p.prize?.kind !== 'jackhof')
    .sort((a, b) => b.position - a.position || (a.packId < b.packId ? -1 : 1))
    .slice(0, Math.max(hiddenNow * 4, 10))
    .map((p) => ({ packId: p.packId, userId: p.userId }));
  const seats = Math.min(hiddenNow, refs.length);
  const assignments = refs.length && cur.seedDigest ? assignGoldenTickets(refs, cur.seedDigest, `${bandId}:hit-fallback`, seats) : [];
  const winners = assignments.filter((a) => a.prize.kind === 'jackhof');
  const batch = db.batch();
  for (const a of winners) batch.set(bandRef.collection(PACKS).doc(a.packId), { prize: a.prize, dealtAt: new Date(nowMs).toISOString(), hitFallback: true }, { merge: true });
  batch.set(bandRef, {
    status: 'locked', lockedAt: new Date(nowMs).toISOString(), lockReason: 'window-reset', revealAtMs: nowMs,
    seatsDealt: FieldValue.increment(seats), rollover: 0,
    ...(stillHidden.length ? { absorbedPositions: FieldValue.arrayUnion(...stillHidden) } : {}),
    ...(winners.length ? { winners: FieldValue.arrayUnion(...winners.map((a) => ({ packId: a.packId, userId: a.userId }))) } : {}),
    hitFallback: { at: new Date(nowMs).toISOString(), hidden: hiddenNow, seats, hitNo },
  }, { merge: true });
  await batch.commit();
  await stampLiveSeats(cur, (cur.seatsDealt ?? 0) + seats);
  logger.error('zone_drop.hit_fallback_dealt', { bandId, hidden: hiddenNow, seats, hitNo, winners: winners.map((w) => w.userId) });
  return { ok: true, winners: (cur.winners?.length ?? 0) + winners.length };
}

// ── Opening ─────────────────────────────────────────────────────────────────

export interface OpenedZonePack {
  packId: string;
  prize: Prize;
}

/**
 * Open a user's packs in a band. Pure reveal — prizes were assigned at lock —
 * and gated on the band's 9pm reveal instant. Idempotent per pack; a Golden
 * Ticket settles a real JackHOF seat through THE DROP's proven seat path.
 */
export async function openZonePacks(opts: {
  userId: string;
  bandId: string;
  packIds?: string[];
  nowMs?: number;
}): Promise<{ ok: boolean; reason?: string; opened: OpenedZonePack[] }> {
  if (!isFirestoreConfigured()) return { ok: false, reason: 'no-firestore', opened: [] };
  if (!(await readZoneDropConfig()).enabled) return { ok: false, reason: 'not-live', opened: [] };
  const userId = opts.userId.toLowerCase();
  const nowMs = opts.nowMs ?? Date.now();
  const db = getAdminFirestore();
  const bandRef = db.collection(BANDS).doc(opts.bandId);
  const band = (await bandRef.get()).data() as BandDoc | undefined;
  if (!band) return { ok: false, reason: 'no-band', opened: [] };
  // Batch bands gate on the lock; instant bands gate per pack (dealt + past
  // any hit-reveal hold) — packOpenable is the single rule for both.
  if (band.mode !== 'instant') {
    if (band.status !== 'locked') return { ok: false, reason: 'not-yet', opened: [] };
    if (typeof band.revealAtMs === 'number' && nowMs < band.revealAtMs) {
      return { ok: false, reason: 'sealed-until-9', opened: [] };
    }
  }

  const mine = await bandRef.collection(PACKS).where('userId', '==', userId).get();
  const targets = mine.docs
    .map((d) => d.data() as ZonePackDoc)
    .filter((p) => packOpenable(band, p, nowMs))
    .filter((p) => (opts.packIds ? opts.packIds.includes(p.packId) : true));
  if (targets.length === 0) return { ok: true, reason: 'nothing-to-open', opened: [] };

  const opened: OpenedZonePack[] = [];
  for (const pack of targets) {
    const packRef = bandRef.collection(PACKS).doc(pack.packId);
    try {
      const prize = await db.runTransaction(async (tx) => {
        const fresh = (await tx.get(packRef)).data() as ZonePackDoc | undefined;
        if (!fresh || fresh.opened) throw new Error('ALREADY_OPEN');
        tx.set(packRef, { opened: true, openedAt: new Date(nowMs).toISOString() }, { merge: true });
        return fresh.prize ?? { kind: 'none' as const };
      });
      opened.push({ packId: pack.packId, prize });
      if (prize.kind === 'jackhof') {
        // Reuse THE DROP's end-to-end seat path (mint pass NFT → level stamp →
        // promo-round queue → seat) — a pack-won seat must behave exactly like
        // a drop-won JackHOF seat. Dynamic import: dropRun is heavy and this
        // fires only on a win.
        const { awardSpecialSeat } = await import('@/lib/dropRun');
        await awardSpecialSeat(userId, `zone:${opts.bandId}`, 'jackhof')
          .catch((err) => logger.error('zone_drop.seat_failed', { bandId: opts.bandId, userId, err: (err as Error).message }));
      }
    } catch (err) {
      if ((err as Error).message !== 'ALREADY_OPEN') {
        logger.error('zone_drop.open_failed', { packId: pack.packId, err: (err as Error).message });
      }
    }
  }
  return { ok: true, opened };
}

// ── Status (page + API) ─────────────────────────────────────────────────────

export interface ZoneDropBandStatus {
  bandId: string;
  band: number;
  fromPos: number;
  toPos: number;
  tickets: number;
  status: 'earning' | 'locked';
  packCount: number;
  revealAtMs: number | null;
  /** Winners exposed only after the reveal instant — never before. */
  winners: Array<{ userId: string }> | null;
  myPacks: number;
  myUnopened: number;
  /** Unopened pack ids, oldest first — the client's OPEN ONE pops the head. */
  myUnopenedIds: string[];
  /** 'instant' = seats land draft by draft, packs open at fill (8/25). */
  mode: 'batch' | 'instant';
  /** Instant: seats already landed / still hidden in the drafts ahead. */
  seatsDealt: number;
  seatsLeft: number;
  /** Instant: of myUnopened, how many can be ripped right now (dealt). */
  myReady: number;
  myReadyIds: string[];
  /** Instant: unopened packs whose draft isn't dealt yet (seconds) or held
   *  until a Jackpot-hit reveal. */
  myWaiting: number;
}

export async function getZoneDropStatus(wallet?: string | null): Promise<{
  enabled: boolean;
  windowStart: number | null;
  position: number | null;
  bands: ZoneDropBandStatus[];
  /** Older bands where this wallet still holds sealed packs. */
  backlog: ZoneDropBandStatus[];
}> {
  const cfg = await readZoneDropConfig();
  if (!cfg.enabled || !isFirestoreConfigured()) {
    return { enabled: false, windowStart: null, position: null, bands: [], backlog: [] };
  }
  const db = getAdminFirestore();
  const w = wallet && /^0x[0-9a-fA-F]{40}$/.test(wallet) ? wallet.toLowerCase() : null;
  const view = await readBonusZoneView();
  const windowStart = (view as { windowStart?: number }).windowStart ?? null;
  const position = (view as { position?: number }).position ?? null;
  const zoneCfg = await readBonusZoneConfig();

  const statusFor = async (bandId: string, spec?: BandSpec): Promise<ZoneDropBandStatus | null> => {
    const snap = await db.collection(BANDS).doc(bandId).get();
    const band = snap.exists ? (snap.data() as BandDoc) : null;
    if (!band && !spec) return null;
    const nowMs = Date.now();
    const instant = band?.mode === 'instant' || (!band && cfg.instant);
    let myPacks = 0, myUnopened = 0;
    let myUnopenedIds: string[] = [];
    let myReadyIds: string[] = [];
    if (w && band) {
      const mine = await db.collection(BANDS).doc(bandId).collection(PACKS).where('userId', '==', w).get();
      myPacks = mine.size;
      const unopened = mine.docs
        .map((d) => d.data() as ZonePackDoc)
        .filter((p) => !p.opened)
        .sort((a, b) => (a.earnedAt < b.earnedAt ? -1 : 1));
      myUnopenedIds = unopened.map((p) => p.packId);
      myUnopened = myUnopenedIds.length;
      myReadyIds = unopened.filter((p) => packOpenable(band, p, nowMs)).map((p) => p.packId);
    }
    const revealed = band?.status === 'locked' && typeof band.revealAtMs === 'number' && nowMs >= band.revealAtMs;
    const tickets = band?.tickets ?? spec?.tickets ?? 0;
    const seatsDealt = instant ? (band?.seatsDealt ?? 0) : (revealed ? (band?.winners?.length ?? 0) : 0);
    return {
      bandId,
      band: band?.band ?? spec?.band ?? 0,
      fromPos: band?.fromPos ?? spec?.fromPos ?? 0,
      toPos: band?.toPos ?? spec?.toPos ?? 0,
      tickets,
      status: band?.status ?? 'earning',
      packCount: band?.packCount ?? 0,
      revealAtMs: band?.revealAtMs ?? null,
      // Instant: winners are public as they land (their pack is dealt).
      winners: (revealed || instant) ? (band?.winners ?? []).map(({ userId }) => ({ userId })) : null,
      myPacks,
      myUnopened,
      myUnopenedIds,
      mode: instant ? 'instant' : 'batch',
      seatsDealt,
      seatsLeft: Math.max(0, tickets - seatsDealt),
      myReady: myReadyIds.length,
      myReadyIds,
      myWaiting: Math.max(0, myUnopened - myReadyIds.length),
    };
  };

  const bands: ZoneDropBandStatus[] = [];
  if (typeof windowStart === 'number') {
    for (const spec of bandSpecs(zoneCfg, cfg.seatsByBand)) {
      const st = await statusFor(bandIdFor(windowStart, spec.band), spec);
      if (st) bands.push(st);
    }
  }

  // Backlog: bands from older windows where this wallet still holds sealed
  // packs. Found via the wallet's own ledger — no collection-group index.
  const backlog: ZoneDropBandStatus[] = [];
  if (w) {
    const ledger = await db.collection(USERS).doc(w).collection(LEDGER).select('bandId').get();
    const bandIds = [...new Set(ledger.docs.map((d) => (d.data() as { bandId?: string }).bandId).filter(Boolean))] as string[];
    for (const bandId of bandIds) {
      if (typeof windowStart === 'number' && bandId.startsWith(`${windowStart}__`)) continue;
      const st = await statusFor(bandId);
      if (st && st.myUnopened > 0) backlog.push(st);
    }
  }

  return { enabled: true, windowStart, position, bands, backlog };
}
