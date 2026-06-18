/**
 * GET /api/admin/users-aggregate
 *
 * Per-user rollup of every meaningful signal across the system. Powers
 * the "every user" filterable table on the admin dashboard.
 *
 * One bounded fan-out:
 *   1. v2_users — base list + identity + current balances + walletType
 *   2. v2_activity_events — bounded scan, group by userId to get
 *      lifetime drafts entered / passes bought / spend / promos
 *      claimed / spins won / free drafts won
 *   3. collectionGroup('promos') — bounded scan, group by parent userId
 *      to get promo-started / promo-completed sets per user
 *
 * Returns a single array. The frontend filters / sorts / paginates
 * client-side — for SBS's user count (~200) this is plenty fast.
 *
 * Boris's spec: "every user new user that joins → table at the bottom →
 * filter to see who drafted a lot but never did a promo etc."
 */

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { ACTIVITY_EVENTS_COLLECTION } from '@/lib/activityEvents';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';
import { getServerDraftsApiUrl } from '@/lib/serverDraftsApiUrl';

export const dynamic = 'force-dynamic';

// Bounds — set deliberately high so we never silently undercount.
// Staging is at ~200 users / few thousand activity events today; these
// give 50–100× headroom. Raise if we ever approach.
const USERS_LIMIT = 50_000;
const ACTIVITY_LIMIT = 200_000;
const PROMOS_LIMIT = 50_000;

/**
 * Module-level cache of Go owner profile lookups. Each entry expires
 * after CACHE_TTL_MS so a name edit propagates within a minute, but
 * back-to-back dashboard polls (every 60s) don't re-fetch the full
 * staging user base on every refresh. Cleared automatically by
 * lazy-expiry on read.
 */
const ownerProfileCache = new Map<string, { displayName: string | null; imageUrl: string | null; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

interface AggregateUser {
  wallet: string;
  username: string | null;
  /** PFP image URL (Go owner profile if set, else null = use default fallback). */
  avatar: string | null;
  /** displayName the user chose on their profile page. Falls back to
   *  username when null, then to the truncated wallet. */
  displayName: string | null;
  walletType: string;
  createdAt: string | null;
  lastActiveAt: string | null;
  balances: {
    freeDrafts: number;
    draftPasses: number;
    wheelSpins: number;
    jackpotEntries: number;
    hofEntries: number;
    cardPurchaseCount: number;
  };
  activity: {
    draftsEntered: number;
    draftsLeft: number;
    draftsWon: number;
    draftWinningsUsd: number;
    passesBought: number;
    spendUsd: number;
    passesGranted: number;
    spinsWon: number;
    freeDraftsWon: number;
    promosClaimed: number;
    cashoutsCompleted: number;
    cashoutsUsd: number;
  };
  promos: {
    startedTypes: string[];
    completedTypes: string[];
    pendingTypes: string[];
    hasStartedAny: boolean;
    hasCompletedAny: boolean;
  };
}

function toIso(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    const d = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  return null;
}

export async function GET(req: Request) {
  const requestId = getRequestId(req);
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  try {
    await requireAdmin(req);
    if (!isFirestoreConfigured()) throw new ApiError(503, 'Firestore not configured');

    const db = getAdminFirestore();

    // 1. v2_users — every user doc, bounded.
    const usersSnap = await db.collection('v2_users')
      .orderBy('createdAt', 'desc')
      .limit(USERS_LIMIT)
      .get();

    // Avatar URL pattern: the Go owner endpoint reveals every user gets
    // a GCS path of the form `<bucket>/<wallet>.jpg`. We construct the
    // URL deterministically without fetching the Go API per user — if
    // the user uploaded a custom PFP, the URL serves it; if not, the
    // browser <img onError> falls back to a placeholder. Cheap, batchable.
    const PFP_BUCKET = 'https://storage.googleapis.com/sbs-staging-pfps';

    const byWallet = new Map<string, AggregateUser>();
    for (const doc of usersSnap.docs) {
      const d = doc.data() ?? {};
      const wallet = (typeof d.walletAddress === 'string' ? d.walletAddress : doc.id).toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(wallet)) continue;
      // Pull a name from any of the candidate fields. Don't strip the
      // 'User-' prefix here — Boris's ask is "show their default name
      // if they haven't edited it"; the default IS something like
      // "User-12345" which is a valid display string. Editing the name
      // overwrites it via /api/owner/update.
      const username = typeof d.username === 'string' && d.username.trim() ? d.username : null;
      const displayName = typeof d.displayName === 'string' && d.displayName.trim()
        ? d.displayName
        : (typeof d.bananaName === 'string' && d.bananaName.trim() ? d.bananaName : null);
      byWallet.set(wallet, {
        wallet,
        username,
        displayName,
        avatar: `${PFP_BUCKET}/${wallet}.jpg`,
        walletType: typeof d.walletType === 'string' ? d.walletType : 'unknown',
        createdAt: toIso(d.createdAt),
        lastActiveAt: toIso(d.lastActiveAt) ?? toIso(d.lastLoginAt),
        balances: {
          freeDrafts: typeof d.freeDrafts === 'number' ? d.freeDrafts : 0,
          draftPasses: typeof d.draftPasses === 'number' ? d.draftPasses : 0,
          wheelSpins: typeof d.wheelSpins === 'number' ? d.wheelSpins : 0,
          jackpotEntries: typeof d.jackpotEntries === 'number' ? d.jackpotEntries : 0,
          hofEntries: typeof d.hofEntries === 'number' ? d.hofEntries : 0,
          cardPurchaseCount: typeof d.cardPurchaseCount === 'number' ? d.cardPurchaseCount : 0,
        },
        activity: {
          draftsEntered: 0,
          draftsLeft: 0,
          draftsWon: 0,
          draftWinningsUsd: 0,
          passesBought: 0,
          spendUsd: 0,
          passesGranted: 0,
          spinsWon: 0,
          freeDraftsWon: 0,
          promosClaimed: 0,
          cashoutsCompleted: 0,
          cashoutsUsd: 0,
        },
        promos: {
          startedTypes: [],
          completedTypes: [],
          pendingTypes: [],
          hasStartedAny: false,
          hasCompletedAny: false,
        },
      });
    }

    // 2. v2_activity_events — bounded scan, aggregate per userId. We
    //    walk all event types in one pass so the scan stays O(1) per
    //    user lookup.
    const ensureUser = (wallet: string): AggregateUser | null => {
      if (!/^0x[0-9a-f]{40}$/.test(wallet)) return null;
      let entry = byWallet.get(wallet);
      if (entry) return entry;
      // User appears in activity but not in v2_users (shouldn't happen
      // but be defensive — could be a wallet that interacted via the
      // Go API without a Firestore mirror). Seed an empty record so
      // their activity counts.
      entry = {
        wallet,
        username: null,
        displayName: null,
        avatar: `https://storage.googleapis.com/sbs-staging-pfps/${wallet}.jpg`,
        walletType: 'unknown',
        createdAt: null,
        lastActiveAt: null,
        balances: { freeDrafts: 0, draftPasses: 0, wheelSpins: 0, jackpotEntries: 0, hofEntries: 0, cardPurchaseCount: 0 },
        activity: {
          draftsEntered: 0, draftsLeft: 0, draftsWon: 0, draftWinningsUsd: 0,
          passesBought: 0, spendUsd: 0, passesGranted: 0,
          spinsWon: 0, freeDraftsWon: 0, promosClaimed: 0,
          cashoutsCompleted: 0, cashoutsUsd: 0,
        },
        promos: { startedTypes: [], completedTypes: [], pendingTypes: [], hasStartedAny: false, hasCompletedAny: false },
      };
      byWallet.set(wallet, entry);
      return entry;
    };

    // Per-user count of promo_claimed activity events. Reconciled in
    // step 3 with claimCount sum via max().
    const promoEventsByUser = new Map<string, number>();
    try {
      const actSnap = await db.collection(ACTIVITY_EVENTS_COLLECTION)
        .orderBy('createdAt', 'desc')
        .limit(ACTIVITY_LIMIT)
        .get();
      for (const doc of actSnap.docs) {
        const d = doc.data() as {
          type?: string;
          userId?: string;
          quantity?: number;
          metadata?: Record<string, unknown>;
        };
        const userId = (d.userId ?? '').toLowerCase();
        const entry = ensureUser(userId);
        if (!entry) continue;
        const meta = d.metadata ?? {};
        switch (d.type) {
          case 'pass_purchased': {
            entry.activity.passesBought += Number(d.quantity ?? 1);
            const price = Number(meta.totalPrice);
            if (Number.isFinite(price)) entry.activity.spendUsd += price;
            break;
          }
          case 'pass_granted':
            entry.activity.passesGranted += Number(d.quantity ?? meta.draftPassesAdded ?? 1);
            break;
          case 'spin_won': {
            entry.activity.spinsWon += 1;
            const prizeType = String(meta.prizeType ?? '');
            const prizeValue = meta.prizeValue;
            if (prizeType === 'draft_pass') {
              const v = Number(prizeValue);
              if (Number.isFinite(v)) entry.activity.freeDraftsWon += v;
            }
            break;
          }
          // Activity events count tracked separately in promoEventsByUser
          // (declared above the scan). Reconciled with claimCount in
          // step 3 via max() so single-claim promos that don't bump
          // claimCount still show up. See lib/admin/metricSources.ts.
          case 'promo_claimed': {
            const cur = promoEventsByUser.get(userId) ?? 0;
            promoEventsByUser.set(userId, cur + 1);
            break;
          }
          case 'draft_entered':
            entry.activity.draftsEntered += 1;
            break;
          case 'draft_left':
            entry.activity.draftsLeft += 1;
            break;
          case 'draft_won': {
            entry.activity.draftsWon += 1;
            const amt = Number(meta.amount);
            if (Number.isFinite(amt)) entry.activity.draftWinningsUsd += amt;
            break;
          }
          case 'cashout_completed': {
            entry.activity.cashoutsCompleted += 1;
            const val = Number(meta.settledUsd ?? meta.amount);
            if (Number.isFinite(val)) entry.activity.cashoutsUsd += val;
            break;
          }
        }
      }
    } catch (err) {
      logger.warn('admin.users_aggregate.activity_scan_failed', { err });
    }

    // 3. collectionGroup('promos') — atomic ground truth for promo
    //    state. Each doc lives at v2_users/{userId}/promos/{promoId}
    //    with three meaningful counters:
    //      claimCount        → number of times this user claimed this
    //                           promo (multi-claim promos can be >1)
    //      progressCurrent   → multi-step progress towards the next claim
    //      progressMax       → number of steps required to claim once
    //
    //    promosClaimed (the user's lifetime total) = sum of claimCount
    //    across all the user's promo docs. This replaces the lossy
    //    activity-event count (Boris caught it: dashboard showed mint
    //    total=11 when real claimCount sum=35).
    let promoDocsScanned = 0;
    try {
      const promosSnap = await db.collectionGroup('promos').limit(PROMOS_LIMIT).get();
      promoDocsScanned = promosSnap.size;
      for (const doc of promosSnap.docs) {
        const segments = doc.ref.path.split('/');
        const wallet = (segments[1] ?? '').toLowerCase();
        const entry = ensureUser(wallet);
        if (!entry) continue;
        const data = doc.data() as { type?: string; progressCurrent?: number; progressMax?: number; claimable?: boolean; claimCount?: number };
        const promoType = typeof data.type === 'string' ? data.type : null;
        if (!promoType) continue;
        const progressCurrent = typeof data.progressCurrent === 'number' ? data.progressCurrent : 0;
        const progressMax = typeof data.progressMax === 'number' ? data.progressMax : 0;
        const claimCount = typeof data.claimCount === 'number' ? data.claimCount : 0;
        const claimed = claimCount > 0;
        const started = progressCurrent > 0 || claimed;
        const isMultiStep = progressMax > 1;
        // True "in progress" — they started but haven't hit the next
        // claim threshold yet. progressCurrent < progressMax is more
        // accurate than `!completed` because multi-claim promos can
        // be both completed AND in-progress towards the next claim.
        const isPending = isMultiStep && started && progressCurrent < progressMax;

        // Per-user lifetime promo claim count = sum of claimCount.
        if (claimCount > 0) entry.activity.promosClaimed += claimCount;

        if (started && !entry.promos.startedTypes.includes(promoType)) {
          entry.promos.startedTypes.push(promoType);
        }
        if (claimed && !entry.promos.completedTypes.includes(promoType)) {
          entry.promos.completedTypes.push(promoType);
        }
        if (isPending && !entry.promos.pendingTypes.includes(promoType)) {
          entry.promos.pendingTypes.push(promoType);
        }
      }
      // Reconcile per-user promo claim count: max(claimCount sum,
      // activity event count). Handles both multi-claim promos
      // (claimCount > events) and single-claim promos (events > 0,
      // claimCount stays 0).
      for (const [wallet, eventCount] of promoEventsByUser) {
        const entry = byWallet.get(wallet);
        if (!entry) continue;
        if (eventCount > entry.activity.promosClaimed) {
          entry.activity.promosClaimed = eventCount;
        }
      }
      logger.info('admin.users_aggregate.promos_scan_ok', {
        context: { promoDocsScanned },
      });
    } catch (err) {
      logger.warn('admin.users_aggregate.promos_scan_failed', { err });
    }

    // Fix up the hasStartedAny / hasCompletedAny flags after all reads.
    for (const u of byWallet.values()) {
      u.promos.hasStartedAny = u.promos.startedTypes.length > 0;
      u.promos.hasCompletedAny = u.promos.completedTypes.length > 0;
    }

    // Backfill displayName for users whose Firestore mirror lacks one
    // (older accounts, or accounts that changed their name only on the
    // Go side). One small fan-out: GET /owner/{wallet} per missing
    // name, capped + parallelized, 2s timeout per call so a stale
    // backend can't stall the whole response.
    //
    // Boris's wallet 0x438b…72e0 is the canonical example — his
    // Firestore doc has no username/displayName, only the Go owner
    // profile does.
    const goBase = getServerDraftsApiUrl();
    // Backfill ANY user missing a displayName — even if they have an
    // auto-generated username in Firestore. The Go owner profile is
    // the source of truth for the user's chosen name (Profile page
    // edits land there first), so we prefer it whenever the Firestore
    // mirror lacks one. Boris's row was the canonical bug: he set
    // displayName="Boris Vagner" but his v2_users doc still only had
    // an auto-username, so the dashboard showed "BananaKing99" /
    // "Banana #XXXX" instead of his real name.
    const missing = Array.from(byWallet.values()).filter((u) => !u.displayName);
    const BACKFILL_CAP = 250;  // staging has ~200 users today — covers the whole base; raise as we grow.
    const toBackfill = missing.slice(0, BACKFILL_CAP);
    const now = Date.now();
    await Promise.all(
      toBackfill.map(async (u) => {
        // Serve from cache when fresh — keeps the broadened backfill
        // free for back-to-back polls.
        const cached = ownerProfileCache.get(u.wallet);
        if (cached && cached.expiresAt > now) {
          if (cached.displayName) u.displayName = cached.displayName;
          if (cached.imageUrl) u.avatar = cached.imageUrl;
          return;
        }
        try {
          const ctl = new AbortController();
          const timer = setTimeout(() => ctl.abort(), 2000);
          const res = await fetch(`${goBase.replace(/\/$/, '')}/owner/${u.wallet}`, {
            signal: ctl.signal,
            headers: { accept: 'application/json' },
          });
          clearTimeout(timer);
          if (!res.ok) {
            ownerProfileCache.set(u.wallet, { displayName: null, imageUrl: null, expiresAt: now + CACHE_TTL_MS });
            return;
          }
          // IMPORTANT: the Go owner endpoint nests both displayName AND
          // imageUrl under `pfp`. Reading `body.displayName` directly
          // (what we had) always returned undefined, so Boris's "Boris
          // Vagner" name never made it through and his row stayed on
          // the italic "Banana #XXXX" fallback. Matched the working
          // shape in app/api/admin/user-lookup/route.ts.
          const body = (await res.json()) as {
            username?: string;
            pfp?: { displayName?: string; imageUrl?: string };
          };
          const dn = body.pfp?.displayName?.trim() || null;
          const img = body.pfp?.imageUrl?.trim() || null;
          if (dn) u.displayName = dn;
          if (!u.username && typeof body.username === 'string' && body.username.trim()) {
            u.username = body.username.trim();
          }
          if (img) u.avatar = img;
          ownerProfileCache.set(u.wallet, { displayName: dn, imageUrl: img, expiresAt: now + CACHE_TTL_MS });
        } catch {
          // Swallow individual failures — the table still renders, the
          // row just keeps its derived "Banana #XXXX" fallback. Cache
          // the miss for a short window to avoid retry storms.
          ownerProfileCache.set(u.wallet, { displayName: null, imageUrl: null, expiresAt: now + 15_000 });
        }
      }),
    );
    logger.info('admin.users_aggregate.name_backfill', {
      requestId,
      context: { missingTotal: missing.length, attempted: toBackfill.length },
    });

    const users = Array.from(byWallet.values());
    logger.info('admin.users_aggregate.ok', {
      requestId,
      context: { userCount: users.length },
    });

    return json({ ok: true, users, requestId });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    logger.error('admin.users_aggregate.failed', {
      err: err instanceof Error ? err : String(err),
      route: 'admin/users-aggregate',
    });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
