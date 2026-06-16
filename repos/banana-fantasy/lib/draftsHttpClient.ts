import { createHttpClient } from '@/lib/api/client';
import { getDraftsApiUrl } from '@/lib/staging';

/** Browser → authenticated BFF; server → Go API directly (service routes use draftsApiServer). */
export function createDraftsHttpClient() {
  if (typeof window === 'undefined') {
    return createHttpClient({ baseUrl: getDraftsApiUrl() });
  }
  return createHttpClient({
    baseUrl: '/api/drafts-api',
    getAccessToken: async () => {
      const { getPrivyAccessToken } = await import('@/lib/privyAccessToken');
      return (await getPrivyAccessToken()) ?? undefined;
    },
  });
}

/** Low-level fetch for one-off browser reads/writes that bypass createHttpClient. */
export async function draftsApiFetch(path: string, init?: RequestInit): Promise<Response> {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (typeof window === 'undefined') {
    const base = getDraftsApiUrl().replace(/\/$/, '');
    return fetch(`${base}${normalized}`, { ...init, cache: 'no-store' });
  }
  const [{ authedAppFetch }, { getPrivyAccessToken }] = await Promise.all([
    import('@/lib/authedAppFetch'),
    import('@/lib/privyAccessToken'),
  ]);
  return authedAppFetch(`/api/drafts-api${normalized}`, getPrivyAccessToken, {
    ...init,
    cache: 'no-store',
  });
}
