/**
 * The Banana Vault — every player gets their OWN secret 4-slot combo
 * (seed-sealed per wallet). Every filled draft can "click" one tumbler: if
 * your pick slot (1-10, random every draft) is one of your 4 numbers, it
 * clicks open. First 3 players to click all 4 win a Jackpot seat; first 5 to
 * click 2 tumblers WITH PAID DRAFTS win 2 Free Spins each.
 *
 * Design decisions (Boris 2026-08-15 — argued through, do not re-litigate):
 *  - PERSONAL combos, never a shared one: every draft seats all 10 slots, so
 *    any shared-combo "first to land it" mechanic resolves in draft one.
 *  - ANY order. Unclicked tumblers never reveal their numbers (mystery to the
 *    last click; slots are randomly assigned so hidden info costs nothing).
 *  - Clicks COUNT at draft-fill time (races resolve by fill order — nobody
 *    loses a prize while asleep). The TAP only reveals; prizes are locked at
 *    fill but delivered on CLAIM press (reveal → claim = two dopamine hits).
 *  - Caps are law: ≤VAULT_SPIN_WINNERS spin bounties + ≤seatsCap seats per
 *    vault, ties never exceed them (overflow decided by processing order,
 *    which is itself seed-permuted per draft — deterministic + fair).
 *  - Free + paid drafts both count toward the SEAT; only paid clicks count
 *    toward the spin bounty ([[free drafts never earn promos]] — a seat is an
 *    entry, spins are liquid).
 *  - Campaign: Vault 1: 3 seats → Vault 2: 3 → Vault 3: 4 = 10 winners → one
 *    exclusive Vault Jackpot lobby (source 'vault', only vault winners ever).
 *    Unclaimed seats roll into the next vault.
 *
 * Collections
 *   banana_vault/state    public race doc: vaultNumber, opensAtMs, closesAtMs,
 *                         seatsCap, seedHash, seatWinners[], spinWinners[]
 *   banana_vault/secret   server-only: the seed (revealed at vault close for
 *                         verification — combo = HMAC(seed:vaultN, wallet))
 *   v2_users/{uid}/promos/banana-vault  per-user: vaultNumber, clicks[],
 *                         seen-draft ledger, won/claim stamps
 */

import { createHmac } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { unlockBadge } from '@/lib/db';
import { VISIBLE_PROMO_TYPES } from '@/lib/promoFilter';
import { pushStreamEventBg } from '@/lib/userEventStream';
import type { Promo } from '@/types';

export const VAULT_PROMO_ID = 'banana-vault';
export const VAULT_COMBO_SIZE = 4;
export const VAULT_SPIN_WINNERS = 5;
export const VAULT_SPINS_PER_WIN = 2;
export const VAULT_WINDOW_MS = 48 * 3600 * 1000;
const VAULT_SEEN_LEDGER_MAX = 120;

const STATE_COLLECTION = 'banana_vault';
const STATE_DOC = 'state';
const SECRET_DOC = 'secret';

export interface VaultClick {
  slot: number;
  at: string;
  paid: boolean;
  revealed: boolean;
}

export interface VaultSeatWinner {
  userId: string;
  /** 1-indexed across the whole campaign — seat 4 = first seat of Vault 2. */
  seat: number;
  vaultNumber: number;
  at: string;
  claimed: boolean;
  seatGranted: boolean;
}

export interface VaultSpinWinner {
  userId: string;
  vaultNumber: number;
  at: string;
  claimed: boolean;
}

export interface VaultState {
  vaultNumber: number;
  opensAtMs: number;
  closesAtMs: number;
  /**

 seats available in THIS vault (3, 3, then 4 + rollover). */
  seatsCap: number;
  seedHash: string;
  seatWinners: VaultSeatWinner[];
  spinWinners: VaultSpinWinner[];
}

export async function getVaultState(): Promise<VaultState | null> {
  if (!isFirestoreConfigured()) return null;
  const snap = await getAdminFirestore().collection(STATE_COLLECTION).doc(STATE_DOC).get();
  if (!snap.exists) return null;
  return snap.data() as VaultState;
}

export function vaultOpen(state: VaultState | null, now: number = Date.now()): boolean {
  return !!state
    && now >= state.opensAtMs
    && now < state.closesAtMs
    && VISIBLE_PROMO_TYPES.has('banana-vault');
}

/**
 * Derive a wallet's secret combo for a vault: HMAC(seed:vaultNumber, wallet)
 * drives a Fisher-Yates over slots 1..10; the first VAULT_COMBO_SIZE are the
 * combo. Deterministic + verifiable once the seed is revealed at vault close.
 */
export function comboForWallet(seed: string, vaultNumber: number, wallet: string): number[] {
  const mac = createHmac('sha256', `${seed}:${vaultNumber}`)
    .update(wallet.toLowerCase()).digest();
  const slots = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  for (let i = slots.length - 1; i > 0; i--) {
    const j = mac[(slots.length - 1 - i) % mac.length] % (i + 1);
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  return slots.slice(0, VAULT_COMBO_SIZE).sort((a, b) => a - b);
}

async function getSeed(): Promise<string | null> {
  const snap = await getAdminFirestore().collection(STATE_COLLECTION).doc(SECRET_DOC).get();
  return (snap.data()?.seed as string | undefined) ?? null;
}

/**
 * Credit one revealed draft slot toward a user's vault. Called from
 * reveal-complete + refresh-draft (the same two hooks as ATB — never the fill
 * webhook, the draft order isn't there yet). Idempotent per (user, draftId).
 *
 * Races resolve by processing order within the fill, which follows the seat
 * iteration order of the caller — acceptable because prizes are capped and
 * same-fill multi-completions are rare; the caps can never be exceeded.
 */
export async function recordBananaVault(
  userId: string,
  draftId: string,
  draftName: string,
  slot: number,
): Promise<void> {
  const state = await getVaultState();
  if (!vaultOpen(state)) return;
  if (!Number.isInteger(slot) || slot < 1 || slot > 10) return;
  const seed = await getSeed();
  if (!seed) return;

  const db = getAdminFirestore();
  const combo = comboForWallet(seed, state!.vaultNumber, userId);
  const inCombo = combo.includes(slot);

  // Paid-or-free for THIS draft: the token the user spent on this league.
  let isPaid = false;
  try {
    const tok = await db.collection('draftTokens')
      .where('OwnerId', '==', userId.toLowerCase())
      .where('LeagueId', '==', draftId).limit(1).get();
    isPaid = !tok.empty && tok.docs[0].data()?.PassType === 'paid';
  } catch { /* default free — never blocks the seat path */ }

  const promoRef = db.collection('v2_users').doc(userId)
    .collection('promos').doc(VAULT_PROMO_ID);
  const stateRef = db.collection(STATE_COLLECTION).doc(STATE_DOC);

  const result = await db.runTransaction(async (tx) => {
    const [promoSnap, stateSnap] = await Promise.all([tx.get(promoRef), tx.get(stateRef)]);
    if (!promoSnap.exists) return { wonSeat: 0, wonSpins: false, newClick: false };
    const promo = promoSnap.data() as Promo;
    if (promo.type !== 'banana-vault') return { wonSeat: 0, wonSpins: false, newClick: false };

    const st = stateSnap.data() as VaultState;
    if (Date.now() >= st.closesAtMs) return { wonSeat: 0, wonSpins: false, newClick: false };

    const mc = (promo.modalContent || {}) as Record<string, unknown>;
    // New vault → fresh hand (clicks reset each vault; seen ledger persists).
    const docVault = (mc.vaultNumber as number | undefined) ?? st.vaultNumber;
    let clicks = docVault === st.vaultNumber
      ? (((mc.vaultClicks as VaultClick[] | undefined)) || [])
      : [];
    const seen = (mc.vaultSeenDraftIds as string[] | undefined) || [];
    if (seen.includes(draftId)) return { wonSeat: 0, wonSpins: false, newClick: false };

    const nowIso = new Date().toISOString();
    const alreadyClicked = clicks.some((c) => c.slot === slot);
    const newClick = inCombo && !alreadyClicked;
    if (newClick) {
      clicks = [...clicks, { slot, at: nowIso, paid: isPaid, revealed: false }];
    }

    // Dead-slot map (Boris 8/15): slots the user LANDED that aren't in their
    // combo get remembered — once revealed by a tap, the card can mark them ✕
    // so they know ahead of time nothing good lives there. Earned info only —
    // never reveals untried slots.
    let misses = docVault === st.vaultNumber
      ? (((mc.vaultMisses as Array<{ slot: number; revealed: boolean }> | undefined)) || [])
      : [];
    if (!inCombo && !misses.some((m) => m.slot === slot)) {
      misses = [...misses, { slot, revealed: false }];
    }

    const update: Record<string, unknown> = {
      progressCurrent: clicks.length,
      updatedAt: nowIso,
      modalContent: {
        vaultNumber: st.vaultNumber,
        vaultClicks: clicks,
        vaultMisses: misses,
        vaultSeenDraftIds: [...seen, draftId].slice(-VAULT_SEEN_LEDGER_MAX),
      },
    };

    let wonSeat = 0;
    let wonSpins = false;

    if (newClick) {
      // Spin bounty: first VAULT_SPIN_WINNERS to reach 2 PAID clicks.
      const paidClicks = clicks.filter((c) => c.paid).length;
      const spinWinners = (st.spinWinners || []).filter((w) => w.vaultNumber === st.vaultNumber);
      const alreadySpinWon = spinWinners.some((w) => w.userId === userId);
      if (paidClicks >= 2 && !alreadySpinWon && spinWinners.length < VAULT_SPIN_WINNERS) {
        wonSpins = true;
        tx.set(stateRef, {
          spinWinners: FieldValue.arrayUnion({
            userId, vaultNumber: st.vaultNumber, at: nowIso, claimed: false,
          } satisfies VaultSpinWinner),
        }, { merge: true });
        (update.modalContent as Record<string, unknown>).vaultSpinsWonAt = nowIso;
      }

      // The crack: all 4 clicked → seat, if this vault has any left.
      const seatWinners = st.seatWinners || [];
      const thisVaultSeats = seatWinners.filter((w) => w.vaultNumber === st.vaultNumber);
      const alreadySeated = seatWinners.some((w) => w.userId === userId);
      if (clicks.length >= VAULT_COMBO_SIZE && !alreadySeated
          && thisVaultSeats.length < st.seatsCap) {
        wonSeat = seatWinners.length + 1;
        (update.modalContent as Record<string, unknown>).vaultWonAt = nowIso;
        (update.modalContent as Record<string, unknown>).vaultSeatNumber = wonSeat;
        tx.set(stateRef, {
          seatWinners: FieldValue.arrayUnion({
            userId, seat: wonSeat, vaultNumber: st.vaultNumber, at: nowIso,
            claimed: false, seatGranted: false,
          } satisfies VaultSeatWinner),
        }, { merge: true });
      }
    }

    tx.set(promoRef, update, { merge: true });
    return { wonSeat, wonSpins, newClick };
  });

  if (result.newClick) {
    // Silent refetch ping — the card pulses "TAP TO CHECK" the moment a fill
    // lands a click. The reveal itself stays face-down until they press.
    pushStreamEventBg(userId, 'notification', { draftId, source: 'banana-vault' });
  }
  if (result.wonSeat > 0) {
    logger.info('vault.seat_locked', { userId, seat: result.wonSeat });
  }
  if (result.wonSpins) {
    logger.info('vault.spins_locked', { userId });
  }
}

/** Tap: flip all unrevealed clicks face-up and return them. */
export async function revealVaultClicks(userId: string): Promise<{ clicks: VaultClick[]; missedSlots: number[] }> {
  const db = getAdminFirestore();
  const promoRef = db.collection('v2_users').doc(userId)
    .collection('promos').doc(VAULT_PROMO_ID);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(promoRef);
    if (!snap.exists) return { clicks: [], missedSlots: [] };
    const mc = (snap.data()?.modalContent || {}) as Record<string, unknown>;
    const clicks = ((mc.vaultClicks as VaultClick[] | undefined) || []);
    const misses = ((mc.vaultMisses as Array<{ slot: number; revealed: boolean }> | undefined) || []);
    const freshClicks = clicks.filter((c) => !c.revealed);
    const freshMisses = misses.filter((m) => !m.revealed).map((m) => m.slot);
    if (freshClicks.length === 0 && freshMisses.length === 0) return { clicks: [], missedSlots: [] };
    tx.set(promoRef, {
      modalContent: {
        vaultClicks: clicks.map((c) => ({ ...c, revealed: true })),
        vaultMisses: misses.map((m) => ({ ...m, revealed: true })),
      },
    }, { merge: true });
    return { clicks: freshClicks, missedSlots: freshMisses };
  });
}

/** Claim the 2-spin bounty (locked at fill, delivered on press). */
export async function claimVaultSpins(userId: string): Promise<{ ok: boolean; spins: number }> {
  const db = getAdminFirestore();
  const stateRef = db.collection(STATE_COLLECTION).doc(STATE_DOC);
  const userRef = db.collection('v2_users').doc(userId);
  const claimed = await db.runTransaction(async (tx) => {
    const st = (await tx.get(stateRef)).data() as VaultState | undefined;
    if (!st) return false;
    const mine = (st.spinWinners || []).find((w) => w.userId === userId && !w.claimed);
    if (!mine) return false;
    tx.set(stateRef, {
      spinWinners: (st.spinWinners || []).map((w) =>
        (w.userId === userId && w.vaultNumber === mine.vaultNumber ? { ...w, claimed: true } : w)),
    }, { merge: true });
    tx.set(userRef, { wheelSpins: FieldValue.increment(VAULT_SPINS_PER_WIN) }, { merge: true });
    const evtRef = db.collection('v2_activity_events').doc();
    tx.set(evtRef, {
      type: 'promo_claimed', userId, walletAddress: userId,
      quantity: VAULT_SPINS_PER_WIN, tokenIds: [], txHash: null, walletType: 'privy',
      paymentMethod: null,
      metadata: { promoType: 'banana-vault', source: 'vault-spin-bounty', spinsAdded: VAULT_SPINS_PER_WIN },
      devicePlatform: 'unknown', userAgent: null,
      createdAt: FieldValue.serverTimestamp(), createdAtIso: new Date().toISOString(),
    });
    return true;
  });
  return { ok: claimed, spins: claimed ? VAULT_SPINS_PER_WIN : 0 };
}

/** Claim the Jackpot seat — mints the pass and queues it in the vault-only lobby. */
export async function claimVaultSeat(userId: string): Promise<{ ok: boolean }> {
  const db = getAdminFirestore();
  const stateRef = db.collection(STATE_COLLECTION).doc(STATE_DOC);
  const winner = await db.runTransaction(async (tx) => {
    const st = (await tx.get(stateRef)).data() as VaultState | undefined;
    if (!st) return null;
    const mine = (st.seatWinners || []).find((w) => w.userId === userId && !w.claimed);
    if (!mine) return null;
    tx.set(stateRef, {
      seatWinners: (st.seatWinners || []).map((w) =>
        (w.userId === userId && w.seat === mine.seat ? { ...w, claimed: true } : w)),
    }, { merge: true });
    return mine;
  });
  if (!winner) return { ok: false };
  await awardVaultSeat(userId, winner.seat)
    .catch((err) => logger.error('vault.seat_failed', { userId, seat: winner.seat, err: String(err) }));
  return { ok: true };
}

/**
 * Mint + queue the Jackpot seat — awardAtbSeat lifted with source 'vault':
 * the Vault lobby can ONLY ever contain vault winners.
 */
async function awardVaultSeat(winnerId: string, seat: number): Promise<void> {
  const db = getAdminFirestore();
  let seated = false;

  const { isAdminMintConfigured, reserveTokensToWallet } = await import('@/lib/onchain/adminMint');
  if (isAdminMintConfigured()) {
    try {
      const res = await reserveTokensToWallet({ to: winnerId, count: 1 });
      const { recordPassOrigins } = await import('@/lib/onchain/passOrigin');
      await recordPassOrigins({
        tokenIds: res.tokenIds, origin: 'admin_grant', ownerAtMint: winnerId,
        txHash: res.txHash, reason: `banana-vault:seat-${seat}`, level: 'jackpot',
      });
      const { registerMintedTokens } = await import('@/lib/onchain/reconcilePasses');
      await registerMintedTokens(winnerId, res.tokenIds, 'free')
        .catch((e) => logger.warn('vault.register_go_failed', { winnerId, err: (e as Error).message }));
      await Promise.all(res.tokenIds.map((tid) => db
        .collection('owners').doc(winnerId.toLowerCase())
        .collection('validDraftTokens').doc(String(tid))
        .set({ Level: 'Jackpot' }, { merge: true })));
      const tokenId = res.tokenIds[0];
      if (tokenId) {
        const { joinQueueWithToken } = await import('@/lib/db');
        const { joinedRoundId } = await joinQueueWithToken(winnerId, 'jackpot', String(tokenId), 'vault');
        if (joinedRoundId !== null) {
          const { ensureSpecialDraftSeat } = await import('@/lib/specialDraft');
          await ensureSpecialDraftSeat('jackpot', joinedRoundId, winnerId);
        }
        seated = true;
        logger.info('vault.seated_with_token', { winnerId, seat, tokenId, round: joinedRoundId });
      }
    } catch (mintErr) {
      logger.error('vault.mint_failed', { winnerId, seat, err: (mintErr as Error).message });
    }
  }

  if (!seated) {
    await db.collection('v2_users').doc(winnerId)
      .set({ jackpotEntries: FieldValue.increment(1) }, { merge: true });
    const { joinQueue } = await import('@/lib/db');
    const { joinedRoundIds } = await joinQueue(winnerId, 'jackpot', 'vault');
    const { ensureSpecialDraftSeat } = await import('@/lib/specialDraft');
    for (const rid of joinedRoundIds) await ensureSpecialDraftSeat('jackpot', rid, winnerId);
    logger.warn('vault.seated_legacy_no_token', { winnerId, seat, rounds: joinedRoundIds });
  }

  await db.runTransaction(async (tx) => {
    const ref = db.collection(STATE_COLLECTION).doc(STATE_DOC);
    const winners = ((await tx.get(ref)).data()?.seatWinners ?? []) as VaultSeatWinner[];
    tx.set(ref, {
      seatWinners: winners.map((w) => (w.userId === winnerId && w.seat === seat ? { ...w, seatGranted: true } : w)),
    }, { merge: true });
  }).catch((err) => logger.warn('vault.grant_mark_failed', { winnerId, err: String(err) }));

  await unlockBadge(winnerId, 'jackpot-club', { source: 'banana-vault', seat })
    .catch((err) => logger.warn('vault.badge_failed', { winnerId, err: String(err) }));
}

/** Card payload for /api/vault/state — everything the tumbler UI needs. */
export async function getVaultCardState(wallet: string | null): Promise<Record<string, unknown> | null> {
  const state = await getVaultState();
  if (!state) return null;
  const seatsTaken = (state.seatWinners || [])
    .filter((w) => w.vaultNumber === state.vaultNumber).length;
  const spinsTaken = (state.spinWinners || [])
    .filter((w) => w.vaultNumber === state.vaultNumber).length;
  const base: Record<string, unknown> = {
    vaultNumber: state.vaultNumber,
    opensAtMs: state.opensAtMs,
    closesAtMs: state.closesAtMs,
    open: vaultOpen(state),
    seatsCap: state.seatsCap,
    seatsLeft: Math.max(0, state.seatsCap - seatsTaken),
    spinBountiesLeft: Math.max(0, VAULT_SPIN_WINNERS - spinsTaken),
  };
  if (!wallet) return base;

  const db = getAdminFirestore();
  const promoSnap = await db.collection('v2_users').doc(wallet)
    .collection('promos').doc(VAULT_PROMO_ID).get();
  const mc = (promoSnap.data()?.modalContent || {}) as Record<string, unknown>;
  const docVault = (mc.vaultNumber as number | undefined) ?? state.vaultNumber;
  const clicks = docVault === state.vaultNumber
    ? (((mc.vaultClicks as VaultClick[] | undefined)) || []) : [];
  const misses = docVault === state.vaultNumber
    ? (((mc.vaultMisses as Array<{ slot: number; revealed: boolean }> | undefined)) || []) : [];
  const revealed = clicks.filter((c) => c.revealed).map((c) => ({ slot: c.slot, paid: c.paid }));
  const missedSlots = misses.filter((m) => m.revealed).map((m) => m.slot).sort((a, b) => a - b);
  const unrevealedCount = clicks.filter((c) => !c.revealed).length + misses.filter((m) => !m.revealed).length;
  const mySeat = (state.seatWinners || []).find((w) => w.userId === wallet);
  const mySpins = (state.spinWinners || []).find((w) => w.userId === wallet && w.vaultNumber === state.vaultNumber);
  return {
    ...base,
    revealed,
    missedSlots,
    unrevealedCount,
    clickedCount: clicks.length,
    seatWon: !!mySeat,
    seatClaimable: !!mySeat && !mySeat.claimed,
    spinsClaimable: !!mySpins && !mySpins.claimed,
  };
}
