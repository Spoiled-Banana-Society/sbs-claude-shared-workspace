'use client';

import { useEffect, useState } from 'react';

interface RawMessage {
  walletAddress?: string;
  timestamp?: number;
}

const POLL_MS = 30_000;

export function chatLastSeenKey(walletAddress: string, draftId: string): string {
  return `chat-last-seen:${walletAddress.toLowerCase()}:${draftId}`;
}

export function markChatRead(walletAddress: string, draftId: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(chatLastSeenKey(walletAddress, draftId), String(Date.now()));
    // Fire a storage event in this tab too so other components that listen
    // for the key can update without waiting for the next poll.
    window.dispatchEvent(new StorageEvent('storage', {
      key: chatLastSeenKey(walletAddress, draftId),
    }));
  } catch { /* quota — non-fatal */ }
}

export function useUnreadChatCount(draftId: string | undefined, walletAddress: string | undefined): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!draftId || !walletAddress) {
      setCount(0);
      return;
    }
    const key = chatLastSeenKey(walletAddress, draftId);
    const myWallet = walletAddress.toLowerCase();
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch(`/api/chat/${encodeURIComponent(draftId)}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { messages?: RawMessage[] };
        if (cancelled) return;
        const lastSeen = Number(localStorage.getItem(key) || 0);
        const messages = Array.isArray(data.messages) ? data.messages : [];
        const unread = messages.filter((m) => {
          const ts = typeof m.timestamp === 'number' ? m.timestamp : 0;
          const wallet = (m.walletAddress || '').toLowerCase();
          return ts > lastSeen && wallet !== myWallet;
        }).length;
        setCount(unread);
      } catch {
        // network blip — keep current count, next tick retries
      }
    };

    void tick();
    const interval = setInterval(tick, POLL_MS);

    // React to mark-as-read from this or another tab.
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) void tick();
    };
    window.addEventListener('storage', onStorage);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('storage', onStorage);
    };
  }, [draftId, walletAddress]);

  return count;
}
