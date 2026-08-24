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
 */

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

/** JackHOF seats per batch (Richard 8/23 final: zone = 1–25 and 26–50, SIX
 *  JackHOF seats in the first band, FOUR in the second — 10 per window, one
 *  full JackHOF league. A third zone tier, if config ever brings one back,
 *  carries no tickets and produces no band. Descending, never flat: waiting
 *  must always lose, same logic as the BOGO ladder. */
export const TICKETS_BY_BAND = [6, 4, 0] as const;

// ── Switch ──────────────────────────────────────────────────────────────────

export interface ZoneDropConfig {
  enabled: boolean;
  /** Stamped by the toggle script on the first flip to ON. */
  sinceIso: string | null;
}

let cfgCache: { at: number; cfg: ZoneDropConfig } | null = null;

/** Env override for emergencies: ZONE_DROP=1 forces ON, =0 forces OFF. */
function envOverride(): boolean | null {
  const v = process.env.ZONE_DROP;
  if (v === '1') return true;
  if (v === '0') return false;
  return null;
}

export async function readZoneDropConfig(opts: { fresh?: boolean } = {}): Promise<ZoneDropConfig> {
  const now = Date.now();
  if (!opts.fresh && cfgCache && now - cfgCache.at < CONFIG_TTL_MS) return cfgCache.cfg;
  const cfg: ZoneDropConfig = { enabled: false, sinceIso: null };
  if (isFirestoreConfigured()) {
    try {
      const snap = await getAdminFirestore().collection('system_config').doc(CONFIG_DOC).get();
      const d = (snap.exists ? snap.data() : null) as Partial<ZoneDropConfig> | null;
      if (d) {
        if (typeof d.enabled === 'boolean') cfg.enabled = d.enabled;
        if (typeof d.sinceIso === 'string' && d.sinceIso) cfg.sinceIso = d.sinceIso;
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
export function bandSpecs(cfg: BonusZoneConfig): BandSpec[] {
  return ([
    { band: 1 as const, fromPos: 1, toPos: cfg.tier1Through, tickets: TICKETS_BY_BAND[0] },
    { band: 2 as const, fromPos: cfg.tier1Through + 1, toPos: cfg.tier2Through, tickets: TICKETS_BY_BAND[1] },
    { band: 3 as const, fromPos: cfg.tier2Through + 1, toPos: cfg.tier3Through, tickets: TICKETS_BY_BAND[2] },
  ]).filter((b) => b.tickets > 0 && b.toPos >= b.fromPos);
}

export function bandForPosition(position: number, cfg: BonusZoneConfig): BandSpec | null {
  return bandSpecs(cfg).find((b) => position >= b.fromPos && position <= b.toPos) ?? null;
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
export function zonePackRulesExplanation(cfg: BonusZoneConfig): string {
  const specs = bandSpecs(cfg);
  const spinLine = (band: number, from: number, to: number) =>
    `• Drafts ${from} to ${to}: Buy ${band} Get 1 Spin. Every paid draft you enter earns ${band === 1 ? 'a Free Spin' : band === 2 ? 'half a Free Spin' : 'a third of a Free Spin'} when it fills.`;
  const seatLines = specs.map((s) =>
    `• The packs from drafts ${s.fromPos} to ${s.toPos} hide ${s.tickets} JACKHOF SEATS.`);
  const zoneEnd = specs[specs.length - 1]?.toPos ?? cfg.tier2Through;
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
}

/** Create the band doc on first use, stamping the sealed-seed commitment
 *  BEFORE any pack exists in it. Idempotent. */
async function ensureBand(windowStart: number, spec: BandSpec): Promise<string> {
  const bandId = bandIdFor(windowStart, spec.band);
  const ref = getAdminFirestore().collection(BANDS).doc(bandId);
  if ((await ref.get()).exists) return bandId;
  const seed = await getSealedDrawSeed();
  const doc: BandDoc = {
    bandId, windowStart, band: spec.band,
    fromPos: spec.fromPos, toPos: spec.toPos, tickets: spec.tickets,
    status: 'earning',
    ...(seed ? { saltHash: seed.saltHash, periodNumber: seed.periodNumber } : {}),
  };
  await ref.set(doc, { merge: true });
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
  if (!(await readZoneDropConfig()).enabled) return { awarded: 0, bandId: null };
  const zoneCfg = await readBonusZoneConfig();
  const spec = bandForPosition(opts.position, zoneCfg);
  if (!spec) return { awarded: 0, bandId: null };

  const userId = opts.userId.toLowerCase();
  const nowMs = opts.nowMs ?? Date.now();
  const bandId = await ensureBand(opts.windowStart, spec);
  const db = getAdminFirestore();
  const bandRef = db.collection(BANDS).doc(bandId);

  const dedupeId = `${bandId}__${userId}__${opts.draftId}`.replace(/[/\\\s]+/g, '_').slice(0, 1400);
  const ledgerRef = db.collection(USERS).doc(userId).collection(LEDGER).doc(dedupeId);
  const packId = dedupeId;

  try {
    await db.runTransaction(async (tx) => {
      if ((await tx.get(ledgerRef)).exists) throw new Error('ALREADY_AWARDED');
      // A locked band's tickets are assigned — a late webhook can't join it.
      const bandSnap = await tx.get(bandRef);
      if ((bandSnap.data() as BandDoc | undefined)?.status !== 'earning') throw new Error('BAND_LOCKED');
      tx.set(ledgerRef, {
        userId, bandId, draftId: opts.draftId, position: opts.position,
        windowStart: opts.windowStart, at: new Date(nowMs).toISOString(),
      });
      tx.set(bandRef.collection(PACKS).doc(packId), {
        packId, userId, bandId, windowStart: opts.windowStart, band: spec.band,
        source: opts.draftId, position: opts.position, passType: 'paid',
        earnedAt: new Date(nowMs).toISOString(),
        prize: null, opened: false,
      } satisfies ZonePackDoc);
      tx.set(bandRef, { packCount: FieldValue.increment(1) }, { merge: true });
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'ALREADY_AWARDED' || msg === 'BAND_LOCKED') return { awarded: 0, bandId };
    logger.error('zone_drop.award_failed', { userId, draftId: opts.draftId, err: msg });
    return { awarded: 0, bandId };
  }

  if (opts.notify && (await readZoneDropConfig()).enabled) {
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
  if (!(await readZoneDropConfig()).enabled) return;
  const zoneCfg = await readBonusZoneConfig();
  for (const spec of bandSpecs(zoneCfg)) {
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
    const position = (view as { position?: number }).position ?? 0;
    if (typeof windowStart === 'number') {
      await maybeLockDueBands(windowStart, position);
      out.window = { windowStart, position };
    }
    const earning = await getAdminFirestore().collection(BANDS).where('status', '==', 'earning').get();
    for (const d of earning.docs) {
      const band = d.data() as BandDoc;
      if (typeof windowStart === 'number' && band.windowStart !== windowStart) {
        out[`orphan:${band.bandId}`] = await lockZoneBand(band.bandId, { reason: 'window-reset' });
      }
    }
  } catch (err) {
    logger.error('zone_drop.tick_failed', { err: (err as Error).message });
    out.error = (err as Error).message;
  }
  return out;
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
  if (band.status !== 'locked') return { ok: false, reason: 'not-yet', opened: [] };
  if (typeof band.revealAtMs === 'number' && nowMs < band.revealAtMs) {
    return { ok: false, reason: 'sealed-until-9', opened: [] };
  }

  const mine = await bandRef.collection(PACKS).where('userId', '==', userId).get();
  const targets = mine.docs
    .map((d) => d.data() as ZonePackDoc)
    .filter((p) => !p.opened)
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
    let myPacks = 0, myUnopened = 0;
    let myUnopenedIds: string[] = [];
    if (w && band) {
      const mine = await db.collection(BANDS).doc(bandId).collection(PACKS).where('userId', '==', w).get();
      myPacks = mine.size;
      myUnopenedIds = mine.docs
        .map((d) => d.data() as ZonePackDoc)
        .filter((p) => !p.opened)
        .sort((a, b) => (a.earnedAt < b.earnedAt ? -1 : 1))
        .map((p) => p.packId);
      myUnopened = myUnopenedIds.length;
    }
    const nowMs = Date.now();
    const revealed = band?.status === 'locked' && typeof band.revealAtMs === 'number' && nowMs >= band.revealAtMs;
    return {
      bandId,
      band: band?.band ?? spec?.band ?? 0,
      fromPos: band?.fromPos ?? spec?.fromPos ?? 0,
      toPos: band?.toPos ?? spec?.toPos ?? 0,
      tickets: band?.tickets ?? spec?.tickets ?? 0,
      status: band?.status ?? 'earning',
      packCount: band?.packCount ?? 0,
      revealAtMs: band?.revealAtMs ?? null,
      winners: revealed ? (band?.winners ?? []).map(({ userId }) => ({ userId })) : null,
      myPacks,
      myUnopened,
      myUnopenedIds,
    };
  };

  const bands: ZoneDropBandStatus[] = [];
  if (typeof windowStart === 'number') {
    for (const spec of bandSpecs(zoneCfg)) {
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
