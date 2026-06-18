let accessTokenGetter: (() => Promise<string | null>) | null = null;

/** Registered once from useAuth so browser BFF calls can attach Privy JWT. */
export function setPrivyAccessTokenGetter(fn: () => Promise<string | null>): void {
  accessTokenGetter = fn;
}

export function getPrivyAccessToken(): Promise<string | null> {
  return accessTokenGetter?.() ?? Promise.resolve(null);
}
