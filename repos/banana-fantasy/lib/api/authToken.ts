/**
 * Module-level Privy token bridge for the API clients (axios in utils/api.ts,
 * fetch via lib/api/client.ts). React hooks like usePrivy() can't be called
 * outside components, but the http clients are constructed at module load.
 *
 * AuthProvider registers a getter once Privy is ready; the http clients pull
 * via getApiToken() in their request interceptors.
 *
 * Returns null when Privy isn't ready or the user is logged out — callers
 * should treat null as "no auth header" and let the server respond with 401
 * if the route requires auth.
 */

let getter: (() => Promise<string | null>) | null = null;

export function setApiTokenGetter(fn: (() => Promise<string | null>) | null): void {
  getter = fn;
}

export async function getApiToken(): Promise<string | undefined> {
  if (!getter) return undefined;
  try {
    const token = await getter();
    return token ?? undefined;
  } catch {
    return undefined;
  }
}
