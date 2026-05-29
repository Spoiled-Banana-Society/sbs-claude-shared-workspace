'use client';

import React, { useState, useEffect, useRef } from 'react';
import { UserPopover } from '@/components/social/UserPopover';

interface ChatMessage {
  id: string;
  sender: string;
  pfpUrl?: string;
  text: string;
  walletAddress?: string;
  isYou: boolean;
  isSystem?: boolean;
  timestamp: number;
}

interface DraftRoomChatProps {
  playerCount: number;
  phase: 'filling' | 'pre-spin' | 'countdown' | 'spinning' | 'result' | 'drafting' | 'loading' | 'completed';
  username?: string;
  draftId?: string;
  walletAddress?: string;
}

export function DraftRoomChat({
  playerCount: _playerCount,
  phase: _phase,
  username = 'You',
  draftId,
  walletAddress,
}: DraftRoomChatProps) {
  const cacheKey = draftId ? `chat:${draftId}` : null;
  // Seed from sessionStorage so a full page reload renders the last known
  // messages instantly. The poll below will refresh from the server on next
  // tick. Keyed by draftId so leaving + rejoining the same draft restores
  // its history immediately, while a different draft starts clean.
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (typeof window === 'undefined' || !cacheKey) return [];
    try {
      const raw = sessionStorage.getItem(cacheKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as ChatMessage[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const myWallet = (walletAddress || '').toLowerCase();

  // Persist messages to sessionStorage so re-mounts and reloads don't blink
  // empty. SessionStorage (not localStorage) so messages don't outlive the
  // tab — cleaner privacy default and bounds storage growth.
  useEffect(() => {
    if (!cacheKey) return;
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify(messages));
    } catch {
      // quota / serialization — non-fatal
    }
  }, [messages, cacheKey]);

  // Poll the chat API for this draft. We can't subscribe directly to RTDB
  // from the browser because the Privy-authenticated client is anonymous to
  // Firebase, and staging rules deny anonymous reads on /drafts/*/chat. The
  // server route reads via Admin SDK and proxies the result.
  const lastSeenIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!draftId) return;
    let cancelled = false;

    const fetchOnce = async () => {
      try {
        const res = await fetch(`/api/chat/${encodeURIComponent(draftId)}`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          messages?: Array<{
            id: string;
            walletAddress: string;
            username: string;
            pfpUrl?: string;
            text: string;
            timestamp: number;
          }>;
        };
        if (cancelled || !Array.isArray(data.messages)) return;
        const next = data.messages.map((r) => ({
          id: r.id,
          sender: r.username || r.walletAddress.slice(0, 6),
          pfpUrl: r.pfpUrl,
          text: r.text,
          walletAddress: r.walletAddress,
          isYou: !!myWallet && r.walletAddress.toLowerCase() === myWallet,
          timestamp: r.timestamp,
        }));
        if (next.length) lastSeenIdRef.current = next[next.length - 1].id;
        setMessages(next);
      } catch {
        // network blip — let next tick retry
      }
    };

    fetchOnce();
    const id = setInterval(fetchOnce, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, [draftId, myWallet]);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom on new messages (only within chat container, not the page)
  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async () => {
    const text = inputValue.trim();
    if (!text || isSending) return;
    if (!draftId || !walletAddress) {
      console.warn('[DraftRoomChat] cannot send: missing draftId or walletAddress');
      return;
    }
    setIsSending(true);
    setInputValue('');
    try {
      const res = await fetch(`/api/chat/${encodeURIComponent(draftId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress, username, text }),
      });
      if (!res.ok) throw new Error(`send failed (${res.status})`);
    } catch (err) {
      console.warn('[DraftRoomChat] send failed:', err);
      setInputValue(text); // restore so user can retry
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Group consecutive messages from same sender
  const groupedMessages = messages.reduce((acc: (ChatMessage & { isFirstInGroup: boolean; isLastInGroup: boolean })[], msg, idx) => {
    const prevMsg = messages[idx - 1];
    const nextMsg = messages[idx + 1];
    const isFirstInGroup = !prevMsg || prevMsg.sender !== msg.sender || prevMsg.isSystem !== msg.isSystem;
    const isLastInGroup = !nextMsg || nextMsg.sender !== msg.sender || nextMsg.isSystem !== msg.isSystem;
    acc.push({ ...msg, isFirstInGroup, isLastInGroup });
    return acc;
  }, []);

  return (
    <div className="w-full max-w-[400px] mx-auto flex-1 flex flex-col bg-[#1c1c1e] rounded-lg">
      {/* Header with tabs - iOS style */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <span className="px-1 text-xs font-medium text-white">Chat</span>
      </div>

      {/* Chat Panel - iMessage style */}
      {/* Messages */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
            {messages.length === 0 && (
              <p className="text-white/30 text-xs text-center py-4">Start a conversation...</p>
            )}
            {groupedMessages.map((msg) => (
              <div key={msg.id}>
                {msg.isSystem ? (
                  <div className="text-center py-1">
                    <span className="text-white/40 text-[10px]">{msg.text}</span>
                  </div>
                ) : (
                  <div className={`flex flex-col ${msg.isYou ? 'items-end' : 'items-start'}`}>
                    {/* Show sender name only for first message in group from others.
                        Clickable — opens UserPopover with friend actions. */}
                    {msg.isFirstInGroup && !msg.isYou && (
                      msg.walletAddress ? (
                        <UserPopover walletAddress={msg.walletAddress} username={msg.sender} pfpUrl={msg.pfpUrl}>
                          <span className="text-[10px] text-white/40 ml-3 mb-0.5 hover:text-white hover:underline cursor-pointer">{msg.sender}</span>
                        </UserPopover>
                      ) : (
                        <span className="text-[10px] text-white/40 ml-3 mb-0.5">{msg.sender}</span>
                      )
                    )}
                    <div
                      className={`
                        px-3 py-1.5 max-w-[85%] text-[13px] leading-tight
                        ${msg.isYou
                          ? 'bg-[#007AFF] text-white'
                          : 'bg-[#3a3a3c] text-white'
                        }
                        ${msg.isYou
                          ? msg.isFirstInGroup && msg.isLastInGroup
                            ? 'rounded-[18px]'
                            : msg.isFirstInGroup
                              ? 'rounded-t-[18px] rounded-bl-[18px] rounded-br-[4px]'
                              : msg.isLastInGroup
                                ? 'rounded-b-[18px] rounded-tl-[18px] rounded-tr-[4px]'
                                : 'rounded-l-[18px] rounded-r-[4px]'
                          : msg.isFirstInGroup && msg.isLastInGroup
                            ? 'rounded-[18px]'
                            : msg.isFirstInGroup
                              ? 'rounded-t-[18px] rounded-br-[18px] rounded-bl-[4px]'
                              : msg.isLastInGroup
                                ? 'rounded-b-[18px] rounded-tr-[18px] rounded-tl-[4px]'
                                : 'rounded-r-[18px] rounded-l-[4px]'
                        }
                      `}
                    >
                      {msg.text}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Input - iMessage style */}
          <div className="p-2 border-t border-white/10">
            <div className="flex items-center gap-2 bg-[#2c2c2e] rounded-full px-1 py-1">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="iMessage"
                className="flex-1 bg-transparent px-3 py-1 text-sm text-white placeholder-white/30 focus:outline-none"
              />
              <button
                onClick={sendMessage}
                disabled={!inputValue.trim() || isSending || !draftId || !walletAddress}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                  inputValue.trim() && !isSending && draftId && walletAddress
                    ? 'bg-[#007AFF] text-white'
                    : 'bg-[#3a3a3c] text-white/30'
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              </button>
            </div>
          </div>
    </div>
  );
}
