import { FieldValue, type Transaction } from 'firebase-admin/firestore';

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

/**
 * Unified commerce / gameplay activity stream. One collection powers both
 * the user-facing profile history and the admin live-activity feed — single
 * source of truth so the two views can never drift.
 *
 * Distinct from `v2_user_events` (auth lifecycle: signup / login / wallet
 * linked / x_linked). That one tracks *identity* state transitions; this
 * one tracks *economic / gameplay* state transitions (what the user gained
 * or lost and how).
 */

export const ACTIVITY_EVENTS_COLLECTION = 'v2_activity_events';

export type ActivityEventType =
  | 'pass_purchased'      // paid mint confirmed on-chain
  | 'pass_granted'        // admin-grant mint confirmed on-chain
  | 'spin_won'            // wheel spin — any prize
  | 'promo_claimed'       // promo reward claimed (new-user, buy-bonus, referral, etc.)
  | 'draft_entered'       // user entered a draft (a pass is "used")
  | 'draft_filled'        // a draft the user is in hit 10/10 (fill webhook). metadata.passType
                          // says which pass that member used — King-of-Drafts counts ONLY
                          // passType:'paid' rows (tallyKingDrafts filters), free rows are
                          // display-only in the profile feed. Do not drop the free rows
                          // "for cleanliness": that's the bug that made free players'
                          // fills invisible (AceJohn ticket-2681, 2026-08-13).
  | 'draft_left'          // user left a filling draft before start (pass refunded)
  | 'draft_won'           // league finalized, user finished in paying place
  | 'marketplace_sold'    // your listed team sold (in-app relay buys; OpenSea-native sales don't emit)
  | 'marketplace_bought'  // you bought a team on the marketplace (in-app relay buys)
  | 'cashout_completed'   // offramp settled — Coinbase or direct USDC/bank
  | 'deposit_completed'   // card deposit (Add Funds) verified on-chain — metadata: { amountUsd, feeCents, provider }
  // ── Presence events (admin Live Activity only — hidden from the user-facing
  //    profile history; see HIDDEN types in ActivityHistory). metadata carries
  //    { isReturning, isNewAccount, firstSession?, accountCreatedAt? }.
  | 'user_signed_up'      // account seeded for the first time ("just created the account")
  | 'user_returned';      // authenticated activity after ≥6h gap ("logged in / came back")

export type WalletType =
  | 'privy_embedded'      // Privy-managed EOA (social/email login)
  | 'privy_external'      // external wallet linked via Privy (MetaMask, CB Wallet, etc.)
  | 'external_connect'    // direct wallet connect without Privy
  | 'unknown';

export type PaymentMethod = 'usdc' | 'card' | 'free' | null;

export type DevicePlatform = 'desktop' | 'mobile' | 'unknown';

export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  userId: string;
  walletAddress: string;
  username: string | null;
  walletType: WalletType;
  paymentMethod: PaymentMethod;
  quantity: number;
  tokenIds: string[];
  txHash: string | null;
  /** Type-specific fields, e.g. `{ prizeType, promoType, draftType, leagueId, amount }`. */
  metadata: Record<string, unknown>;
  devicePlatform: DevicePlatform;
  userAgent: string | null;
  createdAtIso: string;
}

export interface LogActivityInput {
  type: ActivityEventType;
  userId: string;
  walletAddress?: string | null;
  quantity?: number;
  tokenIds?: string[];
  txHash?: string | null;
  paymentMethod?: PaymentMethod;
  metadata?: Record<string, unknown>;
  userAgent?: string | null;
}

function detectPlatform(userAgent: string | null | undefined): DevicePlatform {
  if (!userAgent) return 'unknown';
  return /iPhone|iPad|iPod|Android|Mobile/i.test(userAgent) ? 'mobile' : 'desktop';
}

/**
 * Read a user's denormalized fields (username, walletType) from v2_users in
 * a single round-trip so each activity event carries its own display context.
 * Denormalizing at write time keeps reads cheap (no join at stream time) and
 * avoids eventual inconsistency when usernames are later edited.
 */
async function loadDenormFields(userId: string): Promise<{ username: string | null; walletType: WalletType; walletAddress: string }> {
  const db = getAdminFirestore();
  const snap = await db.collection('v2_users').doc(userId.toLowerCase()).get();
  const data = snap.exists ? (snap.data() ?? {}) : {};
  // Prefer the set username; else the mirrored Go profile display name
  // (synced hourly — many users only ever name themselves there; Chartsy
  // showed as "Banana 2bc7" in feeds, 2026-08-28).
  const username =
    (typeof data.username === 'string' && !data.username.startsWith('User-') && data.username) ||
    (typeof data.displayName === 'string' && data.displayName) || null;
  const walletType = (typeof data.walletType === 'string' ? data.walletType : 'unknown') as WalletType;
  const walletAddress = (typeof data.walletAddress === 'string' && data.walletAddress)
    ? data.walletAddress
    : userId;
  return { username, walletType, walletAddress };
}

/**
 * Build the activity event document body, ready to write. Used by the
 * transactional helper below so callers can include the activity write in
 * the same Firestore transaction as their counter mutation — guaranteeing
 * the activity log and the user-facing counter never drift.
 *
 * Note: denormalized fields are read OUTSIDE the caller's transaction
 * (best-effort, eventual consistency on those is fine because they're
 * display-only). The actual write happens inside the transaction.
 */
async function buildActivityEventDoc(input: LogActivityInput) {
  const userIdLc = input.userId.toLowerCase();
  const denorm = await loadDenormFields(userIdLc);
  const walletAddress = (input.walletAddress ?? denorm.walletAddress).toLowerCase();
  return {
    type: input.type,
    userId: userIdLc,
    walletAddress,
    username: denorm.username,
    walletType: denorm.walletType,
    paymentMethod: input.paymentMethod ?? null,
    quantity: input.quantity ?? 0,
    tokenIds: input.tokenIds ?? [],
    txHash: input.txHash ?? null,
    metadata: input.metadata ?? {},
    devicePlatform: detectPlatform(input.userAgent),
    userAgent: input.userAgent ?? null,
    createdAt: FieldValue.serverTimestamp(),
    createdAtIso: new Date().toISOString(),
  };
}

/**
 * Add an activity-event write to an existing Firestore transaction. The
 * caller's transaction stays atomic: counter update + activity event commit
 * together or not at all. This is the pattern that keeps the user-facing
 * count and the activity feed perfectly aligned — they're written in the
 * same logical operation.
 *
 * Pre-build the doc body OUTSIDE this function (await `buildActivityEventDoc`),
 * because Firestore transactions disallow new reads after a write.
 */
export function addActivityEventToTx(
  tx: Transaction,
  doc: Awaited<ReturnType<typeof buildActivityEventDoc>>,
): void {
  const db = getAdminFirestore();
  const ref = db.collection(ACTIVITY_EVENTS_COLLECTION).doc();
  tx.set(ref, doc);
}

export { buildActivityEventDoc };

export async function logActivityEvent(input: LogActivityInput): Promise<void> {
  if (!isFirestoreConfigured()) return;
  try {
    const db = getAdminFirestore();
    const userIdLc = input.userId.toLowerCase();
    const denorm = await loadDenormFields(userIdLc);
    const walletAddress = (input.walletAddress ?? denorm.walletAddress).toLowerCase();

    const doc: Omit<ActivityEvent, 'id'> & { createdAt: FieldValue } = {
      type: input.type,
      userId: userIdLc,
      walletAddress,
      username: denorm.username,
      walletType: denorm.walletType,
      paymentMethod: input.paymentMethod ?? null,
      quantity: input.quantity ?? 0,
      tokenIds: input.tokenIds ?? [],
      txHash: input.txHash ?? null,
      metadata: input.metadata ?? {},
      devicePlatform: detectPlatform(input.userAgent),
      userAgent: input.userAgent ?? null,
      createdAt: FieldValue.serverTimestamp(),
      createdAtIso: new Date().toISOString(),
    };

    await db.collection(ACTIVITY_EVENTS_COLLECTION).add(doc);
    logger.debug('activity.logged', { type: input.type, userId: userIdLc, quantity: doc.quantity });
  } catch (err) {
    // Best-effort: never fail the caller because analytics write failed.
    logger.warn('activity.write_failed', { err: (err as Error).message, input });
  }
}
