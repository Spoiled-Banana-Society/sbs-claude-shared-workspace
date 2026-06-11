'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useAuth } from '@/hooks/useAuth';
import { useStreamRefetch } from '@/hooks/useStreamRefetch';

export interface PublicUser {
  walletAddress: string;
  username: string;
  profilePicture?: string;
  equippedBadge?: string | null;
}

export interface FriendBuckets {
  friends: PublicUser[];
  incoming: PublicUser[];
  outgoing: PublicUser[];
}

const POLL_MS = 15_000;

export function useFriends(enabled: boolean): {
  data: FriendBuckets;
  loading: boolean;
  refresh: () => Promise<void>;
  sendRequest: (targetWallet: string) => Promise<{ ok: boolean; error?: string }>;
  accept: (otherWallet: string) => Promise<{ ok: boolean; error?: string }>;
  remove: (otherWallet: string) => Promise<{ ok: boolean; error?: string }>;
  search: (q: string) => Promise<PublicUser[]>;
  mutualWith: (wallet: string) => Promise<PublicUser[]>;
} {
  const privy = usePrivy();
  const [data, setData] = useState<FriendBuckets>({ friends: [], incoming: [], outgoing: [] });
  const [loading, setLoading] = useState(true);

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = await privy.getAccessToken();
    if (!token) throw new Error('Session expired — please log in again.');
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  }, [privy]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/friends', { headers, cache: 'no-store' });
      if (!res.ok) return;
      const json = (await res.json()) as FriendBuckets;
      setData({
        friends: json.friends || [],
        incoming: json.incoming || [],
        outgoing: json.outgoing || [],
      });
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [enabled, authHeaders]);

  // Ref the refresh function so the polling effect only re-runs when
  // `enabled` actually flips — never on refresh's identity churn. Without
  // this, Privy hook re-renders rebuild `refresh`, which would re-fire the
  // effect (one immediate request per render) and amplify into a fetch
  // storm if the parent re-renders frequently. See feedback memory:
  // [[render-loop-self-ddos]].
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    void refreshRef.current();
    const id = setInterval(() => { void refreshRef.current(); }, POLL_MS);
    return () => clearInterval(id);
  }, [enabled]);

  // Instant: friend requests/accepts fire a server noti ping — refresh the
  // buckets within ~300ms instead of waiting out the 15s poll.
  const { walletAddress } = useAuth();
  useStreamRefetch(enabled ? walletAddress : null, () => { void refreshRef.current(); });

  const sendRequest = useCallback(async (targetWallet: string) => {
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/friends/request', {
        method: 'POST', headers, body: JSON.stringify({ targetWallet }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: json.error || `error ${res.status}` };
      await refresh();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'failed' };
    }
  }, [authHeaders, refresh]);

  const accept = useCallback(async (otherWallet: string) => {
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/friends/accept', {
        method: 'POST', headers, body: JSON.stringify({ otherWallet }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: json.error || `error ${res.status}` };
      // Optimistic: move them incoming → friends NOW so this surface flips
      // instantly; refresh + the server stream ping confirm everywhere else.
      const w = otherWallet.toLowerCase();
      setData((prev) => {
        const entry = prev.incoming.find((u) => u.walletAddress.toLowerCase() === w);
        if (!entry) return prev;
        return {
          ...prev,
          incoming: prev.incoming.filter((u) => u.walletAddress.toLowerCase() !== w),
          friends: prev.friends.some((u) => u.walletAddress.toLowerCase() === w) ? prev.friends : [...prev.friends, entry],
        };
      });
      await refresh();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'failed' };
    }
  }, [authHeaders, refresh]);

  const remove = useCallback(async (otherWallet: string) => {
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/friends/remove', {
        method: 'POST', headers, body: JSON.stringify({ otherWallet }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: json.error || `error ${res.status}` };
      await refresh();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'failed' };
    }
  }, [authHeaders, refresh]);

  const search = useCallback(async (q: string): Promise<PublicUser[]> => {
    if (!q.trim()) return [];
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(q.trim())}`, { headers });
      if (!res.ok) return [];
      const json = (await res.json()) as { users?: PublicUser[] };
      return json.users || [];
    } catch { return []; }
  }, [authHeaders]);

  const mutualWith = useCallback(async (wallet: string): Promise<PublicUser[]> => {
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/friends/mutual?wallet=${encodeURIComponent(wallet)}`, { headers });
      if (!res.ok) return [];
      const json = (await res.json()) as { mutual?: PublicUser[] };
      return json.mutual || [];
    } catch { return []; }
  }, [authHeaders]);

  return { data, loading, refresh, sendRequest, accept, remove, search, mutualWith };
}
