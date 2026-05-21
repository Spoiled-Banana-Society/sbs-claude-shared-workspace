/**
 * Telegram account linking via a one-time deep-link token.
 *
 * Flow:
 *   1. signed-in user → createTelegramLink() mints a token + `t.me` link
 *   2. user opens the link, taps Start → bot receives `/start <token>`
 *   3. webhook → consumeTelegramLink() validates the token and stores the
 *      user's Telegram chat id on their notification prefs.
 *
 * The token is the only state — no OAuth, no separate account system.
 */

import { randomBytes } from 'crypto';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { setUserNotifPrefs } from './prefs';

const TOKEN_COLLECTION = 'notificationLinkTokens';
const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

/** A URL-safe random token. */
export function generateLinkToken(): string {
  return randomBytes(24).toString('base64url');
}

/** Mint a one-time link token and return the Telegram deep link. */
export async function createTelegramLink(
  walletAddress: string,
): Promise<{ token: string; url: string }> {
  const wallet = walletAddress.trim().toLowerCase();
  const token = generateLinkToken();
  const botName = process.env.TELEGRAM_BOT_NAME || '';

  if (isFirestoreConfigured()) {
    await getAdminFirestore()
      .collection(TOKEN_COLLECTION)
      .doc(token)
      .set({
        walletAddress: wallet,
        channel: 'telegram',
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: Date.now() + TOKEN_TTL_MS,
      });
  }

  return { token, url: `https://t.me/${botName}?start=${token}` };
}

/** Extract the token from a Telegram `/start <token>` message, or null. */
export function parseStartToken(text: string | undefined | null): string | null {
  if (!text) return null;
  const m = text.trim().match(/^\/start(?:@\w+)?\s+(\S+)$/);
  return m ? m[1] : null;
}

/**
 * Consume a link token: validate, link the chat id to the wallet, mark the
 * token used. Returns the linked wallet address, or null if the token is
 * unknown, expired, already consumed, or for the wrong channel.
 */
export async function consumeTelegramLink(
  token: string,
  chatId: string | number,
): Promise<string | null> {
  if (!token || !isFirestoreConfigured()) return null;

  const ref = getAdminFirestore().collection(TOKEN_COLLECTION).doc(token);
  const snap = await ref.get();
  if (!snap.exists) return null;

  const d = snap.data() || {};
  if (d.consumedAt) return null;
  if (typeof d.expiresAt === 'number' && d.expiresAt < Date.now()) return null;
  if (d.channel !== 'telegram') return null;

  const wallet = String(d.walletAddress || '').toLowerCase();
  if (!wallet) return null;

  await setUserNotifPrefs(wallet, {
    telegramChatId: String(chatId),
    channels: { telegram: true },
  });
  await ref.set({ consumedAt: FieldValue.serverTimestamp() }, { merge: true });
  return wallet;
}
