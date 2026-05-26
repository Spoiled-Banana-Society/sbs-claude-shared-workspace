'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useDmInbox, useDmThread, type DmThreadView, type PublicUser } from '@/hooks/useDms';

type InboxTab = 'messages' | 'requests';

function shortWallet(w: string): string {
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
}

function Avatar({ user, size = 'md' }: { user: PublicUser; size?: 'sm' | 'md' | 'lg' }) {
  const px = size === 'sm' ? 'w-8 h-8' : size === 'lg' ? 'w-12 h-12' : 'w-10 h-10';
  const text = size === 'sm' ? 'text-xs' : size === 'lg' ? 'text-base' : 'text-sm';
  if (user.profilePicture) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={user.profilePicture} alt={user.username} className={`${px} rounded-full object-cover bg-white/5 border border-white/10 flex-shrink-0`} />;
  }
  const initial = (user.username || user.walletAddress).slice(0, 1).toUpperCase();
  return (
    <div className={`${px} rounded-full flex-shrink-0 bg-banana/20 border border-banana/30 flex items-center justify-center text-banana font-bold ${text}`}>
      {initial}
    </div>
  );
}

function ThreadRow({ view, active, onClick }: { view: DmThreadView; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
        active ? 'bg-banana/10' : 'hover:bg-white/[0.04]'
      }`}
    >
      <Avatar user={view.other} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className={`text-sm font-medium truncate ${active ? 'text-banana' : 'text-white'}`}>{view.other.username}</p>
          {view.unreadCount > 0 && (
            <span className="w-2 h-2 rounded-full bg-banana flex-shrink-0" aria-label="unread" />
          )}
        </div>
        <p className="text-white/40 text-xs truncate">{view.lastMessagePreview || 'No messages yet'}</p>
      </div>
    </button>
  );
}

function ThreadView({ otherWallet, onBack }: { otherWallet: string; onBack: () => void }) {
  const { user } = useAuth();
  const myWallet = (user?.walletAddress || '').toLowerCase();
  const { messages, other, permission, loading, send, accept } = useDmThread(otherWallet);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [messages.length]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isSending) return;
    setIsSending(true);
    setInput('');
    const r = await send(text);
    setIsSending(false);
    if (!r.ok) {
      setFeedback(r.error || 'Failed to send');
      setInput(text);
      setTimeout(() => setFeedback(null), 3000);
    }
  };

  const handleAccept = async () => {
    const r = await accept();
    if (!r.ok) {
      setFeedback(r.error || 'Failed to accept');
      setTimeout(() => setFeedback(null), 3000);
    }
  };

  // Compose box state based on server-reported permission.
  // - 'send' or 'reply' → normal input, send goes through (reply also accepts).
  // - 'request' → first message creates a pending request (input enabled, with notice).
  // - 'wait' → already sent a request; locked until they accept.
  const composeMode: 'send' | 'request' | 'wait' = permission === 'wait' ? 'wait' : permission === 'request' ? 'request' : 'send';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
        <button onClick={onBack} className="md:hidden text-white/40 hover:text-white" aria-label="Back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        {other && <Avatar user={other} size="sm" />}
        <div className="flex-1 min-w-0">
          <p className="text-white font-medium truncate">{other?.username || shortWallet(otherWallet)}</p>
          <p className="text-white/40 text-[10px] font-mono truncate">{shortWallet(otherWallet)}</p>
        </div>
        {permission === 'reply' && (
          <button
            onClick={handleAccept}
            className="px-3 py-1.5 rounded-lg bg-banana text-black text-xs font-bold hover:bg-banana-light"
          >
            Accept request
          </button>
        )}
      </div>

      {/* Pending banner */}
      {permission === 'wait' && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-white/60 text-xs text-center">
          Request sent. Waiting for them to approve.
        </div>
      )}
      {permission === 'reply' && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-banana/10 border border-banana/30 text-banana/90 text-xs text-center">
          New message request — replying will accept.
        </div>
      )}

      {/* Messages */}
      <div ref={containerRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        {loading && messages.length === 0 && <p className="text-white/30 text-xs text-center py-6">Loading…</p>}
        {!loading && messages.length === 0 && (
          <p className="text-white/30 text-xs text-center py-6">
            {permission === 'request' ? 'No messages yet — your first message will go to their requests.' : 'No messages yet.'}
          </p>
        )}
        {messages.map((msg) => {
          const isYou = msg.walletAddress.toLowerCase() === myWallet;
          return (
            <div key={msg.id} className={`flex ${isYou ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] px-3 py-1.5 rounded-2xl text-[13px] leading-tight break-words whitespace-pre-wrap ${
                isYou ? 'bg-[#007AFF] text-white rounded-br-[4px]' : 'bg-[#3a3a3c] text-white rounded-bl-[4px]'
              }`}>
                {msg.text}
              </div>
            </div>
          );
        })}
      </div>

      {/* Compose */}
      <div className="p-3 border-t border-white/[0.06]">
        {feedback && (
          <p className="text-red-400 text-xs mb-2 text-center">{feedback}</p>
        )}
        {composeMode === 'wait' ? (
          <div className="bg-white/[0.04] border border-white/[0.06] text-white/40 text-sm rounded-lg px-3 py-2 text-center">
            Can&apos;t send more until they accept.
          </div>
        ) : (
          <div className="flex items-center gap-2 bg-[#2c2c2e] rounded-full px-1 py-1">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
              placeholder={composeMode === 'request' ? 'Message request…' : 'iMessage'}
              maxLength={2000}
              className="flex-1 bg-transparent px-3 py-1.5 text-sm text-white placeholder-white/30 focus:outline-none"
            />
            <button
              onClick={() => void handleSend()}
              disabled={!input.trim() || isSending}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                input.trim() && !isSending ? 'bg-banana text-black hover:bg-banana-light' : 'bg-[#3a3a3c] text-white/30 cursor-not-allowed'
              }`}
              aria-label="Send"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function MessagesView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoggedIn } = useAuth();
  const enabled = !!user?.walletAddress && isLoggedIn;
  const { inbox, loading } = useDmInbox(enabled);
  const [tab, setTab] = useState<InboxTab>('messages');
  const [selectedWallet, setSelectedWallet] = useState<string | null>(searchParams?.get('with') || null);

  // Sync the URL ?with=… so deep-linking to a thread works (UserPopover → "Send Message" navigates here).
  useEffect(() => {
    const w = searchParams?.get('with') || null;
    if (w && w !== selectedWallet) setSelectedWallet(w);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const setSelected = (wallet: string | null) => {
    setSelectedWallet(wallet);
    const url = wallet ? `/messages?with=${encodeURIComponent(wallet)}` : '/messages';
    router.replace(url, { scroll: false });
  };

  if (!enabled) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 text-center">
        <h1 className="text-white text-2xl font-semibold mb-2">Messages</h1>
        <p className="text-white/60">Sign in to view your messages.</p>
      </div>
    );
  }

  const visibleList = tab === 'messages' ? inbox.messages : inbox.requests;
  const requestCount = inbox.requests.length;
  const sentCount = inbox.sent.length;

  return (
    <div className="max-w-5xl mx-auto h-[calc(100vh-7rem)] sm:h-[calc(100vh-9rem)] px-2 sm:px-4 py-4">
      <div className="h-full flex bg-[#0f0f12] border border-white/[0.06] rounded-2xl overflow-hidden">
        {/* Sidebar */}
        <aside className={`flex flex-col w-full md:w-80 border-r border-white/[0.06] ${selectedWallet ? 'hidden md:flex' : 'flex'}`}>
          <div className="px-4 py-4 border-b border-white/[0.06]">
            <h1 className="text-white text-lg font-semibold">Messages</h1>
          </div>
          <div className="flex border-b border-white/[0.06]">
            <button
              onClick={() => setTab('messages')}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors relative ${tab === 'messages' ? 'text-banana' : 'text-white/40 hover:text-white/70'}`}
            >
              Messages
              {tab === 'messages' && <div className="absolute bottom-0 left-3 right-3 h-0.5 bg-banana rounded-full" />}
            </button>
            <button
              onClick={() => setTab('requests')}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors relative ${tab === 'requests' ? 'text-banana' : 'text-white/40 hover:text-white/70'}`}
            >
              Requests{requestCount > 0 && <span className="ml-1 text-banana">({requestCount})</span>}
              {tab === 'requests' && <div className="absolute bottom-0 left-3 right-3 h-0.5 bg-banana rounded-full" />}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading && visibleList.length === 0 && (
              <p className="text-white/30 text-xs text-center py-6">Loading…</p>
            )}
            {!loading && visibleList.length === 0 && (
              <p className="text-white/30 text-xs text-center py-8 px-4">
                {tab === 'messages' ? 'No active conversations yet.' : 'No incoming requests.'}
              </p>
            )}
            {visibleList.map((view) => (
              <ThreadRow
                key={view.threadId}
                view={view}
                active={selectedWallet?.toLowerCase() === view.other.walletAddress.toLowerCase()}
                onClick={() => setSelected(view.other.walletAddress)}
              />
            ))}

            {/* Sent-pending callout at the bottom of Messages tab so you can see who you've reached out to. */}
            {tab === 'messages' && sentCount > 0 && (
              <div className="px-3 pt-4 pb-2">
                <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1">Sent requests</p>
              </div>
            )}
            {tab === 'messages' && inbox.sent.map((view) => (
              <ThreadRow
                key={view.threadId}
                view={view}
                active={selectedWallet?.toLowerCase() === view.other.walletAddress.toLowerCase()}
                onClick={() => setSelected(view.other.walletAddress)}
              />
            ))}
          </div>
        </aside>

        {/* Thread pane */}
        <main className={`flex-1 ${selectedWallet ? 'flex' : 'hidden md:flex'} flex-col`}>
          {selectedWallet ? (
            <ThreadView otherWallet={selectedWallet} onBack={() => setSelected(null)} />
          ) : (
            <div className="flex-1 flex items-center justify-center px-6 text-center">
              <div>
                <p className="text-white/40 text-sm">Select a conversation, or open a user&apos;s profile from chat to start one.</p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
