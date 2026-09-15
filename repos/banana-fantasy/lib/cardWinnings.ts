/**
 * Weekly prizes that live ON the team card (Boris 2026-09-14, same model as last season):
 *
 *   award   → `card_winnings/{tokenId}.onCard += amount` (+ an `awards[]` entry) once per gameweek,
 *             recorded in `weekly_awards/{gameweek}` so it can never double-pay.
 *   transfer→ the CURRENT on-chain owner moves a card's whole amount into their site balance
 *             (a pending prize record — the existing /winnings ledger). No KYC here.
 *   withdraw→ the existing /api/prizes/withdraw-all path (Didit tier-1 gate, admin queue, USDC).
 *
 * Cost: one leaderboard query + ≤5 writes per week; ownership = one ownerOf RPC per card with money on it.
 */
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import { createPublicClient, http, type Address } from 'viem';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { BASE, BASE_RPC_URL, BBB4_CONTRACT_ADDRESS } from '@/lib/contracts/bbb4';
import { createPrizeRecordWithId } from '@/lib/prizeOverlay';
import { createNotification } from '@/lib/queueNotifications';
import { currentWeekNumber, gameweekString } from '@/lib/season';
import { logger } from '@/lib/logger';
import { refreshOpenSeaTokens } from '@/lib/opensea';

export const WEEKLY_PRIZE_WEEKS = 14;
export const ADMIN_BELL_WALLET = '0x438bbe98eed1dd2df244b007dab0583cc9be72e0';
const CARD_WINNINGS = 'card_winnings';
const WEEKLY_AWARDS = 'weekly_awards';
const FALLBACK_WEEKLY_PRIZES = [250, 100, 50, 35, 20];

export interface CardAward { gameweek: string; week: number; place: number; amount: number; awardedAt: string; ownerAtAward: string; scoreWeek: number }
export interface CardTransfer { id: string; amount: number; at: string; to: string }
export interface CardWinnings {
  /** Doc id = the on-chain token id when the card has one, else the engine card id (special/promo seats not yet linked). */
  tokenId: string;
  cardId: string;
  chainTokenId: string | null;
  draftId: string;
  leagueName: string;
  level: string;
  onCard: number;
  totalAwarded: number;
  transferred: number;
  awards: CardAward[];
  transfers: CardTransfer[];
  ownerAtLastAward: string;
}
export interface WeeklyWinner { place: number; tokenId: string; cardId: string; chainTokenId: string | null; ownerId: string; amount: number; scoreWeek: number; scoreSeason: number; draftId: string; leagueName: string; level: string }
export type AwardResult =
  | { status: 'awarded'; gameweek: string; winners: WeeklyWinner[] }
  | { status: 'already'; gameweek: string; winners: WeeklyWinner[] }
  | { status: 'dry'; gameweek: string; winners: WeeklyWinner[] }
  | { status: 'tie'; gameweek: string; tieAtPlace: number; candidates: WeeklyWinner[] }
  | { status: 'skipped'; gameweek: string; reason: string };

const r2 = (n: number) => Math.round(n * 100) / 100;
const weekOf = (gw: string) => Number(gw.match(/(\d+)$/)?.[1] || 0);
const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : Math.min(n % 10, 4) % 4] || 'th'}`;

/** The 1st–5th weekly amounts from the live contest doc (Richard's final table); fallback = the same numbers. */
export async function getWeeklyPrizeTable(): Promise<number[]> {
  try {
    const doc = await getAdminFirestore().collection('v2_contests').doc('1').get();
    const rows = (doc.data()?.prizeBreakdown ?? []) as Array<{ place?: string; amount?: number; section?: string }>;
    const weekly = rows
      .filter((r) => String(r.section || '').toLowerCase().startsWith('weekly'))
      .map((r) => ({ place: Number(String(r.place || '').match(/^(\d+)/)?.[1] || 0), amount: Number(r.amount || 0) }))
      .filter((r) => r.place >= 1 && r.place <= 5 && r.amount > 0)
      .sort((a, b) => a.place - b.place);
    if (weekly.length === 5 && weekly.every((r, i) => r.place === i + 1)) return weekly.map((r) => r.amount);
  } catch (err) {
    logger.warn('weekly_prizes.table_read_failed', { err: String(err) });
  }
  return FALLBACK_WEEKLY_PRIZES;
}

async function loadBotSet(): Promise<Set<string>> {
  const snap = await getAdminFirestore().collection('botWallets').select().get();
  return new Set(snap.docs.map((d) => d.id.toLowerCase()));
}

/** Top real-user cards of a week from the leaderboard the scorer already writes. */
async function readWeekTop(gameweek: string, n = 40): Promise<WeeklyWinner[]> {
  const db = getAdminFirestore();
  const bots = await loadBotSet();
  const snap = await db.collection(`draftTokenLeaderboard/${gameweek}/cards`).orderBy('ScoreWeek', 'desc').limit(n).get();
  const rows: WeeklyWinner[] = [];
  for (const d of snap.docs) {
    const x = d.data() as Record<string, unknown>;
    const card = (x.Card ?? {}) as Record<string, unknown>;
    const ownerId = String(x.OwnerId ?? card.OwnerId ?? '').toLowerCase();
    const scoreWeek = Number(x.ScoreWeek ?? 0);
    if (!ownerId || bots.has(ownerId) || !(scoreWeek > 0)) continue;
    // Special/promo seats are keyed by a synthetic card id; their on-chain token (if linked) is Card.RealTokenId.
    const real = String(card.RealTokenId ?? card.realTokenId ?? x.RealTokenId ?? '');
    const chainTokenId = /^\d+$/.test(d.id) ? d.id : (/^\d+$/.test(real) ? real : null);
    rows.push({
      place: 0, tokenId: chainTokenId ?? d.id, cardId: d.id, chainTokenId, ownerId, amount: 0, scoreWeek, scoreSeason: Number(x.ScoreSeason ?? 0),
      draftId: String(card.LeagueId ?? ''), leagueName: String(card.LeagueDisplayName ?? ''), level: String(x.Level ?? card.Level ?? 'Pro'),
    });
  }
  return rows;
}

/**
 * Award a finished gameweek's top-5. Idempotent (weekly_awards/{gw}); refuses on a tie at any paid
 * boundary unless `winners` (place → tokenId, decided by Boris) is supplied.
 */
export async function awardWeeklyPrizes(gameweek: string, opts: { dryRun?: boolean; winners?: Array<{ place: number; tokenId: string }>; source?: string } = {}): Promise<AwardResult> {
  if (!isFirestoreConfigured()) return { status: 'skipped', gameweek, reason: 'firestore not configured' };
  const db = getAdminFirestore();
  const week = weekOf(gameweek);
  if (week < 1 || week > WEEKLY_PRIZE_WEEKS) return { status: 'skipped', gameweek, reason: `week ${week} has no weekly prize` };
  if (currentWeekNumber() <= week) return { status: 'skipped', gameweek, reason: 'week not over yet (rolls Tuesday 3am PT)' };
  const awardRef = db.collection(WEEKLY_AWARDS).doc(gameweek);
  const existing = (await awardRef.get()).data();
  if (existing?.status === 'awarded') return { status: 'already', gameweek, winners: existing.winners as WeeklyWinner[] };

  const prizes = await getWeeklyPrizeTable();
  const rows = await readWeekTop(gameweek);
  if (rows.length < 5) return { status: 'skipped', gameweek, reason: `only ${rows.length} scored real-user cards on the week leaderboard` };

  let winners: WeeklyWinner[];
  if (opts.winners?.length) {
    const byToken = new Map(rows.map((r) => [r.tokenId, r]));
    winners = opts.winners
      .sort((a, b) => a.place - b.place)
      .map((w) => {
        const r = byToken.get(String(w.tokenId));
        if (!r || w.place < 1 || w.place > 5) throw new Error(`token ${w.tokenId} is not in the top ${rows.length} for ${gameweek} or place ${w.place} invalid`);
        return { ...r, place: w.place, amount: prizes[w.place - 1] };
      });
    if (new Set(winners.map((w) => w.place)).size !== 5 || new Set(winners.map((w) => w.tokenId)).size !== 5) throw new Error('winners must cover places 1–5 with 5 distinct tokens');
  } else {
    for (let i = 0; i < 5; i++) {
      if (rows[i + 1] && rows[i].scoreWeek === rows[i + 1].scoreWeek) {
        const candidates = rows.slice(0, 8).map((r, idx) => ({ ...r, place: idx + 1, amount: prizes[idx] ?? 0 }));
        if (!opts.dryRun) {
          await awardRef.set({ status: 'tie', gameweek, tieAtPlace: i + 1, candidates, prizeTable: prizes, checkedAt: new Date().toISOString() }, { merge: true });
          await createNotification(ADMIN_BELL_WALLET, {
            type: 'promo', title: `Week ${week} prizes: tie at ${ordinal(i + 1)} place`, icon: 'trophy', link: '/admin',
            message: `${candidates[i].leagueName} and ${candidates[i + 1].leagueName} both scored ${candidates[i].scoreWeek}. Nothing awarded — decide the order, then award from admin.`,
            dedupeKey: `weekly-prize-tie-${gameweek}`,
          });
        }
        return { status: 'tie', gameweek, tieAtPlace: i + 1, candidates };
      }
    }
    winners = rows.slice(0, 5).map((r, i) => ({ ...r, place: i + 1, amount: prizes[i] }));
  }
  if (opts.dryRun) return { status: 'dry', gameweek, winners };

  const now = new Date().toISOString();
  await db.runTransaction(async (tx) => {
    const cur = (await tx.get(awardRef)).data();
    if (cur?.status === 'awarded') return;
    for (const w of winners) {
      const ref = db.collection(CARD_WINNINGS).doc(w.tokenId);
      const award: CardAward = { gameweek, week, place: w.place, amount: w.amount, awardedAt: now, ownerAtAward: w.ownerId, scoreWeek: w.scoreWeek };
      tx.set(ref, {
        tokenId: w.tokenId, cardId: w.cardId, chainTokenId: w.chainTokenId, draftId: w.draftId, leagueName: w.leagueName, level: w.level, ownerAtLastAward: w.ownerId,
        onCard: FieldValue.increment(w.amount), totalAwarded: FieldValue.increment(w.amount), transferred: FieldValue.increment(0),
        awards: FieldValue.arrayUnion(award), updatedAt: now,
      }, { merge: true });
    }
    tx.set(awardRef, { status: 'awarded', gameweek, week, winners, prizeTable: prizes, awardedAt: now, source: opts.source ?? 'cron' }, { merge: true });
  });
  logger.info('weekly_prizes.awarded', { gameweek, winners: winners.map((w) => `${w.place}:${w.tokenId}:$${w.amount}`) });

  // No winner bells (Boris 2026-09-14) — the prize shows on the card and on /winnings.
  try { await refreshOpenSeaTokens(winners.map((w) => w.tokenId)); } catch { /* OpenSea picks the PRIZES trait up lazily anyway */ }
  await createNotification(ADMIN_BELL_WALLET, {
    type: 'promo', icon: 'trophy', link: '/admin', dedupeKey: `weekly-prize-done-${gameweek}`,
    title: `Week ${week} prizes awarded`,
    message: winners.map((w) => `${ordinal(w.place)} $${w.amount} · ${w.leagueName} (${w.scoreWeek.toFixed(1)})`).join(' · '),
  });
  return { status: 'awarded', gameweek, winners };
}

// ── ownership (on-chain = truth; winnings follow the card when it's sold) ─────────────────────
const ERC721_OWNER_OF = [{ type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'address' }] }] as const;
const ownerMemo = new Map<string, { at: number; owner: string }>();
const OWNER_TTL_MS = 60_000;
export async function resolveOnchainOwners(tokenIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const need = tokenIds.filter((t) => /^\d+$/.test(t)).filter((t) => { const m = ownerMemo.get(t); if (m && Date.now() - m.at < OWNER_TTL_MS) { out.set(t, m.owner); return false; } return true; });
  if (need.length) {
    const client = createPublicClient({ chain: BASE, transport: http(BASE_RPC_URL) });
    await Promise.all(need.map(async (t) => {
      try {
        const owner = (await client.readContract({ address: BBB4_CONTRACT_ADDRESS as Address, abi: ERC721_OWNER_OF, functionName: 'ownerOf', args: [BigInt(t)] })) as string;
        ownerMemo.set(t, { at: Date.now(), owner: owner.toLowerCase() }); out.set(t, owner.toLowerCase());
      } catch (err) { logger.warn('card_winnings.owner_of_failed', { tokenId: t, err: String(err) }); }
    }));
  }
  return out;
}

function toCard(id: string, x: Record<string, unknown>): CardWinnings {
  return {
    tokenId: id, cardId: String(x.cardId ?? id), chainTokenId: x.chainTokenId == null ? null : String(x.chainTokenId), draftId: String(x.draftId ?? ''), leagueName: String(x.leagueName ?? ''), level: String(x.level ?? 'Pro'),
    onCard: r2(Number(x.onCard ?? 0)), totalAwarded: r2(Number(x.totalAwarded ?? 0)), transferred: r2(Number(x.transferred ?? 0)),
    awards: (x.awards as CardAward[]) ?? [], transfers: (x.transfers as CardTransfer[]) ?? [], ownerAtLastAward: String(x.ownerAtLastAward ?? ''),
  };
}

export async function getCardWinningsForTokens(tokenIds: string[]): Promise<Map<string, CardWinnings>> {
  const db = getAdminFirestore(); const out = new Map<string, CardWinnings>();
  const ids = Array.from(new Set(tokenIds.filter((t) => /^\d+$/.test(t))));
  for (let i = 0; i < ids.length; i += 30) {
    const snap = await db.collection(CARD_WINNINGS).where(FieldPath.documentId(), 'in', ids.slice(i, i + 30)).get();
    for (const d of snap.docs) out.set(d.id, toCard(d.id, d.data()));
  }
  return out;
}

/** Cards with money on them that `wallet` currently owns on-chain. */
export async function getCardWinningsForOwner(wallet: string): Promise<CardWinnings[]> {
  const w = wallet.toLowerCase();
  const snap = await getAdminFirestore().collection(CARD_WINNINGS).where('onCard', '>', 0).limit(500).get();
  if (snap.empty) return [];
  const owners = await resolveOnchainOwners(snap.docs.map((d) => d.id));
  // Linked cards: on-chain owner is the truth (winnings follow a sold card). Unlinked special seats: the engine owner at award.
  return snap.docs.map((d) => toCard(d.id, d.data())).filter((c) => (c.chainTokenId ? owners.get(c.tokenId) === w : c.ownerAtLastAward === w));
}

/**
 * Move each card's full on-card amount into the caller's site balance (a pending prize record).
 * `tokenIds` omitted = every card they own with money on it. Ownership is checked on-chain per card.
 */
export async function transferCardWinnings(wallet: string, tokenIds?: string[]): Promise<{ transferred: Array<{ tokenId: string; amount: number; leagueName: string }>; total: number; skipped: Array<{ tokenId: string; reason: string }> }> {
  const w = wallet.toLowerCase(); const db = getAdminFirestore();
  const cards = tokenIds?.length ? Array.from((await getCardWinningsForTokens(tokenIds)).values()) : await getCardWinningsForOwner(w);
  const owners = tokenIds?.length ? await resolveOnchainOwners(cards.map((c) => c.tokenId)) : new Map(cards.map((c) => [c.tokenId, w]));
  const transferred: Array<{ tokenId: string; amount: number; leagueName: string }> = []; const skipped: Array<{ tokenId: string; reason: string }> = [];
  for (const c of cards) {
    const isOwner = c.chainTokenId ? owners.get(c.tokenId) === w : c.ownerAtLastAward === w;
    if (!isOwner) { skipped.push({ tokenId: c.tokenId, reason: 'not the current owner' }); continue; }
    if (!(c.onCard > 0)) { skipped.push({ tokenId: c.tokenId, reason: 'nothing on this card' }); continue; }
    const seq = (c.transfers?.length ?? 0) + 1;
    const prizeId = `syn_cw_${c.tokenId}_${seq}`;
    const weeks = c.awards.filter((a) => !c.transfers.some((t) => t.at >= a.awardedAt)).map((a) => `Wk ${a.week} ${ordinal(a.place)}`).join(', ') || 'Weekly prize';
    const contestName = `${weeks} · ${c.leagueName || `#${c.tokenId}`}`;
    const created = await createPrizeRecordWithId(prizeId, { userId: w, amount: c.onCard, contestName, draftId: c.draftId || undefined, note: `card_winnings transfer #${seq} from token ${c.tokenId}` });
    if (created === null) { skipped.push({ tokenId: c.tokenId, reason: 'ledger unavailable' }); continue; }
    const amount = await db.runTransaction(async (tx) => {
      const ref = db.collection(CARD_WINNINGS).doc(c.tokenId);
      const cur = (await tx.get(ref)).data() as Record<string, unknown> | undefined;
      const onCard = r2(Number(cur?.onCard ?? 0));
      if (!(onCard > 0)) return 0;
      tx.update(ref, { onCard: 0, transferred: FieldValue.increment(onCard), transfers: FieldValue.arrayUnion({ id: prizeId, amount: onCard, at: new Date().toISOString(), to: w }), updatedAt: new Date().toISOString() });
      return onCard;
    });
    if (amount > 0) transferred.push({ tokenId: c.tokenId, amount, leagueName: c.leagueName });
    else skipped.push({ tokenId: c.tokenId, reason: 'already transferred' });
  }
  const total = r2(transferred.reduce((s, t) => s + t.amount, 0));
  if (transferred.length) logger.info('card_winnings.transferred', { wallet: w, total, tokens: transferred.map((t) => t.tokenId) });
  return { transferred, total, skipped };
}

export function previousGameweek(): string | null {
  const wk = currentWeekNumber() - 1;
  return wk >= 1 ? gameweekString(wk) : null;
}
