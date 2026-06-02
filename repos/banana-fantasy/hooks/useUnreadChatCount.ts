'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSyncedFlag, writeSyncedFlag } from '@/hooks/useSyncedFlag';

interface RawMessage {
  walletAddress?: string;
  timestamp?: number;
}

const POLL_MS = 30_000;

/**
 * Mark a league/draft chat as read. The "last seen" timestamp is now stored
 * per-wallet on the SERVER (client-state, key `chatRead:<draftId>`), so reading
 * the chat on one device clears the unread badge on the user's other devices.
 * The shared useSyncedFlag store also updates in-memory immediately, so the
 * badge clears the instant you open the chat.
 */
export function markChatRead(walletAddress: string, draftId: string): void {
  if (!walletAddress || !draftId) return;
  writeSyncedFlag(`chatRead:${draftId}`, Date.now(), walletAddress);
}

export function useUnreadChatCount(draftId: string | undefined, walletAddress: string | undefined): number {
  const [messages, setMessages] = useState<RawMessage[]>([]);
  // Synced "last seen" timestamp. All league cards share ONE client-state
  // fetch (the useSyncedFlag module store dedupes), so a list of cards doesn't
  // fan out into N requests.
  const [lastSeen] = useSyncedFlag<number>(draftId ? `chatRead:${draftId}` : 'chatRead:none', 0);

  useEffect(() => {
    if (!draftId || !walletAddress) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/chat/${encodeURIComponent(draftId)}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { messages?: RawMessage[] };
        if (cancelled) return;
        setMessages(Array.isArray(data.messages) ? data.messages : []);
      } catch {
        // network blip — keep current messages, next tick retries
      }
    };
    void tick();
    const interval = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [draftId, walletAddress]);

  const myWallet = (walletAddress || '').toLowerCase();
  // Recomputes when new messages arrive OR when lastSeen changes (e.g. the user
  // opened the chat → markChatRead → synced store notifies → badge clears).
  return useMemo(
    () =>
      messages.filter((m) => {
        const ts = typeof m.timestamp === 'number' ? m.timestamp : 0;
        const wallet = (m.walletAddress || '').toLowerCase();
        return ts > lastSeen && wallet !== myWallet;
      }).length,
    [messages, lastSeen, myWallet],
  );
}
