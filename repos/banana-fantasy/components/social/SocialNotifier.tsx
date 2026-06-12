'use client';

/**
 * SocialNotifier — fires in-app notifications for new friend requests and
 * new direct messages. Renders nothing.
 *
 * It deliberately does NOT open its own fetch loop. It rides the existing
 * 15s polls inside useFriends/useDmInbox (both already ref-guarded against
 * the render-loop self-DDoS — see [[render-loop-self-ddos]]) and simply
 * diffs the data they return against a localStorage baseline. The only
 * side effects here are reads of localStorage + pushNotification(), so it
 * can never amplify into a fetch storm.
 *
 * pushNotification() respects the user's category mute toggles, so muting
 * "Friend Requests" or "Messages" in /notifications silences these.
 *
 * Mounted once, app-wide (incl. the draft room) for signed-in users.
 */

import { useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useDmInbox, type DmThreadView } from '@/hooks/useDms';
import { usePresenceHeartbeat } from '@/hooks/usePresence';
import { pushNotification } from '@/components/NotificationCenter';

function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
}

export function SocialNotifier() {
  const { user } = useAuth();
  const wallet = (user?.walletAddress || '').toLowerCase();
  const enabled = !!wallet;

  const { inbox } = useDmInbox(enabled);

  // Online-dot heartbeat — marks this user online while the tab is open.
  usePresenceHeartbeat(enabled ? wallet : null);

  // Per-wallet localStorage key so switching accounts never cross-fires.
  const threadsKey = `sbs-social-seen-threads:${wallet}`;

  // ── Friend requests: server-side bell only ────────────────────────────
  // lib/friends.ts notifyFriendRequest writes the synced, cross-device bell
  // (deduped per friendship doc). The old client-side poll-diff here
  // double-pinged every request ("New friend request" + "Friend request",
  // Boris 2026-06-11) — removed; DMs below still notify client-side.

  // ── New direct messages ───────────────────────────────────────────────
  // Covers both accepted threads and pending message requests. A thread
  // notifies when it has unread incoming messages (unreadCount > 0) AND its
  // latest message is newer than the last one we notified about — so every
  // new message from anyone fires, not just the first.
  const messageThreads: DmThreadView[] = [...inbox.messages, ...inbox.requests];
  // Stable signature so the effect only diffs when something actually
  // moved, not on every render of the same data.
  const sig = messageThreads.map((t) => `${t.threadId}:${t.lastMessageAt}:${t.unreadCount}`).join('|');
  const threadsRef = useRef(messageThreads);
  threadsRef.current = messageThreads;
  useEffect(() => {
    if (!enabled) return;
    const threads = threadsRef.current;
    const seen = readJSON<Record<string, number>>(threadsKey, {});
    const firstRun = localStorage.getItem(threadsKey) === null;
    if (firstRun) {
      const seed: Record<string, number> = {};
      for (const t of threads) seed[t.threadId] = t.lastMessageAt;
      writeJSON(threadsKey, seed);
      return;
    }
    const next: Record<string, number> = { ...seen };
    for (const t of threads) {
      const last = seen[t.threadId] ?? 0;
      if (t.unreadCount > 0 && t.lastMessageAt > last) {
        const preview = t.lastMessagePreview ? `: ${t.lastMessagePreview}` : '';
        pushNotification({
          type: 'message_received',
          title: `New message from ${t.other.username || 'someone'}`,
          message: `${t.other.username || 'Someone'}${preview}`.slice(0, 140),
          link: `/messages?with=${encodeURIComponent(t.other.walletAddress)}`,
          dedupeKey: `dm-${t.threadId}-${t.lastMessageAt}`,
        });
      }
      next[t.threadId] = t.lastMessageAt;
    }
    writeJSON(threadsKey, next);
    // `sig` drives re-runs; threads are read from the ref to keep the dep
    // array a stable scalar (the render-loop-safe shape).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sig, threadsKey]);

  return null;
}
