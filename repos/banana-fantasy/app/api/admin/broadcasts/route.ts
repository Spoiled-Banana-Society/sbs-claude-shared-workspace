/**
 * Admin broadcasts — DM all (or a filtered subset of) users.
 *
 * POST /api/admin/broadcasts
 *   body: {
 *     title, body, url,
 *     channels: ('push'|'email')[],
 *     audience: 'all' | { kind: 'kyc-approved' } | { kind: 'wallets', wallets: string[] },
 *   }
 *
 * Audience resolution:
 *   - 'all'                  → no wallet filter (push uses 'Subscribed Users' segment;
 *                              email pulls every notificationPrefs doc with an email set)
 *   - kyc-approved           → wallets with KYC status 'approved'
 *   - wallets: [...]         → explicit list
 *
 * Phase 5 of the admin overhaul (May 2026). Audit-logged per request.
 */

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';
import { logAdminAction } from '@/lib/adminAudit';
import {
  sendBroadcastPushToAll,
  sendBroadcastPushToWallets,
  sendBroadcastEmailToAddresses,
  type BroadcastResult,
} from '@/lib/notifications/broadcast';

export const dynamic = 'force-dynamic';

const MAX_TITLE = 200;
const MAX_BODY = 1000;
const MAX_WALLETS = 500;

interface AudienceWallets { kind: 'wallets'; wallets: string[] }
interface AudienceKyc { kind: 'kyc-approved' }
type Audience = 'all' | AudienceWallets | AudienceKyc;

function isWallet(v: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(v);
}

async function resolveAudience(audience: Audience): Promise<string[]> {
  if (audience === 'all') return [];
  if (audience.kind === 'wallets') {
    return audience.wallets.map((w) => w.toLowerCase()).filter(isWallet);
  }
  if (audience.kind === 'kyc-approved') {
    if (!isFirestoreConfigured()) return [];
    const db = getAdminFirestore();
    // KYC approved users live in v2_users with `kycStatus == 'approved'`.
    // Pull a bounded set so a runaway broadcast never sends to millions.
    const snap = await db
      .collection('v2_users')
      .where('kycStatus', '==', 'approved')
      .limit(MAX_WALLETS)
      .get();
    const wallets: string[] = [];
    for (const doc of snap.docs) {
      const wallet = String(doc.data()?.walletAddress ?? doc.id).toLowerCase();
      if (isWallet(wallet)) wallets.push(wallet);
    }
    return wallets;
  }
  return [];
}

async function resolveEmails(audience: Audience, wallets: string[]): Promise<string[]> {
  if (!isFirestoreConfigured()) return [];
  const db = getAdminFirestore();
  // For 'all' we just pull every prefs doc that has an email. For a wallet
  // list, we batch fetch the prefs docs by id.
  if (audience === 'all') {
    const snap = await db
      .collection('notificationPrefs')
      .where('email', '>', '')
      .limit(MAX_WALLETS)
      .get();
    const out: string[] = [];
    for (const doc of snap.docs) {
      const email = String(doc.data()?.email ?? '').trim();
      if (email) out.push(email);
    }
    return out;
  }
  const out: string[] = [];
  // Firestore `in` filter accepts up to 30 values per query in current SDKs;
  // chunk so we stay within that.
  const CHUNK = 30;
  for (let i = 0; i < wallets.length; i += CHUNK) {
    const slice = wallets.slice(i, i + CHUNK);
    const snap = await db.collection('notificationPrefs')
      .where('walletAddress', 'in', slice)
      .get();
    for (const doc of snap.docs) {
      const email = String(doc.data()?.email ?? '').trim();
      if (email) out.push(email);
    }
  }
  return out;
}

export async function POST(req: Request) {
  const requestId = getRequestId(req);
  // Broadcasts are LOUD — keep the admin rate-limit tight so an accidental
  // double-tap doesn't send the same message twice.
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  let actorWallet = '';
  try {
    const admin = await requireAdmin(req);
    actorWallet = (admin.walletAddress ?? admin.userId ?? '').toLowerCase();

    const body = await parseBody(req);
    const title = requireString(body.title, 'title');
    const text = requireString(body.body, 'body');
    const url = typeof body.url === 'string' ? body.url : '/';
    if (title.length > MAX_TITLE) throw new ApiError(400, `title exceeds ${MAX_TITLE} chars`);
    if (text.length > MAX_BODY) throw new ApiError(400, `body exceeds ${MAX_BODY} chars`);

    // Channels — must be a non-empty subset of {push, email}.
    const channels = Array.isArray(body.channels)
      ? body.channels.filter((c: unknown): c is 'push' | 'email' => c === 'push' || c === 'email')
      : [];
    if (channels.length === 0) throw new ApiError(400, 'channels: at least one of push|email required');

    // Audience — validated against the union above. parseBody returns an
    // untyped record; narrow each field with `Record<string, unknown>`
    // accessors so TS understands the shape.
    const audRaw = body.audience as unknown;
    let audience: Audience;
    if (audRaw === 'all') {
      audience = 'all';
    } else if (
      audRaw
      && typeof audRaw === 'object'
      && (audRaw as Record<string, unknown>).kind === 'kyc-approved'
    ) {
      audience = { kind: 'kyc-approved' };
    } else if (
      audRaw
      && typeof audRaw === 'object'
      && (audRaw as Record<string, unknown>).kind === 'wallets'
      && Array.isArray((audRaw as Record<string, unknown>).wallets)
    ) {
      const wlist = (audRaw as { wallets: unknown[] }).wallets;
      if (wlist.length > MAX_WALLETS) {
        throw new ApiError(400, `wallets list exceeds ${MAX_WALLETS}`);
      }
      audience = { kind: 'wallets', wallets: wlist.map((w) => String(w)) };
    } else {
      throw new ApiError(400, 'audience: must be "all" | {kind:"kyc-approved"} | {kind:"wallets",wallets}');
    }

    const targetWallets = await resolveAudience(audience);
    const results: BroadcastResult[] = [];

    if (channels.includes('push')) {
      if (audience === 'all') {
        results.push(await sendBroadcastPushToAll({ title, body: text, url }));
      } else {
        results.push(await sendBroadcastPushToWallets({ title, body: text, url }, targetWallets));
      }
    }
    if (channels.includes('email')) {
      const emails = await resolveEmails(audience, targetWallets);
      results.push(await sendBroadcastEmailToAddresses({ title, body: text, url }, emails));
    }

    // Audit log — every broadcast is recorded with title + audience + per-channel
    // outcomes so we can prove who sent what when.
    await logAdminAction({
      requestId,
      actor: actorWallet,
      action: 'admin-broadcast',
      target: typeof audience === 'string' ? audience : `${audience.kind}:${targetWallets.length}`,
      after: { title, channels, results, audienceKind: typeof audience === 'string' ? audience : audience.kind },
    });

    logger.info('admin.broadcast.sent', {
      actor: actorWallet,
      route: 'admin/broadcasts',
      context: {
        channels,
        audience: typeof audience === 'string' ? audience : audience.kind,
        targetCount: targetWallets.length,
        results: results.map((r) => ({ channel: r.channel, status: r.status, recipients: r.recipients })),
      },
    });

    return json({ ok: true, results, targetCount: targetWallets.length, requestId });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    logger.error('admin.broadcast.failed', {
      err: err instanceof Error ? err : String(err),
      route: 'admin/broadcasts',
      actor: actorWallet,
    });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
