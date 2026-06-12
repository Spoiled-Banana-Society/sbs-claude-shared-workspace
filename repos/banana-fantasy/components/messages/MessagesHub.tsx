'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { useAuth } from '@/hooks/useAuth';
import { useBlockedUsers, useDmInbox, useDmThread, type DmThreadView, type PublicUser } from '@/hooks/useDms';
import { AvatarWithBadge } from '@/components/badges/AvatarWithBadge';
import { useFriends } from '@/hooks/useFriends';
import { useFriendSuggestions } from '@/hooks/useFriendSuggestions';
import { usePresenceMap } from '@/hooks/usePresence';
import { GlobalChat } from '@/components/chat/GlobalChat';
import { getTruncatedAccountName } from '@/utils/helpers';

/**
 * Unified messages hub: #general chat + Friends + DMs + Requests in one page.
 *
 * URL state via ?view=
 *   ?view=general              → global chat
 *   ?view=friends              → friends panel
 *   ?view=requests             → pending DM requests
 *   ?view=dm&with=0x…          → individual thread
 *
 * On mobile, sidebar and main pane toggle: a selection hides the sidebar; the
 * back arrow returns to it.
 */

type View =
  | { kind: 'menu' } // mobile root: the Messages list itself (desktop treats it as general)
  | { kind: 'general' }
  | { kind: 'friends' }
  | { kind: 'all-users' }
  | { kind: 'requests' }
  | { kind: 'blocked' }
  | { kind: 'dm'; wallet: string };

function Avatar({ user, size = 'sm' }: { user: PublicUser; size?: 'sm' | 'md' }) {
  const px = size === 'sm' ? 32 : 40;
  const { isOnline } = usePresenceMap();
  const online = isOnline(user.walletAddress);
  return (
    <div className="relative flex-shrink-0">
      <AvatarWithBadge
        imageUrl={user.profilePicture}
        alt={user.username}
        size={px}
        equippedBadge={user.equippedBadge ?? null}
        useNextImage={false}
      />
      {online && (
        // Quiet presence dot — green only when online; absence = offline.
        <span
          title="Online"
          className="absolute rounded-full"
          style={{
            width: Math.max(8, Math.round(px * 0.28)),
            height: Math.max(8, Math.round(px * 0.28)),
            right: -1,
            bottom: -1,
            background: '#22c55e',
            border: '2px solid #111114',
          }}
        />
      )}
    </div>
  );
}

// ─── Thread pane ────────────────────────────────────────────────────────────

function ThreadPane({ otherWallet, onBack, onBlockChange }: { otherWallet: string; onBack: () => void; onBlockChange?: () => void }) {
  const { user } = useAuth();
  const myWallet = (user?.walletAddress || '').toLowerCase();
  const { messages, other, permission, block, loading, send, accept, block_: blockUser, unblock } = useDmThread(otherWallet);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

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

  const handleBlock = async () => {
    setMenuOpen(false);
    const r = await blockUser();
    if (!r.ok) {
      setFeedback(r.error || 'Failed to block');
      setTimeout(() => setFeedback(null), 3000);
    } else {
      onBlockChange?.(); // drop the thread from the inbox list right away
      setFeedback('User blocked');
      setTimeout(() => setFeedback(null), 2000);
    }
  };

  const handleUnblock = async () => {
    setMenuOpen(false);
    const r = await unblock();
    if (!r.ok) {
      setFeedback(r.error || 'Failed to unblock');
      setTimeout(() => setFeedback(null), 3000);
    } else {
      onBlockChange?.(); // restore the thread + history in the inbox list
      setFeedback('User unblocked — chat restored');
      setTimeout(() => setFeedback(null), 2000);
    }
  };

  const isBlocked = block.myBlock || block.theirBlock;
  const composeMode: 'send' | 'request' | 'wait' | 'blocked' = isBlocked
    ? 'blocked'
    : permission === 'wait'
      ? 'wait'
      : permission === 'request'
        ? 'request'
        : 'send';

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] flex-shrink-0">
        <button onClick={onBack} className="md:hidden text-white/40 hover:text-white" aria-label="Back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        {other && <Avatar user={other} />}
        <div className="flex-1 min-w-0">
          <p className="text-white font-medium truncate">{getTruncatedAccountName(other?.username || '', otherWallet)}</p>
        </div>
        {permission === 'reply' && !isBlocked && (
          <button onClick={handleAccept} className="px-3 py-1.5 rounded-lg bg-banana text-black text-xs font-bold hover:bg-banana-light">
            Accept request
          </button>
        )}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="w-8 h-8 rounded-full text-white/40 hover:text-white hover:bg-white/[0.06] flex items-center justify-center"
            aria-label="Thread options"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-9 z-20 min-w-[160px] rounded-lg bg-[#1c1c1e] border border-white/[0.08] shadow-lg py-1">
              {block.myBlock ? (
                <button
                  onClick={handleUnblock}
                  className="w-full text-left px-3 py-2 text-sm text-banana hover:bg-white/[0.06]"
                >
                  Unblock user
                </button>
              ) : (
                <button
                  onClick={handleBlock}
                  className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-400/10"
                >
                  Block user
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {block.myBlock && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs text-center">
          You&apos;ve blocked this user. Unblock to exchange messages.
        </div>
      )}
      {!block.myBlock && block.theirBlock && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-white/60 text-xs text-center">
          You can no longer message this user.
        </div>
      )}
      {!isBlocked && permission === 'wait' && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-white/60 text-xs text-center">
          Request sent. Waiting for them to approve.
        </div>
      )}
      {!isBlocked && permission === 'reply' && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-banana/10 border border-banana/30 text-banana/90 text-xs text-center">
          New message request — replying will accept.
        </div>
      )}

      <div ref={ref} className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
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

      <div className="p-3 border-t border-white/[0.06] flex-shrink-0">
        {feedback && <p className="text-red-400 text-xs mb-2 text-center">{feedback}</p>}
        {composeMode === 'blocked' ? (
          <div className="bg-white/[0.04] border border-white/[0.06] text-white/40 text-sm rounded-lg px-3 py-2 text-center">
            {block.myBlock ? 'Unblock to send messages.' : 'Messaging is unavailable.'}
          </div>
        ) : composeMode === 'wait' ? (
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
              placeholder={composeMode === 'request' ? 'Message request…' : 'Message'}
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

// ─── Friends pane (merged: search at top, friends list below) ───────────────

function FriendsPane({ onSelectDm, onBack }: { onSelectDm: (wallet: string) => void; onBack: () => void }) {
  const { user, isLoggedIn } = useAuth();
  const myWallet = (user?.walletAddress || '').toLowerCase();
  const enabled = !!user?.walletAddress && isLoggedIn;
  const { data, loading, accept, remove, sendRequest, search } = useFriends(enabled);
  const { suggestions, dismiss: dismissSuggestion } = useFriendSuggestions(enabled);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Search state — merged from the old Add Friend pane.
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PublicUser[]>([]);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef(search);
  useEffect(() => { searchRef.current = search; }, [search]);
  useEffect(() => {
    if (!q.trim()) { setResults([]); setSearching(false); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      const r = await searchRef.current(q);
      if (!cancelled) { setResults(r); setSearching(false); }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  const flash = (text: string) => {
    setFeedback(text);
    setTimeout(() => setFeedback(null), 2000);
  };

  const stateFor = (wallet: string): 'friend' | 'incoming' | 'outgoing' | 'none' => {
    const w = wallet.toLowerCase();
    if (data.friends.some((u) => u.walletAddress.toLowerCase() === w)) return 'friend';
    if (data.incoming.some((u) => u.walletAddress.toLowerCase() === w)) return 'incoming';
    if (data.outgoing.some((u) => u.walletAddress.toLowerCase() === w)) return 'outgoing';
    return 'none';
  };

  const isSearching = q.trim().length > 0;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] flex-shrink-0">
        <button onClick={onBack} className="md:hidden text-white/40 hover:text-white" aria-label="Back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <h2 className="text-white text-lg font-semibold flex-1">Friends</h2>
        <span className="text-white/40 text-xs">{data.friends.length} friend{data.friends.length === 1 ? '' : 's'}</span>
      </div>

      {/* Search bar at the top — replaces the old Add Friend pane. */}
      <div className="px-4 pt-4 pb-2 flex-shrink-0">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Add a friend — search username or paste wallet (0x…)"
          className="w-full bg-[#1c1c1e] border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-white/30 focus:outline-none focus:border-banana/50"
          maxLength={60}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {feedback && <p className="text-white/50 text-xs text-center mb-2">{feedback}</p>}

        {/* Search results — only shown while typing. */}
        {isSearching && (
          <section className="mb-4">
            <p className="text-white/40 text-[10px] uppercase tracking-wider mb-2 px-1">Search results</p>
            {searching && <p className="text-white/30 text-sm text-center py-4">Searching…</p>}
            {!searching && results.length === 0 && <p className="text-white/30 text-sm text-center py-4">No users found.</p>}
            <div className="space-y-1">
              {results.map((u) => {
                const state = stateFor(u.walletAddress);
                let action: React.ReactNode = null;
                if (u.walletAddress.toLowerCase() === myWallet) action = <span className="text-white/30 text-xs px-3 py-1.5">That&apos;s you</span>;
                else if (state === 'friend') action = <span className="text-green-400 text-xs px-3 py-1.5">Friends</span>;
                else if (state === 'incoming') action = (
                  <button onClick={async () => { const r = await accept(u.walletAddress); flash(r.ok ? 'Friend added' : r.error || 'Failed'); }} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-banana text-black hover:bg-banana-light">Accept</button>
                );
                else if (state === 'outgoing') action = <span className="text-white/40 text-xs px-3 py-1.5">Requested</span>;
                else action = (
                  <button onClick={async () => { const r = await sendRequest(u.walletAddress); flash(r.ok ? 'Request sent' : r.error || 'Failed'); }} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-banana text-black hover:bg-banana-light">Add Friend</button>
                );
                return (
                  <div key={u.walletAddress} className="flex items-center gap-3 px-2 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                    <Avatar user={u} />
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">{getTruncatedAccountName(u.username, u.walletAddress)}</p>
                    </div>
                    {action}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Hide the friends sections while searching to keep focus on results. */}
        {!isSearching && (
          <>
            {/* Suggested friends — people you recently drafted with. */}
            {suggestions.length > 0 && (
              <section className="mb-4">
                <p className="text-white/40 text-[10px] uppercase tracking-wider mb-2 px-1">Suggested friends</p>
                <div className="space-y-1">
                  {suggestions.map((u) => (
                    <div key={u.walletAddress} className="flex items-center gap-3 px-2 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                      <Avatar user={u} />
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium truncate">{getTruncatedAccountName(u.username, u.walletAddress)}</p>
                      </div>
                      <button
                        onClick={async () => {
                          dismissSuggestion(u.walletAddress);
                          const r = await sendRequest(u.walletAddress);
                          flash(r.ok ? 'Request sent' : r.error || 'Failed');
                        }}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-banana text-black hover:bg-banana-light"
                      >
                        Add Friend
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Incoming requests */}
            {data.incoming.length > 0 && (
              <section className="mb-4">
                <p className="text-white/40 text-[10px] uppercase tracking-wider mb-2 px-1">Incoming requests</p>
                <div className="space-y-1">
                  {data.incoming.map((u) => (
                    <div key={u.walletAddress} className="flex items-center gap-3 px-2 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                      <Avatar user={u} />
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium truncate">{getTruncatedAccountName(u.username, u.walletAddress)}</p>
                      </div>
                      <button
                        onClick={async () => { const r = await accept(u.walletAddress); flash(r.ok ? 'Friend added' : r.error || 'Failed'); }}
                        className="px-2.5 py-1 rounded-md bg-banana text-black text-xs font-bold hover:bg-banana-light"
                      >
                        Accept
                      </button>
                      <button
                        onClick={async () => { const r = await remove(u.walletAddress); flash(r.ok ? 'Rejected' : r.error || 'Failed'); }}
                        className="px-2.5 py-1 rounded-md text-white/40 hover:text-red-400 hover:bg-red-400/10 text-xs"
                      >
                        Reject
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Outgoing requests */}
            {data.outgoing.length > 0 && (
              <section className="mb-4">
                <p className="text-white/40 text-[10px] uppercase tracking-wider mb-2 px-1">Sent</p>
                <div className="space-y-1">
                  {data.outgoing.map((u) => (
                    <div key={u.walletAddress} className="flex items-center gap-3 px-2 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                      <Avatar user={u} />
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium truncate">{getTruncatedAccountName(u.username, u.walletAddress)}</p>
                      </div>
                      <button
                        onClick={async () => { const r = await remove(u.walletAddress); flash(r.ok ? 'Cancelled' : r.error || 'Failed'); }}
                        className="px-2.5 py-1 rounded-md text-white/40 hover:text-red-400 hover:bg-red-400/10 text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Friends */}
            <section>
              <p className="text-white/40 text-[10px] uppercase tracking-wider mb-2 px-1">All friends</p>
              {loading && data.friends.length === 0 && <p className="text-white/30 text-xs text-center py-6">Loading…</p>}
              {!loading && data.friends.length === 0 && <p className="text-white/30 text-xs text-center py-6">No friends yet. Search above to find someone.</p>}
              <div className="space-y-1">
                {data.friends.map((u) => (
                  <div key={u.walletAddress} className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-white/[0.04] transition-colors">
                    <Avatar user={u} />
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">{getTruncatedAccountName(u.username, u.walletAddress)}</p>
                    </div>
                    <button
                      onClick={() => onSelectDm(u.walletAddress)}
                      className="px-2.5 py-1 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-white/70 hover:text-white text-xs"
                    >
                      Message
                    </button>
                    <button
                      onClick={async () => { const r = await remove(u.walletAddress); flash(r.ok ? 'Unfriended' : r.error || 'Failed'); }}
                      className="px-2.5 py-1 rounded-md text-white/40 hover:text-red-400 hover:bg-red-400/10 text-xs"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

// ─── (Old Add-friend pane removed — search lives at the top of Friends) ─────

// ─── All Users pane ──────────────────────────────────────────────────────────
// Directory of everyone who has logged into the new site (new or returning),
// live names + pfps (default Banana handle or edited), Add Friend on each.

function AllUsersPane({ onBack }: { onBack: () => void }) {
  const { user, isLoggedIn } = useAuth();
  const privy = usePrivy();
  const myWallet = (user?.walletAddress || '').toLowerCase();
  const enabled = !!user?.walletAddress && isLoggedIn;
  const { data, accept, sendRequest } = useFriends(enabled);
  const [roster, setRoster] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  // Ref the token getter — Privy hook identity churns per render and a fetch
  // effect must never depend on it directly ([[render-loop-self-ddos]]).
  const getTokenRef = useRef(privy.getAccessToken);
  useEffect(() => { getTokenRef.current = privy.getAccessToken; }, [privy.getAccessToken]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getTokenRef.current();
        const res = await fetch('/api/users/roster', { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(`roster ${res.status}`);
        const json = (await res.json()) as { users?: PublicUser[] };
        if (!cancelled) setRoster(json.users ?? []);
      } catch { /* shows empty-state */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [enabled]);

  const flash = (text: string) => {
    setFeedback(text);
    setTimeout(() => setFeedback(null), 2000);
  };

  const stateFor = (wallet: string): 'friend' | 'incoming' | 'outgoing' | 'none' => {
    const w = wallet.toLowerCase();
    if (data.friends.some((u) => u.walletAddress.toLowerCase() === w)) return 'friend';
    if (data.incoming.some((u) => u.walletAddress.toLowerCase() === w)) return 'incoming';
    if (data.outgoing.some((u) => u.walletAddress.toLowerCase() === w)) return 'outgoing';
    return 'none';
  };

  const q = filter.trim().toLowerCase();
  const shown = roster.filter((u) =>
    !q || u.username.toLowerCase().includes(q) || u.walletAddress.startsWith(q),
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] flex-shrink-0">
        <button onClick={onBack} className="md:hidden text-white/40 hover:text-white" aria-label="Back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <h2 className="text-white text-lg font-semibold flex-1">All Users</h2>
        <span className="text-white/40 text-xs">{roster.length} user{roster.length === 1 ? '' : 's'}</span>
      </div>

      <div className="px-4 pt-4 pb-2 flex-shrink-0">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name or wallet…"
          className="w-full bg-[#1c1c1e] border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-white/30 focus:outline-none focus:border-banana/50"
          maxLength={60}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {feedback && <p className="text-white/50 text-xs text-center mb-2">{feedback}</p>}
        {loading && <p className="text-white/30 text-sm text-center py-8">Loading users…</p>}
        {!loading && shown.length === 0 && <p className="text-white/30 text-sm text-center py-8">No users found.</p>}
        <div className="space-y-1">
          {shown.map((u) => {
            const isMe = u.walletAddress.toLowerCase() === myWallet;
            const state = stateFor(u.walletAddress);
            let action: React.ReactNode = null;
            if (isMe) action = <span className="text-white/30 text-xs px-3 py-1.5">You</span>;
            else if (state === 'friend') action = <span className="text-green-400 text-xs px-3 py-1.5">Friends</span>;
            else if (state === 'incoming') action = (
              <button onClick={async () => { const r = await accept(u.walletAddress); flash(r.ok ? 'Friend added' : r.error || 'Failed'); }} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-banana text-black hover:bg-banana-light">Accept</button>
            );
            else if (state === 'outgoing') action = <span className="text-white/40 text-xs px-3 py-1.5">Requested</span>;
            else action = (
              <button onClick={async () => { const r = await sendRequest(u.walletAddress); flash(r.ok ? 'Request sent' : r.error || 'Failed'); }} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-banana text-black hover:bg-banana-light">Add Friend</button>
            );
            return (
              <div key={u.walletAddress} className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-white/[0.04]">
                <Avatar user={u} />
                <span className="text-white text-sm flex-1 truncate">{u.username}</span>
                {action}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Blocked-users pane ─────────────────────────────────────────────────────

function BlockedPane({ onBack, onChange }: { onBack: () => void; onChange?: () => void }) {
  const { user, isLoggedIn } = useAuth();
  const enabled = !!user?.walletAddress && isLoggedIn;
  const { blocked, loading, unblock } = useBlockedUsers(enabled);
  const [feedback, setFeedback] = useState<string | null>(null);

  const flash = (text: string) => {
    setFeedback(text);
    setTimeout(() => setFeedback(null), 2000);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] flex-shrink-0">
        <button onClick={onBack} className="md:hidden text-white/40 hover:text-white" aria-label="Back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <h2 className="text-white text-lg font-semibold flex-1">Blocked</h2>
        <span className="text-white/40 text-xs">{blocked.length} blocked</span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {feedback && <p className="text-white/50 text-xs text-center mb-2">{feedback}</p>}
        {loading && blocked.length === 0 && (
          <p className="text-white/30 text-xs text-center py-6">Loading…</p>
        )}
        {!loading && blocked.length === 0 && (
          <div className="text-center py-10 px-4">
            <p className="text-white/50 text-sm mb-1">You haven&apos;t blocked anyone.</p>
            <p className="text-white/30 text-xs">Blocking a user stops messages between you. You can unblock them here at any time.</p>
          </div>
        )}
        <div className="space-y-1">
          {blocked.map((u) => (
            <div key={u.walletAddress} className="flex items-center gap-3 px-2 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
              <Avatar user={u} />
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium truncate">{getTruncatedAccountName(u.username, u.walletAddress)}</p>
              </div>
              <button
                onClick={async () => { const r = await unblock(u.walletAddress); if (r.ok) onChange?.(); flash(r.ok ? 'Unblocked — chat restored' : r.error || 'Failed'); }}
                className="px-2.5 py-1 rounded-md bg-white/[0.06] hover:bg-banana hover:text-black text-white/70 text-xs font-medium transition-colors"
              >
                Unblock
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Sidebar thread row ─────────────────────────────────────────────────────

function ThreadRow({ view, active, onClick }: { view: DmThreadView; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${active ? 'bg-banana/10' : 'hover:bg-white/[0.04]'}`}
    >
      <Avatar user={view.other} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className={`text-sm font-medium truncate ${active ? 'text-banana' : 'text-white'}`}>{view.other.username}</p>
          {view.unreadCount > 0 && <span className="w-2 h-2 rounded-full bg-banana flex-shrink-0" aria-label="unread" />}
        </div>
        <p className="text-white/40 text-xs truncate">{view.lastMessagePreview || 'No messages yet'}</p>
      </div>
    </button>
  );
}

// ─── Main hub ───────────────────────────────────────────────────────────────

export function MessagesHub() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoggedIn } = useAuth();
  const enabled = !!user?.walletAddress && isLoggedIn;
  const { inbox, loading, reject: rejectDmRequest, refresh: refreshInbox } = useDmInbox(enabled);
  const { data: friendsData } = useFriends(enabled);
  const privy = usePrivy();

  const initialView = useCallback((): View => {
    const v = searchParams?.get('view') || '';
    const w = searchParams?.get('with') || '';
    if (v === 'friends') return { kind: 'friends' };
    if (v === 'all-users') return { kind: 'all-users' };
    if (v === 'requests') return { kind: 'requests' };
    if (v === 'add-friend') return { kind: 'friends' };
    if (v === 'blocked') return { kind: 'blocked' };
    if (v === 'general') return { kind: 'general' };
    if (w) return { kind: 'dm', wallet: w };
    // Default: the Messages MENU on mobile (otherwise you're trapped in
    // #general with no way to the rest, Boris 2026-06-11); general on desktop
    // where the sidebar is always visible anyway.
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
      return { kind: 'menu' };
    }
    return { kind: 'general' };
  }, [searchParams]);

  const [view, setView] = useState<View>(initialView);

  // Keep URL in sync with view.
  useEffect(() => {
    const v = searchParams?.get('view') || '';
    const w = searchParams?.get('with') || '';
    const fromUrl: View = (() => {
      if (v === 'friends') return { kind: 'friends' };
      if (v === 'all-users') return { kind: 'all-users' };
      if (v === 'requests') return { kind: 'requests' };
      if (v === 'add-friend') return { kind: 'friends' };
      if (v === 'blocked') return { kind: 'blocked' };
      if (v === 'general') return { kind: 'general' };
      if (w) return { kind: 'dm', wallet: w };
      if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
        return { kind: 'menu' };
      }
      return { kind: 'general' };
    })();
    setView(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const navigate = (next: View) => {
    setView(next);
    let url = '/messages';
    if (next.kind === 'menu') url = '/messages';
    else if (next.kind === 'general') url = '/messages?view=general';
    else if (next.kind === 'friends') url = '/messages?view=friends';
    else if (next.kind === 'all-users') url = '/messages?view=all-users';
    else if (next.kind === 'requests') url = '/messages?view=requests';
    else if (next.kind === 'blocked') url = '/messages?view=blocked';
    else if (next.kind === 'dm') url = `/messages?with=${encodeURIComponent(next.wallet)}`;
    router.replace(url, { scroll: false });
  };

  const requestCount = inbox.requests.length;
  const friendRequestCount = friendsData.incoming.length;
  const isMobilePaneOpen = view.kind !== 'general' || false; // for layout decisions
  void isMobilePaneOpen;
  void privy;

  if (!isLoggedIn) {
    // Not signed in — show #general only, no sidebar friend stuff
    return (
      <div className="max-w-3xl mx-auto px-4 py-6">
        <GlobalChat />
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 text-center">
        <h1 className="text-white text-2xl font-semibold mb-2">Messages</h1>
        <p className="text-white/60">Sign in to view your messages.</p>
      </div>
    );
  }

  // For mobile: when a content view is active, hide the sidebar.
  const hideSidebarOnMobile = view.kind !== 'general' || (view.kind === 'general' && false);
  void hideSidebarOnMobile;

  return (
    <div className="max-w-6xl mx-auto h-[calc(100vh-7rem)] sm:h-[calc(100vh-9rem)] px-2 sm:px-4 py-4">
      <div className="h-full flex bg-[#0f0f12] border border-white/[0.06] rounded-2xl overflow-hidden">
        {/* Sidebar */}
        <aside className={`flex-col w-full md:w-72 lg:w-80 border-r border-white/[0.06] ${view.kind === 'menu' ? 'flex' : 'hidden'} md:flex`}>
          <SidebarContent
            view={view}
            inbox={inbox}
            loading={loading}
            requestCount={requestCount}
            friendRequestCount={friendRequestCount}
            onNavigate={navigate}
          />
        </aside>

        {/* Main pane */}
        <main className={`flex-1 flex-col min-w-0 ${view.kind === 'menu' ? 'hidden' : 'flex'} md:flex`}>
          {(view.kind === 'general' || view.kind === 'menu') && (
            <div className="flex flex-col h-full">
              <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] flex-shrink-0 md:hidden">
                <button onClick={() => navigate({ kind: 'menu' })} className="text-white/40 hover:text-white" aria-label="Back">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
                </button>
                <h2 className="text-white font-semibold">#general</h2>
              </div>
              <div className="flex-1 overflow-hidden">
                <GlobalChat />
              </div>
            </div>
          )}
          {view.kind === 'friends' && <FriendsPane onSelectDm={(w) => navigate({ kind: 'dm', wallet: w })} onBack={() => navigate({ kind: 'menu' })} />}
          {view.kind === 'all-users' && <AllUsersPane onBack={() => navigate({ kind: 'menu' })} />}
          {view.kind === 'blocked' && <BlockedPane onBack={() => navigate({ kind: 'menu' })} onChange={refreshInbox} />}
          {view.kind === 'requests' && (
            <RequestsPane inbox={inbox} onSelectDm={(w) => navigate({ kind: 'dm', wallet: w })} onBack={() => navigate({ kind: 'menu' })} onReject={rejectDmRequest} />
          )}
          {view.kind === 'dm' && <ThreadPane otherWallet={view.wallet} onBack={() => navigate({ kind: 'menu' })} onBlockChange={refreshInbox} />}
        </main>
      </div>
    </div>
  );
}

// ─── Sidebar content ────────────────────────────────────────────────────────

function SidebarContent({
  view,
  inbox,
  loading,
  requestCount,
  friendRequestCount,
  onNavigate,
}: {
  view: View;
  inbox: { messages: DmThreadView[]; requests: DmThreadView[]; sent: DmThreadView[] };
  loading: boolean;
  requestCount: number;
  friendRequestCount: number;
  onNavigate: (v: View) => void;
}) {
  const isActive = (kind: View['kind'], extra?: string): boolean => {
    if (view.kind !== kind) return false;
    if (kind === 'dm' && view.kind === 'dm' && extra) return view.wallet.toLowerCase() === extra.toLowerCase();
    return true;
  };

  return (
    <>
      <div className="px-4 py-4 border-b border-white/[0.06]">
        <h1 className="text-white text-lg font-semibold">Messages</h1>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {/* Channels section */}
        <div className="mb-1">
          <p className="px-3 py-1 text-white/40 text-[10px] uppercase tracking-wider">Channels</p>
          <SidebarLink
            label="# general"
            active={isActive('general')}
            onClick={() => onNavigate({ kind: 'general' })}
          />
        </div>

        {/* Social section */}
        <div className="mb-1 mt-3">
          <p className="px-3 py-1 text-white/40 text-[10px] uppercase tracking-wider">Social</p>
          <SidebarLink
            label="Friends"
            badge={friendRequestCount}
            active={isActive('friends')}
            onClick={() => onNavigate({ kind: 'friends' })}
          />
          <SidebarLink
            label="All Users"
            active={isActive('all-users')}
            onClick={() => onNavigate({ kind: 'all-users' })}
          />
          <SidebarLink
            label="Message Requests"
            badge={requestCount}
            active={isActive('requests')}
            onClick={() => onNavigate({ kind: 'requests' })}
          />
          <SidebarLink
            label="Blocked"
            active={isActive('blocked')}
            onClick={() => onNavigate({ kind: 'blocked' })}
          />
        </div>

        {/* DMs section */}
        <div className="mt-3">
          <p className="px-3 py-1 text-white/40 text-[10px] uppercase tracking-wider">Direct Messages</p>
          {loading && inbox.messages.length === 0 && <p className="text-white/30 text-xs text-center py-3">Loading…</p>}
          {!loading && inbox.messages.length === 0 && inbox.sent.length === 0 && (
            <p className="text-white/30 text-xs text-center py-4 px-3">No conversations yet.</p>
          )}
          {inbox.messages.map((t) => (
            <ThreadRow
              key={t.threadId}
              view={t}
              active={view.kind === 'dm' && view.wallet.toLowerCase() === t.other.walletAddress.toLowerCase()}
              onClick={() => onNavigate({ kind: 'dm', wallet: t.other.walletAddress })}
            />
          ))}
          {inbox.sent.length > 0 && (
            <>
              <p className="px-3 pt-3 pb-1 text-white/30 text-[10px] uppercase tracking-wider">Sent</p>
              {inbox.sent.map((t) => (
                <ThreadRow
                  key={t.threadId}
                  view={t}
                  active={view.kind === 'dm' && view.wallet.toLowerCase() === t.other.walletAddress.toLowerCase()}
                  onClick={() => onNavigate({ kind: 'dm', wallet: t.other.walletAddress })}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function SidebarLink({ label, badge, active, onClick }: { label: string; badge?: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left transition-colors ${
        active ? 'bg-banana/10 text-banana' : 'text-white/70 hover:bg-white/[0.04] hover:text-white'
      }`}
    >
      <span className="text-sm font-medium">{label}</span>
      {badge ? (
        <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-banana text-black text-[10px] font-bold flex items-center justify-center">
          {badge > 9 ? '9+' : badge}
        </span>
      ) : null}
    </button>
  );
}

// ─── Requests pane (full list) ──────────────────────────────────────────────

function RequestsPane({ inbox, onSelectDm, onBack, onReject }: {
  inbox: { messages: DmThreadView[]; requests: DmThreadView[]; sent: DmThreadView[] };
  onSelectDm: (wallet: string) => void;
  onBack: () => void;
  onReject: (wallet: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const both = useMemo(() => {
    return [
      ...inbox.requests.map((t) => ({ ...t, kind: 'incoming' as const })),
      ...inbox.sent.map((t) => ({ ...t, kind: 'sent' as const })),
    ];
  }, [inbox]);

  const flash = (text: string) => { setFeedback(text); setTimeout(() => setFeedback(null), 2000); };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] flex-shrink-0">
        <button onClick={onBack} className="md:hidden text-white/40 hover:text-white" aria-label="Back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <h2 className="text-white text-lg font-semibold flex-1">Message Requests</h2>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {feedback && <p className="text-white/50 text-xs text-center mb-2">{feedback}</p>}
        {both.length === 0 && <p className="text-white/30 text-sm text-center py-6">No pending requests.</p>}
        {inbox.requests.length > 0 && (
          <section className="mb-4">
            <p className="text-white/40 text-[10px] uppercase tracking-wider mb-2 px-1">Incoming</p>
            <div className="space-y-1">
              {inbox.requests.map((t) => (
                <div key={t.threadId} className="flex items-center gap-3 px-2 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                  <Avatar user={t.other} />
                  <button onClick={() => onSelectDm(t.other.walletAddress)} className="flex-1 min-w-0 text-left">
                    <p className="text-white text-sm font-medium truncate">{t.other.username}</p>
                    <p className="text-white/40 text-xs truncate">{t.lastMessagePreview || 'wants to message you'}</p>
                  </button>
                  <button
                    onClick={() => onSelectDm(t.other.walletAddress)}
                    className="text-banana text-xs px-2 py-1 rounded-md bg-banana/10 hover:bg-banana/20"
                  >
                    View
                  </button>
                  <button
                    onClick={async () => { const r = await onReject(t.other.walletAddress); flash(r.ok ? 'Request deleted' : r.error || 'Failed'); }}
                    className="px-2 py-1 rounded-md text-white/40 hover:text-red-400 hover:bg-red-400/10 text-xs"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
        {inbox.sent.length > 0 && (
          <section>
            <p className="text-white/40 text-[10px] uppercase tracking-wider mb-2 px-1">Sent</p>
            <div className="space-y-1">
              {inbox.sent.map((t) => (
                <button key={t.threadId} onClick={() => onSelectDm(t.other.walletAddress)} className="w-full flex items-center gap-3 px-2 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.04] text-left">
                  <Avatar user={t.other} />
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{t.other.username}</p>
                    <p className="text-white/40 text-xs truncate">{t.lastMessagePreview || 'request pending'}</p>
                  </div>
                  <span className="text-white/30 text-xs px-2 py-1 rounded-md bg-white/[0.04]">Pending</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
