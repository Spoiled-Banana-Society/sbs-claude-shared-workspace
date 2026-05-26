import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { getPrivyUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { LOG_SOURCES } from '@/lib/logSources';
import { logErrorEvent } from '@/lib/errorEvents';

const COLLECTION = 'notificationSubscriptions';
const PREFS_COLLECTION = 'notificationPrefs';

/**
 * Poll OneSignal for a device's actual subscription state.
 *
 * The browser SDK can report `optedIn: true` locally while OneSignal's
 * server-side `notification_types` is still null/0 (or never lands at
 * all if iOS silently dropped the permission). This is the gap that
 * made every "Connected" toggle a lie. We poll for up to ~5s after the
 * client-side opt-in so the server has the truth before we let the
 * frontend declare success.
 *
 * Returns:
 *   verified=true  → notification_types > 0, identifier valid
 *   verified=false → still null/0/invalid after the poll budget
 */
async function verifyOneSignalSubscription(
  playerId: string,
): Promise<{
  verified: boolean;
  notificationTypes: number | null;
  invalidIdentifier: boolean;
  reason?: string;
}> {
  const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !apiKey) {
    return {
      verified: false,
      notificationTypes: null,
      invalidIdentifier: false,
      reason: 'OneSignal not configured',
    };
  }

  // Five attempts × 1s = ~5s budget. Each attempt is one round-trip to
  // OneSignal's player-by-id endpoint. We stop early once a definitive
  // state appears (subscribed OR explicitly opted out / invalid).
  const url = `https://onesignal.com/api/v1/players/${encodeURIComponent(playerId)}?app_id=${appId}`;
  let last: { notificationTypes: number | null; invalidIdentifier: boolean } = {
    notificationTypes: null,
    invalidIdentifier: false,
  };
  for (let i = 0; i < 5; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1000));
    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: `Key ${apiKey}` } });
    } catch (err) {
      return {
        verified: false,
        notificationTypes: null,
        invalidIdentifier: false,
        reason: `OneSignal network error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (res.status === 404) {
      // Device hasn't propagated to OneSignal yet — try again next iteration.
      continue;
    }
    if (!res.ok) {
      return {
        verified: false,
        notificationTypes: null,
        invalidIdentifier: false,
        reason: `OneSignal ${res.status}: ${await res.text().catch(() => '')}`,
      };
    }
    const data = (await res.json()) as {
      notification_types?: number | null;
      invalid_identifier?: boolean;
    };
    last = {
      notificationTypes: data.notification_types ?? null,
      invalidIdentifier: !!data.invalid_identifier,
    };
    if (last.invalidIdentifier) {
      return { ...last, verified: false, reason: 'OneSignal marked the device identifier invalid' };
    }
    if ((last.notificationTypes ?? 0) > 0) {
      return { ...last, verified: true };
    }
    // Any explicit negative value means the user/OS revoked permission;
    // no point polling further.
    if ((last.notificationTypes ?? 0) < 0) {
      return {
        ...last,
        verified: false,
        reason: `Notifications disabled at OS level (OneSignal notification_types=${last.notificationTypes})`,
      };
    }
    // Still null/0 → keep polling.
  }
  return {
    ...last,
    verified: false,
    reason:
      'OneSignal still reports the device as not subscribed after 5s — the browser opt-in did not sync to the server',
  };
}

/**
 * POST /api/notifications/subscribe
 * Persists a user's OneSignal player ID keyed by their wallet address so
 * server-side code (cron jobs, pick-up handlers, queue triggers) can look up
 * the playerId and fire targeted pushes.
 *
 * Requires an authenticated Privy user; the authenticated wallet must match
 * the request body's walletAddress so one user can't overwrite another's
 * subscription.
 *
 * Body: { walletAddress: string, playerId: string }
 */
export async function POST(req: NextRequest) {
  try {
    let authenticatedWallet: string;
    try {
      const user = await getPrivyUser(req);
      authenticatedWallet = (user.walletAddress || '').toLowerCase();
      if (!authenticatedWallet) throw new Error('no wallet on user');
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const walletAddress = typeof body.walletAddress === 'string' ? body.walletAddress.trim().toLowerCase() : '';
    const playerId = typeof body.playerId === 'string' ? body.playerId.trim() : '';

    if (!walletAddress) {
      return NextResponse.json({ error: 'walletAddress required' }, { status: 400 });
    }
    if (!playerId) {
      return NextResponse.json({ error: 'playerId required' }, { status: 400 });
    }
    if (walletAddress !== authenticatedWallet) {
      return NextResponse.json({ error: 'Wallet mismatch' }, { status: 403 });
    }

    if (!isFirestoreConfigured()) {
      logger.debug(`[notifications/subscribe] firestore not configured — logging only wallet=${walletAddress} playerId=${playerId}`);
      return NextResponse.json({ ok: true, persisted: false, verified: false });
    }

    const db = getAdminFirestore();
    await db.collection(COLLECTION).doc(walletAddress).set(
      {
        walletAddress,
        playerId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    // Verify with OneSignal that the device actually landed as subscribed.
    // Only after that do we save `channels.push: true` in prefs — that flag
    // gates real delivery (lib/notifications/channels.ts:47), so it must
    // never be set while OneSignal says recipients would be 0.
    const verification = await verifyOneSignalSubscription(playerId);

    if (verification.verified) {
      await db.collection(PREFS_COLLECTION).doc(walletAddress).set(
        {
          walletAddress,
          channels: { push: true },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      logger.info('notifications.subscribe.verified', {
        actor: walletAddress,
        route: 'notifications/subscribe',
        context: {
          playerId,
          notificationTypes: verification.notificationTypes,
        },
      });
    } else {
      // Don't flip channels.push:true. Surface the exact reason so the
      // frontend can show a specific action ("iPhone Settings → … →
      // Allow Notifications"). Direct logErrorEvent write (bypasses the
      // logger → dynamic-import → Firestore pipeline that's been losing
      // writes from Vercel) so the row lands in the admin Logs tab tied
      // to the wallet.
      logErrorEvent({
        source: LOG_SOURCES.notifications.CHANNEL_CONNECT_FAILED,
        message: verification.reason ?? 'OneSignal verification failed',
        actor: walletAddress,
        route: 'notifications/subscribe',
        context: {
          channel: 'push',
          playerId,
          notificationTypes: verification.notificationTypes,
          invalidIdentifier: verification.invalidIdentifier,
        },
      });
      logger.warn('notifications.subscribe.unverified', {
        actor: walletAddress,
        context: { playerId, reason: verification.reason },
      });
    }

    return NextResponse.json({
      ok: true,
      persisted: true,
      verified: verification.verified,
      notificationTypes: verification.notificationTypes,
      reason: verification.reason,
    });
  } catch (err) {
    console.error('[notifications/subscribe] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/**
 * DELETE /api/notifications/subscribe?walletAddress=0x...
 * Removes the subscription when a user opts out. Same auth contract as POST.
 */
export async function DELETE(req: NextRequest) {
  try {
    let authenticatedWallet: string;
    try {
      const user = await getPrivyUser(req);
      authenticatedWallet = (user.walletAddress || '').toLowerCase();
      if (!authenticatedWallet) throw new Error('no wallet on user');
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const walletAddress = (req.nextUrl.searchParams.get('walletAddress') || '').trim().toLowerCase();
    if (!walletAddress) {
      return NextResponse.json({ error: 'walletAddress required' }, { status: 400 });
    }
    if (walletAddress !== authenticatedWallet) {
      return NextResponse.json({ error: 'Wallet mismatch' }, { status: 403 });
    }
    if (!isFirestoreConfigured()) {
      return NextResponse.json({ ok: true, persisted: false });
    }
    const db = getAdminFirestore();
    await db.collection(COLLECTION).doc(walletAddress).delete();
    return NextResponse.json({ ok: true, persisted: true });
  } catch (err) {
    console.error('[notifications/subscribe DELETE] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
