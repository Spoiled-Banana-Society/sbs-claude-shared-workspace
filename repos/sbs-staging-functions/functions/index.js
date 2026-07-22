const functions = require("firebase-functions");
const admin = require("firebase-admin");
const fetch = require("node-fetch");
const { isSlowDraftNightPause, slowDraftActiveSecondsUntil } = require("./slowDraftClock");

admin.initializeApp();

const DRAFTS_API_URL = "https://sbs-drafts-api-staging-652484219017.us-central1.run.app";

// Fire-and-forget write into the banana-fantasy v2_error_events Firestore
// collection so notification-trigger failures surface in the admin Logs tab
// (filter: area=notifications) instead of dying silently in Cloud Functions
// logs. Schema mirrors lib/errorEvents.ts on the frontend — keep the field
// names in sync if you change one.
function logErrorEvent(source, message, opts) {
  try {
    const doc = {
      source: String(source),
      message: String(message || ""),
      timestamp: new Date().toISOString(),
    };
    if (opts && opts.actor) doc.actor = String(opts.actor).toLowerCase();
    if (opts && opts.route) doc.route = String(opts.route);
    if (opts && opts.context && typeof opts.context === "object") {
      doc.context = opts.context;
    }
    admin
      .firestore()
      .collection("v2_error_events")
      .add(doc)
      .catch((err) => {
        console.warn("[logErrorEvent] Firestore write failed", err);
      });
  } catch (err) {
    console.warn("[logErrorEvent] threw", err);
  }
}

/**
 * Firestore trigger: watches v2_queues/{type} for changes.
 *
 * NEW BEHAVIOR (create at 1/10, not 10/10):
 * - When a round has ≥1 member and no draftId → create draft with current members
 * - When a round has new members and a draftId → add each new member to the existing draft
 * - When a round reaches 10 members → set status to 'drafting'
 *
 * This lets users enter the draft room immediately and see the filling phase.
 */
exports.onQueueUpdate = functions
  .runWith({ timeoutSeconds: 120, memory: "256MB" })
  .firestore.document("v2_queues/{queueType}")
  .onWrite(async (change, context) => {
    const queueType = context.params.queueType; // 'jackpot' or 'hof'
    const afterData = change.after.exists ? change.after.data() : null;
    if (!afterData || !afterData.rounds) return null;

    const beforeData = change.before.exists ? change.before.data() : null;
    const beforeRounds = beforeData?.rounds || [];

    const rounds = afterData.rounds;
    let updated = false;

    for (let i = 0; i < rounds.length; i++) {
      const round = rounds[i];
      if (round.status === "completed") continue;

      // Find the matching before-round to detect new members
      const beforeRound = beforeRounds.find((r) => r.roundId === round.roundId);
      const beforeWallets = new Set(
        (beforeRound?.members || []).map((m) => m.wallet)
      );
      const newMembers = round.members.filter(
        (m) => !beforeWallets.has(m.wallet)
      );

      // CASE 1: Round has members but no draft yet → create draft
      if (!round.draftId && round.members.length >= 1) {
        const wallets = round.members.map((m) => m.wallet);
        console.log(
          `[onQueueUpdate] Round ${round.roundId} for ${queueType}: creating draft with ${wallets.length} member(s)...`
        );

        try {
          const res = await fetch(
            `${DRAFTS_API_URL}/staging/create-special-draft`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ type: queueType, wallets }),
            }
          );

          if (!res.ok) {
            const errText = await res.text();
            console.error(
              `[onQueueUpdate] Go API error creating draft for round ${round.roundId}: ${res.status} ${errText}`
            );
            continue;
          }

          const result = await res.json();
          console.log(
            `[onQueueUpdate] Draft created for ${queueType} round ${round.roundId}: ${result.draftId} (${result.numPlayers} players)`
          );

          rounds[i].draftId = result.draftId;
          updated = true;

          // If already at 10, mark as drafting
          if (round.members.length >= 10) {
            rounds[i].status = "drafting";
          }
        } catch (err) {
          console.error(
            `[onQueueUpdate] Error creating draft for round ${round.roundId}:`,
            err
          );
        }
        continue;
      }

      // CASE 2: Round has a draft and new members joined → add them
      if (round.draftId && newMembers.length > 0) {
        for (const member of newMembers) {
          console.log(
            `[onQueueUpdate] Adding ${member.wallet} to draft ${round.draftId} (round ${round.roundId})`
          );
          try {
            const res = await fetch(
              `${DRAFTS_API_URL}/staging/join-special-draft`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  draftId: round.draftId,
                  wallet: member.wallet,
                }),
              }
            );

            if (!res.ok) {
              const errText = await res.text();
              console.error(
                `[onQueueUpdate] Error adding ${member.wallet} to ${round.draftId}: ${res.status} ${errText}`
              );
            } else {
              const result = await res.json();
              console.log(
                `[onQueueUpdate] ${member.wallet} joined ${round.draftId} (${result.numPlayers} players)`
              );
            }
          } catch (err) {
            console.error(
              `[onQueueUpdate] Error adding member to draft:`,
              err
            );
          }
        }
      }

      // CASE 3: Round has 10 members → mark as drafting
      if (
        round.members.length >= 10 &&
        round.status !== "drafting" &&
        round.draftId
      ) {
        console.log(
          `[onQueueUpdate] Round ${round.roundId} is full (10/10) — setting status to drafting`
        );
        rounds[i].status = "drafting";
        updated = true;
      }
    }

    // Write back the updated rounds if any changed
    if (updated) {
      await change.after.ref.update({ rounds });
      console.log(`[onQueueUpdate] Updated queue ${queueType} with changes`);
    }

    return null;
  });
/**
 * onPickAdvance — Firebase RTDB trigger that fires a OneSignal push when
 * a slow-draft's currentDrafter changes to a new wallet, so users with
 * the tab closed still get notified in time to make their pick.
 *
 * Deploy target: sbs-staging-env (later: sbs-prod-env)
 * Expected location: ~/sbs-staging-functions/functions/src/ (or index)
 * Deploy: firebase deploy --only functions:onPickAdvance
 *
 * Paired with the /api/notifications/pick-up route on the Vercel frontend,
 * which does the actual OneSignal REST API call + Firestore-backed dedup
 * so duplicate fires from multiple triggers are safe.
 *
 * Node 20 / CommonJS. Uses node-fetch@2.
 *
 * NOTE: `functions` and `fetch` are already required at the top of this file —
 * no duplicate requires here.
 */

// Vercel endpoint that wraps OneSignal. Swap host per env if needed.
const PICK_UP_ENDPOINT =
  process.env.PICK_UP_ENDPOINT ||
  'https://banana-fantasy-sbs.vercel.app/api/notifications/pick-up';

// Shared secret for the server-to-server notification routes. Must match
// NOTIFICATIONS_INTERNAL_SECRET on the Vercel deploy.
const NOTIFICATIONS_INTERNAL_SECRET = process.env.NOTIFICATIONS_INTERNAL_SECRET || '';

exports.onPickAdvance = functions
  .region('us-central1')
  .database.ref('drafts/{draftId}/realTimeDraftInfo')
  // onWrite, NOT onUpdate (2026-07-12): the node is CREATED at draft start, so
  // onUpdate silently skipped the first pick of every draft — the first
  // on-deck alert never sent. Same fix as onBotTurn; deletes guarded below,
  // and the pure-tick guard already handles a null `before` (create).
  .onWrite(async (change, ctx) => {
    if (!change.after.exists()) return null; // node deleted — nothing to do
    const before = change.before.val();
    const after = change.after.val();
    const { draftId } = ctx.params;

    if (!after) return null;

    // Draft is over — nothing to notify.
    if (after.isDraftComplete || after.isDraftClosed) return null;

    // Skip timer-only ticks (realTimeDraftInfo updates every second for
    // the countdown). The original check bailed when currentDrafter was
    // unchanged — but that ALSO dropped legitimate back-to-back picks in
    // snake drafts, where the same wallet drafts at the turn (e.g. slot
    // 10 picks at #10 then #11 immediately; slot 1 picks at #20 then
    // #21). In that case currentDrafter is unchanged but pickNumber
    // advances — the user IS up again and needs the alert. Bail only
    // when BOTH are unchanged (= a pure timer tick with no state change).
    if (
      before &&
      before.currentDrafter === after.currentDrafter &&
      before.pickNumber === after.pickNumber
    ) {
      return null;
    }

    // Fires for ALL drafts. SLOW drafts alert the user now on the clock.
    // FAST drafts (<=1h/pick) alert the ON-DECK player a full pick early — 30s
    // is too little time to react to an at-your-turn alert. The on-deck player
    // is stamped into this node by the Go engine (`onDeckDrafter`). The
    // recipient's per-speed preference (pickSlow/pickFast) is still applied
    // server-side in the /api/notifications/pick-up route by pickLength.
    const pickLength = Number(after.pickLength ?? 0);
    const isFast = pickLength > 0 && pickLength <= 3600;
    const currentPick = Number(after.pickNumber ?? 0);
    const onDeckDrafter = String(after.onDeckDrafter || '').toLowerCase();

    let walletAddress;
    let notifyPickNumber;
    let onDeck;
    if (isFast) {
      if (currentPick >= 150) return null; // last pick — on-deck was already alerted
      if (!onDeckDrafter) {
        // Pre-upgrade node (no on-deck stamped) — don't go silent, fall back to on-clock.
        walletAddress = String(after.currentDrafter || '').toLowerCase();
        notifyPickNumber = currentPick;
        onDeck = false;
      } else if (onDeckDrafter.startsWith('bot-')) {
        return null; // on-deck player is a bot — nobody to alert
      } else {
        walletAddress = onDeckDrafter;
        notifyPickNumber = currentPick + 1; // the on-deck player's OWN upcoming pick
        onDeck = true;
      }
    } else {
      walletAddress = String(after.currentDrafter || '').toLowerCase();
      notifyPickNumber = currentPick;
      onDeck = false;
    }
    if (!walletAddress || walletAddress.startsWith('bot-')) return null;

    // displayName lives on the draft root, not inside realTimeDraftInfo.
    let draftName;
    try {
      const nameSnap = await change.after.ref.parent.child('displayName').once('value');
      draftName = nameSnap.val() || undefined;
    } catch (e) {
      /* non-fatal — copy falls back to a generic line */
    }

    const body = {
      walletAddress,
      draftId,
      draftName,
      // Keys the per-pick dedup downstream. For an on-deck alert it's the
      // on-deck player's OWN upcoming pick number.
      pickNumber: notifyPickNumber,
      pickLengthSeconds: pickLength,
      onDeck,
    };

    try {
      const res = await fetch(PICK_UP_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': NOTIFICATIONS_INTERNAL_SECRET,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const responseBody = await res.text();
        console.warn('[onPickAdvance] pick-up endpoint', res.status, responseBody);
        logErrorEvent(
          'notifications.functions.pick_up.endpoint_error',
          `pick-up endpoint returned ${res.status}`,
          {
            actor: walletAddress,
            route: 'functions/onPickAdvance',
            context: {
              draftId,
              pickNumber: after.pickNumber,
              pickLengthSeconds: pickLength,
              status: res.status,
              responseBody: responseBody.slice(0, 500),
            },
          },
        );
      }
    } catch (err) {
      console.error('[onPickAdvance] fetch failed', err);
      logErrorEvent(
        'notifications.functions.pick_up.fetch_failed',
        err && err.message ? err.message : String(err),
        {
          actor: walletAddress,
          route: 'functions/onPickAdvance',
          context: { draftId, pickNumber: after.pickNumber },
        },
      );
    }

    return null;
  });

/**
 * onDraftFilled — Firebase RTDB trigger that fires a multi-channel
 * "your draft filled" alert when a draft reaches 10 players.
 *
 * Paired with the /api/notifications/draft-filled route on the Vercel
 * frontend, which fans out to every channel each league member has
 * connected (push / email / Telegram / Discord) and dedups per recipient.
 *
 * The participant roster is NOT in RTDB — only `displayName`, `numPlayers`
 * and `realTimeDraftInfo` live there. The roster is read from Firestore:
 * `drafts/{draftId}/state/info`.DraftOrder, falling back to the league doc
 * `drafts/{draftId}`.CurrentUsers (both arrays of { OwnerId, TokenId }).
 *
 * Deploy: firebase deploy --only functions:onDraftFilled
 */

const DRAFT_FILLED_ENDPOINT =
  process.env.DRAFT_FILLED_ENDPOINT ||
  'https://banana-fantasy-sbs.vercel.app/api/notifications/draft-filled';

exports.onDraftFilled = functions
  .region('us-central1')
  .database.ref('drafts/{draftId}/numPlayers')
  .onWrite(async (change, ctx) => {
    const before = Number(change.before.val() || 0);
    const after = Number(change.after.val() || 0);
    const { draftId } = ctx.params;

    // Only fire on the transition INTO a full draft.
    if (after < 10 || before >= 10) return null;

    let wallets = [];
    let draftName;
    try {
      const db = admin.firestore();
      const info = await db.doc(`drafts/${draftId}/state/info`).get();
      const order = info.exists ? info.data().DraftOrder : null;
      if (Array.isArray(order) && order.length) {
        wallets = order.map((o) => o && o.OwnerId).filter(Boolean);
        draftName = info.data().DisplayName;
      } else {
        // state/info may not be written yet — fall back to the league doc.
        const root = await db.doc(`drafts/${draftId}`).get();
        const cu = root.exists ? root.data().CurrentUsers : null;
        if (Array.isArray(cu)) wallets = cu.map((o) => o && o.OwnerId).filter(Boolean);
        if (root.exists) draftName = root.data().DisplayName;
      }
    } catch (err) {
      console.error('[onDraftFilled] roster lookup failed', draftId, err);
      logErrorEvent(
        'notifications.functions.draft_filled.roster_lookup_failed',
        err && err.message ? err.message : String(err),
        {
          route: 'functions/onDraftFilled',
          context: { draftId },
        },
      );
      return null;
    }

    wallets = wallets
      .map((w) => String(w).toLowerCase())
      .filter((w) => w && !w.startsWith('bot-'));

    if (!wallets.length) {
      console.warn('[onDraftFilled] no human wallets for draft', draftId);
      logErrorEvent(
        'notifications.functions.draft_filled.no_human_wallets',
        'roster contained no human wallets — no draft.filled alerts will be sent',
        {
          route: 'functions/onDraftFilled',
          context: { draftId },
        },
      );
      return null;
    }

    try {
      const res = await fetch(DRAFT_FILLED_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': NOTIFICATIONS_INTERNAL_SECRET,
        },
        body: JSON.stringify({ draftId, draftName, wallets }),
      });
      if (!res.ok) {
        const responseBody = await res.text();
        console.warn('[onDraftFilled] endpoint', res.status, responseBody);
        logErrorEvent(
          'notifications.functions.draft_filled.endpoint_error',
          `draft-filled endpoint returned ${res.status}`,
          {
            route: 'functions/onDraftFilled',
            context: {
              draftId,
              walletCount: wallets.length,
              status: res.status,
              responseBody: responseBody.slice(0, 500),
            },
          },
        );
      }
    } catch (err) {
      console.error('[onDraftFilled] fetch failed', err);
      logErrorEvent(
        'notifications.functions.draft_filled.fetch_failed',
        err && err.message ? err.message : String(err),
        {
          route: 'functions/onDraftFilled',
          context: { draftId, walletCount: wallets.length },
        },
      );
    }

    return null;
  });

/**
 * onBotTurn — the house-bot "brain" (v1: human-like timing + ADP + variance).
 *
 * Fires on the same RTDB node as onPickAdvance. When the player now on the
 * clock is a HOUSE BOT (wallet doc in Firestore `botWallets` with isBot=true),
 * this waits a random human-ish delay, re-checks that it is STILL that bot's
 * turn (compute-at-submit — never act on pre-sleep state), then submits a pick
 * through the SAME public pick endpoint a human uses.
 *
 * Pick logic v1: all 224 team-position slots from playerStats2026/playerMap,
 * minus everything in the draft summary, sorted by ADP; draw weighted-random
 * from the top N so bots don't all draft identically; soft positional caps so
 * a bot can't build 15 QBs. Strategy dials live in Firestore
 * `system_config/botBrain` — editable without redeploying:
 *   { enabled, fastMinDelaySec, fastMaxDelaySec, slowMinDelaySec,
 *     slowMaxDelaySec, topN, positionCaps: {QB,RB,WR,TE} }
 *
 * SAFETY MODEL (why this can't break a draft):
 *  - enabled !== true → hard no-op. botWallets empty → no-op for every draft.
 *  - It only ever SUBMITS a normal pick; the Go engine still validates turn,
 *    expiry and duplicates, and rejects anything illegal with a 400.
 *  - Any failure here (crash, timeout, rejection) simply means the bot misses
 *    the pick and the engine's existing end-of-timer auto-pick takes over —
 *    identical to how bots behave without this function.
 *  - Never picks inside the last ~5s of the window (leaves the buzzer path
 *    clean for the engine's own scheduled auto-pick).
 *
 * Deploy: firebase deploy --only functions:onBotTurn   (per-function ONLY —
 * other functions in this file are older than what's deployed.)
 */
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

// Deterministic per-(draft,bot) randomness — the same bot in the same draft
// always draws the SAME team blueprint, so all 15 stateless invocations build
// toward one coherent plan without storing anything.
function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Richard's "normal drafter" team blueprint (2026-07-02): 2-3 QB, 3-4 RB1,
// 3-4 WR1, 2-3 TE, 2-3 DST; at most ONE RB2 and ONE WR2, WR2 preferred over
// RB2, RB2 only sometimes (and only on 3-RB1 builds). Always sums to 15.
function drawTeamBlueprint(rand) {
  for (let tries = 0; tries < 60; tries++) {
    const t = {
      QB: rand() < 0.6 ? 2 : 3,
      RB1: rand() < 0.5 ? 3 : 4,
      WR1: rand() < 0.45 ? 3 : 4,
      TE: rand() < 0.6 ? 2 : 3,
      DST: rand() < 0.7 ? 2 : 3,
      RB2: 0,
      WR2: 0,
    };
    const rem = 15 - (t.QB + t.RB1 + t.WR1 + t.TE + t.DST);
    if (rem < 0 || rem > 2) continue;
    if (rem === 2) {
      t.WR2 = 1;
      t.RB2 = 1;
    } else if (rem === 1) {
      if (t.RB1 === 3 && rand() < 0.3) t.RB2 = 1;
      else t.WR2 = 1;
    }
    return t;
  }
  return { QB: 3, RB1: 4, WR1: 4, TE: 2, DST: 2, RB2: 0, WR2: 0 };
}

/**
 * submitBotPick — the shared "compute and submit" half of the bot brain:
 * availability, blueprint, balance floor, reality override, weighted draw,
 * POST to the public pick endpoint. Callers (onBotTurn for fast drafts,
 * botSlowPickWorker for slow) MUST have just verified against a fresh RTDB
 * read that it is still `drafter`'s turn on `pickNumberAtStart`. Never throws
 * — any failure is logged and the engine's buzzer auto-pick is the backstop.
 * Returns true only when the pick endpoint accepted the pick.
 */
async function submitBotPick(draftId, drafter, pickNumberAtStart, cfg, delayNote) {
  try {
    // Availability = all slots minus summary picks. Same construction the
    // draft room uses.
    const [pmSnap, sumRes] = await Promise.all([
      admin.firestore().collection('playerStats2026').doc('playerMap').get(),
      fetch(`${DRAFTS_API_URL}/draft/${draftId}/state/summary`),
    ]);
    const players = (pmSnap.data() || {}).Players || {};
    const sumBody = await sumRes.json().catch(() => null);
    const summary = Array.isArray(sumBody) ? sumBody : (sumBody && sumBody.summary) || [];
    const taken = new Set();
    const mine = {}; // this bot's roster so far, counted by SLOT TYPE (RB1 vs RB2 etc.)
    const typeOf = (playerId) => String(playerId).split('-')[1] || '';
    const posOf = (playerId) => typeOf(playerId).replace(/\d+$/, '');
    for (const row of summary) {
      const p = row && row.playerInfo;
      if (!p || !p.playerId) continue;
      taken.add(p.playerId);
      if (String(p.ownerAddress || '').toLowerCase() === drafter) {
        const t = typeOf(p.playerId);
        mine[t] = (mine[t] || 0) + 1;
      }
    }

    // This bot's team blueprint for THIS draft (deterministic — see helpers).
    const targets = drawTeamBlueprint(mulberry32(hashSeed(draftId + '|' + drafter)));

    let available = Object.keys(players)
      .filter((id) => !taken.has(id))
      .map((id) => ({ id, adp: Number(players[id].ADP) || 999 }))
      .sort((a, b) => a.adp - b.adp);
    // Starter supply BEFORE any filtering — the reality-override rules below
    // need to know whether RB1/WR1 are still gettable at all.
    const supplyOf = (t) => available.filter((s) => typeOf(s.id) === t).length;
    const rb1Supply = supplyOf('RB1');
    const wr1Supply = supplyOf('WR1');

    // Reality override (Richard, 2026-07-12, draft-122 round 13): the
    // "never a backup before 2 starters" gate assumes starters are still
    // available. If WR1s sell out while the bot holds only 1, a hard gate
    // would ban it from EVER taking another WR — it spent round 13 on an
    // RB2 instead. So: the backup gate only applies while that position's
    // starters can still be drafted, and when they can't, the blueprint's
    // backup allowance grows so the bot can reach 3 total at the position.
    const wrTotalNow = (mine.WR1 || 0) + (mine.WR2 || 0);
    const rbTotalNow = (mine.RB1 || 0) + (mine.RB2 || 0);
    const effTargets = { ...targets };
    if (wr1Supply === 0 && wrTotalNow < 3) {
      effTargets.WR2 = Math.max(effTargets.WR2 ?? 0, (mine.WR2 || 0) + (3 - wrTotalNow));
    }
    if (rb1Supply === 0 && rbTotalNow < 3) {
      effTargets.RB2 = Math.max(effTargets.RB2 ?? 0, (mine.RB2 || 0) + (3 - rbTotalNow));
    }

    // Draft toward the blueprint: only slot types still needed, and never a
    // backup (RB2/WR2) before 2+ starters at that position are rostered —
    // unless the starters are gone (reality override above).
    const needed = available.filter((s) => {
      const t = typeOf(s.id);
      if ((mine[t] || 0) >= (effTargets[t] ?? 0)) return false;
      if (t === 'RB2' && (mine.RB1 || 0) < 2 && rb1Supply > 0) return false;
      if (t === 'WR2' && (mine.WR1 || 0) < 2 && wr1Supply > 0) return false;
      return true;
    });
    if (needed.length > 0) available = needed; // blueprint is a plan, not a straitjacket — never strand the bot
    if (available.length === 0) return false; // engine fallback will handle it

    // Emergency narrowing, ANY round: under 3 TOTAL at a premium position
    // whose starters are gone — take its backups NOW while they exist. This
    // is what turns "RB2 in round 13 with one WR" into "grab WR2s," and
    // "4th QB while holding 2 RBs" into "grab RB2s." WR before RB when
    // both are starving.
    let emergencyType = null;
    if (wr1Supply === 0 && wrTotalNow < 3 && available.some((s) => typeOf(s.id) === 'WR2')) {
      emergencyType = 'WR2';
    } else if (rb1Supply === 0 && rbTotalNow < 3 && available.some((s) => typeOf(s.id) === 'RB2')) {
      emergencyType = 'RB2';
    }
    if (emergencyType) available = available.filter((s) => typeOf(s.id) === emergencyType);

    // Early-draft balance floor (Richard, 2026-07-12 after draft-122): walk
    // out of the first 7 rounds with AT LEAST 2 RB1 and 2 WR1. The blueprint
    // alone says how many to end with, not WHEN — an RB-heavy start let the
    // WR1 shelf empty out and the bot finished with a single WR1. Two
    // triggers narrow the pool to a deficit position:
    //  - scarcity: a needed premium type is down to ≤10 available (≈ one
    //    snake round of demand) — take it before the run finishes it;
    //  - runway: deficit picks needed ≥ early picks remaining — stop
    //    browsing, cover the floor.
    // Most-endangered position first when both are short. If the position
    // is already sold out, there's nothing to force — blueprint continues.
    const myPickCount = Object.values(mine).reduce((a, b) => a + b, 0);
    if (myPickCount < 7) {
      const deficits = [];
      for (const t of ['RB1', 'WR1']) {
        const have = mine[t] || 0;
        if (have < 2) {
          const supply = available.filter((s) => typeOf(s.id) === t).length;
          if (supply > 0) deficits.push({ t, need: 2 - have, supply });
        }
      }
      const totalNeed = deficits.reduce((a, d) => a + d.need, 0);
      const runwayTight = 7 - myPickCount <= totalNeed;
      const scarce = deficits.filter((d) => d.supply <= 10);
      if (deficits.length > 0 && (runwayTight || scarce.length > 0)) {
        const focus = (scarce.length > 0 ? scarce : deficits).sort((a, b) => a.supply - b.supply)[0];
        available = available.filter((s) => typeOf(s.id) === focus.t);
      }
    }

    // Variance: weighted draw from the top N by ADP (front-loaded weights).
    const topN = Math.max(1, Number(cfg.topN ?? 5));
    const pool = available.slice(0, topN);
    const weights = pool.map((_, i) => Math.pow(0.55, i)); // 1, .55, .30, .17, .09…
    let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
    let chosen = pool[0];
    for (let i = 0; i < pool.length; i++) {
      roll -= weights[i];
      if (roll <= 0) { chosen = pool[i]; break; }
    }

    const team = String(chosen.id).split('-')[0] || '';
    const position = posOf(chosen.id);
    const res = await fetch(
      `${DRAFTS_API_URL}/draft-actions/${draftId}/owner/${drafter}/actions/pick`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: chosen.id,
          displayName: chosen.id,
          team,
          position,
        }),
      },
    );
    if (!res.ok) {
      // Benign losses (turn advanced, dup pick) end here — engine's buzzer
      // auto-pick is the backstop either way. Log for the admin Logs tab.
      const bodyText = await res.text().catch(() => '');
      console.warn('[onBotTurn] pick rejected', draftId, drafter, res.status, bodyText.slice(0, 200));
      logErrorEvent('bots.brain.pick_rejected', `pick endpoint ${res.status}`, {
        actor: drafter,
        route: 'functions/onBotTurn',
        context: { draftId, pickNumber: pickNumberAtStart, playerId: chosen.id, status: res.status, body: bodyText.slice(0, 300) },
      });
      return false;
    }
    console.log(`[onBotTurn] ${drafter} picked ${chosen.id} in ${draftId} ${delayNote} (pick ${pickNumberAtStart})`);
    return true;
  } catch (err) {
    console.error('[onBotTurn] failed — engine auto-pick will cover', err);
    logErrorEvent('bots.brain.failed', err && err.message ? err.message : String(err), {
      actor: drafter,
      route: 'functions/onBotTurn',
      context: { draftId, pickNumber: pickNumberAtStart },
    });
    return false;
  }
}

exports.onBotTurn = functions
  .region('us-central1')
  // 300s: a countdown-phase pick 1 can now sleep up to ~60s (rest of the
  // countdown) + 90s (slow-draft max human delay) before its lookups.
  .runWith({ timeoutSeconds: 300, memory: '256MB' })
  .database.ref('drafts/{draftId}/realTimeDraftInfo')
  // onWrite, NOT onUpdate (2026-07-12): pick 1 of every draft arrives as the
  // CREATION of this node at draft start — onUpdate never fired for it, so a
  // bot holding pick 1 always buzzer-picked (seen live in fast-draft-122).
  // onWrite fires on create + update; deletes are guarded below, and the
  // pure-tick guard already handles a null `before` (create).
  .onWrite(async (change, ctx) => {
    if (!change.after.exists()) return null; // node deleted — nothing to do
    const before = change.before.val();
    const after = change.after.val();
    const { draftId } = ctx.params;

    if (!after || after.isDraftComplete || after.isDraftClosed) return null;
    // Pure timer tick (nothing advanced) — same guard as onPickAdvance.
    if (
      before &&
      before.currentDrafter === after.currentDrafter &&
      before.pickNumber === after.pickNumber
    ) {
      return null;
    }

    const drafter = String(after.currentDrafter || '').toLowerCase();
    // Legacy fake FillBots owners ("bot-…") are handled by the engine itself.
    if (!drafter || drafter.startsWith('bot-')) return null;

    // Only act for registered house bots.
    const botDoc = await admin.firestore().collection('botWallets').doc(drafter).get();
    if (!botDoc.exists || botDoc.data().isBot !== true) return null;

    // Kill switch + dials. enabled must be EXPLICITLY true.
    const cfgSnap = await admin.firestore().collection('system_config').doc('botBrain').get();
    const cfg = cfgSnap.exists ? cfgSnap.data() : {};
    if (cfg.enabled !== true) return null;

    const pickLength = Number(after.pickLength ?? 0);
    const pickNumberAtStart = Number(after.pickNumber ?? 0);

    // SLOW drafts (Richard, 2026-07-21): a bot should answer at a random point
    // while the pause-aware clock still reads between ~8:00:00 and 6:00:00
    // left — hours into its window like a human, not 30–90s in like the old
    // path (which read as instant answers around the clock). A function can't
    // sleep for hours, so enqueue a target clock reading for
    // botSlowPickWorker (5-min cron) and get out. Doc is keyed by draftId
    // (only one seat is ever on the clock per draft), so each new bot turn
    // overwrites the previous task and stale tasks can't stack up.
    if (pickLength >= 3600) {
      const minClock = Math.max(60, Number(cfg.slowPickMinClockSec ?? 21600));
      const maxClockRaw = Number(cfg.slowPickMaxClockSec ?? 28500);
      // Never target the full window (instant answer) or less than the min.
      const maxClock = Math.min(Math.max(maxClockRaw, minClock), pickLength - 60);
      const targetClockSec = Math.round(minClock + Math.random() * (Math.max(maxClock, minClock) - minClock));
      await admin.firestore().collection('botPickQueue').doc(draftId).set({
        drafter,
        pickNumber: pickNumberAtStart,
        targetClockSec,
        pickLength,
        createdAt: new Date().toISOString(),
      });
      console.log(`[onBotTurn] slow draft — queued ${drafter} pick ${pickNumberAtStart} in ${draftId} for clock <= ${targetClockSec}s left`);
      return null;
    }

    const isFast = pickLength > 0 && pickLength <= 3600;
    const minD = Number(isFast ? cfg.fastMinDelaySec ?? 10 : cfg.slowMinDelaySec ?? 30);
    const maxD = Number(isFast ? cfg.fastMaxDelaySec ?? 30 : cfg.slowMaxDelaySec ?? 90);
    let delaySec = minD + Math.random() * (Math.max(maxD, minD) - minD);

    // Pick 1's RTDB node is CREATED at league fill — 60s before the pick
    // window opens (pickStartTime = draftStartTime). The Go engine accepts
    // early picks, so a bot holding pick 1 that submits during the countdown
    // drags the whole draft ahead of every client's "Starting soon" clock
    // (BBB #143 + #144, 2026-07-14: seat 3 humans saw ~11s of a 30s pick).
    // Anchor the bot's human-like delay to the window OPENING, not to this
    // wake-up: sleep out the rest of the countdown first, then the delay.
    const nowSec = Date.now() / 1000;
    const windowOpensSec = Number(after.pickStartTime || 0);
    const untilOpenSec = Math.max(0, windowOpensSec - nowSec);

    // Leave ≥5s of headroom before the buzzer so the engine's own auto-pick
    // path is never raced at the wire. Headroom is measured from when the
    // window opens (= now for every pick except a countdown-phase pick 1).
    const headroom = Number(after.pickEndTime || 0) - Math.max(nowSec, windowOpensSec) - 5;
    if (headroom <= 1) return null; // window already nearly over — engine handles it
    if (delaySec > headroom) delaySec = Math.max(1, headroom);

    await sleepMs((untilOpenSec + delaySec) * 1000);

    // COMPUTE AT SUBMIT: fresh read after the sleep. If the world moved on
    // (bot already picked via engine, pick advanced, draft over) — walk away.
    const liveSnap = await change.after.ref.once('value');
    const live = liveSnap.val() || {};
    if (live.isDraftComplete || live.isDraftClosed) return null;
    if (String(live.currentDrafter || '').toLowerCase() !== drafter) return null;
    if (Number(live.pickNumber ?? -1) !== pickNumberAtStart) return null;
    if (Date.now() / 1000 > Number(live.pickEndTime || 0) - 3) return null;
    // NEVER submit before the pick window opens — even if the sleep math
    // above is ever wrong, an early pick desyncs the draft from every
    // client's countdown. The engine's auto-pick covers a skipped turn.
    if (Date.now() / 1000 < Number(live.pickStartTime || 0)) return null;

    await submitBotPick(draftId, drafter, pickNumberAtStart, cfg, `after ${Math.round(delaySec)}s`);

    return null;
  });

/**
 * botSlowPickWorker — the slow-draft half of the bot brain (Richard's spec,
 * 2026-07-21): a bot in a slow draft picks at a random point while the
 * pause-aware clock reads between ~7:55:00 and 6:00:00 left, not seconds into
 * an 8-hour window. onBotTurn enqueues a botPickQueue/{draftId} doc with the
 * target clock reading; this cron submits the pick once the displayed clock
 * crosses it. The clock is frozen 22:00–05:00 PT, so a target can only be
 * crossed during active hours — bots never answer overnight (the tick also
 * hard-skips the pause window so a stale task can't fire at 3am either).
 * Verification mirrors onBotTurn's compute-at-submit rules: fresh RTDB read,
 * same drafter, same pickNumber, window open, never near the buzzer. Every
 * failure path leaves the engine's own auto-pick as the backstop.
 */
exports.botSlowPickWorker = functions
  .region('us-central1')
  .runWith({ timeoutSeconds: 300, memory: '256MB' })
  .pubsub.schedule('every 5 minutes')
  .timeZone('America/Los_Angeles')
  .onRun(async () => {
    const cfgSnap = await admin.firestore().collection('system_config').doc('botBrain').get();
    const cfg = cfgSnap.exists ? cfgSnap.data() : {};
    if (cfg.enabled !== true) return null;

    const queue = await admin.firestore().collection('botPickQueue').get();
    if (queue.empty) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    if (isSlowDraftNightPause(nowSec)) return null;

    for (const doc of queue.docs) {
      const task = doc.data() || {};
      const draftId = doc.id;
      const drafter = String(task.drafter || '').toLowerCase();
      try {
        const liveSnap = await admin.database().ref(`drafts/${draftId}/realTimeDraftInfo`).once('value');
        const live = liveSnap.val();
        // Stale task — draft gone/over, or the turn moved on without us
        // (engine buzzer-picked, or a human picked into the window): drop it.
        if (
          !live || live.isDraftComplete || live.isDraftClosed
          || String(live.currentDrafter || '').toLowerCase() !== drafter
          || Number(live.pickNumber ?? -1) !== Number(task.pickNumber ?? -2)
        ) {
          await doc.ref.delete();
          continue;
        }
        // Countdown-phase pick 1: window not open yet — check again next tick.
        if (nowSec < Number(live.pickStartTime || 0)) continue;
        const clockRemaining = slowDraftActiveSecondsUntil(nowSec, Number(live.pickEndTime || 0));
        // Buzzer imminent (shouldn't happen with a ≥6h target) — engine's lane.
        if (clockRemaining <= 120) {
          await doc.ref.delete();
          continue;
        }
        if (clockRemaining > Number(task.targetClockSec || 0)) continue; // not time yet
        const h = Math.floor(clockRemaining / 3600);
        const m = Math.floor((clockRemaining % 3600) / 60);
        const ok = await submitBotPick(draftId, drafter, Number(task.pickNumber ?? 0), cfg, `with ${h}h${String(m).padStart(2, '0')}m left`);
        // On failure keep the task: the next tick re-verifies and retries (or
        // deletes it as stale once the engine/turn has moved on).
        if (ok) await doc.ref.delete();
      } catch (err) {
        console.error('[botSlowPickWorker] task failed', draftId, err);
        logErrorEvent('bots.brain.slow_worker_failed', err && err.message ? err.message : String(err), {
          actor: drafter,
          route: 'functions/botSlowPickWorker',
          context: { draftId, pickNumber: Number(task.pickNumber ?? -1) },
        });
      }
    }
    return null;
  });

/**
 * scheduledUpdateRosters — daily roster/depth-chart refresh from Rolling
 * Insights (PlayersFromTeam + 2026 byes in playerStats2026/playerMap; ADP is
 * owned by scheduledUpdateADP). Export restored 2026-07-04 so the deployed
 * cron picks up the NAME_FIX/PINNED guards in updateRosters.js — the old
 * deployed copy kept dropping Justin Jefferson (MIN) and mangling several
 * depth names on every nightly run. See updateRosters.js.
 */
const { updateRosters } = require("./updateRosters");
exports.scheduledUpdateRosters = functions
  .runWith({ timeoutSeconds: 300, memory: "512MB" })
  .pubsub.schedule("every 24 hours")
  .timeZone("America/New_York")
  .onRun(async () => {
    const res = await updateRosters({ db: admin.firestore() });
    console.log("[scheduledUpdateRosters] complete", JSON.stringify(res));
    return null;
  });
