import { GoogleAuth } from 'google-auth-library';
import { Timestamp } from 'firebase-admin/firestore';

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { jsonError } from '@/lib/api/routeUtils';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Cron job that pulls severity>=ERROR log entries from the staging Go
 * services (sbs-drafts-api-staging) and
 * writes them into the v2_error_events Firestore collection. From there
 * the existing admin notification-counts pipeline (countServerErrors +
 * IMPORTANT_ERROR_PATTERNS regex with ^backend\.) lights up the admin
 * badge so server-side failures surface the same way client errors do.
 *
 * Why this exists: on 2026-05-12 a 1.92 MB Firestore doc-size error in
 * the Go API silently broke every draft fill for ~10 days. It logged
 * loudly to Cloud Logging but never made it into our admin alerting,
 * because the existing v2_error_events writers all run in Next.js
 * routes — Go service errors had no bridge. This cron is that bridge.
 *
 * Schedule: every 5 minutes via vercel.json. Looks back since the last
 * successful run (stored in admin_state/cloud_error_sync) so each run
 * is incremental + idempotent on Cloud Logging's `insertId`.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`.
 *
 * Cloud Logging access: reuses FIREBASE_SERVICE_ACCOUNT_JSON — that
 * service account already has Logging Viewer in staging.
 */

interface LogEntry {
  insertId?: string;
  timestamp?: string;
  severity?: string;
  resource?: { labels?: { service_name?: string; revision_name?: string } };
  labels?: Record<string, string>;
  textPayload?: string;
  jsonPayload?: Record<string, unknown>;
  httpRequest?: { status?: number; requestUrl?: string; requestMethod?: string };
}

/** Compact "POST /path → 500" from an entry's HTTP request, if any. */
function httpContext(entry: LogEntry): string {
  const h = entry.httpRequest;
  if (!h?.requestUrl) return '';
  let path = h.requestUrl;
  try {
    path = new URL(h.requestUrl).pathname;
  } catch {
    /* keep the raw url */
  }
  return `${h.requestMethod || 'request'} ${path} → ${h.status ?? '?'}`;
}

const SERVICES = ['sbs-drafts-api-staging'];
const STATE_DOC = 'admin_state/cloud_error_sync';
const PROJECT_ID = 'sbs-staging-env';
const LOOKBACK_FALLBACK_MS = 15 * 60 * 1000; // 15 min on first run
const MAX_ENTRIES_PER_RUN = 200;

// HTTP-only 4xx/5xx access-log noise that we don't want in the admin
// badge. The interesting backend errors are real stdout/stderr ERROR
// severity from the Go code itself (panics, fill failures, etc.).
const SKIP_IF_HTTP_REQUEST_ONLY = true;

function getServiceAccount(): {
  client_email: string;
  private_key: string;
  project_id: string;
} | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.private_key && parsed.client_email) return parsed;
  } catch {
    try {
      const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
      if (parsed.private_key && parsed.client_email) return parsed;
    } catch {
      /* fall through */
    }
  }
  return null;
}

interface SyncState {
  lastTimestamp?: string;        // RFC3339, last entry processed
  lastInsertIds?: string[];      // last batch's insertIds for dedupe across runs
}

async function loadState(): Promise<SyncState> {
  if (!isFirestoreConfigured()) return {};
  const db = getAdminFirestore();
  const snap = await db.doc(STATE_DOC).get();
  if (!snap.exists) return {};
  return snap.data() as SyncState;
}

async function saveState(state: SyncState): Promise<void> {
  if (!isFirestoreConfigured()) return;
  const db = getAdminFirestore();
  await db.doc(STATE_DOC).set(state, { merge: true });
}

function classifyEvent(entry: LogEntry, serviceName: string): { source: string; message: string } {
  const svc = serviceName.replace('sbs-drafts-', '').replace('-staging', '');
  // svc is now "api" or "server"
  const tp = (entry.textPayload || '').trim();
  const jp = entry.jsonPayload;

  // Prefer a structured event name when the Go code emits one
  // (timer.go and elsewhere print `{"severity":"ERROR","event":"...","draftId":"..."}`)
  if (jp && typeof jp.event === 'string') {
    const evt = jp.event.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
    const msg = typeof jp.message === 'string' ? jp.message : JSON.stringify(jp).slice(0, 1000);
    return { source: `backend.${svc}.${evt}`, message: msg };
  }

  // Heuristic: pull a recognisable event from common Go log lines
  if (/exceeds the maximum allowed size/i.test(tp)) {
    return { source: `backend.${svc}.firestore_doc_too_large`, message: tp.slice(0, 1500) };
  }
  if (/panic: /i.test(tp)) {
    const firstLine = tp.split('\n')[0];
    return { source: `backend.${svc}.panic`, message: firstLine.slice(0, 1500) };
  }
  if (/ERROR creating draft summary/i.test(tp)) {
    return { source: `backend.${svc}.fill_summary_failed`, message: tp.slice(0, 1500) };
  }
  if (/error creating draft state upon league filling/i.test(tp)) {
    return { source: `backend.${svc}.fill_failed`, message: tp.slice(0, 1500) };
  }
  if (/Removed user from draft after it failed/i.test(tp)) {
    return { source: `backend.${svc}.fill_rollback`, message: tp.slice(0, 1500) };
  }
  if (/cloud task/i.test(tp)) {
    return { source: `backend.${svc}.cloud_task_error`, message: tp.slice(0, 1500) };
  }

  // Generic bucket — no tight name, so make the message carry whatever
  // context exists: the HTTP route+status and/or the raw payload. This
  // is what stops a backend error from showing as a vague "server
  // request failed" with no indication of *where* or *why*.
  const http = httpContext(entry);
  const body = tp ? tp.slice(0, 1500) : jp ? JSON.stringify(jp).slice(0, 1500) : '';
  return {
    source: `backend.${svc}.error`,
    message: [http, body].filter(Boolean).join(' — ') || '(no payload)',
  };
}

async function fetchLogs(
  client: Awaited<ReturnType<GoogleAuth['getClient']>>,
  since: string,
): Promise<LogEntry[]> {
  // Cloud Logging is OR-of-services in one query so we get a chronologically
  // merged stream rather than two passes that could race the cursor.
  const services = SERVICES.map((s) => `"${s}"`).join(' OR ');
  const filter = [
    `resource.type="cloud_run_revision"`,
    `resource.labels.service_name=(${services})`,
    `severity>=ERROR`,
    `timestamp>"${since}"`,
  ].join(' AND ');

  const res = await client.request<{ entries?: LogEntry[] }>({
    url: 'https://logging.googleapis.com/v2/entries:list',
    method: 'POST',
    data: {
      resourceNames: [`projects/${PROJECT_ID}`],
      filter,
      orderBy: 'timestamp asc',
      pageSize: MAX_ENTRIES_PER_RUN,
    },
  });
  return res.data?.entries || [];
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return jsonError('unauthorized', 401);
  }
  if (!isFirestoreConfigured()) {
    return jsonError('firestore not configured', 500);
  }

  const sa = getServiceAccount();
  if (!sa) {
    logger.error('cloud_error_sync.no_service_account', {});
    return jsonError('service account missing', 500);
  }

  try {
    const state = await loadState();
    const since =
      state.lastTimestamp || new Date(Date.now() - LOOKBACK_FALLBACK_MS).toISOString();
    const seen = new Set(state.lastInsertIds || []);

    const auth = new GoogleAuth({
      credentials: sa as { client_email: string; private_key: string },
      scopes: ['https://www.googleapis.com/auth/logging.read'],
    });
    const client = await auth.getClient();

    const entries = await fetchLogs(client, since);

    const db = getAdminFirestore();
    const batch = db.batch();
    const newInsertIds: string[] = [];
    let written = 0;
    let lastTimestamp = state.lastTimestamp || since;

    for (const entry of entries) {
      // Skip HTTP-only access-log noise. We want application errors,
      // not "GET /ws 401" spam — those have their own dedicated detector.
      if (
        SKIP_IF_HTTP_REQUEST_ONLY &&
        !entry.textPayload &&
        !entry.jsonPayload &&
        entry.httpRequest
      ) {
        if (entry.timestamp && entry.timestamp > lastTimestamp) lastTimestamp = entry.timestamp;
        continue;
      }
      const id = entry.insertId;
      if (id && seen.has(id)) continue;

      const serviceName = entry.resource?.labels?.service_name || 'unknown-service';
      const { source, message } = classifyEvent(entry, serviceName);

      const docRef = db.collection('v2_error_events').doc();
      batch.set(docRef, {
        source,
        message,
        timestamp: entry.timestamp || new Date().toISOString(),
        actor: 'backend-cron-bridge',
        context: {
          insertId: id,
          serviceName,
          revisionName: entry.resource?.labels?.revision_name,
          severity: entry.severity,
          rawPayloadKind: entry.textPayload ? 'text' : entry.jsonPayload ? 'json' : 'http',
        },
        // Server timestamp for any downstream queries that need it
        createdAt: Timestamp.now(),
      });
      written++;
      if (id) newInsertIds.push(id);
      if (entry.timestamp && entry.timestamp > lastTimestamp) lastTimestamp = entry.timestamp;

      // Firestore batches cap at 500 ops; safety guard
      if (written >= 400) break;
    }

    if (written > 0) {
      await batch.commit();
    }

    // Keep the last 1000 insertIds for dedupe across the next few runs.
    // Cloud Logging timestamp comparisons can be ambiguous at the second
    // boundary, so insertId belt-and-suspenders.
    const trimmedIds = [...(state.lastInsertIds || []), ...newInsertIds].slice(-1000);
    await saveState({ lastTimestamp, lastInsertIds: trimmedIds });

    logger.info('cloud_error_sync.run_complete', {
      scanned: entries.length,
      written,
      lastTimestamp,
    });
    return Response.json({
      ok: true,
      scanned: entries.length,
      written,
      lastTimestamp,
    });
  } catch (err) {
    logger.error('cloud_error_sync.failed', { err });
    return jsonError('sync failed', 500);
  }
}
