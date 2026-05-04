import { NextRequest, NextResponse } from 'next/server';
import { getAdminApp } from '@/lib/firebaseAdmin';

const DRAFTS_API_URL = process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL
  || 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';

/**
 * GET /api/drafts/league-players?draftId=xxx
 *
 * Returns the current player count + real-time pick timer info for a draft.
 * Primary source is Firebase RTDB `drafts/{draftId}/realTimeDraftInfo` which
 * the Go API updates on every join and every pick — it carries the
 * authoritative `pickEndTime` (absolute Unix seconds) that the drafting page
 * needs to render per-row countdowns without racing the draft-room tab's
 * intermittent store writes.
 *
 * Fallback: `numPlayers` also available at `drafts/{draftId}/numPlayers` for
 * drafts that haven't had `realTimeDraftInfo` written yet (filling phase
 * pre-10/10). Go API `/state/info` is the last-resort fallback when RTDB
 * reads fail entirely — ensures a transient RTDB outage doesn't take down
 * the drafting page's polling loops.
 *
 * Response:
 *   { numPlayers: number, pickEndTime?: number, pickLength?: number,
 *     currentDrafter?: string, currentPickNumber?: number }
 *
 * Returns 502 only when all sources fail with no usable signal.
 */
export async function GET(req: NextRequest) {
  const draftId = req.nextUrl.searchParams.get('draftId');
  if (!draftId) {
    return NextResponse.json({ error: 'Missing draftId' }, { status: 400 });
  }

  let rtdbPlayers = 0;
  let rtdbOk = false;
  let pickEndTime: number | undefined;
  let pickLength: number | undefined;
  let currentDrafter: string | undefined;
  let currentPickNumber: number | undefined;

  // Step 1 — read realTimeDraftInfo from RTDB for the rich timer + drafter
  // fields. This is the source the draft-room uses in-tab; proxying it here
  // lets the drafting page stay in sync without a parallel Firebase client.
  try {
    const app = getAdminApp();
    const token = await app.options.credential?.getAccessToken();
    const infoUrl = `https://sbs-staging-env-default-rtdb.firebaseio.com/drafts/${encodeURIComponent(draftId)}/realTimeDraftInfo.json`;
    const res = await fetch(`${infoUrl}?access_token=${token?.access_token}`, { cache: 'no-store' });
    if (res.ok) {
      const val = await res.json();
      if (val && typeof val === 'object') {
        pickEndTime = typeof val.pickEndTime === 'number' ? val.pickEndTime : undefined;
        pickLength = typeof val.pickLength === 'number' ? val.pickLength : undefined;
        currentDrafter = typeof val.currentDrafter === 'string' ? val.currentDrafter : undefined;
        currentPickNumber = typeof val.currentPickNumber === 'number' ? val.currentPickNumber : undefined;
        rtdbOk = true;
        // realTimeDraftInfo only exists after draft has started — by definition 10 players.
        rtdbPlayers = 10;
      } else if (val === null) {
        // realTimeDraftInfo absent — draft still filling. Fall through to numPlayers.
        rtdbOk = true;
      }
    }

    // Step 1b — if realTimeDraftInfo was absent (filling phase), read numPlayers separately.
    if (rtdbPlayers === 0 && rtdbOk) {
      const numUrl = `https://sbs-staging-env-default-rtdb.firebaseio.com/drafts/${encodeURIComponent(draftId)}/numPlayers.json`;
      const numRes = await fetch(`${numUrl}?access_token=${token?.access_token}`, { cache: 'no-store' });
      if (numRes.ok) {
        const numVal = await numRes.json();
        if (typeof numVal === 'number') rtdbPlayers = numVal;
      }
    }
  } catch (rtdbErr) {
    console.warn('[league-players] RTDB read failed, will try Go fallback:', rtdbErr);
  }

  let numPlayers = rtdbPlayers;

  // Step 2 — Go /state/info fallback for numPlayers when RTDB is behind or
  // silent. Still worth running even when RTDB succeeded but reported <10,
  // since fill-bots can leave RTDB stale relative to the Go league doc.
  let goOk = false;
  if (numPlayers < 10) {
    try {
      const infoRes = await fetch(
        `${DRAFTS_API_URL}/draft/${encodeURIComponent(draftId)}/state/info`,
        { cache: 'no-store' },
      );
      if (infoRes.ok) {
        const info = await infoRes.json();
        const orderLen = Array.isArray(info?.draftOrder) ? info.draftOrder.length : 0;
        if (orderLen >= 10 && Number(info?.draftStartTime) > 0) {
          numPlayers = 10;
        } else if (orderLen > numPlayers) {
          numPlayers = orderLen;
        }
        goOk = true;
      } else if (infoRes.status === 404) {
        goOk = true; // draft-state doc not created yet — normal during filling
      }
    } catch (goErr) {
      console.warn('[league-players] Go /state/info fallback failed:', goErr);
    }
  }

  if (!rtdbOk && !goOk) {
    return NextResponse.json({ error: 'Failed to read draft state' }, { status: 502 });
  }

  return NextResponse.json({
    numPlayers,
    players: [],
    pickEndTime,
    pickLength,
    currentDrafter,
    currentPickNumber,
  });
}
