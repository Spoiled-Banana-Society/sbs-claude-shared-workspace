import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';
import { refreshOpenSeaTokens } from '@/lib/opensea';
import { requireAdmin } from '@/lib/adminAuth';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DRAFTS_API_BASE = process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL
  || 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';

/**
 * POST /api/admin/nft/refresh-wallet?owner=0x..&which=available|active|all&offset=0&limit=200
 *
 * Nudges OpenSea to re-pull metadata for a wallet's BBB4 tokens, so the
 * obsidian cards (grey pass / team) replace whatever OpenSea cached before the
 * baseURI was set. One-time backfill for already-minted passes; new mints
 * self-refresh via registerMintedTokens. Chunk via offset/limit for big holders.
 *
 * Auth: admin Privy session OR `x-admin-key` (ADMIN_API_KEY / bootstrap secret).
 */
async function authed(req: Request): Promise<boolean> {
  const provided = req.headers.get('x-admin-key') || '';
  const adminKey = process.env.ADMIN_API_KEY || '';
  const bootstrap = process.env.NFT_REFRESH_SECRET || '';
  if ((adminKey && provided === adminKey) || (bootstrap && provided === bootstrap)) return true;
  try { await requireAdmin(req); return true; } catch { return false; }
}

export async function POST(req: Request) {
  if (!(await authed(req))) return jsonError('Unauthorized', 401);

  const owner = (getSearchParam(req, 'owner') || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(owner)) return jsonError('owner must be a wallet address', 400);
  const which = (getSearchParam(req, 'which') || 'available').toLowerCase();
  const offset = Math.max(0, Number(getSearchParam(req, 'offset')) || 0);
  const limit = Math.min(Number(getSearchParam(req, 'limit')) || 200, 400);

  let available: string[] = [];
  let active: string[] = [];
  try {
    const res = await fetch(`${DRAFTS_API_BASE}/owner/${owner}/draftToken/all`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return jsonError(`Go API ${res.status}`, 502);
    const data = await res.json();
    const ids = (arr: unknown): string[] => (Array.isArray(arr) ? arr : [])
      .map((t: Record<string, unknown>) => String(t?.realTokenId ?? t?._cardId ?? '').trim())
      .filter((s) => /^\d+$/.test(s));
    available = ids(data?.available);
    active = ids(data?.active);
  } catch (err) {
    return jsonError(`Go API fetch failed: ${String(err)}`, 502);
  }

  const pool = which === 'all' ? [...available, ...active] : which === 'active' ? active : available;
  const slice = pool.slice(offset, offset + limit);
  const refreshed = await refreshOpenSeaTokens(slice);
  const nextOffset = offset + limit < pool.length ? offset + limit : null;

  logger.info('admin.nft.refresh_wallet', { owner, which, total: pool.length, offset, attempted: slice.length, refreshed, nextOffset });
  return json({ ok: true, owner, which, total: pool.length, offset, attempted: slice.length, refreshed, nextOffset });
}
