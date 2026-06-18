'use client';

/**
 * Attach Privy JWT to same-origin /api calls.
 * Pass `getAccessToken` from `usePrivy()` — do not list it in useEffect deps
 * (unstable identity causes render-loop fetches; use a ref instead).
 */
export async function authedAppFetch(
  url: string,
  getAccessToken: () => Promise<string | null>,
  init?: RequestInit,
): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Content-Type') && init?.body) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(url, { ...init, headers });
}
