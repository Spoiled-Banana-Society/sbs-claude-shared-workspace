const functions = require("firebase-functions");
const admin = require("firebase-admin");
const fetch = require("node-fetch");

admin.initializeApp();

const DRAFTS_API_URL = "https://sbs-drafts-api-staging-652484219017.us-central1.run.app";

const { updateADP } = require("./updateADP");

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

// Only fire for slow drafts — fast drafts have everyone on-page already.
const SLOW_PICK_THRESHOLD_SECONDS = 3600; // pickLength > 60 min = slow

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

    // currentDrafter hasn't actually changed — ignore timer-only updates.
    if (before && before.currentDrafter === after.currentDrafter) return null;

    // Only slow drafts need push. Fast draft users are sitting on the page.
    const pickLength = Number(after.pickLength ?? 0);
    if (!pickLength || pickLength <= SLOW_PICK_THRESHOLD_SECONDS) return null;

    const walletAddress = String(after.currentDrafter || '').toLowerCase();
    if (!walletAddress || walletAddress.startsWith('bot-')) return null;

    const body = {
      walletAddress,
      draftId,
      draftName: after.displayName,
      pickNumber: after.currentPickNumber,
      pickLengthSeconds: pickLength,
    };

    try {
      const res = await fetch(PICK_UP_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        console.warn('[onPickAdvance] pick-up endpoint', res.status, await res.text());
      }
    } catch (err) {
      console.error('[onPickAdvance] fetch failed', err);
    }

    return null;
  });

/**
 * scheduledUpdateADP — hourly Average Draft Position recompute.
 *
 * Staging port of prod's updateADPForPlayers. Reads completed (IsLocked) drafts
 * from Firestore, averages each team-position's pick number, and writes the
 * result into playerStats2024/playerMap. See updateADP.js.
 *
 * Prod config: { timeoutSeconds: 500, memory: "512MB" }, 'every 1 hours'.
 */
exports.scheduledUpdateADP = functions
  .runWith({ timeoutSeconds: 500, memory: "512MB" })
  .pubsub.schedule("every 60 minutes")
  .timeZone("America/New_York")
  .onRun(async () => {
    const res = await updateADP({ db: admin.firestore() });
    console.log("[scheduledUpdateADP] complete", JSON.stringify(res));
    return null;
  });
