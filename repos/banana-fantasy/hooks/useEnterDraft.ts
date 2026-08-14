'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { isStagingMode } from '@/lib/staging';
import * as draftStore from '@/lib/draftStore';
import { joinDraft, joinPrivateDraft } from '@/lib/api/leagues';
import { getActivePrivateLeague, clearActivePrivateLeague } from '@/lib/privateLeagueSession';
import { logger } from '@/lib/logger';
import { reportClientError, reportClientEvent } from '@/lib/clientErrors';

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
 *  2. Call joinDraft FIRST (with retries) — the Go engine is the real
 *     ownership gate (it consumes the actual token and rejects a wallet with
 *     none), so it's the only call allowed to block the user.
 *  3. On success, sync the Firestore mirror + activity feed in the background
 *     via POST /api/owner/use-pass { joined: true } — non-blocking.
 *  4. Navigate to /draft-room with id + players + joinedAt seeded into the URL
 *     so the room paints a fully-populated lobby on first frame — no blank,
 *     no "0 → 1 → N" flash, no async-draftId-spawn race.
 *
 * JOIN-FIRST (2026-07-06, do not reorder back): the flow used to gate on the
 * use-pass round-trip BEFORE joining. Breadcrumb data (draft.enter.*) proved
 * every real-world failure was that Vercel round-trip exceeding its 12s abort
 * on flaky devices — while the Go join itself never failed once. Blocking the
 * essential call behind the bookkeeping call was the entire "takes my pass but
 * doesn't join" bug (Richard, MrMcNasty, Vertig0, + 3 wallets on 7/5). The
 * mirror decrement is cosmetic: the Go join consumes the real token, and the
 * balance route recounts the mirror from inventory on next read regardless.
 */
export function useEnterDraft() {
  const router = useRouter();
  const { user, updateUser, refreshBalance } = useAuth();
  const [joiningLobby, setJoiningLobby] = useState(false);
  // Visible failure message rendered by <JoiningLobbyOverlay error={joinError}>.
  // MUST be in-page UI, not window.alert(): iOS saved-to-home-screen apps
  // silently swallow alert(), which made every failure below invisible —
  // users saw the pass counter dip and then nothing (2026-07-05, Richard's
  // own iPhone PWA). Every failure path sets this instead of alerting.
  const [joinError, setJoinError] = useState<string | null>(null);
  // Synchronous re-entrancy guard. setState (joiningLobby) doesn't take effect
  // until the next render, so two taps in the same frame would BOTH get past it
  // and each spend a pass + join a draft (mobile double-tap = double-charge).
  // A ref flips immediately, so the second concurrent call bails before the
  // first `await`. Reset on every failure path so a retry is allowed; the
  // success path navigates away (unmount), which clears it too.
  const inFlightRef = useRef(false);

  const isLive = isStagingMode() && !!user?.walletAddress;

  const enterDraftWithPassType = async (
    passType: 'paid' | 'free',
    speed: 'fast' | 'slow' = 'fast',
    // Password-gated private league target (the /private/[id] page). When set,
    // the join goes to the group's own currently-filling draft instead of the
    // public matchmaker — every other part of the flow (join-first, overlay,
    // retries, bookkeeping, navigation) is IDENTICAL, which is exactly why the
    // private page rides this hook instead of forking it.
    privateLeague?: { id: string; password: string },
    opts?: {
      /** User explicitly chose a public draft over their private league. */
      forcePublic?: boolean;
    },
  ) => {
    if (!user?.walletAddress) return;
    if (inFlightRef.current) return; // a join is already in flight — ignore the double-tap

    // Private-league auto-routing (ticket-2681, 2026-08-14). A member who
    // unlocked /private/[id] expects EVERY "Enter Draft" to be their group's
    // draft — before this, those clicks went to the public matchmaker and
    // burned passes on strangers' lobbies (AceJohn). So without an explicit
    // target: route into the remembered league, on its fixed lane, with a
    // paid pass (private leagues never take free passes). EntryFlowModal
    // names the league and offers the public escape (opts.forcePublic).
    let autoPrivate = false;
    if (!privateLeague && !opts?.forcePublic) {
      const active = getActivePrivateLeague();
      if (active) {
        privateLeague = { id: active.id, password: active.password };
        passType = 'paid';
        speed = active.draftType;
        autoPrivate = true;
      }
    }

    inFlightRef.current = true;
    setJoinError(null);
    // Overlay up from the TAP, not after the pass-spend round-trip. The spend
    // call can stall (iOS PWA resume with dead sockets); before this change the
    // user got zero feedback until it returned — a dead button with a dipped
    // pass counter. Every early-return below must setJoiningLobby(false).
    setJoiningLobby(true);

    const beforePaid = user.draftPasses || 0;
    const beforeFree = user.freeDrafts || 0;

    // Optimistic local update so the header ticks down on click. Rolled
    // back below if the backend rejects.
    if (passType === 'paid') {
      updateUser({ draftPasses: Math.max(0, beforePaid - 1) });
    } else {
      updateUser({ freeDrafts: Math.max(0, beforeFree - 1) });
    }

    // Non-staging / local mode: no Go engine exists here, so the Firestore
    // decrement stays the gate (it's the only ledger in this mode). Live mode
    // skips this entirely — the Go join below is the authoritative gate.
    if (!isLive) {
      let decremented = false;
      try {
        // 12s cap so a lost reply can't hang the flow forever.
        const spendController = new AbortController();
        const spendTimeout = setTimeout(() => spendController.abort(), 12_000);
        let res: Response;
        try {
          res = await fetch('/api/owner/use-pass', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: user.id || user.walletAddress, passType, speed }),
            signal: spendController.signal,
          });
        } finally {
          clearTimeout(spendTimeout);
        }
        const body = await res.json().catch(() => ({}));
        decremented = res.ok && !!body?.decremented;
      } catch (err) {
        reportClientEvent({
          source: 'draft.enter.spend_fail',
          message: `use-pass failed/timed out (local mode): ${err instanceof Error ? err.message : String(err)}`,
          route: 'enter-draft', actor: user.walletAddress,
          context: { speed, passType, err: err instanceof Error ? err.message : String(err) },
        }, { skipThrottle: true });
        updateUser({ draftPasses: beforePaid, freeDrafts: beforeFree });
        void refreshBalance();
        setJoiningLobby(false);
        setJoinError('Connection hiccup — your pass was NOT used. Tap Enter again. If it keeps happening, close and reopen the app.');
        inFlightRef.current = false;
        return;
      }

      if (!decremented) {
        updateUser({ draftPasses: beforePaid, freeDrafts: beforeFree });
        void refreshBalance();
        setJoiningLobby(false);
        setJoinError('No draft passes available. Your balance has been refreshed.');
        inFlightRef.current = false;
        return;
      }
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
    // (Overlay is already up — shown at the tap.) Hold it for a minimum beat
    // so the branded "Joining lobby…" transition is always clearly visible,
    // even when joinDraft resolves near-instantly. Never pads beyond this.
    const MIN_OVERLAY_MS = 700;
    const overlayStart = Date.now();
    // DIAGNOSTIC breadcrumbs (Boris 2026-07-05): per-attempt join timing.
    // reportClientEvent posts to Vercel (/api/client-errors), a different host
    // than the Go join, so it can't compete with it. Fire-and-forget.
    reportClientEvent({
      source: 'draft.enter.join_start',
      message: `starting join (${speed}/${passType}${privateLeague ? ` → private:${privateLeague.id}${autoPrivate ? ' (auto)' : ''}` : ' → public'}) — join-first, nothing spent yet`,
      route: 'enter-draft', actor: user.walletAddress,
      context: { speed, passType, privateLeagueId: privateLeague?.id ?? null, autoPrivate },
    }, { skipThrottle: true });
    // Go's rejections that a retry can never change: no matching pass in the
    // wallet, or the season join deadline passed. Retrying these just makes
    // the user stare at the overlay for two extra backoffs.
    const isDeterministicRejection = (msg: string) =>
      /not enough (paid|free) draft passes/i.test(msg) ||
      /deadline to join has passed/i.test(msg) ||
      /incorrect password/i.test(msg);
    let rejectionMsg: string | null = null;
    let draftRoom: Awaited<ReturnType<typeof joinDraft>> | null = null;
    const MAX_JOIN_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_JOIN_RETRIES; attempt++) {
      const t0 = Date.now();
      try {
        draftRoom = privateLeague
          ? await joinPrivateDraft(user.walletAddress, privateLeague.id, privateLeague.password, speed, passType)
          : await joinDraft(user.walletAddress, speed, 1, passType);
        reportClientEvent({
          source: 'draft.enter.join_done',
          message: `join attempt ${attempt} → ${draftRoom?.id ? `draftId ${draftRoom.id}` : 'NO draft id'} in ${Date.now() - t0}ms`,
          route: 'enter-draft', actor: user.walletAddress,
          context: { attempt, draftId: draftRoom?.id ?? null, ms: Date.now() - t0, speed },
        }, { skipThrottle: true });
        if (draftRoom?.id) break;
        throw new Error('Join failed: no draft ID');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        reportClientEvent({
          source: 'draft.enter.join_fail',
          message: `join attempt ${attempt}/${MAX_JOIN_RETRIES} failed in ${Date.now() - t0}ms: ${msg}`,
          route: 'enter-draft', actor: user.walletAddress,
          context: { attempt, ms: Date.now() - t0, speed, err: msg },
        }, { skipThrottle: true });
        logger.warn(`[Enter] join attempt ${attempt}/${MAX_JOIN_RETRIES} failed`, { err: msg });
        if (isDeterministicRejection(msg)) {
          rejectionMsg = msg;
          break;
        }
        if (attempt < MAX_JOIN_RETRIES) await new Promise(r => setTimeout(r, 1500 * attempt));
      }
    }

    if (!draftRoom?.id) {
      // Join failed (retries exhausted, or Go rejected outright). NOTHING was
      // spent — join-first means no decrement happened, so there is nothing to
      // refund. Roll back the optimistic header tick and tell the user.
      reportClientEvent({
        source: 'draft.enter.no_lobby',
        message: `join did not land (${rejectionMsg ? `rejected: ${rejectionMsg.trim()}` : `all ${MAX_JOIN_RETRIES} attempts failed`}) — nothing spent, took ${Date.now() - overlayStart}ms total`,
        route: 'enter-draft', actor: user.walletAddress,
        context: { speed, passType, totalMs: Date.now() - overlayStart, rejected: !!rejectionMsg },
      }, { skipThrottle: true });
      setJoiningLobby(false);
      updateUser({ draftPasses: beforePaid, freeDrafts: beforeFree });
      void refreshBalance();
      if (rejectionMsg && /not enough/i.test(rejectionMsg)) {
        setJoinError(autoPrivate
          ? 'Your private league takes paid Draft Passes and you have none available. Get a pass, then tap Enter Draft again.'
          : 'No draft passes available. Your balance has been refreshed.');
      } else if (rejectionMsg && /incorrect password/i.test(rejectionMsg)) {
        if (autoPrivate) {
          // The remembered password no longer works (commissioner rotated it).
          // Kill the stale session so joins don't dead-end here forever, and
          // send the member back to their league link for the new password.
          clearActivePrivateLeague({ alsoPassword: true });
          setJoinError('Your league password changed. Your pass was NOT used — open your league page link and enter the new password.');
        } else {
          setJoinError('Incorrect league password. Your pass was NOT used — re-enter the password and try again.');
        }
      } else if (rejectionMsg) {
        setJoinError('Joining is closed — the deadline to enter drafts has passed.');
      } else {
        setJoinError('Could not join a draft right now. Your pass was NOT used — please try again.');
      }
      inFlightRef.current = false;
      return;
    }

    const newId = draftRoom.id;
    const joinedCount = Math.min(Math.max(Number(draftRoom.players) || 1, 1), 10);
    const joinedAt = Date.now();

    // Post-join bookkeeping (NON-BLOCKING — the user is already seated, this
    // must never delay or fail the flow). The Go join consumed the real token;
    // this syncs the Firestore mirror counter to that reality, writes the
    // draft_entered feed row WITH the real leagueId (no more phantom rows on
    // failed joins), and fires the admin new-user bell. keepalive lets the
    // request survive the route change to /draft-room. If it's lost, the
    // mirror self-heals on the next balance read — we only log the miss.
    void fetch('/api/owner/use-pass', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: user.id || user.walletAddress,
        passType,
        speed,
        leagueId: newId,
        joined: true,
      }),
      keepalive: true,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`post-join bookkeeping returned ${res.status}`);
      })
      .catch((err) => {
        reportClientError({
          source: 'draft.enter.bookkeep_fail',
          message: err instanceof Error ? err.message : String(err),
          route: 'enter-draft', actor: user.walletAddress,
          context: { passType, leagueId: newId, speed },
        });
      });

    // A successful join is fresh explicit intent: make sure this draft id is
    // OFF the hidden/cleared blacklists before persisting the row. Without
    // this, re-entering a lobby id you'd previously "Clear All"-ed left the
    // new seat permanently invisible on the drafting page (2026-07-23 wave —
    // Clear All leaves drafts backend-side, the router re-seats you into the
    // same reopened lobby id, and the blacklist then hides your real seat).
    try {
      for (const key of ['banana-hidden-drafts', 'banana-cleared-drafts']) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const ids: string[] = JSON.parse(raw);
        if (Array.isArray(ids) && ids.includes(newId)) {
          localStorage.setItem(key, JSON.stringify(ids.filter((i) => i !== newId)));
        }
      }
    } catch { /* non-fatal — the self-heal poll un-hides on next pass */ }

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

  const clearJoinError = () => setJoinError(null);

  return { joiningLobby, joinError, clearJoinError, enterDraftWithPassType };
}
