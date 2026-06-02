'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/Toast';
import { subscribeUserEvents, type UserStreamEvent } from '@/lib/api/firebase';
import { BADGE_BY_ID } from '@/lib/badges/catalog';

/**
 * Real-time user event stream — primary surface for badge unlocks +
 * promo events. Server writes lightweight pings to RTDB at
 * `/userEvents/{userId}/{auto-id}`; this hook listens, dedups, and fires
 * the toast + bell entry within ~100ms.
 *
 * Mounted once at the app level (alongside useBadgeUnlockNotifier).
 *
 * Dedup gate: `sbs-stream-seen:<userId>` localStorage set, mirroring the
 * `sbs-badges-notified` pattern. Each event carries an `eventId` from
 * Firebase's push() — once we've fired for that id, we never fire again,
 * even across mounts / tabs / reconnects.
 *
 * Toast suppression: when the user is in /draft-room (lobby or actively
 * drafting), the toast is silently skipped — only the bell entry fires.
 * Same rule as useBadgeUnlockNotifier. The bell shows the unread badge
 * the moment they leave the room.
 *
 * Initial-load behavior: onChildAdded fires once for every existing
 * child at subscribe time. The `seen` set + the 5-minute freshness
 * window prevent old events from re-celebrating on every page load.
 */

const STREAM_SEEN_PREFIX = 'sbs-stream-seen';
const FRESHNESS_WINDOW_MS = 5 * 60_000; // events older than this are silently absorbed (initial-load history)
const MAX_SEEN_IDS_RETAINED = 500;       // cap localStorage growth

function seenKey(userId: string) {
  return `${STREAM_SEEN_PREFIX}:${userId.toLowerCase()}`;
}

function readSeen(userId: string): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(seenKey(userId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function addSeen(userId: string, eventId: string) {
  if (typeof window === 'undefined') return;
  try {
    const current = readSeen(userId);
    current.add(eventId);
    // Drop the oldest entries if we exceed the cap (Set preserves
    // insertion order; this is a simple FIFO eviction).
    let arr = Array.from(current);
    if (arr.length > MAX_SEEN_IDS_RETAINED) {
      arr = arr.slice(arr.length - MAX_SEEN_IDS_RETAINED);
    }
    localStorage.setItem(seenKey(userId), JSON.stringify(arr));
  } catch {
    // quota — silent
  }
}

interface Surfaces {
  /** Show the bottom-right toast (unless suppressed). */
  showToast: (message: string, link?: string) => void;
  /** Add a persistent entry to the notification bell. */
  pushNotif: (title: string, message: string, link: string, dedupeKey: string) => void;
}

/**
 * Map an event type → toast/bell copy. Keep messages short and concrete
 * — these are the strings the user actually sees.
 */
function renderEvent(event: UserStreamEvent, surfaces: Surfaces) {
  switch (event.type) {
    case 'badge-unlock': {
      const badge = event.badgeId ? BADGE_BY_ID[event.badgeId] : null;
      if (!badge) return;
      surfaces.showToast(`Badge unlocked: ${badge.label} ${badge.glyph}`, '/profile?tab=badges');
      surfaces.pushNotif(
        `Badge unlocked: ${badge.label}`,
        badge.description,
        '/profile?tab=badges',
        `badge-${event.badgeId}`,
      );
      return;
    }
    case 'promo-new-user': {
      surfaces.showToast('Welcome bonus ready — claim your free spin', '/promos');
      surfaces.pushNotif(
        'Welcome bonus ready!',
        'Your new-user free spin is waiting on the promos page.',
        '/promos',
        `promo-new-user-${event.eventId}`,
      );
      return;
    }
    case 'promo-pick-10': {
      surfaces.showToast('You got slot 10 — free spin earned!', '/promos');
      surfaces.pushNotif(
        'Pick 10 → Free Spin',
        'You drew slot 10 in a draft — your free spin is ready to claim.',
        '/promos',
        `promo-pick-10-${event.eventId}`,
      );
      return;
    }
    case 'promo-jackpot-hit': {
      const count = event.awardedCount ?? 1;
      surfaces.showToast(
        count === 1 ? 'Jackpot Hit — free spin earned!' : `Jackpot Hit — ${count} free spins earned!`,
        '/promos',
      );
      surfaces.pushNotif(
        'Jackpot Hit!',
        count === 1
          ? 'You hit a Jackpot draft — claim your free spin.'
          : `You hit a Jackpot draft — claim your ${count} free spins.`,
        '/promos',
        `promo-jackpot-${event.eventId}`,
      );
      return;
    }
    case 'promo-buy-10': {
      const count = event.awardedCount ?? 1;
      surfaces.showToast(
        count === 1 ? 'Buy 10 milestone — free spin earned!' : `Buy 10 — ${count} free spins earned!`,
        '/promos',
      );
      surfaces.pushNotif(
        'Free spin earned!',
        count === 1
          ? 'You completed Buy 10 — claim your free spin.'
          : `You completed Buy 10 — claim your ${count} free spins.`,
        '/promos',
        `promo-buy-10-${event.eventId}`,
      );
      return;
    }
    case 'promo-card-free-draft': {
      const count = event.awardedCount ?? 1;
      surfaces.showToast(
        count === 1
          ? '🎁 You earned a free draft — your card fees covered it!'
          : `🎁 You earned ${count} free drafts — your card fees covered them!`,
        '/drafting',
      );
      surfaces.pushNotif(
        count === 1 ? 'Free draft earned!' : `${count} free drafts earned!`,
        count === 1
          ? 'Your card fees added up to $25 — a free draft is on us. Tap to play.'
          : `Your card fees earned you ${count} free drafts — on us. Tap to play.`,
        '/drafting',
        `promo-card-free-draft-${event.eventId}`,
      );
      return;
    }
    case 'promo-daily-drafts': {
      surfaces.showToast('4 Drafts Daily complete — free spin earned!', '/promos');
      surfaces.pushNotif(
        'Daily promo complete!',
        'You finished 4 drafts today — claim your free spin.',
        '/promos',
        `promo-daily-${event.eventId}`,
      );
      return;
    }
    case 'promo-first-purchase': {
      const count = event.awardedCount ?? 1;
      surfaces.showToast(
        count === 1 ? 'First purchase bonus — free spin earned!' : `First purchase bonus — ${count} free spins earned!`,
        '/promos',
      );
      surfaces.pushNotif(
        'First purchase bonus!',
        count === 1
          ? 'Your first purchase earned a free spin — claim it now.'
          : `Your first purchase earned ${count} free spins — claim them now.`,
        '/promos',
        `promo-first-purchase-${event.eventId}`,
      );
      return;
    }
    case 'first-purchase-unlocked': {
      // The new-user finished their welcome-wheel winnings. Surface the
      // first-purchase promo: a bell notification, and a CustomEvent the
      // app-wide FirstPurchasePromoModal listens for to pop the modal.
      surfaces.pushNotif(
        'First Purchase Bonus 🍌',
        'Every 4 passes on your first buy = 1 free spin. Buy them in one transaction to stack the most spins.',
        '/buy-drafts',
        `first-purchase-unlocked-${event.eventId}`,
      );
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('sbs-first-purchase-unlocked'));
      }
      return;
    }
    case 'referral-milestone': {
      // Friend identity is NOT in the event payload — it lives in
      // authenticated /api/promos. The toast/bell copy is intentionally
      // generic; users open /promos to see which friend triggered it.
      const milestoneLabel =
        event.milestone === 'verified' ? 'verified their X account' :
        event.milestone === 'bought1' ? 'bought their first draft' :
        event.milestone === 'bought10' ? 'bought 10 drafts' :
        'hit a milestone';
      surfaces.showToast(`A referred friend ${milestoneLabel} — free spin earned!`, '/promos');
      surfaces.pushNotif(
        'Referral free spin!',
        `A friend you referred ${milestoneLabel}. Claim your free spin.`,
        '/promos',
        `referral-${event.eventId}`,
      );
      return;
    }
    default: {
      // Unknown future event types are silently absorbed — server can
      // ship new types before frontend catches up without spamming users.
      return;
    }
  }
}

export function useUserEventStream() {
  const { user, isLoggedIn } = useAuth();
  const { show } = useToast();
  const pathname = usePathname();
  // Latest pathname in a ref so the (rarely-rebuilt) subscription
  // closure reads the current route without re-subscribing on every nav.
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  useEffect(() => {
    if (!isLoggedIn || !user?.id) return;
    const userId = user.id.toLowerCase();

    const unsub = subscribeUserEvents(userId, (event) => {
      // Dedup: every event has a stable eventId; ignore if already shown.
      const seen = readSeen(userId);
      if (seen.has(event.eventId)) return;

      // Freshness: on initial subscribe, onChildAdded fires for ALL
      // existing children. Without this filter we'd re-celebrate every
      // historical event every time the user opens the app. 5min keeps
      // the window forgiving for slow network / late deliveries.
      const ageMs = Date.now() - (event.timestamp ?? 0);
      if (Number.isFinite(ageMs) && ageMs > FRESHNESS_WINDOW_MS) {
        addSeen(userId, event.eventId); // mark seen so we don't re-check next mount
        return;
      }

      const inDraftRoom = (pathnameRef.current ?? '').startsWith('/draft-room');

      const surfaces: Surfaces = {
        showToast: (message, link) => {
          if (inDraftRoom) return; // toast suppressed in draft lobby/drafting
          show({
            level: 'success',
            message,
            ...(link ? { action: { label: 'View', onClick: () => { window.location.href = link; } } } : {}),
          });
        },
        // No-op: the persistent bell entry is now created SERVER-SIDE in
        // pushStreamEvent (lib/userEventStream.ts → createNotification), so
        // it's account-synced across devices. This hook only drives the
        // ephemeral, per-device toast. (renderEvent still calls pushNotif;
        // keeping it a no-op avoids touching every case.)
        pushNotif: () => {},
      };

      renderEvent(event, surfaces);
      addSeen(userId, event.eventId);
    });

    return () => {
      try { unsub(); } catch { /* ignore */ }
    };
  }, [isLoggedIn, user?.id, show]);
}
