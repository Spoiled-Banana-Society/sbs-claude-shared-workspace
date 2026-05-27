/**
 * Loose URL matcher for the OneSignal service worker's notificationclick
 * handler. Lives in src (not the SW file) so it can be unit-tested. The
 * SW file inlines the same logic — keep them in sync if you change one.
 *
 * Why loose matching: the notification URL we send is the canonical
 * deep-link (e.g. `/draft-room?id=d1`). A user actively in the draft
 * usually has a fuller URL — `?id=d1&wallet=0xabc&mode=live&speed=fast`.
 * Exact match would miss every open tab the user actually has, opening
 * a fresh (unauthenticated, no-state) tab on every push click. Loose
 * match focuses the right tab and keeps state intact.
 */

interface ClientLike {
  url: string;
}

/**
 * Find the best open client to focus for a given notification URL.
 *
 * Rules:
 *   - Same origin required (no cross-origin focus — security footgun).
 *   - Same pathname required.
 *   - If pathname is `/draft-room`, also require matching `id` (draftId).
 *   - More specific paths win over `/` (homepage).
 *   - Malformed URLs are silently skipped, never thrown.
 *
 * Returns the matched ClientLike, or null if no acceptable match.
 */
export function findMatchingClient<T extends ClientLike>(
  clients: readonly T[],
  targetUrlStr: string,
): T | null {
  const target = safeUrl(targetUrlStr);
  if (!target) return null;

  let bestMatch: T | null = null;
  let bestSpecificity = -1;

  for (const client of clients) {
    const candidate = safeUrl(client.url);
    if (!candidate) continue;

    if (candidate.origin !== target.origin) continue;
    if (candidate.pathname !== target.pathname) continue;

    // /draft-room specifically must agree on the draftId, otherwise we'd
    // focus a tab showing a totally different draft.
    if (target.pathname === '/draft-room') {
      const targetDraftId = target.searchParams.get('id');
      const candidateDraftId = candidate.searchParams.get('id');
      if (!targetDraftId || targetDraftId !== candidateDraftId) continue;
    }

    // Score by pathname depth — `/draft-room` > `/promos` > `/`. Lets a
    // user with both the homepage AND the draft open get focused into
    // the draft.
    const specificity = candidate.pathname.split('/').filter(Boolean).length;
    if (specificity > bestSpecificity) {
      bestSpecificity = specificity;
      bestMatch = client;
    }
  }
  return bestMatch;
}

function safeUrl(s: string): URL | null {
  try {
    return new URL(s);
  } catch {
    return null;
  }
}
