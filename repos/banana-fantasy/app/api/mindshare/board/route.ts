/**
 * Banana X Mindshare — public board read.
 *
 * Returns the live week (countdown target), the top-25 tiles with share
 * percentages, and — when ?wallet= is passed — the viewer's own row so the
 * page can pin YOU everywhere.
 *
 * Identity rules (Richard 8/13):
 * - Board shows SITE USERNAMES, never X handles, for anyone whose X is
 *   linked to an SBS account. Unlinked tweeters fall back to @xhandle (the
 *   only identity we have — doubles as the nudge to link).
 * - The persisted X-link store is v2_twitter_links (twitterHandle +
 *   lowercased walletAddress). v2_users.xHandle is client-memory only and
 *   NEVER written to Firestore (verified 8/13: 0 of 1,435 docs).
 * - House accounts (EXCLUDED_HANDLES) never appear.
 *
 * Zero-state (launch + every Thursday-night reset): when fewer than 6 tiles
 * have scored, also returns a sample of REAL linked players (bots excluded)
 * at score 0, so the page can show the board "moving" while everyone is at
 * zero (Richard 8/13: people should see how it works even at all-zeros).
 */
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { getOrInitState, WEEKS_COLLECTION, EXCLUDED_HANDLES } from '@/lib/mindshare';
import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';

export const dynamic = 'force-dynamic';

interface TileOut { handle: string; display: string; score: number; pct: number; rank: number }

export async function GET(req: Request) {
  if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 500);
  try {
    const db = getAdminFirestore();
    const state = await getOrInitState();

    const [tilesSnap, linksSnap, botsSnap] = await Promise.all([
      db.collection(WEEKS_COLLECTION).doc(state.weekId).collection('tiles')
        .orderBy('attention', 'desc').limit(200).get(),
      db.collection('v2_twitter_links').select('twitterHandle', 'walletAddress').get(),
      db.collection('botWallets').select().get(),
    ]);

    const bots = new Set(botsSnap.docs.map((d) => d.id.toLowerCase()));
    const handleToWallet = new Map<string, string>();
    const walletToHandle = new Map<string, string>();
    for (const d of linksSnap.docs) {
      const h = String(d.data()?.twitterHandle ?? '').replace(/^@/, '');
      const w = String(d.data()?.walletAddress ?? '').toLowerCase();
      if (!h || !/^0x[0-9a-f]{40}$/.test(w)) continue;
      handleToWallet.set(h.toLowerCase(), w);
      if (!walletToHandle.has(w)) walletToHandle.set(w, h);
    }

    const ranked = tilesSnap.docs
      .map((d) => {
        const t = d.data();
        return {
          key: d.id,
          handle: String(t.handle ?? d.id),
          score: (Number(t.attention) || 0) + (Number(t.refBonus) || 0),
        };
      })
      // Board = SBS accounts ONLY (Richard 8/13: "new people dont get shit,
      // its if they have accounts with us"). Unlinked tweeters are scored and
      // banked in Firestore but never shown — the moment they link, they
      // appear with all their points. Zero-score tiles don't clutter either.
      .filter((t) => !EXCLUDED_HANDLES.has(t.key) && t.score > 0 && handleToWallet.has(t.key))
      .sort((a, b) => b.score - a.score);
    const total = ranked.reduce((s, t) => s + t.score, 0);

    // Zero-state sample: real linked players not already on the board.
    const zeroHandles: string[] = [];
    if (ranked.filter((t) => t.score > 0).length < 6) {
      const seen = new Set(ranked.map((t) => t.key));
      for (const [hLower, w] of handleToWallet) {
        if (bots.has(w) || seen.has(hLower) || EXCLUDED_HANDLES.has(hLower)) continue;
        seen.add(hLower);
        zeroHandles.push(hLower);
        if (zeroHandles.length >= 30) break;
      }
    }

    // Viewer's linked handle
    const wallet = (getSearchParam(req, 'wallet') ?? '').toLowerCase();
    const viewerHandle = /^0x[0-9a-f]{40}$/.test(wallet) ? (walletToHandle.get(wallet) ?? null) : null;

    // Username join: one getAll over every wallet we might display.
    const walletsNeeded = new Set<string>();
    for (const t of ranked.slice(0, 25)) {
      const w = handleToWallet.get(t.key);
      if (w) walletsNeeded.add(w);
    }
    for (const h of zeroHandles) {
      const w = handleToWallet.get(h);
      if (w) walletsNeeded.add(w);
    }
    const usernameByWallet = new Map<string, string>();
    const walletList = [...walletsNeeded];
    if (walletList.length > 0) {
      const docs = await db.getAll(
        ...walletList.map((w) => db.collection('v2_users').doc(w)),
        { fieldMask: ['username'] },
      );
      docs.forEach((doc, i) => {
        const name = String(doc.data()?.username ?? '').trim();
        if (name) usernameByWallet.set(walletList[i], name);
      });
    }
    const displayFor = (handleLower: string, handleRaw: string): string => {
      const w = handleToWallet.get(handleLower);
      const name = w ? usernameByWallet.get(w) : undefined;
      // Placeholder site names ("User-0xdaca…") aren't identities — the X
      // handle reads better until they pick a real username (Richard 8/13).
      if (name && !/^user-0x/i.test(name)) return name;
      return `@${handleRaw}`;
    };

    const tiles: TileOut[] = ranked.slice(0, 25).map((t, i) => ({
      handle: t.handle,
      display: displayFor(t.key, t.handle),
      score: Math.round(t.score),
      pct: total > 0 ? Math.round((t.score / total) * 1000) / 10 : 0,
      rank: i + 1,
    }));

    let you: { handle: string | null; display: string | null; linked: boolean; rank: number | null; score: number; pct: number } | null = null;
    if (/^0x[0-9a-f]{40}$/.test(wallet)) {
      if (!viewerHandle) {
        you = { handle: null, display: null, linked: false, rank: null, score: 0, pct: 0 };
      } else {
        const idx = ranked.findIndex((t) => t.key === viewerHandle.toLowerCase());
        const score = idx >= 0 ? Math.round(ranked[idx].score) : 0;
        you = {
          handle: viewerHandle,
          display: displayFor(viewerHandle.toLowerCase(), viewerHandle),
          linked: true,
          rank: idx >= 0 ? idx + 1 : null,
          score,
          pct: idx >= 0 && total > 0 ? Math.round((score / total) * 1000) / 10 : 0,
        };
      }
    }

    const zeroTiles = zeroHandles.map((h) => displayFor(h, h));

    return json({
      week: { id: state.weekId, startsAtMs: state.startsAtMs, endsAtMs: state.endsAtMs },
      total: Math.round(total),
      tiles,
      you,
      zeroTiles,
    }, {
      // Stale-tab guard: the page compares this against the value it saw on
      // first load and reloads itself when a new deploy lands (launch-day
      // iterations left open tabs rendering with old page code — Richard 8/13).
      headers: { 'x-mindshare-build': (process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev').slice(0, 12) },
    });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : 'board read failed', 500);
  }
}
