/**
 * Authenticated helpers for e2e tests that set up drafts via the Go API.
 * Reads DRAFTS_API_SERVICE_KEY and ADMIN_API_KEY from env (or .env.local).
 *
 * When DRAFTS_API_AUTH_ENABLED=true on Cloud Run, these keys are required.
 * When auth is off, requests still succeed without headers.
 *
 * Usage (Playwright):
 *   import { mintToken, joinDraft, fillBots, getDraftInfo, extractDraftId } from '../scripts/e2e-drafts-api.mjs';
 */
import { config } from 'dotenv';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const file of ['.env.local', '.env.staging', '.env']) {
  const path = join(ROOT, file);
  if (existsSync(path)) config({ path, override: false });
}

export const API_BASE = (
  process.env.STAGING_DRAFTS_API_URL ||
  process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL ||
  'https://sbs-drafts-api-staging-652484219017.us-central1.run.app'
).replace(/\/$/, '');

export const WS_BASE = 'wss://sbs-drafts-server-staging-652484219017.us-central1.run.app';

function buildHeaders({ wallet, admin } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const serviceKey = process.env.DRAFTS_API_SERVICE_KEY?.trim();
  if (serviceKey) headers['X-SBS-Service-Key'] = serviceKey;
  if (wallet) headers['X-SBS-Wallet'] = wallet.toLowerCase();
  if (admin) {
    const adminKey = process.env.ADMIN_API_KEY?.trim();
    if (adminKey) headers['X-Admin-Key'] = adminKey;
  }
  return headers;
}

/** Low-level fetch against the staging Go API. */
export async function draftsApiFetch(path, opts = {}) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const url = `${API_BASE}${normalized}`;
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers: buildHeaders({ wallet: opts.wallet, admin: opts.admin }),
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  try {
    return await res.json();
  } catch {
    return { _error: true, status: res.status };
  }
}

export async function mintToken(wallet, minId, maxId = minId) {
  return draftsApiFetch(`/owner/${wallet}/draftToken/mint`, {
    method: 'POST',
    wallet,
    body: { minId, maxId },
  });
}

export async function joinDraft(wallet, speed = 'fast', numLeaguesToJoin = 1) {
  return draftsApiFetch(`/league/${speed}/owner/${wallet}`, {
    method: 'POST',
    wallet,
    body: { numLeaguesToJoin },
  });
}

export async function fillBots(draftId, speed = 'fast', count = 9) {
  return draftsApiFetch(
    `/staging/fill-bots/${speed}?count=${count}&leagueId=${encodeURIComponent(draftId)}`,
    { method: 'POST', admin: true, body: {} },
  );
}

export async function getDraftInfo(draftId) {
  return draftsApiFetch(`/draft/${draftId}/state/info`);
}

export function extractDraftId(joinResult) {
  const raw = Array.isArray(joinResult) ? joinResult[0] : joinResult;
  return raw?._leagueId ?? raw?.draftId ?? raw?.leagueId ?? null;
}
