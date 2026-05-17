import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STREAM_LIFETIME_MS = 55_000;
const KEEPALIVE_INTERVAL_MS = 15_000;

interface TokenPayload {
  cardId: string;
  leagueId: string;
  leagueDisplayName: string;
  level: string;
  draftType?: string;
  rosterCount: number;
  ownerId: string;
}

interface StreamPayload {
  walletAddress: string;
  tokens: TokenPayload[];
}

/**
 * GET /api/drafts/my-drafts/stream?wallet={walletAddress}
 *
 * Server-Sent Events stream of a user's active draft tokens. Subscribes
 * to the `owners/{walletAddress}/usedDraftTokens` collection via
 * Firestore `onSnapshot`. Whenever a token is added (joined a draft) or
 * its fields change (league name written, roster updated as picks
 * happen, completion via roster=15), a fresh token list is pushed.
 *
 * Latency from "draft fills" → "My Drafts row appears with correct
 * league number" is sub-200ms. Replaces the prior 2s polling cadence
 * that left the door open to stale rows between polls.
 *
 * Filters out completed drafts (rosterCount >= 15) server-side so the
 * client doesn't need to. Backfills empty leagueDisplayName from the
 * draft doc same as the REST endpoint.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const walletParam = (url.searchParams.get('wallet') || '').trim().toLowerCase();
  if (!walletParam || !/^0x[a-f0-9]{40}$/.test(walletParam)) {
    return new Response('Missing or invalid `wallet` query param', { status: 400 });
  }

  if (!isFirestoreConfigured()) {
    const empty: StreamPayload = { walletAddress: walletParam, tokens: [] };
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${JSON.stringify(empty)}\n\n`));
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  }

  const db = getAdminFirestore();
  const collectionRef = db.collection(`owners/${walletParam}/usedDraftTokens`);
  const encoder = new TextEncoder();

  // Backfill helper: if a token's cached LeagueDisplayName is empty,
  // read the draft doc and use its DisplayName instead. Mirrors the
  // Go API backfill — frontend doesn't have to resolve later.
  const enrichToken = async (raw: FirebaseFirestore.DocumentData): Promise<TokenPayload> => {
    const cardId = String(raw._cardId ?? raw.CardId ?? raw.cardId ?? '');
    const leagueId = String(raw._leagueId ?? raw.LeagueId ?? raw.leagueId ?? '');
    let leagueDisplayName = String(raw._leagueDisplayName ?? raw.LeagueDisplayName ?? raw.leagueDisplayName ?? '');
    const level = String(raw._level ?? raw.Level ?? raw.level ?? 'Pro');
    const draftType = raw._draftType ?? raw.DraftType ?? raw.draftType;
    const roster = raw.Roster ?? raw.roster ?? {};
    const rosterCount =
      (roster.QB?.length ?? 0) +
      (roster.RB?.length ?? 0) +
      (roster.WR?.length ?? 0) +
      (roster.TE?.length ?? 0) +
      (roster.DST?.length ?? 0);
    const ownerId = String(raw._ownerId ?? raw.OwnerId ?? raw.ownerId ?? walletParam);

    if (!leagueDisplayName && leagueId) {
      try {
        const draftSnap = await db.collection('drafts').doc(leagueId).get();
        if (draftSnap.exists) {
          const dn = (draftSnap.data() as { DisplayName?: string } | undefined)?.DisplayName;
          if (dn) leagueDisplayName = dn;
        }
      } catch { /* network blip — leave empty, frontend handles fallback */ }
    }

    return { cardId, leagueId, leagueDisplayName, level, draftType, rosterCount, ownerId };
  };

  const buildPayload = async (): Promise<StreamPayload> => {
    const snap = await collectionRef.get();
    const tokens = await Promise.all(snap.docs.map((d) => enrichToken(d.data())));
    // Completed drafts (full roster) drop out — matches REST endpoint
    // semantics so My Drafts only shows in-progress entries.
    const active = tokens.filter((t) => t.rosterCount < 15);
    return { walletAddress: walletParam, tokens: active };
  };

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
        } catch {
          closed = true;
        }
      };

      let firstSnapshotSent = false;
      try {
        const initial = await buildPayload();
        send('snapshot', initial);
        firstSnapshotSent = true;
      } catch (err) {
        logger.warn('drafts.my_drafts.stream.initial_failed', {
          route: '/api/drafts/my-drafts/stream',
          wallet: walletParam,
          err: (err as Error).message,
        });
      }

      // Firestore collection-level onSnapshot fires on any add/remove/
      // update inside `owners/{wallet}/usedDraftTokens`. That covers:
      //   - User joins a new draft (token added)
      //   - Lobby fills (leagueDisplayName written on the token)
      //   - Picks happen (roster updated)
      //   - Draft completes (rosterCount hits 15 → filter excludes)
      const unsubscribe = collectionRef.onSnapshot(
        async () => {
          if (!firstSnapshotSent) {
            firstSnapshotSent = true;
            return;
          }
          try {
            const fresh = await buildPayload();
            send('update', fresh);
          } catch (err) {
            logger.warn('drafts.my_drafts.stream.refetch_failed', {
              route: '/api/drafts/my-drafts/stream',
              wallet: walletParam,
              err: (err as Error).message,
            });
          }
        },
        (err) => {
          logger.warn('drafts.my_drafts.stream.snapshot_err', {
            route: '/api/drafts/my-drafts/stream',
            wallet: walletParam,
            err: err.message,
          });
        },
      );

      const keepalive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          closed = true;
        }
      }, KEEPALIVE_INTERVAL_MS);

      const lifetime = setTimeout(() => {
        if (closed) return;
        closed = true;
        try { unsubscribe(); } catch { /* ignore */ }
        clearInterval(keepalive);
        try { controller.close(); } catch { /* ignore */ }
      }, STREAM_LIFETIME_MS);

      req.signal.addEventListener('abort', () => {
        if (closed) return;
        closed = true;
        try { unsubscribe(); } catch { /* ignore */ }
        clearInterval(keepalive);
        clearTimeout(lifetime);
        try { controller.close(); } catch { /* ignore */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
