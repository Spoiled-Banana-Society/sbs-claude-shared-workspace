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
import { useFriends } from '@/hooks/useFriends';
import { useDmInbox, type DmThreadView } from '@/hooks/useDms';
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

  const { data: friends } = useFriends(enabled);
  const { inbox } = useDmInbox(enabled);

  // Per-wallet localStorage keys so switching accounts never cross-fires.
  const friendsKey = `sbs-social-seen-friends:${wallet}`;
  const threadsKey = `sbs-social-seen-threads:${wallet}`;

  // ── New incoming friend requests ──────────────────────────────────────
  // friends.incoming churns identity each 15s poll, so this effect re-runs
  // every poll — exactly when we want to diff. No fetch happens in here.
  const incoming = friends.incoming;
  useEffect(() => {
    if (!enabled) return;
    const incomingWallets = incoming.map((u) => u.walletAddress.toLowerCase());
    const seen = readJSON<string[]>(friendsKey, []);
    // First run for this wallet (no baseline stored): seed it silently so
    // we don't notify for requests that were already sitting there.
    const firstRun = localStorage.getItem(friendsKey) === null;
    if (firstRun) {
      writeJSON(friendsKey, incomingWallets);
      return;
    }
    const seenSet = new Set(seen);
    const fresh = incoming.filter((u) => !seenSet.has(u.walletAddress.toLowerCase()));
    for (const u of fresh) {
      pushNotification({
        type: 'friend_request',
        title: 'New friend request',
        message: `${u.username || 'Someone'} wants to be friends.`,
        link: '/messages',
        dedupeKey: `friend-req-${u.walletAddress.toLowerCase()}`,
      });
    }
    // Persist the current set (drops requests that were accepted/withdrawn
    // so a re-sent request later can notify again).
    writeJSON(friendsKey, incomingWallets);
  }, [enabled, incoming, friendsKey]);

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
