'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';

export interface PublicUser {
  walletAddress: string;
  username: string;
  profilePicture?: string;
}

export interface DmThreadView {
  threadId: string;
  other: PublicUser;
  status: 'pending' | 'accepted';
  startedBy: string;
  lastMessageAt: number;
  lastMessagePreview: string;
  unreadCount: number;
}

export interface DmInbox {
  messages: DmThreadView[]; // accepted threads
  requests: DmThreadView[]; // pending, I'm recipient
  sent: DmThreadView[];     // pending, I sent
}

export interface DmMessage {
  id: string;
  walletAddress: string;
  text: string;
  timestamp: number;
}

export type DmPermission = 'send' | 'request' | 'wait' | 'reply';

export interface BlockState {
  myBlock: boolean;
  theirBlock: boolean;
}

const INBOX_POLL_MS = 15_000;
const THREAD_POLL_MS = 2000;

function useAuthHeaders() {
  const privy = usePrivy();
  return useCallback(async (): Promise<HeadersInit> => {
    const token = await privy.getAccessToken();
    if (!token) throw new Error('Session expired');
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  }, [privy]);
}

/**
 * Inbox: polls /api/dms/threads every 15s.
 */
export function useDmInbox(enabled: boolean): {
  inbox: DmInbox;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const headers = useAuthHeaders();
  const [inbox, setInbox] = useState<DmInbox>({ messages: [], requests: [], sent: [] });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const h = await headers();
      const res = await fetch('/api/dms/threads', { headers: h, cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as DmInbox;
      setInbox({
        messages: data.messages || [],
        requests: data.requests || [],
        sent: data.sent || [],
      });
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [enabled, headers]);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    void refresh();
    const id = setInterval(refresh, INBOX_POLL_MS);
    return () => clearInterval(id);
  }, [enabled, refresh]);

  return { inbox, loading, refresh };
}

/**
 * Single thread: polls /api/dms/{otherWallet} every 2s.
 */
export function useDmThread(otherWallet: string | null): {
  messages: DmMessage[];
  other: PublicUser | null;
  permission: DmPermission;
  block: BlockState;
  loading: boolean;
  send: (text: string) => Promise<{ ok: boolean; error?: string }>;
  accept: () => Promise<{ ok: boolean; error?: string }>;
  block_: () => Promise<{ ok: boolean; error?: string }>;
  unblock: () => Promise<{ ok: boolean; error?: string }>;
  refresh: () => Promise<void>;
} {
  const headers = useAuthHeaders();
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [other, setOther] = useState<PublicUser | null>(null);
  const [permission, setPermission] = useState<DmPermission>('request');
  const [block, setBlock] = useState<BlockState>({ myBlock: false, theirBlock: false });
  const [loading, setLoading] = useState(!!otherWallet);

  const refresh = useCallback(async () => {
    if (!otherWallet) return;
    try {
      const h = await headers();
      const res = await fetch(`/api/dms/${encodeURIComponent(otherWallet)}`, { headers: h, cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json() as {
        messages?: DmMessage[];
        other?: PublicUser;
        permission?: DmPermission;
        block?: BlockState;
      };
      setMessages(data.messages || []);
      setOther(data.other || null);
      setPermission(data.permission || 'request');
      setBlock(data.block || { myBlock: false, theirBlock: false });
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [otherWallet, headers]);

  useEffect(() => {
    if (!otherWallet) {
      setMessages([]);
      setOther(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void refresh();
    const id = setInterval(refresh, THREAD_POLL_MS);
    return () => clearInterval(id);
  }, [otherWallet, refresh]);

  const send = useCallback(async (text: string) => {
    if (!otherWallet) return { ok: false, error: 'no thread' };
    try {
      const h = await headers();
      const res = await fetch(`/api/dms/${encodeURIComponent(otherWallet)}`, {
        method: 'POST', headers: h, body: JSON.stringify({ text }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: json.error || `error ${res.status}` };
      await refresh();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'failed' };
    }
  }, [otherWallet, headers, refresh]);

  const accept = useCallback(async () => {
    if (!otherWallet) return { ok: false, error: 'no thread' };
    try {
      const h = await headers();
      const res = await fetch(`/api/dms/${encodeURIComponent(otherWallet)}/accept`, { method: 'POST', headers: h });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: json.error || `error ${res.status}` };
      await refresh();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'failed' };
    }
  }, [otherWallet, headers, refresh]);

  const blockFn = useCallback(async () => {
    if (!otherWallet) return { ok: false, error: 'no thread' };
    try {
      const h = await headers();
      const res = await fetch(`/api/dms/${encodeURIComponent(otherWallet)}/block`, { method: 'POST', headers: h });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: json.error || `error ${res.status}` };
      await refresh();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'failed' };
    }
  }, [otherWallet, headers, refresh]);

  const unblock = useCallback(async () => {
    if (!otherWallet) return { ok: false, error: 'no thread' };
    try {
      const h = await headers();
      const res = await fetch(`/api/dms/${encodeURIComponent(otherWallet)}/block`, { method: 'DELETE', headers: h });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: json.error || `error ${res.status}` };
      await refresh();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'failed' };
    }
  }, [otherWallet, headers, refresh]);

  return { messages, other, permission, block, loading, send, accept, block_: blockFn, unblock, refresh };
}

/**
 * Blocked-users list: who I've blocked, with profiles. Used by the
 * "Blocked" panel so the user can see and unblock them.
 */
export function useBlockedUsers(enabled: boolean): {
  blocked: PublicUser[];
  loading: boolean;
  refresh: () => Promise<void>;
  unblock: (wallet: string) => Promise<{ ok: boolean; error?: string }>;
} {
  const headers = useAuthHeaders();
  const [blocked, setBlocked] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(enabled);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const h = await headers();
      const res = await fetch('/api/dms/blocks', { headers: h, cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json() as { blocked?: PublicUser[] };
      setBlocked(data.blocked || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [enabled, headers]);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    void refresh();
  }, [enabled, refresh]);

  const unblock = useCallback(async (wallet: string) => {
    try {
      const h = await headers();
      const res = await fetch(`/api/dms/${encodeURIComponent(wallet)}/block`, { method: 'DELETE', headers: h });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: json.error || `error ${res.status}` };
      await refresh();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'failed' };
    }
  }, [headers, refresh]);

  return { blocked, loading, refresh, unblock };
}
