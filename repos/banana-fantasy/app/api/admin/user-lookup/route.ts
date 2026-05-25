/**
 * GET /api/admin/user-lookup?wallet=0x…
 *
 * Consolidated per-user diagnostic endpoint. Fans out to every data
 * source we have for one wallet and returns a single shape the
 * frontend can render without orchestrating multiple requests.
 *
 * Every section read is wrapped in `Promise.allSettled` so a partial
 * failure (e.g., missing Firestore index, OneSignal hiccup) shows up
 * as `unavailable: true` for that section instead of breaking the
 * whole page. Each failure also writes one `logger.error` so the
 * admin Logs tab surfaces what's down.
 *
 * Health summary is computed server-side so the frontend doesn't
 * have to know the rules — keeps logic + thresholds in one place.
 */

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import type { Timestamp } from 'firebase-admin/firestore';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';

export const dynamic = 'force-dynamic';

const WALLET_REGEX = /^0x[0-9a-fA-F]{40}$/;
const ERRORS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const RECENT_LIMIT = 20; // payments, drafts, activity
const ERROR_LIMIT = 100;
const AUDIT_LIMIT = 50;
const NOTES_LIMIT = 50;

type Maybe<T> = T | null;
type FirestoreTimestamp = Timestamp | { toDate: () => Date };

function toIsoDate(value: unknown): Maybe<string> {
  if (typeof value === 'string' && value.trim()) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as FirestoreTimestamp).toDate === 'function'
  ) {
    const d = (value as FirestoreTimestamp).toDate();
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    // OneSignal returns unix seconds.
    return new Date(value * 1000).toISOString();
  }
  return null;
}

function normalizeWallet(raw: string): string {
  return raw.trim().toLowerCase();
}

function shortHex(w: string): string {
  if (!w) return '';
  const hex = w.replace(/^0x/i, '');
  return `0x${hex.slice(0, 4)}…${hex.slice(-4)}`;
}

interface SectionFail {
  ok: false;
  reason: string;
}
function sectionFail(name: string, err: unknown): SectionFail {
  const reason = err instanceof Error ? err.message : String(err);
  logger.error('admin.user_lookup.section_failed', {
    err: reason,
    route: 'admin/user-lookup',
    context: { section: name },
  });
  return { ok: false, reason };
}

/* ───────────────────────────────────────────────────────── Identity + balance */

/**
 * Fetch the user's profile (displayName, avatar URL) from the Go owner API.
 * Boris's display name + PFP live in the Go-side owner doc — not in our
 * Firestore v2_users mirror — so the admin Lookup card was showing
 * "No display name" even for users with one. Soft-fails on any error so
 * the rest of the lookup still works; logs the cause so the admin Logs
 * tab surfaces what went wrong (silent null was making this look broken
 * when really the env var was unset / fetch timed out / etc.).
 */
interface OwnerProfile {
  displayName: string | null;
  avatar: string | null;
  availableCreditUsd: number;
  availableEthCredit: number;
  pendingCreditUsd: number;
  numWithdrawals: number;
  isBlueCheckVerified: boolean;
  blueCheckEmail: string | null;
  /** Diagnostic — why the profile is empty if it is. Surfaced to the
   *  client so admins can see "fetch timed out" / "404" instead of a
   *  silently-empty card. */
  diagnostic?: string;
}

async function fetchOwnerProfile(wallet: string): Promise<OwnerProfile> {
  const empty = (diagnostic: string): OwnerProfile => ({
    displayName: null,
    avatar: null,
    availableCreditUsd: 0,
    availableEthCredit: 0,
    pendingCreditUsd: 0,
    numWithdrawals: 0,
    isBlueCheckVerified: false,
    blueCheckEmail: null,
    diagnostic,
  });
  // Vercel env var is named NEXT_PUBLIC_STAGING_DRAFTS_API_URL (verified
  // against the live env list). NEXT_PUBLIC_SBS_API_URL is a legacy
  // name still referenced in /api/owner/update — check both, then fall
  // back to the hardcoded staging URL so this works even if env is
  // missing entirely. THIS WAS THE PFP/NAME BUG: env var I was checking
  // didn't exist on Vercel, so every owner-profile call returned empty.
  const STAGING_FALLBACK = 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
  const baseRaw =
    process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL
    || process.env.STAGING_DRAFTS_API_URL
    || process.env.NEXT_PUBLIC_SBS_API_URL
    || process.env.SBS_API_URL
    || STAGING_FALLBACK;
  const base = baseRaw.replace(/\/+$/, '');
  // 15s timeout — Vercel function max is ~30s; Cloud Run cold-start on
  // staging is 5-8s in the worst case. Previous 8s was still timing out
  // when Boris's session hit a cold container. Generous timeout costs
  // nothing because the call runs in parallel with other reads.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  const start = Date.now();
  try {
    // ALWAYS log the attempt so we can see in admin Logs whether the
    // fetch even started — previous behavior logged only failures.
    logger.info('admin.user_lookup.owner_profile_call', {
      route: 'admin/user-lookup',
      context: { wallet, base },
    });
    const res = await fetch(`${base}/owner/${wallet}`, { cache: 'no-store', signal: ctrl.signal });
    const elapsed = Date.now() - start;
    if (!res.ok) {
      logger.warn('admin.user_lookup.owner_profile_http_failed', {
        route: 'admin/user-lookup',
        context: { wallet, status: res.status, base, elapsedMs: elapsed },
      });
      return empty(`Go owner endpoint returned HTTP ${res.status} after ${elapsed}ms`);
    }
    const data = (await res.json()) as {
      pfp?: { displayName?: string; imageUrl?: string };
      availableCredit?: number;
      availableEthCredit?: number;
      pendingCredit?: number;
      numWithdrawals?: number;
      isBlueCheckVerified?: boolean;
      blueCheckEmail?: string;
    };
    const displayName = typeof data?.pfp?.displayName === 'string' && data.pfp.displayName.trim()
      ? data.pfp.displayName
      : null;
    const avatar = typeof data?.pfp?.imageUrl === 'string' && data.pfp.imageUrl.trim()
      ? data.pfp.imageUrl
      : null;
    logger.info('admin.user_lookup.owner_profile_ok', {
      route: 'admin/user-lookup',
      context: { wallet, hasDisplayName: !!displayName, hasAvatar: !!avatar, elapsedMs: elapsed },
    });
    return {
      displayName,
      avatar,
      availableCreditUsd: typeof data.availableCredit === 'number' ? data.availableCredit : 0,
      availableEthCredit: typeof data.availableEthCredit === 'number' ? data.availableEthCredit : 0,
      pendingCreditUsd: typeof data.pendingCredit === 'number' ? data.pendingCredit : 0,
      numWithdrawals: typeof data.numWithdrawals === 'number' ? data.numWithdrawals : 0,
      isBlueCheckVerified: data.isBlueCheckVerified === true,
      blueCheckEmail: typeof data.blueCheckEmail === 'string' && data.blueCheckEmail.trim() ? data.blueCheckEmail : null,
      diagnostic: !displayName && !avatar ? `Go owner endpoint returned no pfp data after ${elapsed}ms` : undefined,
    };
  } catch (err) {
    const elapsed = Date.now() - start;
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn('admin.user_lookup.owner_profile_fetch_failed', {
      route: 'admin/user-lookup',
      err: reason,
      context: { wallet, base, elapsedMs: elapsed },
    });
    return empty(`Fetch threw after ${elapsed}ms: ${reason}`);
  } finally {
    clearTimeout(timer);
  }
}

async function readIdentity(wallet: string) {
  const db = getAdminFirestore();
  // Fan out Firestore read + Go-API owner-profile read in parallel — the
  // owner profile carries the user-chosen displayName + avatar that the
  // Firestore doc doesn't mirror.
  const [doc, ownerProfile] = await Promise.all([
    db.collection('v2_users').doc(wallet).get(),
    fetchOwnerProfile(wallet),
  ]);
  if (!doc.exists && !ownerProfile.displayName) return null;
  const d = doc.exists ? (doc.data() ?? {}) : {};
  return {
    walletAddress: typeof d.walletAddress === 'string' ? d.walletAddress.toLowerCase() : wallet,
    username:
      typeof d.username === 'string' && !d.username.startsWith('User-') ? d.username : null,
    // Prefer the Go-side owner profile (what the user actually set in their
    // Profile page) over the Firestore mirror (which may not be in sync).
    displayName:
      ownerProfile.displayName ??
      (typeof d.displayName === 'string' && d.displayName.trim() ? d.displayName : null),
    avatar: ownerProfile.avatar,
    email:
      (typeof d.blueCheckEmail === 'string' && d.blueCheckEmail) ||
      (typeof d.email === 'string' && d.email) ||
      null,
    blueCheckVerified: d.blueCheckVerified === true || d.isBlueCheckVerified === true,
    banned: d.banned === true,
    kycStatus: typeof d.kycStatus === 'string' ? d.kycStatus : null,
    kycTier: typeof d.kycTier === 'number' ? d.kycTier : null,
    createdAt: toIsoDate(d.createdAt),
    lastActiveAt: toIsoDate(d.lastActiveAt) ?? toIsoDate(d.lastLoginAt),
    balance: {
      freeDrafts: typeof d.freeDrafts === 'number' ? d.freeDrafts : 0,
      draftPasses: typeof d.draftPasses === 'number' ? d.draftPasses : 0,
      wheelSpins: typeof d.wheelSpins === 'number' ? d.wheelSpins : 0,
      jackpotEntries: typeof d.jackpotEntries === 'number' ? d.jackpotEntries : 0,
      hofEntries: typeof d.hofEntries === 'number' ? d.hofEntries : 0,
      cardPurchaseCount:
        typeof d.cardPurchaseCount === 'number' ? d.cardPurchaseCount : 0,
    },
    // Money — pulled from the Go owner endpoint. Boris's ask: "do they
    // have money in their account or card all their txns their history."
    account: {
      availableCreditUsd: ownerProfile.availableCreditUsd,
      availableEthCredit: ownerProfile.availableEthCredit,
      pendingCreditUsd: ownerProfile.pendingCreditUsd,
      numWithdrawalsLifetime: ownerProfile.numWithdrawals,
    },
    // Diagnostic — surfaces "why is displayName/avatar empty" so the
    // admin UI can show "Owner fetch failed: timeout" instead of just
    // a silent 🍌 placeholder.
    ownerFetchDiagnostic: ownerProfile.diagnostic ?? null,
  };
}

/* ───────────────────────────────────────────────────────── Notification prefs */

async function readNotificationPrefs(wallet: string) {
  const db = getAdminFirestore();
  const doc = await db.collection('notificationPrefs').doc(wallet).get();
  if (!doc.exists) {
    return {
      walletAddress: wallet,
      channels: {},
      events: {},
      email: null,
      telegramChatId: null,
      discordId: null,
      updatedAt: null,
    };
  }
  const d = doc.data() ?? {};
  return {
    walletAddress: wallet,
    channels: (d.channels ?? {}) as Record<string, boolean>,
    events: (d.events ?? {}) as Record<string, boolean>,
    email: typeof d.email === 'string' ? d.email : null,
    telegramChatId: typeof d.telegramChatId === 'string' ? d.telegramChatId : null,
    discordId: typeof d.discordId === 'string' ? d.discordId : null,
    updatedAt: toIsoDate(d.updatedAt),
  };
}

/* ───────────────────────────────────────────────────────── OneSignal devices */

interface OneSignalPlayer {
  id?: string;
  device_type?: number;
  device_os?: string;
  device_model?: string;
  created_at?: number;
  last_active?: number;
  notification_types?: number;
  invalid_identifier?: boolean;
  tags?: Record<string, string>;
}

const DEVICE_TYPE_NAME: Record<number, string> = {
  0: 'iOS app',
  1: 'Android app',
  5: 'Chrome web',
  7: 'Firefox web',
  8: 'Safari web',
  9: 'Edge web',
  11: 'Chrome ext',
  14: 'SMS',
  15: 'Web',
  17: 'iOS PWA',
};

async function readPushDevices(wallet: string) {
  const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !apiKey) {
    return { configured: false, devices: [], totalPlayersInApp: 0 };
  }

  const res = await fetch(
    `https://onesignal.com/api/v1/players?app_id=${appId}&limit=300`,
    { headers: { Authorization: `Key ${apiKey}` } },
  );
  if (!res.ok) {
    throw new Error(
      `OneSignal players ${res.status}: ${await res.text().catch(() => '')}`,
    );
  }
  const body = (await res.json()) as {
    total_count?: number;
    players?: OneSignalPlayer[];
  };
  const matches = (body.players ?? []).filter(
    (p) => (p.tags?.walletAddress || '').toLowerCase() === wallet,
  );
  return {
    configured: true,
    totalPlayersInApp: body.total_count ?? 0,
    devices: matches.map((p) => ({
      playerId: p.id ?? '',
      deviceType: p.device_type ?? null,
      deviceTypeName:
        p.device_type !== undefined
          ? (DEVICE_TYPE_NAME[p.device_type] ?? `type ${p.device_type}`)
          : '?',
      os: p.device_os ?? null,
      model: p.device_model ?? null,
      createdAt: toIsoDate(p.created_at),
      lastActiveAt: toIsoDate(p.last_active),
      // OneSignal v1 reports `notification_types` unreliably for newer
      // subscriptions in their v2 schema. We surface the raw value but
      // the page should treat "0 OneSignal recipients on send" as the
      // source of truth for "is this device receiving?" — that's what
      // the `notifications.push.zero_recipients` error log captures.
      notificationTypes: p.notification_types ?? null,
      invalidIdentifier: p.invalid_identifier === true,
      tags: p.tags ?? {},
    })),
  };
}

/* ───────────────────────────────────────────────────────── Lists with userId / actor */

interface ListQuery {
  collection: string;
  field: string; // 'userId' | 'actor' | 'target' | 'wallet'
  limit: number;
}

async function readList(wallet: string, q: ListQuery) {
  const db = getAdminFirestore();
  const snap = await db
    .collection(q.collection)
    .where(q.field, '==', wallet)
    .limit(q.limit)
    .get();

  // Sort client-side by timestamp desc so we don't need a composite
  // index (which would require explicit firestore.indexes.json edits +
  // production deploy of the index). Trade-off: we read up to `limit`
  // unordered docs, then sort in memory.
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown>));
  rows.sort((a, b) => {
    const ta =
      toIsoDate(a.timestamp) ?? toIsoDate(a.createdAt) ?? toIsoDate(a.created_at) ?? '';
    const tb =
      toIsoDate(b.timestamp) ?? toIsoDate(b.createdAt) ?? toIsoDate(b.created_at) ?? '';
    return tb.localeCompare(ta);
  });
  return rows;
}

/* ───────────────────────────────────────────────────────── Health summary */

function computeHealthSummary(parts: {
  identity: Awaited<ReturnType<typeof readIdentity>> | null;
  prefs: Awaited<ReturnType<typeof readNotificationPrefs>>;
  push: Awaited<ReturnType<typeof readPushDevices>> | null;
  errors: Record<string, unknown>[];
  withdrawals: Record<string, unknown>[];
  kyc: Record<string, unknown>[];
}) {
  const issues: { level: 'critical' | 'warning'; text: string }[] = [];
  const now = Date.now();

  // Bans = critical
  if (parts.identity?.banned) {
    issues.push({ level: 'critical', text: 'User is banned' });
  }

  // KYC blocked = critical (most recent attempt)
  const mostRecentKyc = parts.kyc[0];
  if (mostRecentKyc && typeof mostRecentKyc.status === 'string') {
    if (mostRecentKyc.status === 'blocked') {
      issues.push({ level: 'critical', text: 'KYC blocked' });
    } else if (
      mostRecentKyc.status === 'name_mismatch' ||
      mostRecentKyc.status === 'dob_mismatch'
    ) {
      issues.push({ level: 'warning', text: `KYC needs review (${mostRecentKyc.status})` });
    }
  }

  // Push on but 0 devices = critical
  const pushOn = parts.prefs.channels?.push === true;
  const deviceCount = parts.push?.devices?.length ?? 0;
  if (pushOn && deviceCount === 0) {
    issues.push({
      level: 'critical',
      text: 'Push toggle is on but no devices are subscribed',
    });
  }

  // Channels toggled on but missing destination = warning
  if (parts.prefs.channels?.email === true && !parts.prefs.email) {
    issues.push({ level: 'warning', text: 'Email toggle on but no email linked' });
  }
  if (parts.prefs.channels?.telegram === true && !parts.prefs.telegramChatId) {
    issues.push({ level: 'warning', text: 'Telegram toggle on but not linked' });
  }
  if (parts.prefs.channels?.discord === true && !parts.prefs.discordId) {
    issues.push({ level: 'warning', text: 'Discord toggle on but not linked' });
  }

  // Pending withdrawal >48h = critical
  for (const w of parts.withdrawals) {
    if (typeof w.status === 'string' && w.status === 'pending') {
      const createdIso = toIsoDate(w.createdAt);
      if (createdIso) {
        const ageHours = (now - new Date(createdIso).getTime()) / 3_600_000;
        if (ageHours > 48) {
          issues.push({
            level: 'critical',
            text: `Withdrawal pending ${Math.round(ageHours)}h`,
          });
        }
      }
    }
  }

  // Recent error counts
  const errorsLast24h = parts.errors.filter((e) => {
    const t = toIsoDate(e.timestamp);
    return t && now - new Date(t).getTime() < 24 * 60 * 60 * 1000;
  }).length;
  const errorsLast7d = parts.errors.length;

  if (errorsLast24h > 0) {
    issues.push({
      level: 'critical',
      text: `${errorsLast24h} error${errorsLast24h === 1 ? '' : 's'} in last 24h`,
    });
  } else if (errorsLast7d > 0) {
    issues.push({
      level: 'warning',
      text: `${errorsLast7d} error${errorsLast7d === 1 ? '' : 's'} in last 7 days`,
    });
  }

  const hasCritical = issues.some((i) => i.level === 'critical');
  const hasWarning = issues.some((i) => i.level === 'warning');
  const status: 'critical' | 'warning' | 'ok' = hasCritical
    ? 'critical'
    : hasWarning
      ? 'warning'
      : 'ok';

  return { status, issues };
}

/* ───────────────────────────────────────────────────────── Notes */

async function readNotes(wallet: string) {
  const db = getAdminFirestore();
  const snap = await db
    .collection('adminUserNotes')
    .where('wallet', '==', wallet)
    .limit(NOTES_LIMIT)
    .get();
  const rows = snap.docs.map((d) => ({
    id: d.id,
    wallet: String(d.data()?.wallet ?? ''),
    text: String(d.data()?.text ?? ''),
    createdBy: String(d.data()?.createdBy ?? ''),
    createdAt: toIsoDate(d.data()?.createdAt),
  }));
  rows.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  return rows;
}

/* ───────────────────────────────────────────────────────── GET handler */

export async function GET(req: Request) {
  const requestId = getRequestId(req);
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  try {
    await requireAdmin(req);
    if (!isFirestoreConfigured()) throw new ApiError(503, 'Firestore not configured');

    const url = new URL(req.url);
    const wallet = normalizeWallet(url.searchParams.get('wallet') ?? '');
    if (!WALLET_REGEX.test(wallet)) {
      throw new ApiError(400, 'wallet param required (40-hex with 0x prefix)');
    }

    // Parallel fan-out. allSettled so partial failures don't crash the
    // page — the section just renders as "unavailable" with the reason.
    const [
      identityRes,
      prefsRes,
      pushRes,
      kycRes,
      onrampRes,
      offrampRes,
      withdrawalsRes,
      draftsRes,
      errorsRes,
      auditRes,
      activityRes,
      notesRes,
    ] = await Promise.allSettled([
      readIdentity(wallet),
      readNotificationPrefs(wallet),
      readPushDevices(wallet),
      readList(wallet, { collection: 'kycAttempts', field: 'userId', limit: RECENT_LIMIT }),
      readList(wallet, { collection: 'onrampAttempts', field: 'userId', limit: RECENT_LIMIT }),
      readList(wallet, { collection: 'offrampAttempts', field: 'userId', limit: RECENT_LIMIT }),
      readList(wallet, {
        collection: 'withdrawalRequests',
        field: 'userId',
        limit: RECENT_LIMIT,
      }),
      readList(wallet, { collection: 'v2_drafts', field: 'createdBy', limit: RECENT_LIMIT }),
      readList(wallet, { collection: 'v2_error_events', field: 'actor', limit: ERROR_LIMIT }),
      readList(wallet, { collection: 'adminAuditLog', field: 'target', limit: AUDIT_LIMIT }),
      // ACTIVITY: read from `v2_activity_events` (the commerce + gameplay
      // stream that powers Live Activity) — NOT `userEvents`, which is a
      // stale collection name from an older auth pipeline that's never
      // populated. The previous code was reading from `userEvents` and
      // finding 0 hits for every wallet. Limit now 5000 — was 200, which
      // truncated heavy users (Boris's wallet alone has 74+ spins +
      // numerous purchases + promos), causing the lifetime tiles to
      // undercount his real activity. 5k is well above any one user's
      // actual event count.
      readList(wallet, { collection: 'v2_activity_events', field: 'userId', limit: 5000 }),
      readNotes(wallet),
    ]);

    const identity = identityRes.status === 'fulfilled' ? identityRes.value : null;
    const prefs =
      prefsRes.status === 'fulfilled'
        ? prefsRes.value
        : {
            walletAddress: wallet,
            channels: {} as Record<string, boolean>,
            events: {} as Record<string, boolean>,
            email: null,
            telegramChatId: null,
            discordId: null,
            updatedAt: null,
          };
    const push = pushRes.status === 'fulfilled' ? pushRes.value : null;

    const errors = errorsRes.status === 'fulfilled' ? errorsRes.value : [];
    // Drop errors older than 7 days (we over-fetch then trim).
    const cutoff = Date.now() - ERRORS_WINDOW_MS;
    const recentErrors = errors.filter((e) => {
      const t = toIsoDate(e.timestamp);
      return !t || new Date(t).getTime() >= cutoff;
    });

    const kyc = kycRes.status === 'fulfilled' ? kycRes.value : [];
    const withdrawals = withdrawalsRes.status === 'fulfilled' ? withdrawalsRes.value : [];

    const healthSummary = computeHealthSummary({
      identity,
      prefs,
      push,
      errors: recentErrors,
      withdrawals,
      kyc,
    });

    const userExists = !!identity;

    return json({
      ok: true,
      wallet,
      walletShort: shortHex(wallet),
      requestId,
      userExists,
      healthSummary,
      identity: identityRes.status === 'fulfilled' ? identity : sectionFail('identity', identityRes.reason),
      notes: notesRes.status === 'fulfilled' ? notesRes.value : sectionFail('notes', notesRes.reason),
      notifications: {
        prefs: prefsRes.status === 'fulfilled' ? prefs : sectionFail('prefs', prefsRes.reason),
        push: pushRes.status === 'fulfilled' ? push : sectionFail('push', pushRes.reason),
      },
      kyc: kycRes.status === 'fulfilled' ? kyc : sectionFail('kyc', kycRes.reason),
      payments: {
        onramps: onrampRes.status === 'fulfilled' ? onrampRes.value : sectionFail('onramps', onrampRes.reason),
        offramps: offrampRes.status === 'fulfilled' ? offrampRes.value : sectionFail('offramps', offrampRes.reason),
        withdrawals: withdrawalsRes.status === 'fulfilled' ? withdrawals : sectionFail('withdrawals', withdrawalsRes.reason),
      },
      drafts: draftsRes.status === 'fulfilled' ? draftsRes.value : sectionFail('drafts', draftsRes.reason),
      errors: errorsRes.status === 'fulfilled' ? recentErrors : sectionFail('errors', errorsRes.reason),
      audit: auditRes.status === 'fulfilled' ? auditRes.value : sectionFail('audit', auditRes.reason),
      activity: activityRes.status === 'fulfilled' ? activityRes.value : sectionFail('activity', activityRes.reason),
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    logger.error('admin.user_lookup.handler_failed', {
      err: err instanceof Error ? err : String(err),
      route: 'admin/user-lookup',
    });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
