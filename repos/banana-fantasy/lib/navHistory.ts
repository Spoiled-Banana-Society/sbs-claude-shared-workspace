// Tiny app-wide "where did I just come from" tracker. A global recorder runs in
// <Providers> on every client navigation, so any page can ask getLastPath() to
// see the route it was on immediately before. Used by the marketplace to decide
// whether to restore scroll (arrived from a team page → restore) or start at the
// top (arrived fresh from anywhere else). Resets on a hard refresh, which is the
// correct behavior (a hard refresh should start at the top).

let lastPath: string | null = null;

/** The pathname the user was on immediately before the current one. */
export function getLastPath(): string | null {
  return lastPath;
}

/** Record a navigation. Called once per pathname change by the global recorder. */
export function recordPath(path: string): void {
  if (path === lastPath) return;
  lastPath = path;
}

/** True for a team detail route like /marketplace/123 (but not /marketplace). */
export function isTeamDetailPath(path: string | null): boolean {
  return !!path && /^\/marketplace\/[^/]+/.test(path);
}
