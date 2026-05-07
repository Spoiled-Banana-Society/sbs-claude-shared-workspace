'use client';

import { useEffect, useRef } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/Toast';
import { pushNotification } from '@/components/NotificationCenter';
import { BADGE_BY_ID } from '@/lib/badges/catalog';

const POLL_MS = 30_000; // 30s — covers the post-draft sweep + wheel spin paths
const SWEEP_THROTTLE_MS = 60_000; // don't run sweep-mine more than once per minute per session

function storageKey(userId: string) {
  return `sbs-badges-seen:${userId.toLowerCase()}`;
}

function readSeen(userId: string): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function writeSeen(userId: string, ids: Set<string>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(Array.from(ids)));
  } catch { /* quota */ }
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
  const { getAccessToken } = usePrivy();
  const { show } = useToast();
  const seedDoneRef = useRef<Set<string>>(new Set()); // tracks userIds we've seeded the "seen" set for
  const inFlightRef = useRef(false);
  const lastSweepRef = useRef(0);

  useEffect(() => {
    if (!isLoggedIn || !user?.id) return;
    const userId = user.id.toLowerCase();
    let cancelled = false;

    const trySweep = async () => {
      if (Date.now() - lastSweepRef.current < SWEEP_THROTTLE_MS) return;
      lastSweepRef.current = Date.now();
      try {
        const token = await getAccessToken();
        if (!token) {
          console.warn('[Badges] sweep skipped: no Privy token yet');
          return;
        }
        const res = await fetch('/api/badges/sweep-mine', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          console.warn('[Badges] sweep failed', { status: res.status, body });
        } else {
          console.log('[Badges] sweep ok', body);
        }
      } catch (err) {
        console.warn('[Badges] sweep threw', err);
      }
    };

    const tick = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        // Run a sweep first (server-side awarding for league-outcome /
        // draft-count tiers based on Go API state). Throttled to 1/min.
        await trySweep();
        const res = await fetch(`/api/badges?userId=${encodeURIComponent(userId)}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json() as { unlocked?: { id: string }[] };
        if (cancelled) return;
        const currentIds = new Set((data.unlocked ?? []).map(u => u.id));

        // First time this session for this user: record current set as
        // "already seen" so legacy unlocks don't toast.
        if (!seedDoneRef.current.has(userId)) {
          const seen = readSeen(userId);
          if (seen.size === 0) {
            writeSeen(userId, currentIds);
          }
          seedDoneRef.current.add(userId);
          return;
        }

        const seen = readSeen(userId);
        const newlyUnlocked: string[] = [];
        currentIds.forEach(id => {
          if (!seen.has(id)) newlyUnlocked.push(id);
        });
        if (newlyUnlocked.length === 0) return;

        for (const id of newlyUnlocked) {
          const badge = BADGE_BY_ID[id];
          if (!badge) continue;
          show({
            level: 'success',
            message: `Badge unlocked: ${badge.label} ${badge.glyph}`,
            action: { label: 'View', onClick: () => { window.location.href = '/profile?tab=badges'; } },
          });
          pushNotification({
            type: 'promo',
            title: `Badge unlocked: ${badge.label}`,
            message: badge.description,
            link: '/profile?tab=badges',
          });
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
  }, [isLoggedIn, user?.id, show, getAccessToken]);
}
