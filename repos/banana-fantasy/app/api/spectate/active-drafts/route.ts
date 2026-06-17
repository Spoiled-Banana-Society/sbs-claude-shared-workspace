import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

// GET /api/spectate/active-drafts
//
// Admin-gated. Returns the most recent in-progress drafts so the
// /admin Spectate tab can list them. Strategy:
// 1. Read drafts/draftTracker.FilledLeaguesCount as the high-water mark.
// 2. Probe the latest 30 fast + 30 slow draft IDs in parallel via the
//    Go API state/info endpoint (server-side URL, never PROD).
// 3. Keep drafts where 1 <= pickNumber <= 150 (drafting). Anything that
//    404s is either a future fill slot or pre-state-init filling — we
//    flag those as filling=true if a Firestore doc exists for the id.
// 4. Sort newest first.

const PROBE_DEPTH = 30;
const SPEEDS = ['fast', 'slow'] as const;

interface ActiveDraft {
  draftId: string;
  displayName: string;
  speed: 'fast' | 'slow';
  level: string | null;
  pickNumber: number;
  currentDrafter: string;
  filling: boolean;
}

interface DraftInfoResponse {
  pickNumber: number;
  currentDrafter: string;
  displayName: string;
  currentPickEndTime?: number | null;
}

// Hardcoded staging — see comment in /api/spectate/draft-state/route.ts.
import { getServerDraftsApiUrl } from '@/lib/serverDraftsApiUrl';

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  try {
    await requireAdmin(req);
    if (!isFirestoreConfigured()) throw new ApiError(503, 'Firestore not configured');

    const db = getAdminFirestore();
    const [trackerSnap, recentSnap] = await Promise.all([
      db.collection('drafts').doc('draftTracker').get(),
      // Read a recent draft doc to pull the season year prefix from. Real
      // doc IDs look like "2024-fast-draft-722" — never trust the calendar
      // year for the prefix; the season name lives in the data.
      db.collection('drafts').orderBy('__name__', 'desc').limit(20).get().catch(() => null),
    ]);
    const filled = Number(
      (trackerSnap.data() as { FilledLeaguesCount?: number } | undefined)?.FilledLeaguesCount ?? 0,
    );
    if (filled <= 0) return json({ drafts: [] }, 200);

    const sampleDraftId = recentSnap?.docs.map(d => d.id).find(id => /^\d{4}-(fast|slow)-draft-\d+$/.test(id));
    const yearPrefix = sampleDraftId ? sampleDraftId.split('-')[0] : '2024';
    const apiBase = getServerDraftsApiUrl();

    const candidates: { id: string; speed: 'fast' | 'slow'; num: number }[] = [];
    for (const speed of SPEEDS) {
      for (let i = 0; i < PROBE_DEPTH; i++) {
        const num = filled - i + 1; // include the currently-filling draft (filled+1)
        if (num <= 0) break;
        candidates.push({ id: `${yearPrefix}-${speed}-draft-${num}`, speed, num });
      }
    }

    // Probe both Firestore (for Level/DisplayName) and the Go API (for
    // pickNumber/currentDrafter) in one parallel sweep.
    const [docSnaps, infoResults] = await Promise.all([
      Promise.all(
        candidates.map(c => db.collection('drafts').doc(c.id).get().catch(() => null)),
      ),
      Promise.all(
        candidates.map(c =>
          fetchJson<DraftInfoResponse>(`${apiBase}/draft/${encodeURIComponent(c.id)}/state/info`),
        ),
      ),
    ]);

    type Categorized = ActiveDraft & { completed: boolean };
    const drafts: Categorized[] = candidates
      .map((c, i): Categorized | null => {
        const snap = docSnaps[i];
        const info = infoResults[i];
        const docExists = !!snap?.exists;
        if (!docExists && !info) return null;
        const data = snap?.exists ? (snap.data() as { Level?: string; DisplayName?: string } | undefined) : undefined;
        const pickNumber = info?.pickNumber ?? 0;
        // Completed signal: pickNumber has reached 150 AND there's no
        // active pick in flight (currentPickEndTime null/missing). Matches
        // what the Go API exposes for finished drafts (verified on
        // 2024-fast-draft-709 — pickNumber=150 + currentPickEndTime=null).
        const completed = pickNumber >= 150 && !info?.currentPickEndTime;
        return {
          draftId: c.id,
          displayName: info?.displayName ?? data?.DisplayName ?? c.id,
          speed: c.speed,
          level: data?.Level ?? null,
          pickNumber,
          currentDrafter: info?.currentDrafter ?? '',
          filling: !info,
          completed,
        };
      })
      .filter((d): d is Categorized => d !== null);

    const sortNewestFirst = (a: Categorized, b: Categorized) => b.draftId.localeCompare(a.draftId);
    const active = drafts
      .filter(d => !d.completed && (d.filling || (d.pickNumber > 0 && d.pickNumber <= 150)))
      .sort(sortNewestFirst)
      .map(({ completed: _c, ...rest }) => rest);
    const completed = drafts
      .filter(d => d.completed)
      .sort(sortNewestFirst)
      .map(({ completed: _c, ...rest }) => rest);

    return json({ drafts: active, active, completed }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('spectate.active_drafts.failed', { err });
    return jsonError('Internal Server Error', 500);
  }
}
