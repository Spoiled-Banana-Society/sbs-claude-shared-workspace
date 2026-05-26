'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';

export interface PublicUser {
  walletAddress: string;
  username: string;
  profilePicture?: string;
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

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    void refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [enabled, refresh]);

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
