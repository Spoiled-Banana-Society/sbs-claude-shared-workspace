import { json, jsonError } from '@/lib/api/routeUtils';
import { setBbb4BaseURI } from '@/lib/onchain/adminMint';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/nft/set-base-uri  { uri }
 * One-time admin action: set the BBB4 collection baseURI to our metadata
 * endpoint so OpenSea/wallets render the obsidian cards. Gated by ADMIN_API_KEY
 * (header `x-admin-key`). Signs with the runtime BBB4 owner key.
 */
export async function POST(req: Request) {
  const provided = req.headers.get('x-admin-key') || '';
  const adminKey = process.env.ADMIN_API_KEY || '';
  const bootstrap = process.env.SETBASEURI_SECRET || '';
  const ok = (!!adminKey && provided === adminKey) || (!!bootstrap && provided === bootstrap);
  if (!ok) {
    return jsonError('Unauthorized', 401);
  }
  let body: { uri?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const uri = String(body.uri || '').trim();
  if (!/^https?:\/\/.+\/$/.test(uri)) {
    return jsonError('uri must be an absolute URL ending in "/"', 400);
  }
  try {
    const result = await setBbb4BaseURI(uri);
    logger.info('admin.set_base_uri', { uri, txHash: result.txHash });
    return json({ ok: true, uri, ...result });
  } catch (err) {
    logger.error('admin.set_base_uri_failed', { uri, error: String(err) });
    return jsonError(`setBaseURI failed: ${String(err)}`, 500);
  }
}
