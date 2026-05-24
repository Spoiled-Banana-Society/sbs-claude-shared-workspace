/**
 * Daily digest — yesterday's KPIs + critical errors, emailed to admins.
 *
 * Two callers:
 *   - POST (admin) — "Send digest now" button in admin Tools. Manually
 *     triggered, returns the rendered body so the caller can preview.
 *   - GET (cron)   — fired by Vercel cron at 08:00 daily. Requires the
 *     CRON_SECRET env var as Bearer auth so external callers can't spam.
 *
 * The same render function is used for both — we never want a manual
 * preview to diverge from what cron actually sends.
 *
 * Phase 5 of the admin overhaul (May 2026). Email goes to every wallet
 * in the admin allowlist that has an email on file in notificationPrefs.
 */

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { getAdminWalletAllowlist } from '@/lib/adminAllowlist';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';
import { sendBroadcastEmailToAddresses } from '@/lib/notifications/broadcast';

export const dynamic = 'force-dynamic';

interface DigestData {
  date: string;
  passesGrantedToday: number;
  signupsToday: number;
  wheelSpinsToday: number;
  withdrawalsPendingNow: number;
  criticalErrorCount: number;
  topErrorSources: Array<{ source: string; count: number }>;
}

/**
 * Build yesterday's digest by aggregating Firestore queries. Returns the
 * raw data (not the rendered email) so callers can render it however
 * they need. Tries to keep query count small — each section is one query.
 */
async function buildDigest(): Promise<DigestData> {
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const empty: DigestData = {
    date,
    passesGrantedToday: 0,
    signupsToday: 0,
    wheelSpinsToday: 0,
    withdrawalsPendingNow: 0,
    criticalErrorCount: 0,
    topErrorSources: [],
  };
  if (!isFirestoreConfigured()) return empty;
  const db = getAdminFirestore();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const sinceIso = since.toISOString();

  // Each block is wrapped so one failed query doesn't break the digest.
  const out = { ...empty };

  try {
    const snap = await db.collection('v2_users').where('createdAt', '>=', sinceIso).limit(500).get();
    out.signupsToday = snap.size;
  } catch (err) {
    logger.warn('digest.section.signups_failed', { err });
  }

  try {
    const snap = await db.collection('userEvents')
      .where('eventType', '==', 'signup')
      .where('timestamp', '>=', sinceIso)
      .limit(500)
      .get();
    // Prefer the userEvents stream's authoritative signup count over the
    // v2_users createdAt count above when both succeed.
    if (snap.size > 0) out.signupsToday = snap.size;
  } catch (err) {
    logger.warn('digest.section.signup_events_failed', { err });
  }

  try {
    const snap = await db.collection('userEvents')
      .where('eventType', '==', 'spin_won')
      .where('timestamp', '>=', sinceIso)
      .limit(500)
      .get();
    out.wheelSpinsToday = snap.size;
  } catch (err) {
    logger.warn('digest.section.spins_failed', { err });
  }

  try {
    const snap = await db.collection('userEvents')
      .where('eventType', '==', 'pass_granted')
      .where('timestamp', '>=', sinceIso)
      .limit(500)
      .get();
    out.passesGrantedToday = snap.size;
  } catch (err) {
    logger.warn('digest.section.passes_failed', { err });
  }

  try {
    const snap = await db.collection('withdrawalRequests').where('status', '==', 'pending').limit(200).get();
    out.withdrawalsPendingNow = snap.size;
  } catch (err) {
    logger.warn('digest.section.withdrawals_failed', { err });
  }

  try {
    const snap = await db.collection('v2_error_events')
      .where('timestamp', '>=', sinceIso)
      .limit(1000)
      .get();
    const counts = new Map<string, number>();
    for (const doc of snap.docs) {
      const source = String(doc.data()?.source ?? '');
      if (!source) continue;
      counts.set(source, (counts.get(source) ?? 0) + 1);
      if (/critical|fatal|crash/i.test(source)) {
        out.criticalErrorCount += 1;
      }
    }
    out.topErrorSources = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([source, count]) => ({ source, count }));
  } catch (err) {
    logger.warn('digest.section.errors_failed', { err });
  }

  return out;
}

function renderDigestSubject(data: DigestData): string {
  if (data.criticalErrorCount > 0) {
    return `🚨 SBS digest — ${data.date} — ${data.criticalErrorCount} critical`;
  }
  if (data.withdrawalsPendingNow >= 5) {
    return `📋 SBS digest — ${data.date} — ${data.withdrawalsPendingNow} withdrawals pending`;
  }
  return `🍌 SBS digest — ${data.date}`;
}

function renderDigestBody(data: DigestData): string {
  const lines: string[] = [];
  lines.push(`Yesterday on SBS Fantasy`);
  lines.push(``);
  lines.push(`• Signups:             ${data.signupsToday}`);
  lines.push(`• Wheel spins:         ${data.wheelSpinsToday}`);
  lines.push(`• Passes granted:      ${data.passesGrantedToday}`);
  lines.push(`• Pending withdrawals: ${data.withdrawalsPendingNow}`);
  lines.push(`• Critical errors:     ${data.criticalErrorCount}`);
  lines.push(``);
  if (data.topErrorSources.length > 0) {
    lines.push(`Top error sources (24h):`);
    for (const { source, count } of data.topErrorSources) {
      lines.push(`  ${source} — ${count}×`);
    }
    lines.push(``);
  }
  lines.push(`Full admin: https://banana-fantasy-sbs.vercel.app/admin`);
  return lines.join('\n');
}

async function loadAdminEmails(): Promise<string[]> {
  if (!isFirestoreConfigured()) return [];
  const db = getAdminFirestore();
  const lower = getAdminWalletAllowlist().map((w) => w.toLowerCase());
  const out = new Set<string>();
  // notificationPrefs `in` queries cap at 30 — chunk just in case.
  const CHUNK = 30;
  for (let i = 0; i < lower.length; i += CHUNK) {
    const slice = lower.slice(i, i + CHUNK);
    try {
      const snap = await db.collection('notificationPrefs').where('walletAddress', 'in', slice).get();
      for (const doc of snap.docs) {
        const email = String(doc.data()?.email ?? '').trim();
        if (email) out.add(email);
      }
    } catch (err) {
      logger.warn('digest.admin_email_lookup_failed', { err });
    }
  }
  return [...out];
}

async function sendDigest(requestId: string): Promise<{ data: DigestData; recipients: number; status: string }> {
  const data = await buildDigest();
  const emails = await loadAdminEmails();
  if (emails.length === 0) {
    return { data, recipients: 0, status: 'no admin emails on file' };
  }
  const subject = renderDigestSubject(data);
  const body = renderDigestBody(data);
  const result = await sendBroadcastEmailToAddresses(
    { title: subject, body, url: 'https://banana-fantasy-sbs.vercel.app/admin' },
    emails,
  );
  logger.info('admin.digest.sent', { route: 'admin/daily-digest', requestId, context: { recipients: emails.length, result } });
  return { data, recipients: result.recipients ?? 0, status: result.status };
}

export async function POST(req: Request) {
  const requestId = getRequestId(req);
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  try {
    await requireAdmin(req);
    const result = await sendDigest(requestId);
    return json({ ok: true, ...result, subject: renderDigestSubject(result.data), body: renderDigestBody(result.data), requestId });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    logger.error('admin.digest.failed', { err: err instanceof Error ? err : String(err), route: 'admin/daily-digest' });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}

/**
 * Cron caller. Vercel cron fires GET with `Authorization: Bearer <CRON_SECRET>`
 * — we verify that before running the same digest path the manual button
 * uses. No requireAdmin (cron has no wallet).
 */
export async function GET(req: Request) {
  const requestId = getRequestId(req);
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return jsonError('Cron not configured (CRON_SECRET unset)', 503, { requestId });
  }
  const got = req.headers.get('authorization') ?? '';
  if (got !== `Bearer ${expected}`) {
    return jsonError('Unauthorized', 401, { requestId });
  }
  try {
    const result = await sendDigest(requestId);
    return json({ ok: true, ...result, requestId });
  } catch (err) {
    logger.error('admin.digest.cron_failed', { err: err instanceof Error ? err : String(err), route: 'admin/daily-digest' });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
