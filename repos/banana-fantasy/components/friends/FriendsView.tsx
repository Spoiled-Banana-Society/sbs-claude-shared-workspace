'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useFriends, type PublicUser } from '@/hooks/useFriends';

type Tab = 'friends' | 'pending' | 'add';

function UserAvatar({ user }: { user: PublicUser }) {
  if (user.profilePicture) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={user.profilePicture} alt={user.username} className="w-10 h-10 rounded-full object-cover bg-white/5 border border-white/10 flex-shrink-0" />;
  }
  const initial = (user.username || user.walletAddress).slice(0, 1).toUpperCase();
  return (
    <div className="w-10 h-10 rounded-full flex-shrink-0 bg-banana/20 border border-banana/30 flex items-center justify-center text-banana font-bold">
      {initial}
    </div>
  );
}

function shortWallet(w: string): string {
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
}

interface UserRowProps {
  user: PublicUser;
  rightSlot: React.ReactNode;
  mutualCount?: number;
}

function UserRow({ user, rightSlot, mutualCount }: UserRowProps) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.04] transition-colors">
      <UserAvatar user={user} />
      <div className="flex-1 min-w-0">
        <p className="text-white font-medium truncate">{user.username}</p>
        <p className="text-white/40 text-xs truncate">
          {shortWallet(user.walletAddress)}
          {typeof mutualCount === 'number' && mutualCount > 0 && (
            <span> · <span className="text-banana/80">{mutualCount} mutual</span></span>
          )}
        </p>
      </div>
      <div className="flex-shrink-0 flex items-center gap-1.5">{rightSlot}</div>
    </div>
  );
}

export function FriendsView() {
  const { user, isLoggedIn } = useAuth();
  const enabled = !!user?.walletAddress && isLoggedIn;
  const { data, loading, sendRequest, accept, remove, search, mutualWith } = useFriends(enabled);
  const [tab, setTab] = useState<Tab>('friends');
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<PublicUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [mutualByUser, setMutualByUser] = useState<Record<string, number>>({});

  const myWallet = (user?.walletAddress || '').toLowerCase();

  // For the friends list — show mutual counts when viewing a friend, since
  // that's a small set and useful info. Fetch lazily.
  const friendWalletsKey = useMemo(
    () => data.friends.map((f) => f.walletAddress).join(','),
    [data.friends],
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      const next: Record<string, number> = {};
      // Parallel — capped at 10 friends max
      await Promise.all(data.friends.slice(0, 20).map(async (f) => {
        const mutual = await mutualWith(f.walletAddress);
        next[f.walletAddress.toLowerCase()] = mutual.length;
      }));
      if (!cancelled) setMutualByUser(next);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, friendWalletsKey]);

  // Debounced search.
  useEffect(() => {
    if (!searchQ.trim()) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      const r = await search(searchQ);
      if (!cancelled) {
        setSearchResults(r);
        setSearching(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); setSearching(false); };
  }, [searchQ, search]);

  const flash = useCallback((kind: 'ok' | 'err', text: string) => {
    setFeedback({ kind, text });
    setTimeout(() => setFeedback(null), 2500);
  }, []);

  const handleSendRequest = async (wallet: string) => {
    const r = await sendRequest(wallet);
    if (r.ok) flash('ok', 'Request sent');
    else flash('err', r.error || 'failed');
  };

  const handleAccept = async (wallet: string) => {
    const r = await accept(wallet);
    if (r.ok) flash('ok', 'Friend added');
    else flash('err', r.error || 'failed');
  };

  const handleRemove = async (wallet: string, label = 'removed') => {
    const r = await remove(wallet);
    if (r.ok) flash('ok', label);
    else flash('err', r.error || 'failed');
  };

  // For search results — show what action is available based on existing state.
  const stateFor = (wallet: string): 'friend' | 'incoming' | 'outgoing' | 'none' => {
    const w = wallet.toLowerCase();
    if (data.friends.some((u) => u.walletAddress.toLowerCase() === w)) return 'friend';
    if (data.incoming.some((u) => u.walletAddress.toLowerCase() === w)) return 'incoming';
    if (data.outgoing.some((u) => u.walletAddress.toLowerCase() === w)) return 'outgoing';
    return 'none';
  };

  if (!enabled) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center">
        <h1 className="text-white text-2xl font-semibold mb-2">Friends</h1>
        <p className="text-white/60">Sign in to manage friends.</p>
      </div>
    );
  }

  const pendingCount = data.incoming.length;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <h1 className="text-white text-2xl font-semibold mb-1">Friends</h1>
      <p className="text-white/40 text-sm mb-5">Connect with other players.</p>

      {/* Tab bar */}
      <div className="flex border-b border-white/[0.06] mb-4">
        {[
          { id: 'friends' as Tab, label: `Friends (${data.friends.length})` },
          { id: 'pending' as Tab, label: pendingCount > 0 ? `Pending (${pendingCount})` : 'Pending' },
          { id: 'add' as Tab, label: 'Add Friend' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
              tab === t.id ? 'text-banana' : 'text-white/40 hover:text-white/70'
            }`}
          >
            {t.label}
            {tab === t.id && <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-banana rounded-full" />}
          </button>
        ))}
      </div>

      {/* Toast */}
      {feedback && (
        <div className={`mb-3 px-3 py-2 rounded-lg text-sm ${
          feedback.kind === 'ok' ? 'bg-green-500/10 border border-green-500/30 text-green-300' : 'bg-red-500/10 border border-red-500/30 text-red-300'
        }`}>
          {feedback.text}
        </div>
      )}

      {/* Friends tab */}
      {tab === 'friends' && (
        <div>
          {loading && <p className="text-white/30 text-sm text-center py-8">Loading…</p>}
          {!loading && data.friends.length === 0 && (
            <div className="text-center py-12">
              <p className="text-white/50">No friends yet.</p>
              <p className="text-white/30 text-xs mt-1">Switch to Add Friend to send a request.</p>
            </div>
          )}
          <div className="space-y-2">
            {data.friends.map((u) => (
              <UserRow
                key={u.walletAddress}
                user={u}
                mutualCount={mutualByUser[u.walletAddress.toLowerCase()]}
                rightSlot={
                  <button
                    onClick={() => handleRemove(u.walletAddress, 'unfriended')}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-white/40 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                  >
                    Remove
                  </button>
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* Pending tab */}
      {tab === 'pending' && (
        <div className="space-y-6">
          <section>
            <h2 className="text-white/60 text-xs uppercase tracking-wider mb-2">Incoming</h2>
            {data.incoming.length === 0 ? (
              <p className="text-white/30 text-sm">No incoming requests.</p>
            ) : (
              <div className="space-y-2">
                {data.incoming.map((u) => (
                  <UserRow
                    key={u.walletAddress}
                    user={u}
                    rightSlot={
                      <>
                        <button
                          onClick={() => handleAccept(u.walletAddress)}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-banana text-black hover:bg-banana-light transition-colors"
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => handleRemove(u.walletAddress, 'rejected')}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium text-white/40 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                        >
                          Reject
                        </button>
                      </>
                    }
                  />
                ))}
              </div>
            )}
          </section>
          <section>
            <h2 className="text-white/60 text-xs uppercase tracking-wider mb-2">Sent</h2>
            {data.outgoing.length === 0 ? (
              <p className="text-white/30 text-sm">No outgoing requests.</p>
            ) : (
              <div className="space-y-2">
                {data.outgoing.map((u) => (
                  <UserRow
                    key={u.walletAddress}
                    user={u}
                    rightSlot={
                      <button
                        onClick={() => handleRemove(u.walletAddress, 'cancelled')}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium text-white/40 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                      >
                        Cancel
                      </button>
                    }
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Add Friend tab */}
      {tab === 'add' && (
        <div>
          <input
            type="text"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Search by username or wallet (0x…)"
            className="w-full bg-[#1c1c1e] border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-white/30 focus:outline-none focus:border-banana/50"
            maxLength={60}
          />
          <p className="text-white/30 text-xs mt-2">Exact username or full wallet address.</p>

          <div className="mt-4">
            {searching && <p className="text-white/30 text-sm text-center py-6">Searching…</p>}
            {!searching && searchQ.trim() && searchResults.length === 0 && (
              <p className="text-white/30 text-sm text-center py-6">No users found.</p>
            )}
            <div className="space-y-2">
              {searchResults.map((u) => {
                const state = stateFor(u.walletAddress);
                let action: React.ReactNode = null;
                if (u.walletAddress.toLowerCase() === myWallet) {
                  action = <span className="text-white/30 text-xs px-3 py-1.5">That&apos;s you</span>;
                } else if (state === 'friend') {
                  action = <span className="text-green-400 text-xs px-3 py-1.5">Friends</span>;
                } else if (state === 'incoming') {
                  action = (
                    <button
                      onClick={() => handleAccept(u.walletAddress)}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold bg-banana text-black hover:bg-banana-light"
                    >
                      Accept
                    </button>
                  );
                } else if (state === 'outgoing') {
                  action = <span className="text-white/40 text-xs px-3 py-1.5">Requested</span>;
                } else {
                  action = (
                    <button
                      onClick={() => handleSendRequest(u.walletAddress)}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold bg-banana text-black hover:bg-banana-light"
                    >
                      Add Friend
                    </button>
                  );
                }
                return <UserRow key={u.walletAddress} user={u} rightSlot={action} />;
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
