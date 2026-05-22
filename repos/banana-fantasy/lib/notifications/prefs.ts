/**
 * Per-user notification preferences — contact info, per-channel opt-in, and
 * per-event opt-in. Single source of truth: Firestore
 * `notificationPrefs/{walletAddress}` (doc id = lowercased wallet).
 */

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import type { ChannelId, EventPrefs, NotifEvent, UserNotifPrefs } from './types';

const COLLECTION = 'notificationPrefs';
const ALL_CHANNELS: ChannelId[] = ['push', 'email', 'telegram', 'discord'];
const ALL_EVENTS: (keyof EventPrefs)[] = ['draftFilled', 'pickSlow', 'pickFast'];

/** Pick length (seconds) at/above which a draft counts as "slow". */
export const SLOW_PICK_THRESHOLD_SECONDS = 3600;

/** Prefs for a user who has never opened the settings page. */
export function defaultPrefs(walletAddress: string): UserNotifPrefs {
  return {
    walletAddress: walletAddress.trim().toLowerCase(),
    channels: { push: true },
  };
}

/** Coerce a stored boolean map to strict booleans, keeping only known keys. */
function coerceFlags<K extends string>(raw: unknown, keys: K[]): Partial<Record<K, boolean>> {
  const out: Partial<Record<K, boolean>> = {};
  if (raw && typeof raw === 'object') {
    for (const k of keys) {
      const v = (raw as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = !!v;
    }
  }
  return out;
}

/** Load a user's prefs, or a safe default if none are stored. */
export async function getUserNotifPrefs(walletAddress: string): Promise<UserNotifPrefs> {
  const wallet = walletAddress.trim().toLowerCase();
  if (!isFirestoreConfigured()) return defaultPrefs(wallet);

  const snap = await getAdminFirestore().collection(COLLECTION).doc(wallet).get();
  if (!snap.exists) return defaultPrefs(wallet);

  const d = snap.data() || {};
  const events = coerceFlags(d.events, ALL_EVENTS);
  return {
    walletAddress: wallet,
    email: typeof d.email === 'string' ? d.email : undefined,
    telegramChatId: d.telegramChatId != null ? String(d.telegramChatId) : undefined,
    discordId: d.discordId != null ? String(d.discordId) : undefined,
    channels: coerceFlags(d.channels, ALL_CHANNELS),
    events: Object.keys(events).length ? events : undefined,
  };
}

/** Merge a partial update into a user's prefs doc. */
export async function setUserNotifPrefs(
  walletAddress: string,
  patch: Partial<Omit<UserNotifPrefs, 'walletAddress'>>,
): Promise<void> {
  const wallet = walletAddress.trim().toLowerCase();
  if (!isFirestoreConfigured()) return;
  await getAdminFirestore()
    .collection(COLLECTION)
    .doc(wallet)
    .set(
      { walletAddress: wallet, ...patch, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
}

/**
 * Truly disconnect a linked channel: clear its stored contact id
 * (telegramChatId / discordId) and switch the channel off. After this the
 * channel reads as "not connected", so the next connect re-runs the full
 * link flow — letting the user link a different account.
 */
export async function unlinkChannel(
  walletAddress: string,
  channel: 'telegram' | 'discord',
): Promise<void> {
  const wallet = walletAddress.trim().toLowerCase();
  if (!isFirestoreConfigured()) return;
  const idField = channel === 'telegram' ? 'telegramChatId' : 'discordId';
  await getAdminFirestore()
    .collection(COLLECTION)
    .doc(wallet)
    .set(
      {
        walletAddress: wallet,
        [idField]: FieldValue.delete(),
        channels: { [channel]: false },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}

/**
 * Whether the user wants this event at all — checked before any channel
 * routing. A missing preference defaults to "on"; only an explicit `false`
 * opts out. "your turn" is split by draft speed via `pickLengthSeconds`.
 */
export function wantsEvent(prefs: UserNotifPrefs, event: NotifEvent): boolean {
  const ev = prefs.events ?? {};
  if (event.type === 'draft.filled') return ev.draftFilled !== false;
  const isSlow = (event.pickLengthSeconds ?? 0) >= SLOW_PICK_THRESHOLD_SECONDS;
  return isSlow ? ev.pickSlow !== false : ev.pickFast !== false;
}
