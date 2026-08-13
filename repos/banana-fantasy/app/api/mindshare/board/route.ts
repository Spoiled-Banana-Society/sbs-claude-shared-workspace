/**
 * Banana X Mindshare — public board read.
 *
 * Returns the live week (countdown target), the top-25 tiles with share
 * percentages, and — when ?wallet= is passed — the viewer's own row (their
 * linked X handle, rank, score) so the page can pin YOU everywhere.
 *
 * Zero-state (launch + every Thursday-night reset): when fewer than 6 tiles
 * have scored, also returns a sample of REAL linked X handles (bots excluded)
 * at score 0, so the page can show the board "moving" while everyone is at
 * zero (Richard 8/13: people should see how it works even at all-zeros).
 */
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { getOrInitState, WEEKS_COLLECTION } from '@/lib/mindshare';
import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';

export const dynamic = 'force-dynamic';

interface TileOut { handle: string; score: number; pct: number; rank: number }

export async function GET(req: Request) {
  if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 500);
  try {
    const db = getAdminFirestore();
    const state = await getOrInitState();

    const tilesSnap = await db.collection(WEEKS_COLLECTION).doc(state.weekId)
      .collection('tiles').orderBy('attention', 'desc').limit(200).get();
    const ranked = tilesSnap.docs
      .map((d) => {
        const t = d.data();
        return {
          key: d.id,
          handle: String(t.handle ?? d.id),
          score: (Number(t.attention) || 0) + (Number(t.refBonus) || 0),
        };
      })
      .sort((a, b) => b.score - a.score);
    const total = ranked.reduce((s, t) => s + t.score, 0);
    const tiles: TileOut[] = ranked.slice(0, 25).map((t, i) => ({
      handle: t.handle,
      score: Math.round(t.score),
      pct: total > 0 ? Math.round((t.score / total) * 1000) / 10 : 0,
      rank: i + 1,
    }));

    // Viewer row
    const wallet = (getSearchParam(req, 'wallet') ?? '').toLowerCase();
    let you: { handle: string | null; linked: boolean; rank: number | null; score: number; pct: number } | null = null;
    if (/^0x[0-9a-f]{40}$/.test(wallet)) {
      const userSnap = await db.collection('v2_users').doc(wallet).get();
      const rawHandle = userSnap.exists ? String(userSnap.data()?.xHandle ?? '') : '';
      const handle = rawHandle.replace(/^@/, '');
      if (!handle) {
        you = { handle: null, linked: false, rank: null, score: 0, pct: 0 };
      } else {
        const idx = ranked.findIndex((t) => t.key === handle.toLowerCase());
        const score = idx >= 0 ? Math.round(ranked[idx].score) : 0;
        you = {
          handle,
          linked: true,
          rank: idx >= 0 ? idx + 1 : null,
          score,
          pct: idx >= 0 && total > 0 ? Math.round((score / total) * 1000) / 10 : 0,
        };
      }
    }

    // Zero-state: real linked handles so the board has tiles to shuffle at 0.
    const zeroTiles: string[] = [];
    if (tiles.length < 6) {
      const [usersSnap, botsSnap] = await Promise.all([
        db.collection('v2_users').select('xHandle').limit(2000).get(),
        db.collection('botWallets').select().get(),
      ]);
      const bots = new Set(botsSnap.docs.map((d) => d.id.toLowerCase()));
      const seen = new Set(ranked.map((t) => t.key));
      for (const doc of usersSnap.docs) {
        if (bots.has(doc.id.toLowerCase())) continue;
        const h = String(doc.data()?.xHandle ?? '').replace(/^@/, '');
        if (!h || seen.has(h.toLowerCase())) continue;
        seen.add(h.toLowerCase());
        zeroTiles.push(h);
        if (zeroTiles.length >= 30) break;
      }
    }

    return json({
      week: { id: state.weekId, startsAtMs: state.startsAtMs, endsAtMs: state.endsAtMs },
      total: Math.round(total),
      tiles,
      you,
      zeroTiles,
    });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : 'board read failed', 500);
  }
}
