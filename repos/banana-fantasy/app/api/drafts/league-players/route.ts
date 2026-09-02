import { NextRequest, NextResponse } from 'next/server';
import { getAdminApp, getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';

const DRAFTS_API_URL = process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL
  || 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';

// Env-driven so prod reads its OWN RTDB. Staging keeps this exact URL when
// NEXT_PUBLIC_DATABASE_URL is unset, so staging is unchanged. Trailing slash
// stripped so `${RTDB_URL}/drafts/...` is always well-formed.
const RTDB_URL = (process.env.NEXT_PUBLIC_DATABASE_URL
  || 'https://sbs-staging-env-default-rtdb.firebaseio.com').replace(/\/$/, '');

/** Normalize the server's draft-type strings (human or short code) → the UI
 *  short code. Returns undefined for anything unrecognized so callers keep
 *  their existing value instead of clobbering it with a bad type. */
function normalizeDraftType(v: unknown): 'pro' | 'hof' | 'jackpot' | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim().toLowerCase();
  if (s === 'jackpot') return 'jackpot';
  if (s === 'hof' || s === 'hall of fame') return 'hof';
  if (s === 'pro') return 'pro';
  return undefined;
}

/**
 * GET /api/drafts/league-players?draftId=xxx[&wallet=0x…]
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
 *     currentDrafter?: string, currentPickNumber?: number,
 *     autoDraft?: boolean }
 *
 * `autoDraft` (only when `wallet` is passed AND the draft is drafting) is the
 * SERVER's auto-pick flag for that wallet — Firestore
 * `drafts/{id}/state/sortOrders/{wallet}/sort.AutoDraft`, the same field the
 * draft room's GET /preferences reads. The My Drafts ✈️ badge used to come
 * only from this device's draftStore (written by the draft room), so it never
 * showed for a toggle made on another device, nor for the server's own
 * 2-missed-picks promotion — the one case a user most needs to notice
 * (MrMcNasty, Discord 2026-08-17: "would be cool if you can see on this
 * screen if any of your drafts are on auto"). Gated to drafting so filling
 * rows don't burn a Firestore read every poll.
 *
 * Returns 502 only when all sources fail with no usable signal.
 */
export async function GET(req: NextRequest) {
  const draftId = req.nextUrl.searchParams.get('draftId');
  if (!draftId) {
    return NextResponse.json({ error: 'Missing draftId' }, { status: 400 });
  }
  const wallet = (req.nextUrl.searchParams.get('wallet') ?? '').trim().toLowerCase();

  // PRIOR-SEASON short-circuit (cost audit 9/2). Old-season drafts had their
  // RTDB nodes wiped, so they read as numPlayers 0 = "filling" forever — and
  // clients with a stale local draft list polled them every few seconds for
  // eternity (57% of ALL Go /state/info traffic was dead 2025 drafts). A
  // prior-season draft is by definition complete: answer terminally with a
  // long edge cache and touch NOTHING (no RTDB, no Go, no Firestore).
  // ⚠️ EXEMPT special-queue drafts: jackpot/hof/jackhof rounds are created
  // under prior-season ids ON PURPOSE (lane-numbering isolation), so they are
  // LIVE despite the '2025-' prefix (Isaic regression, 9/2).
  const seasonPrefix = `${new Date().getFullYear()}-`;
  if (/^\d{4}-/.test(draftId) && !draftId.startsWith(seasonPrefix)) {
    const { isQueueDraftId } = await import('@/lib/queueDraftIds');
    if (!(await isQueueDraftId(draftId))) {
      return NextResponse.json(
        { numPlayers: 10, players: [] },
        { headers: { 'cache-control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400' } },
      );
    }
  }

  let rtdbPlayers = 0;
  let rtdbOk = false;
  let pickEndTime: number | undefined;
  let pickStartTime: number | undefined;
  let pickLength: number | undefined;
  let currentDrafter: string | undefined;
  let currentPickNumber: number | undefined;
  let draftStartTime: number | undefined;
  let draftType: 'pro' | 'hof' | 'jackpot' | undefined;

  // Step 1 — read realTimeDraftInfo from RTDB for the rich timer + drafter
  // fields. This is the source the draft-room uses in-tab; proxying it here
  // lets the drafting page stay in sync without a parallel Firebase client.
  try {
    const app = getAdminApp();
    const token = await app.options.credential?.getAccessToken();
    const infoUrl = `${RTDB_URL}/drafts/${encodeURIComponent(draftId)}/realTimeDraftInfo.json`;
    const res = await fetch(`${infoUrl}?access_token=${token?.access_token}`, { cache: 'no-store' });
    if (res.ok) {
      const val = await res.json();
      if (val && typeof val === 'object') {
        pickEndTime = typeof val.pickEndTime === 'number' ? val.pickEndTime : undefined;
        pickStartTime = typeof val.pickStartTime === 'number' ? val.pickStartTime : undefined;
        pickLength = typeof val.pickLength === 'number' ? val.pickLength : undefined;
        currentDrafter = typeof val.currentDrafter === 'string' ? val.currentDrafter : undefined;
        currentPickNumber = typeof val.currentPickNumber === 'number' ? val.currentPickNumber : undefined;
        // Server's authoritative draft-start time (Unix seconds), set at fill.
        // Drives the reveal animation off ONE clock so every device shows the
        // same fill→reveal→type→drafting at the same wall-clock second — instead
        // of each device timing the reveal from its own local "saw it fill" anchor.
        draftStartTime = typeof val.draftStartTime === 'number' ? val.draftStartTime : undefined;
        // Draft type, stamped onto realTimeDraftInfo at fill by the Go API.
        // Normalize the server's human strings / short codes → pro|hof|jackpot
        // so the drafting-page list reads the SAME authoritative type the draft
        // room reads off this exact node — no per-device derivation drift, and
        // it's correct even if the deferred per-card Level write hasn't landed.
        draftType = normalizeDraftType(val.type);
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
      const numUrl = `${RTDB_URL}/drafts/${encodeURIComponent(draftId)}/numPlayers.json`;
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

  // Step 3 — server auto-pick flag for this wallet (drafting rows only).
  // Missing doc → undefined (client keeps whatever it has), never false, so a
  // wallet that isn't actually seated here can't clear a real local flag.
  let autoDraft: boolean | undefined;
  if (wallet && /^0x[0-9a-f]{40}$/.test(wallet) && numPlayers >= 10 && isFirestoreConfigured()) {
    try {
      const snap = await getAdminFirestore()
        .doc(`drafts/${draftId}/state/sortOrders/${wallet}/sort`)
        .get();
      const v = snap.exists ? (snap.data() as { AutoDraft?: unknown } | undefined)?.AutoDraft : undefined;
      if (typeof v === 'boolean') autoDraft = v;
    } catch (fsErr) {
      console.warn('[league-players] sortOrders read failed:', fsErr);
    }
  }

  return NextResponse.json({
    numPlayers,
    players: [],
    pickEndTime,
    pickStartTime,
    pickLength,
    currentDrafter,
    currentPickNumber,
    draftStartTime,
    type: draftType,
    ...(autoDraft !== undefined ? { autoDraft } : {}),
  });
}
