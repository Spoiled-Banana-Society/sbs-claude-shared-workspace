'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useAuth } from '@/hooks/useAuth';
import { isWalletAdmin } from '@/lib/adminAllowlist';
import { ChatModerationMenu } from '@/components/chat/ChatModerationMenu';
import { UserPopover } from '@/components/social/UserPopover';

interface ChatMessage {
  id: string;
  walletAddress: string;
  username: string;
  pfpUrl?: string;
  text: string;
  timestamp: number;
}

interface ActiveMute {
  expiresAt: number;
  reason?: string;
}

const POLL_MS = 2000;
const MUTE_POLL_MS = 15_000;

function formatMuteRemaining(expiresAt: number): string {
  if (expiresAt === 0) return 'permanently muted';
  const ms = expiresAt - Date.now();
  if (ms <= 0) return 'muted until just now';
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s remaining`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m}m remaining`;
  const h = Math.ceil(m / 60);
  if (h < 24) return `${h}h remaining`;
  const d = Math.ceil(h / 24);
  return `${d}d remaining`;
}

export function GlobalChat() {
  const { user } = useAuth();
  const privy = usePrivy();
  const walletAddress = user?.walletAddress ?? '';
  const myWallet = walletAddress.toLowerCase();
  const username = user?.username || walletAddress.slice(0, 8) || 'Anon';
  const pfpUrl = user?.profilePicture;
  const isAdmin = isWalletAdmin(walletAddress);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [myMute, setMyMute] = useState<ActiveMute | null>(null);
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auth headers builder — needed for POST (send) and any moderation calls.
  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = await privy.getAccessToken();
    if (!token) throw new Error('Session expired — please log in again.');
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  }, [privy]);

  // Poll messages every 2s.
  useEffect(() => {
    let cancelled = false;
    const fetchOnce = async () => {
      try {
        const res = await fetch('/api/global-chat', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { messages?: ChatMessage[] };
        if (cancelled) return;
        setMessages(Array.isArray(data.messages) ? data.messages : []);
      } catch { /* network blip */ }
      finally { if (!cancelled) setIsLoading(false); }
    };
    void fetchOnce();
    const id = setInterval(fetchOnce, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Poll my mute status every 15s (and on mount). Cheap server check; if a
  // mute was applied while the user had the tab open we want the input to
  // disable within a beat.
  useEffect(() => {
    if (!walletAddress) {
      setMyMute(null);
      return;
    }
    let cancelled = false;
    const check = async () => {
      try {
        const headers = await authHeaders();
        const res = await fetch('/api/global-chat/my-mute', { headers, cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { mute: ActiveMute | null };
        if (!cancelled) setMyMute(data.mute);
      } catch { /* ignore */ }
    };
    void check();
    const id = setInterval(check, MUTE_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [walletAddress, authHeaders]);

  // Scroll to bottom on new messages.
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages.length]);

  // Effective mute: respect expiresAt locally too (in case the poll lags).
  const effectiveMute = useMemo(() => {
    if (!myMute) return null;
    if (myMute.expiresAt !== 0 && myMute.expiresAt < Date.now()) return null;
    return myMute;
  }, [myMute]);

  const canSend = !!walletAddress && !effectiveMute && !isSending;

  const send = async () => {
    const text = input.trim();
    if (!text || !canSend) return;
    setIsSending(true);
    setInput('');
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/global-chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({ text, username, pfpUrl }),
      });
      if (!res.ok) {
        // 403 with { error: 'muted', mute: {...} } → reflect mute in UI
        const data = await res.json().catch(() => ({}));
        if (res.status === 403 && data?.error === 'muted' && data.mute) {
          setMyMute(data.mute as ActiveMute);
        }
        setInput(text); // restore for retry
      }
    } catch (err) {
      console.warn('[GlobalChat] send failed:', err);
      setInput(text);
    } finally {
      setIsSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const handleDeleteMessage = useCallback(async (messageId: string) => {
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/global-chat/${encodeURIComponent(messageId)}`, {
        method: 'DELETE',
        headers,
      });
      if (res.ok) {
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
      }
    } catch (err) {
      console.warn('[GlobalChat] delete failed:', err);
    } finally {
      setOpenMenuFor(null);
    }
  }, [authHeaders]);

  const handleModerate = useCallback(async (body: Record<string, unknown>) => {
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/global-chat/moderate', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.warn('[GlobalChat] moderation failed:', err);
      }
    } catch (err) {
      console.warn('[GlobalChat] moderation failed:', err);
    } finally {
      setOpenMenuFor(null);
    }
  }, [authHeaders]);

  return (
    <div className="flex flex-col h-full w-full bg-[#1c1c1e]/40 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
        <div>
          <h2 className="text-white font-semibold">#general</h2>
          <p className="text-white/40 text-xs">Banana Fantasy community chat</p>
        </div>
        <span className="text-white/30 text-xs">{messages.length} message{messages.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Messages */}
      <div ref={containerRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {isLoading && messages.length === 0 && (
          <p className="text-white/30 text-xs text-center py-8">Loading…</p>
        )}
        {!isLoading && messages.length === 0 && (
          <div className="text-center py-12">
            <p className="text-white/50 text-base font-medium">No messages yet.</p>
            <p className="text-white/30 text-sm mt-1">Be the first to say something.</p>
          </div>
        )}
        {messages.map((msg) => {
          const isYou = !!myWallet && msg.walletAddress.toLowerCase() === myWallet;
          const initial = (msg.username || msg.walletAddress).slice(0, 1).toUpperCase();
          return (
            <div key={msg.id} className="group flex items-start gap-3 px-2 py-1.5 rounded-lg hover:bg-white/[0.02]">
              {/* Avatar — clickable, opens UserPopover with friend actions. */}
              <UserPopover walletAddress={msg.walletAddress} username={msg.username} pfpUrl={msg.pfpUrl}>
                {msg.pfpUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={msg.pfpUrl} alt={msg.username} className="w-9 h-9 rounded-full object-cover flex-shrink-0 bg-white/5 border border-white/10 hover:ring-2 hover:ring-banana/40 transition-all" />
                ) : (
                  <div className="w-9 h-9 rounded-full flex-shrink-0 bg-banana/20 border border-banana/30 flex items-center justify-center text-banana font-bold text-sm hover:ring-2 hover:ring-banana/40 transition-all">
                    {initial}
                  </div>
                )}
              </UserPopover>

              {/* Body */}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <UserPopover walletAddress={msg.walletAddress} username={msg.username} pfpUrl={msg.pfpUrl}>
                    <span className={`text-sm font-semibold hover:underline ${isYou ? 'text-banana' : 'text-white'}`}>
                      {msg.username || msg.walletAddress.slice(0, 8)}
                    </span>
                  </UserPopover>
                  <span className="text-white/30 text-[10px]">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>
                <p className="text-white/85 text-sm break-words whitespace-pre-wrap">{msg.text}</p>
              </div>

              {/* Admin menu trigger */}
              {isAdmin && (
                <div className="relative flex-shrink-0">
                  <button
                    onClick={() => setOpenMenuFor((cur) => (cur === msg.id ? null : msg.id))}
                    className="opacity-0 group-hover:opacity-100 hover:bg-white/10 rounded-md p-1 text-white/40 hover:text-white/80 transition-all"
                    aria-label="Moderate message"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="12" cy="5" r="2" />
                      <circle cx="12" cy="12" r="2" />
                      <circle cx="12" cy="19" r="2" />
                    </svg>
                  </button>
                  {openMenuFor === msg.id && (
                    <ChatModerationMenu
                      message={msg}
                      onClose={() => setOpenMenuFor(null)}
                      onDeleteMessage={() => handleDeleteMessage(msg.id)}
                      onModerate={handleModerate}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Input — disabled if muted or not signed in */}
      <div className="p-3 border-t border-white/[0.06]">
        {effectiveMute ? (
          <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm rounded-lg px-3 py-2 text-center">
            You&apos;re muted — {formatMuteRemaining(effectiveMute.expiresAt)}
            {effectiveMute.reason ? ` · ${effectiveMute.reason}` : ''}
          </div>
        ) : !walletAddress ? (
          <div className="bg-white/[0.03] border border-white/10 text-white/50 text-sm rounded-lg px-3 py-2 text-center">
            Sign in to chat.
          </div>
        ) : (
          <div className="flex items-center gap-2 bg-[#2c2c2e] rounded-full px-1 py-1">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Message #general"
              maxLength={500}
              className="flex-1 bg-transparent px-3 py-1.5 text-sm text-white placeholder-white/30 focus:outline-none"
            />
            <button
              onClick={() => void send()}
              disabled={!input.trim() || !canSend}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                input.trim() && canSend ? 'bg-banana text-black hover:bg-banana-light' : 'bg-[#3a3a3c] text-white/30 cursor-not-allowed'
              }`}
              aria-label="Send"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
