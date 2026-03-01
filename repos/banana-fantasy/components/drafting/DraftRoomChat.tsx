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

// Trash talk messages for simulation
const TRASH_TALK = [
  "Let's gooo!",
  "KC QB is mine, don't even try",
  "Who's taking SF RB first?",
  "This is gonna be a good one",
  "GL everyone",
  "Ready to dominate",
  "First timer here, be gentle lol",
  "Anyone else get Jackpot before?",
  "That pick was bold",
  "Interesting strategy...",
  "Stealing that one from ya",
  "RIP to whoever gets stuck with NE",
  "My sleeper pick is gonna hit",
  "Trust the process",
  "gg",
  "nice pick",
  "I wanted that one",
  "This draft is stacked",
  "Going contrarian here",
  "Fade the chalk",
];

const PLAYER_NAMES = ['GridironKing', 'TouchdownTitan', 'Diamond', 'MoonBoi', 'BlitzMaster', 'EndZoneKing', 'Holder', 'Gridiron', 'DraftKing'];

interface DraftRoomChatProps {
  playerCount: number;
  phase: 'filling' | 'pre-spin' | 'countdown' | 'spinning' | 'result' | 'drafting' | 'loading' | 'completed';
  username?: string;
}

export function DraftRoomChat({ playerCount, phase, username = 'You' }: DraftRoomChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isMuted, setIsMuted] = useState(true);
  const [isDeafened, setIsDeafened] = useState(false);
  const [showVoicePanel, setShowVoicePanel] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const lastPlayerCountRef = useRef(playerCount);
  const isCollapsedRef = useRef(isCollapsed);

  // Keep ref in sync
  useEffect(() => {
    isCollapsedRef.current = isCollapsed;
  }, [isCollapsed]);

  // Voice participants (simulated)
  const [voiceParticipants, setVoiceParticipants] = useState<VoiceParticipant[]>([
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

  // Simulate players joining during filling
  useEffect(() => {
    if (phase === 'filling' && playerCount > lastPlayerCountRef.current) {
      const newPlayerName = PLAYER_NAMES[playerCount - 2] || `Player${playerCount}`;

      // Add to voice participants
      setVoiceParticipants(prev => [
        ...prev,
        { id: `p${playerCount}`, name: newPlayerName, isMuted: Math.random() > 0.3, isSpeaking: false, isYou: false }
      ]);

      // Sometimes the new player says something
      if (Math.random() > 0.5) {
        setTimeout(() => {
          const greetings = ["hey", "yo", "let's go", "sup", "ready!", "GL all"];
          const msg: ChatMessage = {
            id: `msg-${Date.now()}`,
            sender: newPlayerName,
            text: greetings[Math.floor(Math.random() * greetings.length)],
            isYou: false,
            timestamp: Date.now(),
          };
          setMessages(prev => [...prev, msg]);
          if (isCollapsedRef.current) setUnreadCount(c => c + 1);
        }, 500 + Math.random() * 1500);
      }
    }
    lastPlayerCountRef.current = playerCount;
  }, [playerCount, phase]);

  // Simulate random chat during drafting
  useEffect(() => {
    if (phase !== 'drafting') return;

    const interval = setInterval(() => {
      if (Math.random() > 0.7) {
        const sender = PLAYER_NAMES[Math.floor(Math.random() * PLAYER_NAMES.length)];
        const text = TRASH_TALK[Math.floor(Math.random() * TRASH_TALK.length)];
        const msg: ChatMessage = {
          id: `msg-${Date.now()}-${Math.random()}`,
          sender,
          text,
          isYou: false,
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev.slice(-50), msg]); // Keep last 50 messages
        if (isCollapsedRef.current) setUnreadCount(c => c + 1);
      }
    }, 3000 + Math.random() * 5000);

    return () => clearInterval(interval);
  }, [phase]);

  // Simulate voice activity
  useEffect(() => {
    if (!showVoicePanel) return;

    const interval = setInterval(() => {
      setVoiceParticipants(prev => prev.map(p => ({
        ...p,
        isSpeaking: !p.isMuted && !p.isYou && Math.random() > 0.7
      })));
    }, 500);

    return () => clearInterval(interval);
  }, [showVoicePanel]);

  const sendMessage = () => {
    if (!inputValue.trim()) return;

    const msg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: username,
      text: inputValue.trim(),
      isYou: true,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, msg]);
    setInputValue('');
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
                disabled={!inputValue.trim()}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                  inputValue.trim()
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
