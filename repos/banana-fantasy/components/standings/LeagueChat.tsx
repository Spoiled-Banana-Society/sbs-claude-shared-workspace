'use client';

import React, { useEffect, useRef, useState } from 'react';
import { markChatRead } from '@/hooks/useUnreadChatCount';

interface ChatMessage {
  id: string;
  sender: string;
  walletAddress: string;
  text: string;
  isYou: boolean;
  timestamp: number;
}

interface LeagueChatProps {
  draftId: string;
  walletAddress?: string;
  username?: string;
}

const POLL_MS = 2000;
const HISTORY_LIMIT = 200;

export function LeagueChat({ draftId, walletAddress, username = 'You' }: LeagueChatProps) {
  const myWallet = (walletAddress || '').toLowerCase();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  // Mark as read on mount and whenever new messages arrive while the panel
  // is mounted. The mount alone covers the initial open; the update covers
  // a user staying on the chat tab while peers send new messages.
  useEffect(() => {
    if (!walletAddress) return;
    markChatRead(walletAddress, draftId);
  }, [walletAddress, draftId, messages.length]);

  // Poll for new messages every 2s. Matches DraftRoomChat behavior.
  useEffect(() => {
    let cancelled = false;
    const fetchOnce = async () => {
      try {
        const res = await fetch(`/api/chat/${encodeURIComponent(draftId)}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as {
          messages?: Array<{
            id: string;
            walletAddress: string;
            username: string;
            text: string;
            timestamp: number;
          }>;
        };
        if (cancelled || !Array.isArray(data.messages)) return;
        setMessages(data.messages.slice(-HISTORY_LIMIT).map((r) => ({
          id: r.id,
          sender: r.username || r.walletAddress.slice(0, 6),
          walletAddress: r.walletAddress,
          text: r.text,
          isYou: !!myWallet && r.walletAddress.toLowerCase() === myWallet,
          timestamp: r.timestamp,
        })));
      } catch {
        // network blip — let next tick retry
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void fetchOnce();
    const id = setInterval(fetchOnce, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [draftId, myWallet]);

  // Scroll to bottom on new messages.
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages]);

  const send = async () => {
    const text = inputValue.trim();
    if (!text || isSending || !walletAddress) return;
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
      console.warn('[LeagueChat] send failed:', err);
      setInputValue(text); // restore for retry
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

  // Group consecutive messages from same sender for iMessage-style bubbles.
  const grouped = messages.reduce((acc: (ChatMessage & { isFirstInGroup: boolean; isLastInGroup: boolean })[], msg, idx) => {
    const prev = messages[idx - 1];
    const next = messages[idx + 1];
    acc.push({
      ...msg,
      isFirstInGroup: !prev || prev.sender !== msg.sender,
      isLastInGroup: !next || next.sender !== msg.sender,
    });
    return acc;
  }, []);

  const canSend = !!walletAddress && !isSending;

  return (
    <div className="flex flex-col h-[60vh] sm:h-[480px] bg-[#1c1c1e]/40 rounded-xl border border-white/[0.06] overflow-hidden">
      {/* Messages */}
      <div ref={containerRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
        {isLoading && messages.length === 0 && (
          <p className="text-white/30 text-xs text-center py-8">Loading chat…</p>
        )}
        {!isLoading && messages.length === 0 && (
          <div className="text-center py-8">
            <p className="text-white/40 text-sm">No messages yet.</p>
            <p className="text-white/30 text-xs mt-1">Say hi to your league!</p>
          </div>
        )}
        {grouped.map((msg) => (
          <div key={msg.id} className={`flex flex-col ${msg.isYou ? 'items-end' : 'items-start'}`}>
            {msg.isFirstInGroup && !msg.isYou && (
              <span className="text-[10px] text-white/40 ml-3 mb-0.5">{msg.sender}</span>
            )}
            <div
              className={`
                px-3 py-1.5 max-w-[85%] text-[13px] leading-tight break-words
                ${msg.isYou ? 'bg-[#007AFF] text-white' : 'bg-[#3a3a3c] text-white'}
                ${
                  msg.isYou
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
        ))}
      </div>

      {/* Input */}
      <div className="p-2 border-t border-white/[0.06]">
        <div className="flex items-center gap-2 bg-[#2c2c2e] rounded-full px-1 py-1">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={walletAddress ? 'Message' : 'Sign in to chat'}
            disabled={!walletAddress}
            className="flex-1 bg-transparent px-3 py-1 text-sm text-white placeholder-white/30 focus:outline-none disabled:cursor-not-allowed"
          />
          <button
            onClick={() => void send()}
            disabled={!inputValue.trim() || !canSend}
            className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
              inputValue.trim() && canSend ? 'bg-[#007AFF] text-white' : 'bg-[#3a3a3c] text-white/30'
            }`}
            aria-label="Send"
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
