/**
 * Quota-safe web storage writes.
 *
 * iOS Safari caps localStorage around 5MB and throws QuotaExceededError
 * ("The quota has been exceeded.") on the write that crosses it. Any
 * unguarded `localStorage.setItem` inside a render/effect then unmounts the
 * page into the error boundary — which is how AceJohn's draft room died
 * mid-pick (ticket-2681, 8/4): storage stays full across refresh, so every
 * reload crashed again on the first write.
 *
 * `safeSetItem` never throws. On a failed write it prunes refetchable cache
 * keys and retries once; if the write still fails it reports what's filling
 * the store (top keys by size) so we can see the actual hog from the logs,
 * then gives up quietly.
 */
import { clientLog } from '@/lib/clientLog';
import { reportClientError } from '@/lib/clientErrors';

/**
 * Key prefixes that are pure refetchable caches — safe to drop wholesale
 * when storage is full. NEVER add user state here (banana-hidden-drafts,
 * banana-cleared-drafts, airplane:/mute: latches, Privy keys…).
 */
const PRUNABLE_PREFIXES = [
  'swr:',          // useSWRLike persisted API caches (standings, history, …)
  'sbs:my-nfts:',  // useMarketplace My Teams cache
  'sbs-draftcard:',// DraftComplete card image URL (sessionStorage)
];

function isPrunable(key: string): boolean {
  return PRUNABLE_PREFIXES.some((p) => key.startsWith(p));
}

function usageStats(store: Storage): { totalChars: number; keys: number; top: Array<{ k: string; c: number }> } {
  const sizes: Array<{ k: string; c: number }> = [];
  let totalChars = 0;
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (!k) continue;
    const c = k.length + (store.getItem(k)?.length ?? 0);
    totalChars += c;
    sizes.push({ k, c });
  }
  sizes.sort((a, b) => b.c - a.c);
  return { totalChars, keys: sizes.length, top: sizes.slice(0, 8) };
}

/** Drop refetchable cache keys. Returns how many chars were freed. */
export function pruneRefetchableKeys(store: Storage): number {
  let freed = 0;
  const doomed: string[] = [];
  try {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && isPrunable(k)) {
        freed += k.length + (store.getItem(k)?.length ?? 0);
        doomed.push(k);
      }
    }
    for (const k of doomed) store.removeItem(k);
  } catch { /* storage unavailable — nothing to free */ }
  return freed;
}

// One diagnostics report per page load is plenty — this fires on a path
// that can be hit every few seconds (draft-room heartbeat).
let reportedThisLoad = false;

function reportQuota(store: Storage, key: string, valueLen: number, phase: 'pruned_retry_failed' | 'boot_prune'): void {
  if (reportedThisLoad) return;
  reportedThisLoad = true;
  try {
    const stats = usageStats(store);
    const detail = {
      key, valueLen, phase,
      totalChars: stats.totalChars, keyCount: stats.keys,
      top: stats.top.map(({ k, c }) => `${k}=${c}`).join(','),
    };
    clientLog('storage#', 'quota_exceeded', detail);
    reportClientError({
      source: 'storage.quota_exceeded',
      message: `Storage write failed for "${key}" (${valueLen} chars) — store at ${stats.totalChars} chars across ${stats.keys} keys`,
      route: typeof window !== 'undefined' ? window.location?.pathname : undefined,
      context: detail,
    });
  } catch { /* diagnostics must never throw */ }
}

/**
 * Quota-safe setItem. Returns true if the value was stored. Defaults to
 * localStorage; pass `sessionStorage` explicitly for session keys.
 */
export function safeSetItem(key: string, value: string, store?: Storage): boolean {
  if (typeof window === 'undefined') return false;
  let s: Storage;
  try { s = store ?? window.localStorage; } catch { return false; }
  try {
    s.setItem(key, value);
    return true;
  } catch {
    // Full (or storage disabled). Make room from refetchable caches and retry.
    try {
      pruneRefetchableKeys(s);
      s.setItem(key, value);
      return true;
    } catch {
      reportQuota(s, key, value.length, 'pruned_retry_failed');
      return false;
    }
  }
}

/**
 * Boot-time self-heal: if the store is close to the iOS ~5MB (≈2.5M UTF-16
 * chars) ceiling, drop refetchable caches BEFORE anything crashes on a write.
 * Also reports what's big past the warn line, so we learn what actually fills
 * users' storage. Call once from a root client effect. Never throws.
 */
export function bootStoragePrune(): void {
  if (typeof window === 'undefined') return;
  const WARN_CHARS = 1_500_000;  // ~3MB — report so we see the hogs coming
  const PRUNE_CHARS = 2_000_000; // ~4MB — free space before writes start failing
  for (const which of ['local', 'session'] as const) {
    try {
      const store = which === 'local' ? window.localStorage : window.sessionStorage;
      const { totalChars } = usageStats(store);
      if (totalChars >= PRUNE_CHARS) {
        const freed = pruneRefetchableKeys(store);
        clientLog('storage#', 'boot_prune', { which, totalChars, freed });
        reportQuota(store, `(boot:${which})`, 0, 'boot_prune');
      } else if (totalChars >= WARN_CHARS) {
        const stats = usageStats(store);
        clientLog('storage#', 'boot_high_usage', {
          which, totalChars, keyCount: stats.keys,
          top: stats.top.map(({ k, c }) => `${k}=${c}`).join(','),
        });
      }
    } catch { /* storage unavailable — nothing to do */ }
  }
}
