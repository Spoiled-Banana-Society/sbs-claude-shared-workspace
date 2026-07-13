'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { pushNotification } from '@/components/NotificationCenter';
import { BADGE_BY_ID } from '@/lib/badges/catalog';

// 5-minute safety net. Real-time pushes via useUserEventStream
// (RTDB) deliver badge unlocks within ~100ms — this poll is only for
// catching anything RTDB might miss (network blips, RTDB write
// failures, badges granted while the user was offline). Reduced from
// 30s on 2026-05-18 when push shipped.
const POLL_MS = 5 * 60_000;

function seenStorageKey(userId: string) {
  return `sbs-badges-seen:${userId.toLowerCase()}`;
}

function notifiedStorageKey(userId: string) {
  return `sbs-badges-notified:${userId.toLowerCase()}`;
}

function readSet(key: string): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function writeSet(key: string, ids: Set<string>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(ids)));
  } catch { /* quota */ }
}

function readSeen(userId: string): Set<string> {
  return readSet(seenStorageKey(userId));
}

function writeSeen(userId: string, ids: Set<string>) {
  writeSet(seenStorageKey(userId), ids);
}

function readNotified(userId: string): Set<string> {
  return readSet(notifiedStorageKey(userId));
}

function addNotified(userId: string, badgeId: string) {
  const current = readNotified(userId);
  current.add(badgeId);
  writeSet(notifiedStorageKey(userId), current);
}

/**
 * Polls /api/badges for the logged-in user, diffs against the
 * locally-tracked "already seen" set, and fires both a bottom-right
 * toast AND a notification-center entry whenever a new badge unlocks.
 *
 * Mounted once at the app level (inside AppContent), so any path that
 * unlocks a badge — wheel spin, draft fill sweep, admin grant —
 * surfaces the celebration without that path having to fire the
 * notification itself.
 *
 * First-load behavior: when the user first loads the app after this
 * ships, all of their already-unlocked badges get recorded as "seen"
 * silently — we don't want to spam toast notifications for badges
 * earned long ago.
 */
export function useBadgeUnlockNotifier() {
  const { user, isLoggedIn } = useAuth();
  const seedDoneRef = useRef<Set<string>>(new Set()); // tracks userIds we've seeded the "seen" set for
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!isLoggedIn || !user?.id) return;
    const userId = user.id.toLowerCase();
    let cancelled = false;

    const tick = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        // /api/badges runs a server-side sweep inline (throttled per-user
        // via the lastBadgeSweepAt field), so just reading the catalog
        // is enough to keep unlocks fresh.
        const res = await fetch(`/api/badges?userId=${encodeURIComponent(userId)}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json() as { unlocked?: { id: string; unlockedAt?: string | null }[] };
        if (cancelled) return;
        const unlocked = data.unlocked ?? [];
        const currentIds = new Set(unlocked.map(u => u.id));
        const unlockedAtById = new Map(unlocked.map(u => [u.id, u.unlockedAt ?? null]));

        // First time this session for this user: record current set as
        // "already seen" so legacy unlocks don't toast. Always write
        // (not just on empty) — the seen set should reflect the latest
        // server truth, otherwise multi-tab races and stale localStorage
        // can leave badges marked "new" forever.
        if (!seedDoneRef.current.has(userId)) {
          writeSeen(userId, currentIds);
          seedDoneRef.current.add(userId);
          return;
        }

        const seen = readSeen(userId);
        const newlyUnlocked: string[] = [];
        currentIds.forEach(id => {
          if (!seen.has(id)) newlyUnlocked.push(id);
        });
        if (newlyUnlocked.length === 0) return;

        // Only notify for badges that ACTUALLY unlocked recently. If a
        // badge has an unlockedAt timestamp older than 5 minutes, it
        // was unlocked in a prior session — the seen-set drift (cleared
        // storage, switched browsers, new device) isn't our cue to
        // re-celebrate an old achievement.
        const NOTIFY_WINDOW_MS = 5 * 60_000;
        const nowMs = Date.now();

        // Persistent per-user "we already notified for this badge" set.
        // Single source of truth — survives tab close, localStorage seed
        // re-runs, wallet switches, multi-tab races. The legacy seen-set
        // diff above is the *trigger*; this is the *gate*.
        const notified = readNotified(userId);

        for (const id of newlyUnlocked) {
          const badge = BADGE_BY_ID[id];
          if (!badge) continue;
          const unlockedAt = unlockedAtById.get(id);
          const unlockedAtMs = unlockedAt ? Date.parse(unlockedAt) : NaN;
          const isRecent = Number.isFinite(unlockedAtMs) && (nowMs - unlockedAtMs) < NOTIFY_WINDOW_MS;
          if (!isRecent) continue; // silently absorb — already-earned badge
          if (notified.has(id)) continue; // already announced this one — skip

          // No toasts (Boris 2026-07-10): the bell entry below is the only
          // surface for badge unlocks.
          pushNotification({
            type: 'promo',
            title: `Badge unlocked: ${badge.label}`,
            message: badge.description,
            link: '/profile?tab=badges',
            dedupeKey: `badge-${id}`,
          });
          addNotified(userId, id);
        }
        writeSeen(userId, currentIds);
      } catch {
        // non-fatal — try again next tick
      } finally {
        inFlightRef.current = false;
      }
    };

    // Run immediately on mount, then poll. The post-action paths (draft
    // fill sweep, wheel spin) typically complete in <5s, so a 30s poll
    // catches them within a reasonable window.
    void tick();
    const interval = window.setInterval(tick, POLL_MS);

    // Also tick when the tab regains focus — covers users coming back
    // from another tab where the badge unlocked.
    const onFocus = () => { void tick(); };
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [isLoggedIn, user?.id]);
}
