/**
 * Pure math for the Banana Draw — "Collect Bananas → JACKHOF SEAT".
 *
 * Every 24 hours one Banana is drawn at random and its holder wins a seat in
 * the first-ever JackHOF draft. More Bananas = better odds, but a single
 * Banana can win.
 *
 * Side-effect free so the earning rates, cycle boundaries and — most
 * importantly — the WINNER SELECTION are unit-testable without Firestore.
 * lib/bananaDraw.ts does the I/O and imports these. Same split as
 * lib/promoMath.ts and lib/rollingLanes.ts.
 */

// ── Earning rates (Boris 2026-07-26) ────────────────────────────────────────
// Framing rule for all copy: 1 Banana is the BASELINE every draft earns, and
// paid earns a BONUS on top. Never present free as the lesser tier — the whole
// point of the promo is getting people to burn the free stack they're sitting
// on, and "your drafts are worth less" is the one message that would stop them.
export const BANANAS_PER_DRAFT = 1;
export const BANANAS_PAID_BONUS = 1;
export const BANANAS_REFERRAL_DRAFT = 5;
export const BANANAS_REFERRAL_PURCHASE = 5;
/** A single friend can never be worth more than this (5 + 5). */
export const BANANAS_MAX_PER_FRIEND = BANANAS_REFERRAL_DRAFT + BANANAS_REFERRAL_PURCHASE;

/**
 * The Banana Draw went live at NOON PT on 2026-07-26 — the first cycle's open.
 *
 * ⚠️ Referrals only pay for friends who signed up AT OR AFTER this instant.
 * Without the cut-off the promo back-pays the entire historic referral book:
 * 53 accounts carried a `referredBy` on launch day, 52 of them from before the
 * promo existed, and one referrer alone held 23 of them — up to 230 Bananas
 * into a pool that was 34. The promo is a growth lever for NEW invites, not a
 * settlement of old ones (Richard 2026-07-26).
 */
export const BANANA_DRAW_LAUNCH_MS = Date.UTC(2026, 6, 26, 19, 0, 0);

/** True when a referred friend counts for Banana payouts — i.e. they joined
 *  after the promo went live. A friend with no signup stamp is an old account
 *  (createdAt has been written on every signup for far longer than the promo
 *  has existed), so the absent case is legacy and pays nothing. */
export function referralCountsForBananas(friendCreatedAtMs: number | null | undefined): boolean {
  return typeof friendCreatedAtMs === 'number'
    && Number.isFinite(friendCreatedAtMs)
    && friendCreatedAtMs >= BANANA_DRAW_LAUNCH_MS;
}

/** The draw lands at NOON Pacific, matching the promo-window cutover hour. */
export const DRAW_HOUR_PT = 12;

export type BananaSource = 'draft-free' | 'draft-paid' | 'referral-draft' | 'referral-purchase';

/** Bananas a filled draft is worth. Free = 1, paid = 1 + 1 bonus.
 *  Only ever called with the AUTHORITATIVE token pass type — never the
 *  client-supplied one (see resolveDraftPassType). */
export function bananasForDraft(passType: 'free' | 'paid'): number {
  return BANANAS_PER_DRAFT + (passType === 'paid' ? BANANAS_PAID_BONUS : 0);
}

export function bananasForSource(source: BananaSource): number {
  switch (source) {
    case 'draft-free': return bananasForDraft('free');
    case 'draft-paid': return bananasForDraft('paid');
    case 'referral-draft': return BANANAS_REFERRAL_DRAFT;
    case 'referral-purchase': return BANANAS_REFERRAL_PURCHASE;
  }
}

// ── Cycle boundaries ────────────────────────────────────────────────────────

export interface DrawCycle {
  /** PT calendar day the cycle CLOSES on, e.g. "2026-07-27". Doc id. */
  cycleId: string;
  /** Inclusive open instant (ms) — the previous draw. */
  opensAt: number;
  /** Exclusive close instant (ms) — this cycle's draw. */
  closesAt: number;
}

/** UTC instant when LA wall-clock hits `hour` on the given y/m/d.
 *  LA is UTC-7 (PDT) or UTC-8 (PST) — try both and keep the one that
 *  round-trips, so the campaign survives the November DST change.
 *  Same technique as lib/sbsDay.ts. */
function ptHourUtc(y: number, m: number, d: number, hour: number): number {
  for (const offset of [7, 8]) {
    const candidate = Date.UTC(y, m - 1, d, hour + offset, 0, 0);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles', hour: '2-digit', hour12: false, day: '2-digit',
    }).formatToParts(new Date(candidate))
      .reduce<Record<string, string>>((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    if (Number(parts.hour) === hour && Number(parts.day) === d) return candidate;
  }
  return Date.UTC(y, m - 1, d, hour + 7, 0, 0); // unreachable fallback: PDT
}

/** The cycle that `nowMs` falls inside — the one currently accepting Bananas. */
export function cycleFor(nowMs: number): DrawCycle {
  const la = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(new Date(nowMs))
    .reduce<Record<string, string>>((acc, p) => { acc[p.type] = p.value; return acc; }, {});

  const y = Number(la.year), m = Number(la.month), d = Number(la.day);
  // Before noon PT we're still inside the cycle that closes TODAY at noon;
  // at or after noon we're in the one closing TOMORROW.
  const beforeDraw = Number(la.hour) < DRAW_HOUR_PT;
  const closeDate = new Date(Date.UTC(y, m - 1, d));
  if (!beforeDraw) closeDate.setUTCDate(closeDate.getUTCDate() + 1);
  const cy = closeDate.getUTCFullYear(), cm = closeDate.getUTCMonth() + 1, cd = closeDate.getUTCDate();

  const closesAt = ptHourUtc(cy, cm, cd, DRAW_HOUR_PT);
  const openDate = new Date(Date.UTC(cy, cm - 1, cd));
  openDate.setUTCDate(openDate.getUTCDate() - 1);
  const opensAt = ptHourUtc(openDate.getUTCFullYear(), openDate.getUTCMonth() + 1, openDate.getUTCDate(), DRAW_HOUR_PT);

  const cycleId = `${cy}-${String(cm).padStart(2, '0')}-${String(cd).padStart(2, '0')}`;
  return { cycleId, opensAt, closesAt };
}

// ── The draw ────────────────────────────────────────────────────────────────

export interface DrawEntry {
  userId: string;
  bananas: number;
}

export interface DrawResult {
  winnerId: string | null;
  /** 0-indexed Banana that won, across the whole sorted pool. Published so
   *  anyone can recompute the draw from the snapshot + revealed seed. */
  winningIndex: number;
  totalBananas: number;
  /** Entries in the exact order the ranges were laid out. */
  ordered: DrawEntry[];
}

/**
 * Weighted random winner. Every entrant occupies a contiguous run of Banana
 * indices; the sealed seed picks one index, and whoever's run contains it wins.
 *
 * ⚠️ The seed MUST be committed before the cycle closes. If it were derived at
 * close time from anything observable, someone holding several wallets could
 * compute whether a last-second entry made them win and enter only if it did —
 * the exact last-joiner grinding attack lib/jackpotDrawProof.ts was built to
 * kill. Sealing first makes the calculation impossible.
 *
 * Entries are sorted by userId so the layout is reproducible by any auditor
 * from the published snapshot alone, independent of read order.
 */
export function pickWinner(entries: DrawEntry[], seedHex: string): DrawResult {
  const ordered = entries
    .filter((e) => Number.isFinite(e.bananas) && e.bananas > 0)
    .map((e) => ({ userId: e.userId, bananas: Math.floor(e.bananas) }))
    .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));

  const totalBananas = ordered.reduce((s, e) => s + e.bananas, 0);
  if (totalBananas <= 0) return { winnerId: null, winningIndex: -1, totalBananas: 0, ordered };

  // Full-width hash → BigInt keeps the modulo unbiased for any pool size.
  const winningIndex = Number(BigInt(`0x${seedHex.replace(/^0x/, '')}`) % BigInt(totalBananas));

  let cursor = 0;
  for (const e of ordered) {
    if (winningIndex < cursor + e.bananas) {
      return { winnerId: e.userId, winningIndex, totalBananas, ordered };
    }
    cursor += e.bananas;
  }
  // Unreachable — winningIndex < totalBananas by construction.
  return { winnerId: ordered[ordered.length - 1].userId, winningIndex, totalBananas, ordered };
}

/** Share of the pool, for the leaderboard. Ranked by SHARE, never by position:
 *  "the leader has 14%" invites people in, "you're 47th" pushes them out. */
export function shareOf(bananas: number, totalBananas: number): number {
  if (!totalBananas || totalBananas <= 0) return 0;
  return (bananas / totalBananas) * 100;
}
