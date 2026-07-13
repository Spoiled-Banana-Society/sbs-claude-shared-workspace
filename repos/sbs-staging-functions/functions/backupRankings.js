const admin = require("firebase-admin");

/**
 * backupRankings — daily durable snapshot of every user's draft rankings.
 *
 * Rankings are the one piece of user state we can't regenerate: a player who
 * hand-sorts their board has an irreplaceable order. The hourly ADP rerank is
 * built to never touch a customized doc, but a backup is the real safety net —
 * if anything ever corrupts or wrongly overwrites a board, we can restore it.
 *
 * Each run writes ONE JSON object to gs://sbs-staging-rankings-backups holding:
 *   - every owners/{wallet}/drafts/rankings doc (full order + _customized flag +
 *     _lastWrittenOrder + timestamps)
 *   - the global seed doc (playerStats2026/rankings) for completeness
 * so a single file fully restores the rankings state at that moment.
 *
 * The bucket has a 90-day delete lifecycle, giving a rolling ~3-month window.
 * Read-only against Firestore — it never writes a ranking, so it can't be the
 * thing that breaks one.
 */

const BUCKET = "sbs-staging-rankings-backups";
const SEASON_COLLECTION = "playerStats2026";

async function backupRankings({ db, bucketName = BUCKET, takenAt } = {}) {
  db = db || admin.firestore();
  takenAt = takenAt || new Date().toISOString();

  const ownerRefs = await db.collection("owners").listDocuments();
  const perUser = [];
  let customizedCount = 0;
  const CH = 300;
  for (let i = 0; i < ownerRefs.length; i += CH) {
    const refs = ownerRefs.slice(i, i + CH).map((r) => r.collection("drafts").doc("rankings"));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const d = snap.data() || {};
      const customized = d._customized === true;
      if (customized) customizedCount++;
      perUser.push({
        wallet: snap.ref.parent.parent.id,
        customized,
        createTime: snap.createTime ? snap.createTime.toDate().toISOString() : null,
        updateTime: snap.updateTime ? snap.updateTime.toDate().toISOString() : null,
        _lastWrittenOrder: d._lastWrittenOrder !== undefined ? d._lastWrittenOrder : null,
        Ranking: d.Ranking || d.ranking || [],
      });
    }
  }

  const globalSeed = (await db.collection(SEASON_COLLECTION).doc("rankings").get()).data() || {};

  const payload = {
    takenAt,
    totalDocs: perUser.length,
    customizedCount,
    globalSeed_playerStats2026_rankings: globalSeed,
    perUser,
  };

  // Partition by day so the bucket browses cleanly; filename is fully timestamped.
  const day = takenAt.slice(0, 10);
  const safe = takenAt.replace(/[:.]/g, "-");
  const path = `rankings/${day}/rankings-backup-${safe}.json`;
  await admin
    .storage()
    .bucket(bucketName)
    .file(path)
    .save(JSON.stringify(payload), { contentType: "application/json", resumable: false });

  return { bucket: bucketName, path, totalDocs: perUser.length, customizedCount };
}

module.exports = { backupRankings };
