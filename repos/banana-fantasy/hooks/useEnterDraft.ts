'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { isStagingMode } from '@/lib/staging';
import * as draftStore from '@/lib/draftStore';
import { joinDraft } from '@/lib/api/leagues';
import { logger } from '@/lib/logger';
import { reportClientError } from '@/lib/clientErrors';
import { LOG_SOURCES } from '@/lib/logSources';

/**
 * THE single "enter a draft" flow. Used by EVERY entry point (home page
 * Featured Contest, /drafting "Enter draft", and any future button) so there
 * is exactly ONE implementation of join-before-navigate + the branded
 * "Joining lobby" overlay. Before this hook existed the logic was copy-pasted
 * in app/page.tsx and useDraftingPageState.ts; the home copy never got the
 * join-before-navigate rebuild, so entering from the home page glitched
 * (no overlay, blank lobby that then filled in its count) while /drafting was
 * fine. Whichever copy a fix touched, the other kept regressing — that's why
 * the glitch "kept coming back." One hook = it can't diverge again.
 *
 * What the flow does (this is the GOOD behavior, do not regress it):
 *  1. Show the branded "Joining lobby…" overlay (caller renders
 *     <JoiningLobbyOverlay show={joiningLobby} />).
 *  2. Decrement the pass against the authoritative Firestore gate; abort +
 *     refund on failure.
 *  3. Call joinDraft HERE (with retries) so we have the real draftId + player
 *     count BEFORE navigating.
 *  4. Navigate to /draft-room with id + players + joinedAt seeded into the URL
 *     so the room paints a fully-populated lobby on first frame — no blank,
 *     no "0 → 1 → N" flash, no async-draftId-spawn race.
 */
export function useEnterDraft() {
  const router = useRouter();
  const { user, updateUser, refreshBalance } = useAuth();
  const [joiningLobby, setJoiningLobby] = useState(false);

  const isLive = isStagingMode() && !!user?.walletAddress;

  const enterDraftWithPassType = async (
    passType: 'paid' | 'free',
    speed: 'fast' | 'slow' = 'fast',
  ) => {
    if (!user?.walletAddress) return;

    const beforePaid = user.draftPasses || 0;
    const beforeFree = user.freeDrafts || 0;

    // Optimistic local update so the header ticks down on click. Rolled
    // back below if the backend rejects.
    if (passType === 'paid') {
      updateUser({ draftPasses: Math.max(0, beforePaid - 1) });
    } else {
      updateUser({ freeDrafts: Math.max(0, beforeFree - 1) });
    }

    // Backend gate: Firestore is the authoritative source. If the
    // decrement fails (counter already at 0, even if local state showed
    // otherwise), abort the join — user genuinely has no passes. The
    // Go API still has its own ledger; without this gate a stale UI
    // could let someone enter a draft they shouldn't.
    let decremented = false;
    try {
      const res = await fetch('/api/owner/use-pass', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id || user.walletAddress, passType }),
      });
      const body = await res.json().catch(() => ({}));
      decremented = res.ok && !!body?.decremented;
    } catch {
      // Network failure — roll back and tell the user. Don't navigate
      // because we can't confirm the backend got the decrement.
      updateUser({ draftPasses: beforePaid, freeDrafts: beforeFree });
      alert('Network error. Please try again.');
      return;
    }

    if (!decremented) {
      // Backend says no spendable passes. Rollback optimistic update and
      // re-sync from Firestore so the header reflects truth.
      updateUser({ draftPasses: beforePaid, freeDrafts: beforeFree });
      void refreshBalance();
      alert('No draft passes available. Your balance has been refreshed.');
      return;
    }

    // Non-staging / local mode: no backend draft to join. Spin up a local
    // draft and navigate — same shape the home page used before, kept here so
    // the single hook covers every mode.
    if (!isLive) {
      const localDraftId = `local-${Date.now()}`;
      const localContestName = `League #${Math.floor(Math.random() * 9000) + 1000}`;
      draftStore.addDraft({
        id: localDraftId,
        contestName: localContestName,
        status: 'filling',
        type: null,
        draftSpeed: speed,
        players: 1,
        maxPlayers: 10,
        joinedAt: Date.now(),
        phase: 'filling',
        liveWalletAddress: user.walletAddress,
        passType,
      });
      const params = new URLSearchParams({
        id: localDraftId,
        name: localContestName,
        speed,
        players: '1',
        passType,
      });
      router.push(`/draft-room?${params.toString()}`);
      return;
    }

    // Join-before-navigate: do the actual joinDraft HERE (on tap), while a
    // branded "Joining lobby…" overlay is showing, then navigate to the room
    // with the resolved draftId + player count already in the URL. This drops
    // the user straight into a FULLY POPULATED lobby on first paint — no blank,
    // no pulse, no async draftId race (the old flow navigated with no id and
    // joined inside the room, which caused the "0 then 1 then 2" flash).
    setJoiningLobby(true);
    // Hold the overlay for a minimum beat so the branded "Joining lobby…"
    // transition is always clearly visible, even when joinDraft resolves
    // near-instantly. Perceptible but snappy — never pads beyond this.
    const MIN_OVERLAY_MS = 700;
    const overlayStart = Date.now();
    let draftRoom: Awaited<ReturnType<typeof joinDraft>> | null = null;
    const MAX_JOIN_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_JOIN_RETRIES; attempt++) {
      try {
        draftRoom = await joinDraft(user.walletAddress, speed, 1, passType);
        if (draftRoom?.id) break;
        throw new Error('Join failed: no draft ID');
      } catch (err) {
        logger.warn(`[Enter] join attempt ${attempt}/${MAX_JOIN_RETRIES} failed`, { err: err instanceof Error ? err.message : String(err) });
        if (attempt < MAX_JOIN_RETRIES) await new Promise(r => setTimeout(r, 1500 * attempt));
      }
    }

    if (!draftRoom?.id) {
      // Join failed after retries. Refund the pass we just spent (use-pass
      // decremented Firestore; no league was actually joined) and bail.
      setJoiningLobby(false);
      void fetch('/api/owner/refund-pass', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id || user.walletAddress, passType }),
      })
        .then((res) => {
          if (!res.ok) {
            reportClientError({
              source: LOG_SOURCES.draft.JOIN_REFUND_FAILED,
              message: `Join-fail refund returned ${res.status}`,
              route: 'enter-draft',
              actor: user.walletAddress,
              context: { passType, userId: user.id || user.walletAddress, status: res.status },
            });
          }
        })
        .catch((err) => {
          reportClientError({
            source: LOG_SOURCES.draft.JOIN_REFUND_FAILED,
            message: err instanceof Error ? err.message : String(err),
            route: 'enter-draft',
            actor: user.walletAddress,
            context: { passType, userId: user.id || user.walletAddress, network: true },
          });
        });
      updateUser({ draftPasses: beforePaid, freeDrafts: beforeFree });
      void refreshBalance();
      alert('Could not join a draft right now. Your pass was not used — please try again.');
      return;
    }

    const newId = draftRoom.id;
    const joinedCount = Math.min(Math.max(Number(draftRoom.players) || 1, 1), 10);
    const joinedAt = Date.now();

    // Persist the draft so the room + leave flow have the exact token/passType.
    draftStore.addDraft({
      id: newId,
      contestName: draftRoom.contestName || '',
      status: 'filling',
      type: null,
      draftSpeed: speed,
      players: joinedCount,
      maxPlayers: 10,
      joinedAt,
      phase: 'filling',
      liveWalletAddress: user.walletAddress,
      passType,
      cardId: draftRoom.cardId,
    });

    // Navigate to the room with everything seeded — same URL shape as
    // re-entering an active draft (the proven id-in-URL path), plus joinedAt
    // so the room's post-join grace window keeps the count from dipping.
    const params = new URLSearchParams({
      id: newId,
      name: 'Draft Room',
      speed,
      players: String(joinedCount),
      mode: 'live',
      wallet: user.walletAddress,
      passType,
      joinedAt: String(joinedAt),
    });
    // Let the branded overlay breathe for its minimum beat before we swap routes.
    const elapsed = Date.now() - overlayStart;
    if (elapsed < MIN_OVERLAY_MS) await new Promise(r => setTimeout(r, MIN_OVERLAY_MS - elapsed));
    // Stamp the moment we leave for the room so the draft room can measure the
    // hand-off gap (the blank/flash before the lobby paints) and surface a
    // slow hand-off to the admin error feed. Best-effort; cleared on the room side.
    try { sessionStorage.setItem('sbs-join-nav-ts', String(Date.now())); } catch { /* ignore */ }
    router.push(`/draft-room?${params.toString()}`);
  };

  return { joiningLobby, enterDraftWithPassType };
}
