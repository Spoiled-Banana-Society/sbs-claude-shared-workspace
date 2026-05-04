import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from '@/lib/logger';

const ONESIGNAL_APP_ID = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
const ONESIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY;
const INTERNAL_SECRET = process.env.NOTIFICATIONS_INTERNAL_SECRET;
const SENT_COLLECTION = 'notificationsSent';

/**
 * POST /api/notifications/pick-up
 *
 * SERVER-TO-SERVER ONLY. The only legitimate caller is the Firebase
 * Cloud Function listening on RTDB `drafts/{id}/realTimeDraftInfo`
 * transitions; it presents a shared `x-internal-secret` header that
 * matches `NOTIFICATIONS_INTERNAL_SECRET` on this deploy.
 *
 * A client-side caller was previously supported but removed: an authed
 * user proving "I'm logged in" doesn't prove "this push is legitimate,"
 * so the client path was an authenticated-spam vector. The server-side
 * trigger covers all cases including users with tabs closed.
 *
 * Body: {
 *   walletAddress: string,      // lowercased; OneSignal tag target
 *   draftId: string,
 *   draftName?: string,
 *   pickNumber?: number,        // used for atomic (wallet,draft,pick) dedup
 *   pickLengthSeconds?: number, // push TTL + copy
 * }
 *
 * Dedup: we try `doc.create()` on `${wallet}__${draft}__${pick}`.
 *   - If that succeeds, status='pending', we send, then flip to 'sent'.
 *   - If Firestore returns ALREADY_EXISTS, we read the doc: if status is
 *     'sent' → skip (real dedup), if status is 'failed' → reset to
 *     'pending' and retry the send. Any other Firestore error → 502.
 */
export async function POST(req: NextRequest) {
  try {
    // Auth: only the Cloud Function (or another trusted server) with the
    // shared secret may call this. No Privy-user path.
    if (!INTERNAL_SECRET) {
      return NextResponse.json(
        { error: 'NOTIFICATIONS_INTERNAL_SECRET not configured' },
        { status: 503 },
      );
    }
    const secretHeader = req.headers.get('x-internal-secret');
    if (!secretHeader || secretHeader !== INTERNAL_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!ONESIGNAL_APP_ID || !ONESIGNAL_REST_API_KEY) {
      return NextResponse.json({ error: 'OneSignal not configured' }, { status: 503 });
    }

    const body = await req.json();
    const walletAddress = typeof body.walletAddress === 'string' ? body.walletAddress.trim().toLowerCase() : '';
    const draftId = typeof body.draftId === 'string' ? body.draftId.trim() : '';
    const draftName = typeof body.draftName === 'string' ? body.draftName : '';
    const pickNumber = Number.isFinite(body.pickNumber) ? Number(body.pickNumber) : null;
    const pickLengthSeconds = Number.isFinite(body.pickLengthSeconds)
      ? Number(body.pickLengthSeconds)
      : null;

    if (!walletAddress) return NextResponse.json({ error: 'walletAddress required' }, { status: 400 });
    if (!draftId) return NextResponse.json({ error: 'draftId required' }, { status: 400 });

    // Atomic dedup via Firestore create(). Only the first concurrent caller
    // lands the doc; others bounce out on ALREADY_EXISTS, at which point
    // we read the existing doc and decide whether to skip or retry.
    let dedupRef: FirebaseFirestore.DocumentReference | null = null;
    if (isFirestoreConfigured() && pickNumber != null) {
      const db = getAdminFirestore();
      const dedupId = `${walletAddress}__${draftId}__${pickNumber}`;
      dedupRef = db.collection(SENT_COLLECTION).doc(dedupId);
      try {
        await dedupRef.create({
          walletAddress,
          draftId,
          pickNumber,
          status: 'pending',
          startedAt: FieldValue.serverTimestamp(),
        });
      } catch (err) {
        const code = (err as { code?: number | string } | undefined)?.code;
        // Firestore Admin SDK uses either numeric gRPC codes (6 = ALREADY_EXISTS)
        // or the string 'already-exists' depending on transport. Anything else
        // is a real Firestore failure and should not silently dedupe.
        const isAlreadyExists = code === 6 || code === 'already-exists';
        if (!isAlreadyExists) {
          console.error('[pick-up] Firestore create() error (non-dedup):', err);
          return NextResponse.json({ error: 'Dedup store unavailable' }, { status: 502 });
        }

        // Existing doc: inspect status to decide skip vs retry.
        try {
          const snap = await dedupRef.get();
          const status = snap.exists ? snap.get('status') : null;
          if (status === 'sent') {
            return NextResponse.json({ ok: true, deduped: true });
          }
          if (status === 'failed') {
            // Prior send failed; reopen the slot and proceed.
            await dedupRef.set(
              {
                status: 'pending',
                retriedAt: FieldValue.serverTimestamp(),
              },
              { merge: true },
            );
          } else {
            // status === 'pending' (or missing): another worker may be in flight.
            // Don't double-send; report dedup.
            return NextResponse.json({ ok: true, deduped: true });
          }
        } catch (readErr) {
          console.error('[pick-up] Firestore read after AlreadyExists failed:', readErr);
          return NextResponse.json({ error: 'Dedup store unavailable' }, { status: 502 });
        }
      }
    }

    const timerCopy = pickLengthSeconds
      ? pickLengthSeconds >= 3600
        ? `${Math.round(pickLengthSeconds / 3600)} hours`
        : `${pickLengthSeconds} seconds`
      : null;

    const title = '🍌 You\'re on the clock!';
    const message = draftName
      ? timerCopy
        ? `${draftName} — tap to pick. ${timerCopy} before it auto-drafts.`
        : `${draftName} — tap to pick.`
      : timerCopy
        ? `Your pick is up. ${timerCopy} before it auto-drafts.`
        : 'Your pick is up — tap to pick.';

    const ttl = pickLengthSeconds ?? 600;

    try {
      const response = await fetch('https://onesignal.com/api/v1/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${ONESIGNAL_REST_API_KEY}`,
        },
        body: JSON.stringify({
          app_id: ONESIGNAL_APP_ID,
          filters: [
            { field: 'tag', key: 'walletAddress', relation: '=', value: walletAddress },
          ],
          headings: { en: title },
          contents: { en: message },
          url: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://banana-fantasy-sbs.vercel.app'}/draft-room?id=${draftId}`,
          chrome_web_badge: '/icons/icon-192.png',
          chrome_web_icon: '/icons/icon-192.png',
          ttl,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        console.error('[pick-up] OneSignal error:', response.status, errorBody);
        if (dedupRef) {
          await dedupRef.set(
            { status: 'failed', failedAt: FieldValue.serverTimestamp() },
            { merge: true },
          ).catch(() => {});
        }
        return NextResponse.json({ error: 'Failed to send notification' }, { status: 502 });
      }

      const result = await response.json();
      if (dedupRef) {
        await dedupRef.set(
          { status: 'sent', sentAt: FieldValue.serverTimestamp(), recipients: result.recipients ?? 0 },
          { merge: true },
        ).catch(() => {});
      }
      logger.debug(
        `[pick-up] sent wallet=${walletAddress} draft=${draftId} pick=${pickNumber ?? '?'} recipients=${result.recipients}`,
      );
      return NextResponse.json({ ok: true, recipients: result.recipients ?? 0 });
    } catch (sendErr) {
      console.error('[pick-up] send threw:', sendErr);
      if (dedupRef) {
        await dedupRef.set(
          { status: 'failed', failedAt: FieldValue.serverTimestamp() },
          { merge: true },
        ).catch(() => {});
      }
      return NextResponse.json({ error: 'Failed to send notification' }, { status: 502 });
    }
  } catch (err) {
    console.error('[pick-up] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
