'use client';

import React, { useState, useEffect, useRef } from 'react';

interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  isYou: boolean;
  isSystem?: boolean;
  timestamp: number;
}

interface VoiceParticipant {
  id: string;
  name: string;
  isMuted: boolean;
  isSpeaking: boolean;
  isYou: boolean;
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
            text: string;
            timestamp: number;
          }>;
        };
        if (cancelled || !Array.isArray(data.messages)) return;
        const next = data.messages.map((r) => ({
          id: r.id,
          sender: r.username || r.walletAddress.slice(0, 6),
          text: r.text,
          isYou: !!myWallet && r.walletAddress.toLowerCase() === myWallet,
          timestamp: r.timestamp,
        }));
        setMessages((prev) => {
          if (isCollapsedRef.current && next.length > prev.length) {
            const known = new Set(prev.map((m) => m.id));
            const newFromOthers = next.filter((m) => !known.has(m.id) && !m.isYou);
            if (newFromOthers.length > 0) {
              setUnreadCount((c) => c + newFromOthers.length);
            }
          }
          if (next.length) lastSeenIdRef.current = next[next.length - 1].id;
          return next;
        });
      } catch {
        // network blip — let next tick retry
      }
    };

    fetchOnce();
    const id = setInterval(fetchOnce, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, [draftId, myWallet]);
  const [isMuted, setIsMuted] = useState(true);
  const [isDeafened, setIsDeafened] = useState(false);
  const [showVoicePanel, setShowVoicePanel] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isCollapsedRef = useRef(isCollapsed);

  // Keep ref in sync
  useEffect(() => {
    isCollapsedRef.current = isCollapsed;
  }, [isCollapsed]);

  // Voice participants (simulated)
  const [voiceParticipants] = useState<VoiceParticipant[]>([
    { id: 'you', name: username, isMuted: true, isSpeaking: false, isYou: true },
  ]);

  // Scroll to bottom on new messages (only within chat container, not the page)
  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // Clear unread when expanded
  useEffect(() => {
    if (!isCollapsed) {
      setUnreadCount(0);
    }
  }, [isCollapsed]);


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

  // Collapsed state - just a button
  if (isCollapsed) {
    return (
      <div className="sticky top-0 flex flex-col items-center py-2 px-1.5 bg-[#1c1c1e] border-l border-white/10 flex-shrink-0 rounded-bl-lg">
        <button
          onClick={() => setIsCollapsed(false)}
          className="relative w-10 h-10 rounded-full bg-[#2c2c2e] hover:bg-[#3a3a3c] flex items-center justify-center transition-all group"
          title="Open chat"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/60 group-hover:text-white">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-[#ff3b30] text-white text-xs font-bold rounded-full flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
        <button
          onClick={() => { setIsCollapsed(false); setShowVoicePanel(true); }}
          className="mt-2 w-10 h-10 rounded-full bg-[#2c2c2e] hover:bg-[#3a3a3c] flex items-center justify-center transition-all group"
          title="Open voice chat"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/60 group-hover:text-white">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[400px] mx-auto flex-1 flex flex-col bg-[#1c1c1e] rounded-lg">
      {/* Header with tabs - iOS style */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <div className="flex items-center gap-1 bg-[#2c2c2e] rounded-lg p-0.5">
          <button
            onClick={() => setShowVoicePanel(false)}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
              !showVoicePanel ? 'bg-[#3a3a3c] text-white' : 'text-white/50 hover:text-white/70'
            }`}
          >
            Chat
          </button>
          <button
            onClick={() => setShowVoicePanel(true)}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-all flex items-center gap-1 ${
              showVoicePanel ? 'bg-[#3a3a3c] text-white' : 'text-white/50 hover:text-white/70'
            }`}
          >
            Voice
          </button>
        </div>
        <button
          onClick={() => setIsCollapsed(true)}
          className="w-6 h-6 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all"
          title="Collapse"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* Chat Panel - iMessage style */}
      {!showVoicePanel && (
        <>
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
                    {/* Show sender name only for first message in group from others */}
                    {msg.isFirstInGroup && !msg.isYou && (
                      <span className="text-[10px] text-white/40 ml-3 mb-0.5">{msg.sender}</span>
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
        </>
      )}

      {/* Voice Panel - also styled to match */}
      {showVoicePanel && (
        <>
          {/* Voice Controls */}
          <div className="p-3 border-b border-white/10">
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => setIsMuted(!isMuted)}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
                  isMuted ? 'bg-[#ff3b30]' : 'bg-[#34c759]'
                }`}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                  {isMuted ? (
                    <>
                      <line x1="1" y1="1" x2="23" y2="23" />
                      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                    </>
                  ) : (
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  )}
                </svg>
              </button>
              <button
                onClick={() => setIsDeafened(!isDeafened)}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
                  isDeafened ? 'bg-[#ff3b30]' : 'bg-[#2c2c2e]'
                }`}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  {isDeafened && <line x1="23" y1="9" x2="17" y2="15" />}
                </svg>
              </button>
            </div>
            <p className="text-center text-xs text-white/50 mt-2">
              {isMuted ? 'Muted' : 'Unmuted'}
            </p>
          </div>

          {/* Participants */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            <p className="text-[10px] text-white/40 px-2 mb-2">
              {voiceParticipants.filter(p => !p.isMuted).length} of {voiceParticipants.length} unmuted
            </p>
            {voiceParticipants.map((participant) => (
              <div
                key={participant.id}
                className={`flex items-center gap-3 px-3 py-2 rounded-xl transition-all ${
                  participant.isSpeaking ? 'bg-[#34c759]/20 ring-2 ring-[#34c759]/50' : 'bg-[#2c2c2e]'
                }`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                  participant.isYou ? 'bg-[#007AFF]' : 'bg-[#3a3a3c]'
                }`}>
                  {participant.name.charAt(0).toUpperCase()}
                </div>
                <span className={`text-sm font-medium truncate flex-1 ${
                  participant.isYou ? 'text-[#007AFF]' : 'text-white'
                }`}>
                  {participant.name}
                  {participant.isYou && ' (you)'}
                </span>
                {participant.isMuted && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[#ff3b30] flex-shrink-0">
                    <line x1="1" y1="1" x2="23" y2="23" />
                    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                  </svg>
                )}
                {participant.isSpeaking && (
                  <div className="flex gap-0.5">
                    <div className="w-1 h-3 bg-[#34c759] rounded-full animate-pulse" />
                    <div className="w-1 h-4 bg-[#34c759] rounded-full animate-pulse delay-75" />
                    <div className="w-1 h-2 bg-[#34c759] rounded-full animate-pulse delay-150" />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Voice disclaimer */}
          <div className="p-3 border-t border-white/10">
            <p className="text-[11px] text-white/40 text-center">Voice chat is in beta</p>
          </div>
        </>
      )}
    </div>
  );
}
