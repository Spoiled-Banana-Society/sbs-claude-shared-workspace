// Shared error-grouping + resolution rule.
//
// One source of truth so every admin surface agrees on (a) how raw error
// events collapse into an "issue" group, and (b) when a group an admin marked
// "fixed" should stay hidden vs. reappear. Previously the Logs feed and the
// notification badge honored "marked fixed" while the Dashboard health box /
// Errors-24h card / top-bar pill counted raw events — so the same issue showed
// as "7 errors" on the dashboard and "0 critical" in the feed. And a fixed
// issue that started firing again stayed hidden forever. Both fixed here.

/** Mask volatile tokens (addresses, hashes, numbers) so like errors group. */
export function normalizeForKey(s: string | undefined): string {
  return (s ?? '')
    .replace(/0x[0-9a-fA-F]+/g, '0x*')
    .replace(/\b[0-9a-f-]{16,}\b/gi, '*')
    .replace(/\d+(\.\d+)?/g, '#')
    .trim();
}

/** Stable group key for an error event — must match the Logs feed + badge. */
export function errorGroupKey(source: string | undefined, message: string | undefined): string {
  return `${normalizeForKey(source)}|${normalizeForKey(message).slice(0, 140)}`;
}

export interface ResolutionLike {
  /** ISO timestamp the admin marked it fixed, or null for legacy resolutions. */
  at: string | null;
}

/**
 * Is this resolution still in effect? A group stays HIDDEN only if it hasn't
 * recurred since it was marked fixed. If it fired again after `at`, the fix
 * clearly didn't hold — it reopens (returns false) and shows everywhere again.
 * Legacy resolutions with no timestamp stay hidden (can't judge recurrence).
 */
export function isResolutionActive(entry: ResolutionLike | undefined | null, groupLastTs: number): boolean {
  if (!entry) return false;
  if (!entry.at) return true;
  const fixedAt = Date.parse(entry.at);
  if (Number.isNaN(fixedAt)) return true;
  return groupLastTs <= fixedAt;
}

interface EventLike {
  source?: string;
  message?: string;
  timestamp?: string;
}

/**
 * Drop events whose group is an active resolution (fixed and not recurred).
 * Used by the dashboard health / errors card / pill so a "mark fixed" hides the
 * issue there too — and a recurrence brings it back. Computes each group's most
 * recent occurrence first so recurrence is judged per group, not per event.
 */
export function dropResolvedEvents<T extends EventLike>(
  events: T[],
  resolvedMap: Record<string, ResolutionLike> | undefined | null,
): T[] {
  if (!events.length || !resolvedMap || Object.keys(resolvedMap).length === 0) return events;
  const lastTs = new Map<string, number>();
  for (const e of events) {
    const k = errorGroupKey(e.source, e.message);
    const ts = e.timestamp ? new Date(e.timestamp).getTime() || 0 : 0;
    if (ts > (lastTs.get(k) ?? 0)) lastTs.set(k, ts);
  }
  return events.filter((e) => {
    const k = errorGroupKey(e.source, e.message);
    return !isResolutionActive(resolvedMap[k], lastTs.get(k) ?? 0);
  });
}
