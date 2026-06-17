import { ApiError } from '@/lib/api/errors';
import { getServerDraftsApiUrl } from '@/lib/serverDraftsApiUrl';

export type DraftsApiServerOptions = {
  method?: string;
  body?: unknown;
  wallet?: string;
  adminKey?: boolean;
};

export async function draftsApiServer(
  path: string,
  opts: DraftsApiServerOptions = {},
): Promise<Response> {
  const serviceKey = process.env.DRAFTS_API_SERVICE_KEY?.trim();
  if (!serviceKey) throw new ApiError(503, 'DRAFTS_API_SERVICE_KEY not configured');

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  headers['X-SBS-Service-Key'] = serviceKey;
  if (opts.wallet) headers['X-SBS-Wallet'] = opts.wallet.toLowerCase();
  if (opts.adminKey) {
    const adminKey = process.env.ADMIN_API_KEY?.trim();
    if (!adminKey) throw new ApiError(503, 'ADMIN_API_KEY not configured');
    headers['X-Admin-Key'] = adminKey;
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return fetch(`${getServerDraftsApiUrl()}${normalizedPath}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: 'no-store',
  });
}

/** Parse JSON or throw ApiError with upstream status. */
export async function draftsApiServerJson<T>(
  path: string,
  opts?: DraftsApiServerOptions,
): Promise<T> {
  const res = await draftsApiServer(path, opts);
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new ApiError(res.status, text || res.statusText);
  return text ? (JSON.parse(text) as T) : ({} as T);
}
