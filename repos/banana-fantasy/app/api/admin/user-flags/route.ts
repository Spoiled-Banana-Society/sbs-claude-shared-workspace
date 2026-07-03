import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { isReturningWalletSync } from '@/lib/returningUsers';
import { logger } from '@/lib/logger';

const MAX_BATCH = 120;
// NEW = account created this season (public launch 2026-06-23). NOT the 7-day
// promo window — for the admin band the meaningful split is first-time player
// vs past-season player, so a first-season account stays NEW until it's
// linked/marked returning (Boris 2026-07-02).
const SEASON_LAUNCH_MS = Date.parse('2026-06-23T00:00:00Z');

// POST /api/admin/user-flags
// Body: { wallets: string[] }
//
// Admin-gated. Returns per-wallet account flags for admin surfaces (the
// Drafts/Spectate "who's in" band):
//   isNew       — first-season account: created since the 2026-06-23 public
//                 launch and not a returning player.
//   isReturning — matched a past-season identity: the server-verified
//                 web2 returning-check stamp OR the static past-players
//                 wallet snapshot. Same definition the promo guard uses.
// Wallets with no v2_users doc (bots / never-seeded) return neither flag.

interface UserFlags {
  isNew: boolean;
  isReturning: boolean;
  /** ISO account-creation time — lets admin surfaces show "created 2h ago". */
  createdAt: string | null;
}

function createdAtMs(raw: unknown): number | null {
  if (typeof raw === 'string') {
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : null;
  }
  // Firestore Timestamp (defensive — seeds write ISO strings, but merge
  // writers elsewhere use serverTimestamp()).
  if (raw && typeof (raw as { toMillis?: () => number }).toMillis === 'function') {
    return (raw as { toMillis: () => number }).toMillis();
  }
  return null;
}

export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  if (!isFirestoreConfigured()) return jsonError('Not configured', 503);

  try {
    await requireAdmin(req);

    const body = await parseBody<{ wallets?: unknown }>(req);
    const wallets = Array.isArray(body.wallets)
      ? [...new Set(
          body.wallets
            .filter((w): w is string => typeof w === 'string' && /^0x[0-9a-fA-F]{40}$/.test(w))
            .map((w) => w.toLowerCase()),
        )].slice(0, MAX_BATCH)
      : [];
    if (wallets.length === 0) return json({ flags: {} });

    const db = getAdminFirestore();
    const refs = wallets.map((w) => db.collection('v2_users').doc(w));
    const snaps = await db.getAll(...refs);

    const flags: Record<string, UserFlags> = {};
    snaps.forEach((snap, i) => {
      const wallet = wallets[i];
      if (!snap.exists) return;
      const data = snap.data() as { createdAt?: unknown; isReturningPlayer?: boolean };
      const isReturning = data.isReturningPlayer === true || isReturningWalletSync(wallet);
      const created = createdAtMs(data.createdAt);
      const isNew = !isReturning && created !== null && created >= SEASON_LAUNCH_MS;
      if (isNew || isReturning) {
        flags[wallet] = {
          isNew,
          isReturning,
          createdAt: created !== null ? new Date(created).toISOString() : null,
        };
      }
    });

    return json({ flags });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('admin.user-flags.failed', { err });
    return jsonError('Internal Server Error', 500);
  }
}
