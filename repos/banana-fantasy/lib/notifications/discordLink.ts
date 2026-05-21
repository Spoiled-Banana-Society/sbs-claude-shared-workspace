/**
 * Discord account linking via OAuth2 (`identify` scope).
 *
 * Flow:
 *   1. signed-in user → createDiscordAuthUrl() — mints a one-time `state`
 *      token bound to their wallet, returns the Discord authorize URL.
 *   2. user authorizes → Discord redirects back with `code` + `state`.
 *   3. callback → consumeDiscordState() validates the state, then
 *      linkDiscordAccount() exchanges the code for the user's Discord id
 *      and stores it on their notification prefs.
 *
 * We only need the Discord user id (to @-mention them via the channel
 * webhook), so `identify` is the only scope requested.
 */

import { randomBytes } from 'crypto';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { setUserNotifPrefs } from './prefs';

const TOKEN_COLLECTION = 'notificationLinkTokens';
const TOKEN_TTL_MS = 15 * 60 * 1000;

/**
 * Build the Discord OAuth authorize URL. The `state` is a one-time token
 * bound to the wallet. Returns null if Discord isn't configured.
 */
export async function createDiscordAuthUrl(
  walletAddress: string,
  redirectUri: string,
): Promise<string | null> {
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) return null;

  const wallet = walletAddress.trim().toLowerCase();
  const state = randomBytes(24).toString('base64url');

  if (isFirestoreConfigured()) {
    await getAdminFirestore()
      .collection(TOKEN_COLLECTION)
      .doc(state)
      .set({
        walletAddress: wallet,
        channel: 'discord',
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: Date.now() + TOKEN_TTL_MS,
      });
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify',
    state,
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

/** Validate the OAuth `state` token; returns the bound wallet, or null. */
export async function consumeDiscordState(state: string): Promise<string | null> {
  if (!state || !isFirestoreConfigured()) return null;

  const ref = getAdminFirestore().collection(TOKEN_COLLECTION).doc(state);
  const snap = await ref.get();
  if (!snap.exists) return null;

  const d = snap.data() || {};
  if (d.consumedAt) return null;
  if (typeof d.expiresAt === 'number' && d.expiresAt < Date.now()) return null;
  if (d.channel !== 'discord') return null;

  const wallet = String(d.walletAddress || '').toLowerCase();
  if (!wallet) return null;

  await ref.set({ consumedAt: FieldValue.serverTimestamp() }, { merge: true });
  return wallet;
}

/**
 * Exchange an OAuth code for the user's Discord id and link it to the
 * wallet. Returns the Discord id, or null on any failure.
 */
export async function linkDiscordAccount(
  walletAddress: string,
  code: string,
  redirectUri: string,
): Promise<string | null> {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }).toString(),
    });
    if (!tokenRes.ok) return null;
    const { access_token: accessToken } = await tokenRes.json();
    if (!accessToken) return null;

    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userRes.ok) return null;
    const { id } = await userRes.json();
    if (!id) return null;

    await setUserNotifPrefs(walletAddress, {
      discordId: String(id),
      channels: { discord: true },
    });
    return String(id);
  } catch {
    return null;
  }
}
