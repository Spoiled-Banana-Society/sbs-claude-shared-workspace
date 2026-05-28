'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';

interface UserPopoverProps {
  walletAddress: string;
  username?: string;
  pfpUrl?: string;
  children: React.ReactNode;
  /** Visual side of the trigger to anchor against. Default 'auto' (chooses based on viewport). */
  side?: 'top' | 'bottom' | 'auto';
}

type Relationship = 'self' | 'friend' | 'incoming' | 'outgoing' | 'none' | 'loading';

interface PublicUser {
  walletAddress: string;
  username: string;
  profilePicture?: string;
}

interface FriendBuckets {
  friends: PublicUser[];
  incoming: PublicUser[];
  outgoing: PublicUser[];
}

function shortWallet(w: string): string {
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
}

/**
 * Wraps any element with a click target that opens a popover showing the
 * user's profile + friend actions. Drop in anywhere a user is rendered —
 * chat messages, draft-room player slots, marketplace seller chips, etc.
 *
 * On open, fetches /api/friends + /api/friends/mutual lazily so the popover
 * always reflects current state. Closes on outside click or Escape.
 */
export function UserPopover({ walletAddress, username, pfpUrl, children, side = 'auto' }: UserPopoverProps) {
  const { user } = useAuth();
  const privy = usePrivy();
  const router = useRouter();
  const myWallet = (user?.walletAddress || '').toLowerCase();
  const targetWallet = walletAddress.toLowerCase();
  const isSelf = !!myWallet && myWallet === targetWallet;

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; placement: 'top' | 'bottom' }>({ left: 0, top: 0, placement: 'bottom' });
  const [relationship, setRelationship] = useState<Relationship>('loading');
  const [mutualCount, setMutualCount] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = await privy.getAccessToken();
    if (!token) throw new Error('Session expired');
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  }, [privy]);

  // Ref authHeaders so the friend-state fetch effect doesn't re-fire on
  // every Privy re-render. See [[render-loop-self-ddos]].
  const authHeadersRef = useRef(authHeaders);
  useEffect(() => { authHeadersRef.current = authHeaders; }, [authHeaders]);

  // Compute position whenever opened.
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const popH = 220; // estimate; the real height will be close enough
    let placement: 'top' | 'bottom' = 'bottom';
    if (side === 'top') placement = 'top';
    else if (side === 'bottom') placement = 'bottom';
    else placement = (window.innerHeight - rect.bottom) < popH ? 'top' : 'bottom';

    const popW = 280;
    let left = rect.left + rect.width / 2 - popW / 2;
    left = Math.max(8, Math.min(window.innerWidth - popW - 8, left));
    const top = placement === 'bottom' ? rect.bottom + 6 : rect.top - popH - 6;
    setPos({ left, top, placement });
  }, [open, side]);

  // Lazy fetch friend state when opened (if not self + signed in).
  useEffect(() => {
    if (!open || isSelf || !myWallet) {
      if (!myWallet) setRelationship('none');
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const headers = await authHeadersRef.current();
        const [friendsRes, mutualRes] = await Promise.all([
          fetch('/api/friends', { headers, cache: 'no-store' }),
          fetch(`/api/friends/mutual?wallet=${encodeURIComponent(targetWallet)}`, { headers, cache: 'no-store' }),
        ]);
        if (cancelled) return;
        if (friendsRes.ok) {
          const data = (await friendsRes.json()) as FriendBuckets;
          if (cancelled) return;
          const has = (list: PublicUser[]) => list.some((u) => u.walletAddress.toLowerCase() === targetWallet);
          if (has(data.friends)) setRelationship('friend');
          else if (has(data.incoming)) setRelationship('incoming');
          else if (has(data.outgoing)) setRelationship('outgoing');
          else setRelationship('none');
        } else {
          setRelationship('none');
        }
        if (mutualRes.ok) {
          const m = (await mutualRes.json()) as { mutual?: PublicUser[] };
          if (!cancelled) setMutualCount((m.mutual || []).length);
        }
      } catch {
        if (!cancelled) setRelationship('none');
      }
    })();
    return () => { cancelled = true; };
  }, [open, isSelf, myWallet, targetWallet]);

  // Outside click / Escape close.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (popoverRef.current?.contains(e.target as Node)) return;
      if (triggerRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const flash = (text: string) => {
    setFeedback(text);
    setTimeout(() => setFeedback(null), 2000);
  };

  const handleSendRequest = async () => {
    setRelationship('loading');
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/friends/request', {
        method: 'POST', headers, body: JSON.stringify({ targetWallet }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        flash(json.error || 'Failed');
        setRelationship('none');
        return;
      }
      // Auto-accept case (mutual): the friendship returned will have status accepted.
      const friendship = json.friendship as { status?: string } | undefined;
      if (friendship?.status === 'accepted') {
        setRelationship('friend');
        flash('Friends!');
      } else {
        setRelationship('outgoing');
        flash('Request sent');
      }
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Failed');
      setRelationship('none');
    }
  };

  const handleAccept = async () => {
    setRelationship('loading');
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/friends/accept', {
        method: 'POST', headers, body: JSON.stringify({ otherWallet: targetWallet }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        flash(json.error || 'Failed');
        setRelationship('incoming');
        return;
      }
      setRelationship('friend');
      flash('Friends!');
    } catch {
      flash('Failed');
      setRelationship('incoming');
    }
  };

  const handleRemove = async (verb: string) => {
    const previous = relationship;
    setRelationship('loading');
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/friends/remove', {
        method: 'POST', headers, body: JSON.stringify({ otherWallet: targetWallet }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        flash(json.error || 'Failed');
        setRelationship(previous);
        return;
      }
      setRelationship('none');
      flash(verb);
    } catch {
      flash('Failed');
      setRelationship(previous);
    }
  };

  const renderAction = () => {
    if (isSelf) return <span className="text-white/30 text-xs">That&apos;s you</span>;
    if (!myWallet) return <span className="text-white/40 text-xs">Sign in to interact</span>;
    if (relationship === 'loading') return <span className="text-white/40 text-xs">Loading…</span>;
    if (relationship === 'friend') {
      return (
        <div className="flex gap-2 w-full">
          <span className="flex-1 text-center px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-sm font-medium">
            Friends
          </span>
          <button
            onClick={() => handleRemove('Unfriended')}
            className="px-3 py-2 rounded-lg text-white/40 hover:text-red-400 hover:bg-red-400/10 text-sm transition-colors"
          >
            Remove
          </button>
        </div>
      );
    }
    if (relationship === 'incoming') {
      return (
        <div className="flex gap-2 w-full">
          <button
            onClick={handleAccept}
            className="flex-1 px-3 py-2 rounded-lg bg-banana text-black hover:bg-banana-light text-sm font-bold transition-colors"
          >
            Accept
          </button>
          <button
            onClick={() => handleRemove('Rejected')}
            className="px-3 py-2 rounded-lg text-white/40 hover:text-red-400 hover:bg-red-400/10 text-sm transition-colors"
          >
            Reject
          </button>
        </div>
      );
    }
    if (relationship === 'outgoing') {
      return (
        <div className="flex gap-2 w-full">
          <span className="flex-1 text-center px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white/60 text-sm">
            Requested
          </span>
          <button
            onClick={() => handleRemove('Cancelled')}
            className="px-3 py-2 rounded-lg text-white/40 hover:text-red-400 hover:bg-red-400/10 text-sm transition-colors"
          >
            Cancel
          </button>
        </div>
      );
    }
    return (
      <button
        onClick={handleSendRequest}
        className="w-full px-3 py-2 rounded-lg bg-banana text-black hover:bg-banana-light text-sm font-bold transition-colors"
      >
        Add Friend
      </button>
    );
  };

  const displayName = username || shortWallet(walletAddress);

  return (
    <>
      <span
        ref={triggerRef}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="cursor-pointer"
      >
        {children}
      </span>
      {open && (
        <div
          ref={popoverRef}
          className="fixed z-[100] w-[280px] bg-[#1c1c1e] border border-white/10 rounded-xl shadow-2xl overflow-hidden animate-fade-in"
          style={{ left: pos.left, top: pos.top }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-4 pt-4 pb-3 border-b border-white/[0.06]">
            <div className="flex items-start gap-3">
              {/* Always a real picture or the banana default; never a wallet initial. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={pfpUrl || '/banana-profile.png'}
                alt={displayName}
                onError={(e) => { e.currentTarget.src = '/banana-profile.png'; }}
                className="w-14 h-14 rounded-full object-cover bg-white/5 border border-white/10 flex-shrink-0"
              />
              <div className="flex-1 min-w-0 mt-1">
                <p className="text-white font-semibold truncate">{displayName}</p>
                <p className="text-white/40 text-xs font-mono truncate">{shortWallet(walletAddress)}</p>
                {mutualCount !== null && mutualCount > 0 && (
                  <p className="text-banana/80 text-xs mt-1">{mutualCount} mutual friend{mutualCount === 1 ? '' : 's'}</p>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="p-3 space-y-2">
            {renderAction()}
            {!isSelf && !!myWallet && (
              <button
                onClick={() => {
                  router.push(`/messages?with=${encodeURIComponent(walletAddress)}`);
                  setOpen(false);
                }}
                className="w-full px-3 py-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.10] text-white/80 hover:text-white text-sm font-medium transition-colors"
              >
                Send Message
              </button>
            )}
          </div>

          {/* Feedback toast */}
          {feedback && (
            <div className="px-3 pb-3 -mt-1">
              <p className="text-white/50 text-xs text-center">{feedback}</p>
            </div>
          )}
        </div>
      )}
      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-2px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in { animation: fadeIn 0.15s ease-out both; }
      `}</style>
    </>
  );
}
