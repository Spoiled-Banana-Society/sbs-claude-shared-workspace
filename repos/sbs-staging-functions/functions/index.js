const functions = require("firebase-functions");
const admin = require("firebase-admin");
const fetch = require("node-fetch");

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
  .onUpdate(async (change, ctx) => {
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

exports.onBotTurn = functions
  .region('us-central1')
  .runWith({ timeoutSeconds: 180, memory: '256MB' })
  .database.ref('drafts/{draftId}/realTimeDraftInfo')
  .onUpdate(async (change, ctx) => {
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
    const isFast = pickLength > 0 && pickLength <= 3600;
    const minD = Number(isFast ? cfg.fastMinDelaySec ?? 10 : cfg.slowMinDelaySec ?? 30);
    const maxD = Number(isFast ? cfg.fastMaxDelaySec ?? 30 : cfg.slowMaxDelaySec ?? 90);
    let delaySec = minD + Math.random() * (Math.max(maxD, minD) - minD);

    // Leave ≥5s of headroom before the buzzer so the engine's own auto-pick
    // path is never raced at the wire.
    const pickNumberAtStart = Number(after.pickNumber ?? 0);
    const headroom = Number(after.pickEndTime || 0) - Date.now() / 1000 - 5;
    if (headroom <= 1) return null; // window already nearly over — engine handles it
    if (delaySec > headroom) delaySec = Math.max(1, headroom);

    await sleepMs(delaySec * 1000);

    // COMPUTE AT SUBMIT: fresh read after the sleep. If the world moved on
    // (bot already picked via engine, pick advanced, draft over) — walk away.
    const liveSnap = await change.after.ref.once('value');
    const live = liveSnap.val() || {};
    if (live.isDraftComplete || live.isDraftClosed) return null;
    if (String(live.currentDrafter || '').toLowerCase() !== drafter) return null;
    if (Number(live.pickNumber ?? -1) !== pickNumberAtStart) return null;
    if (Date.now() / 1000 > Number(live.pickEndTime || 0) - 3) return null;

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
      // Draft toward the blueprint: only slot types still needed, and never a
      // backup (RB2/WR2) before 2+ starters at that position are rostered.
      const needed = available.filter((s) => {
        const t = typeOf(s.id);
        if ((mine[t] || 0) >= (targets[t] ?? 0)) return false;
        if (t === 'RB2' && (mine.RB1 || 0) < 2) return false;
        if (t === 'WR2' && (mine.WR1 || 0) < 2) return false;
        return true;
      });
      if (needed.length > 0) available = needed; // blueprint is a plan, not a straitjacket — never strand the bot
      if (available.length === 0) return null; // engine fallback will handle it

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
      } else {
        console.log(`[onBotTurn] ${drafter} picked ${chosen.id} in ${draftId} after ${Math.round(delaySec)}s (pick ${pickNumberAtStart})`);
      }
    } catch (err) {
      console.error('[onBotTurn] failed — engine auto-pick will cover', err);
      logErrorEvent('bots.brain.failed', err && err.message ? err.message : String(err), {
        actor: drafter,
        route: 'functions/onBotTurn',
        context: { draftId, pickNumber: pickNumberAtStart },
      });
    }

    return null;
  });
