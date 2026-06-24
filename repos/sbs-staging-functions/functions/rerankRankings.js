const admin = require("firebase-admin");

/**
 * rerankToFollowAdp — make each user's DEFAULT rankings track live ADP, while
 * never touching anyone who actually customized their order.
 *
 * Runs right after updateADP rewrites ADP, so it ranks off fresh ADP.
 *
 * Per-user rankings live at owners/{wallet}/drafts/rankings (field `Ranking`:
 * [{ PlayerId, Rank, Score }]). The draft board AND the /rankings page both read
 * this same doc, so updating it fixes both surfaces at once.
 *
 * HOW WE TELL "customized" FROM "default" (the whole safety story):
 *   - First time we ever see a doc (no marker we wrote): if the doc's
 *     updateTime is later than its createTime by more than EPS, a human SAVED it
 *     after it was auto-created → CUSTOMIZED, never touch its order. If
 *     updateTime == createTime, it was written exactly once (the auto-snapshot)
 *     and never again → DEFAULT → safe to set to ADP order. (A doc written once
 *     and never again provably has no user edits to lose.)
 *   - After we manage a doc we stamp `_lastWrittenOrder` (the order we wrote).
 *     On later runs we IGNORE timestamps (our own writes move updateTime) and
 *     instead: if the doc's current order != `_lastWrittenOrder`, the user
 *     edited it since → mark `_customized`, back off. Else keep it on ADP.
 *   - A customized user who reverts to exactly the current ADP order (e.g. hits
 *     "reset to ADP") resumes tracking.
 *
 * SAFETY INVARIANT: we only ever OVERWRITE a doc's order when it is provably a
 * system default — either (a) written once and never edited, or (b) still
 * exactly equal to the order we last wrote. The instant a doc shows a human
 * edit, it is marked and never written again. So a real custom order can't be
 * clobbered.
 */

const SEASON_COLLECTION = "playerStats2026";
const EDIT_EPS_MS = 2000; // a single set() has create==update; a real save advances it far beyond this

const orderKey = (ids) => ids.join("|");
// The meaningful order is by the Rank field (what board/page display), not the
// raw array storage order (which can differ with no user edit).
const sortedOrder = (arr) => (arr || [])
    .map((e) => ({ pid: e.PlayerId || e.playerId, rank: Number(e.Rank != null ? e.Rank : e.rank) }))
    .filter((x) => x.pid)
    .sort((a, b) => (a.rank || 1e9) - (b.rank || 1e9))
    .map((x) => x.pid);

async function rerankToFollowAdp({ db, dryRun = false } = {}) {
  db = db || admin.firestore();

  // Universe + projected Score come from the seed rankings doc; the ORDER we
  // impose comes from live ADP in playerMap.
  const players = ((await db.collection(SEASON_COLLECTION).doc("playerMap").get()).data() || {}).Players || {};
  const seedData = (await db.collection(SEASON_COLLECTION).doc("rankings").get()).data() || {};
  const seedArr = seedData.Ranking || seedData.ranking || [];
  const scoreMap = {};
  const universe = [];
  for (const e of seedArr) {
    const pid = e.PlayerId || e.playerId;
    if (!pid) continue;
    universe.push(pid);
    scoreMap[pid] = e.Score != null ? e.Score : (e.score != null ? e.score : 0);
  }
  if (universe.length === 0) {
    return { skipped: "no seed rankings; rerank not run" };
  }
  const adpOf = (pid) => {
    const p = players[pid];
    const a = p && (p.ADP != null ? p.ADP : p.adp);
    return typeof a === "number" ? a : 1e9;
  };
  const adpOrder = [...universe].sort((a, b) =>
    (adpOf(a) - adpOf(b)) || ((scoreMap[b] || 0) - (scoreMap[a] || 0)) || (a < b ? -1 : 1));
  const adpKey = orderKey(adpOrder);
  const adpRanking = adpOrder.map((pid, i) => ({ PlayerId: pid, Rank: i + 1, Score: scoreMap[pid] || 0 }));

  const ownerRefs = await db.collection("owners").listDocuments();
  const rep = { docs: 0, updatedToAdp: 0, markedCustomized: 0, resumed: 0, customizedSkipped: 0, alreadyOnAdp: 0, empty: 0, dryRun };
  const CH = 300;
  for (let i = 0; i < ownerRefs.length; i += CH) {
    const refs = ownerRefs.slice(i, i + CH).map((r) => r.collection("drafts").doc("rankings"));
    const snaps = await db.getAll(...refs);
    const batch = dryRun ? null : db.batch();
    let bc = 0;
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const data = snap.data() || {};
      const curOrder = sortedOrder(data.Ranking || data.ranking || []);
      if (!curOrder.length) { rep.empty++; continue; }
      rep.docs++;
      const curKey = orderKey(curOrder);
      const ref = snap.ref;
      const hasMarker = data._lastWrittenOrder !== undefined || data._customized !== undefined;

      if (data._customized === true) {
        if (curKey === adpKey) { // reverted to ADP → resume tracking
          rep.resumed++;
          if (!dryRun) { batch.set(ref, { Ranking: adpRanking, _customized: false, _lastWrittenOrder: adpKey }, { merge: true }); bc++; }
        } else { rep.customizedSkipped++; }
        continue;
      }

      if (!hasMarker) {
        // First encounter: decide by timestamp.
        const cT = snap.createTime ? snap.createTime.toMillis() : 0;
        const uT = snap.updateTime ? snap.updateTime.toMillis() : 0;
        if ((uT - cT) > EDIT_EPS_MS) { // human saved after auto-create → customized
          rep.markedCustomized++;
          if (!dryRun) { batch.set(ref, { _customized: true }, { merge: true }); bc++; }
          continue;
        }
        // written once, never edited → safe to set to ADP
        rep.updatedToAdp++;
        if (!dryRun) { batch.set(ref, { Ranking: adpRanking, _lastWrittenOrder: adpKey }, { merge: true }); bc++; }
        continue;
      }

      // Managed before (tracking): detect edits via our own marker, not timestamps.
      if (curKey !== data._lastWrittenOrder) { // user edited since we last wrote
        rep.markedCustomized++;
        if (!dryRun) { batch.set(ref, { _customized: true }, { merge: true }); bc++; }
        continue;
      }
      if (curKey !== adpKey) { // still on our order, ADP moved → re-track
        rep.updatedToAdp++;
        if (!dryRun) { batch.set(ref, { Ranking: adpRanking, _lastWrittenOrder: adpKey }, { merge: true }); bc++; }
      } else {
        rep.alreadyOnAdp++;
      }
    }
    if (!dryRun && bc > 0) await batch.commit();
  }
  return rep;
}

module.exports = { rerankToFollowAdp };
