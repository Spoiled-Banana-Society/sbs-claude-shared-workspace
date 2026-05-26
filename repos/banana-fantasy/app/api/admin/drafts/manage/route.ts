/**
 * Admin draft management — lists drafts in the Go API's `drafts` Firestore
 * collection (the live state, NOT the v2_drafts mirror the older
 * /api/admin/drafts/route reads). Used by the "Manage" sub-tab to find +
 * delete stuck/ghost drafts and refund their tokens.
 *
 * Auth: admin allowlist via requireAdmin.
 *
 * GET ?wallet=0x...&status=filling|drafting|completed&query=...
 *   wallet — filter to drafts that contain this owner in their cards subcollection
 *   status — narrow by the league status string
 *   query  — substring match against id / displayName
 * Returns drafts with their wallets so the UI can show "who's in this draft".
 *
 * DELETE — see ./[slotId]/route.ts.
 */

export const dynamic = 'force-dynamic';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';

interface ManageDraftRow {
  id: string;
  displayName: string | null;
  status: string | null;
  draftType: string | null;
  numPlayers: number;
  maxPlayers: number;
  owners: string[];
  startDate: string | null;
  endDate: string | null;
  isLocked: boolean;
}

const TRACKER_DOC_ID = 'draftTracker';

function normalize(s: string | undefined | null): string {
  return (s ?? '').toLowerCase();
}

// Last numeric run in a string. Slot ids are like `2024-fast-draft-1201`
// (we want 1201, not 2024), display names are like `BBB #1201` (1201).
function lastNumber(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.match(/\d+/g);
  return m ? m[m.length - 1] : null;
}

// Match a free-text query against a draft's id + display name. The UI
// rewrites "BBB #N" → "League #N" on render, so a user typing
// "League 1201" needs to match a stored "BBB #1201". We do that by
// also comparing the trailing number of each string — if the query
// contains a number and so does the target, we match on equality of
// those numbers in addition to plain substring.
function searchMatches(query: string, id: string, displayName: string | null | undefined): boolean {
  const q = query.toLowerCase().trim();
  if (!q) return true;
  if (id.toLowerCase().includes(q)) return true;
  if (displayName && displayName.toLowerCase().includes(q)) return true;
  const qNum = lastNumber(q);
  if (qNum) {
    if (lastNumber(id) === qNum) return true;
    if (lastNumber(displayName) === qNum) return true;
  }
  return false;
}

export async function GET(req: Request) {
  const requestId = getRequestId(req);
  const start = Date.now();
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  try {
    await requireAdmin(req);
    const { searchParams } = new URL(req.url);
    const walletFilter = normalize(searchParams.get('wallet'));
    const statusFilter = normalize(searchParams.get('status')) || null;
    const query = normalize(searchParams.get('query'));

    const db = getAdminFirestore();
    const snap = await db.collection('drafts').get();

    // Walk each draft, pulling cards subcollection in parallel so the UI can
    // see who's in each draft without N+1 from the client side.
    const rows: ManageDraftRow[] = await Promise.all(
      snap.docs
        .filter((doc) => doc.id !== TRACKER_DOC_ID)
        .map(async (doc) => {
          const data = doc.data() as Record<string, unknown>;
          const cards = await db
            .collection('drafts')
            .doc(doc.id)
            .collection('cards')
            .get()
            .catch(() => null);

          const owners: string[] = [];
          if (cards) {
            for (const c of cards.docs) {
              const cd = c.data() as Record<string, unknown>;
              const owner = (cd.OwnerId ?? cd.ownerId) as string | undefined;
              if (owner) owners.push(owner);
            }
          }

          return {
            id: doc.id,
            displayName: (data.DisplayName as string | undefined) ?? null,
            status: (data.Status as string | undefined) ?? null,
            draftType: (data.DraftType as string | undefined) ?? null,
            numPlayers: Number(data.NumPlayers ?? owners.length ?? 0),
            maxPlayers: Number(data.MaxPlayers ?? 10),
            owners,
            startDate: (data.StartDate as string | undefined) ?? null,
            endDate: (data.EndDate as string | undefined) ?? null,
            isLocked: Boolean(data.IsLocked ?? false),
          };
        }),
    );

    let filtered = rows;
    if (walletFilter) {
      filtered = filtered.filter((r) => r.owners.some((o) => normalize(o) === walletFilter));
    }
    if (statusFilter) {
      filtered = filtered.filter((r) => normalize(r.status) === statusFilter);
    }
    if (query) {
      filtered = filtered.filter((r) => searchMatches(query, r.id, r.displayName));
    }

    logger.info('admin.drafts.manage.list.ok', {
      requestId,
      total: rows.length,
      returned: filtered.length,
      walletFilter: walletFilter || null,
      statusFilter,
      query: query || null,
      durationMs: Date.now() - start,
    });

    return json({
      drafts: filtered,
      summary: {
        total: rows.length,
        returned: filtered.length,
      },
      requestId,
    });
  } catch (err) {
    logger.error('admin.drafts.manage.list.failed', {
      requestId,
      err: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    });
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    return jsonError('Failed to list drafts', 500);
  }
}
