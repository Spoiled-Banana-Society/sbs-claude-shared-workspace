'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { usePromos } from '@/hooks/usePromos';
import { isDraftingOpen } from '@/lib/draftTypes';
import { isStagingMode, getDraftServerUrl } from '@/lib/staging';
import { useActiveDrafts } from '@/hooks/useActiveDrafts';
import * as draftStore from '@/lib/draftStore';
import type { DraftState } from '@/lib/draftStore';
import type { ApiDraftToken } from '@/lib/api/owner';
import * as draftApi from '@/lib/draftApi';
import { leaveDraft, joinDraft } from '@/lib/api/leagues';
import { useContests } from '@/hooks/useContests';
import { fetchJson } from '@/lib/appApiClient';
import { filterAndSortVisiblePromos } from '@/lib/promoFilter';
import type { DraftQueue, Promo } from '@/types';
import { logger } from '@/lib/logger';
import { subscribeDraftNumPlayers, subscribeDraftDisplayName } from '@/lib/api/firebase';
import { setLeagueNumberInCache } from '@/hooks/useLeagueNumberForSlot';
import { clientLog } from '@/lib/clientLog';
import { reportClientError } from '@/lib/clientErrors';
import { LOG_SOURCES } from '@/lib/logSources';
import type { Draft, LiveState } from '@/components/drafting/DraftRow';
import type { DraftInfoPayload, TimerPayload } from '@/hooks/useDraftWebSocket';

type DraftingPageSocketMessage =
  | { type: 'timer_update'; payload: TimerPayload }
  | { type: 'draft_info_update'; payload: DraftInfoPayload }
  | { type: 'draft_complete'; payload?: unknown }
  | { type?: string; payload?: unknown };

function isTimerUpdateMessage(data: DraftingPageSocketMessage): data is Extract<DraftingPageSocketMessage, { type: 'timer_update' }> {
  return data.type === 'timer_update';
}

function isDraftInfoUpdateMessage(data: DraftingPageSocketMessage): data is Extract<DraftingPageSocketMessage, { type: 'draft_info_update' }> {
  return data.type === 'draft_info_update';
}

function getSnakeDrafterIndex(pickNumber: number): number {
  const round = Math.ceil(pickNumber / 10);
  const posInRound = (pickNumber - 1) % 10;
  return round % 2 === 1 ? posInRound : 9 - posInRound;
}

function computeTurnsFromServer(
  info: draftApi.DraftInfoResponse,
  walletAddress: string,
): { turnsUntilUserPick: number; isUserTurn: boolean; pickEndTimestamp: number | undefined } {
  const wallet = walletAddress.toLowerCase();
  const currentDrafter = (info.currentDrafter || '').toLowerCase();
  const isUserTurn = wallet !== '' && wallet === currentDrafter;

  const userIndex = info.draftOrder.findIndex(
    entry => entry.ownerId.toLowerCase() === wallet,
  );

  let turnsUntilUserPick = 0;
  if (!isUserTurn && userIndex >= 0) {
    const totalPicks = (info.draftOrder.length || 10) * 15;
    for (let i = 1; i <= totalPicks - info.pickNumber + 1; i++) {
      if (getSnakeDrafterIndex(info.pickNumber + i) === userIndex) {
        turnsUntilUserPick = i;
        break;
      }
    }
  }

  return {
    turnsUntilUserPick,
    isUserTurn,
    pickEndTimestamp: info.currentPickEndTime || undefined,
  };
}

function getBarTimers(): Map<string, number> {
  if (typeof window === 'undefined') return new Map();
  const win = window as Window & { __draftBarTimers?: Map<string, number> };
  if (!win.__draftBarTimers) {
    win.__draftBarTimers = new Map<string, number>();
  }
  return win.__draftBarTimers;
}

export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (hours < 24) return `${hours} hr${hours > 1 ? 's' : ''} ago`;
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  if (s < 60) return `${s}s`;
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function useDraftingPageState() {
  const router = useRouter();
  const { isLoggedIn, user, setShowLoginModal, updateUser, refreshBalance, isLoading: authLoading, isBB3Holder, newUserPromoClaimed, isTwitterVerified, isBalanceLoaded } = useAuth();
  const contestsQuery = useContests();
  const contest = contestsQuery.data?.[0] ?? null;
  const promosQuery = usePromos({ userId: user?.id });
  const rawPromos = promosQuery.promos ?? [];
  const localDrafts = useActiveDrafts();
  const isLive = isStagingMode() && !!user?.walletAddress;

  const [showContestDetails, setShowContestDetails] = useState(false);
  const [infoTopic, setInfoTopic] = useState<string | null>(null);
  const [liveDrafts, setLiveDrafts] = useState<Draft[]>([]);
  // Tracks which wallet's live-drafts API call has completed at least once.
  // Lets us distinguish "still fetching" from "fetched and genuinely empty"
  // — without it, page refresh briefly renders the empty-state hero before
  // the API returns active drafts.
  const [liveDraftsLoadedFor, setLiveDraftsLoadedFor] = useState<string | null>(null);
  const [, setTimers] = useState<Record<string, number>>({});
  const [exitingDraft, setExitingDraft] = useState<Draft | null>(null);
  const [showBuyPasses, setShowBuyPasses] = useState(false);
  const [selectedPromo, setSelectedPromo] = useState<Promo | null>(null);
  const [claimedPromos, setClaimedPromos] = useState<Set<string>>(new Set());
  // Apply shared whitelist + ordering. Sidebar shows the same 6-promo
  // set as the homepage carousel and /promos page.
  const promos = useMemo(() => {
    return filterAndSortVisiblePromos(rawPromos, {
      isBB3Holder,
      newUserPromoClaimed,
      firstPurchaseBonusGranted: !!user?.firstPurchaseBonusGranted,
      firstPurchasePromoUnlocked: !!user?.firstPurchasePromoUnlocked,
      flagsKnown: isBalanceLoaded,
      hasVisibleClaim: (p) => {
        if (!p.claimable || claimedPromos.has(p.id)) return false;
        if ((p.type === 'new-user' || p.type === 'tweet-engagement') && !isTwitterVerified) return false;
        return true;
      },
    });
  }, [rawPromos, isBB3Holder, newUserPromoClaimed, isTwitterVerified, claimedPromos, user?.firstPurchaseBonusGranted, user?.firstPurchasePromoUnlocked, isBalanceLoaded]);
  const promoCount = promos.length;
  const [claimSuccess, setClaimSuccess] = useState<{ show: boolean; count: number }>({ show: false, count: 0 });
  const [promoIndex, setPromoIndex] = useState(0);
  const [promoAutoRotate, setPromoAutoRotate] = useState(true);
  const [showEntryFlow, setShowEntryFlow] = useState(false);
  // True while the join network call is in flight after the user confirms
  // entry — drives the branded "Joining lobby…" overlay. Cleared on failure;
  // on success the page navigates away (drafting page unmounts) so it just
  // fades out with the route change.
  const [joiningLobby, setJoiningLobby] = useState(false);
  const [hiddenDraftIds, setHiddenDraftIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const stored = localStorage.getItem('banana-hidden-drafts');
      return stored ? new Set(JSON.parse(stored) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });
  // Drafts the user explicitly nuked via "Clear All". An explicit Clear All
  // overrides the self-heal step below — these are NEVER resurrected, even
  // for an active/in-progress draft. Separate from the general hidden list
  // so auto-hides can still be un-healed while explicit clears stay cleared.
  const [explicitlyClearedIds, setExplicitlyClearedIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const stored = localStorage.getItem('banana-cleared-drafts');
      return stored ? new Set(JSON.parse(stored) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });
  const [queueDrafts, setQueueDrafts] = useState<Draft[]>([]);
  const [creatingQueueDraft, setCreatingQueueDraft] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) {
      logger.debug('[Queue] No user.id, skipping queue poll');
      return;
    }

    const userId = user.id;
    const walletAddr = user.walletAddress;
    logger.debug('[Queue] Starting poll, userId:', userId, 'walletAddr:', walletAddr);

    const poll = () => {
      fetchJson<Record<string, DraftQueue>>('/api/queues')
        .then(async (queues) => {
          const drafts: Draft[] = [];
          let totalRounds = 0;

          for (const q of Object.values(queues)) {
            for (const r of q.rounds || []) {
              totalRounds++;
              if (r.status === 'completed') continue;

              const memberWallets = r.members?.map((m: { wallet?: string }) => m.wallet) || [];
              const isMember = r.members?.some((m: { wallet?: string }) =>
                m.wallet?.toLowerCase() === userId.toLowerCase() ||
                m.wallet?.toLowerCase() === walletAddr?.toLowerCase(),
              );

              logger.debug('[Queue]', q.type, 'round', r.roundId, ':', isMember ? 'MATCH' : 'no match', 'wallets:', memberWallets.join(','));
              if (!isMember) continue;

              drafts.push({
                id: `queue-${q.type}-${r.roundId}`,
                queueDraftId: r.draftId || undefined,
                contestName: `${q.type === 'jackpot' ? 'Jackpot' : 'HOF'} #${r.roundId}`,
                status: 'filling',
                type: q.type as 'jackpot' | 'hof',
                draftSpeed: 'slow',
                players: r.members?.length || 1,
                maxPlayers: 10,
                joinedAt: r.members?.find((m: { wallet?: string }) =>
                  m.wallet?.toLowerCase() === userId.toLowerCase() ||
                  m.wallet?.toLowerCase() === walletAddr?.toLowerCase(),
                )?.joinedAt || Date.now(),
                lastUpdated: Date.now(),
                specialType: q.type as 'jackpot' | 'hof',
              });
            }
          }

          // Reconcile against Go API: Firestore queue state can lag behind the
          // actual draft (e.g. fill-bots ran on the Go side but the queue's
          // status/members weren't synced). For any round that already has a
          // draftId, trust the Go API's draftOrder length + pickNumber over the
          // queue's stale "filling" / member-count view. If the draft is fully
          // done (all 150 picks made), mark completed so the activeDrafts
          // filter at line 928 removes it from the lobby.
          const TOTAL_PICKS = 150;
          await Promise.all(drafts.map(async (d) => {
            if (!d.queueDraftId) return;
            try {
              const { getDraftInfo, getDraftSummary } = await import('@/lib/api/drafts');
              const info = await getDraftInfo(d.queueDraftId);
              const orderLen = info.draftOrder?.length ?? 0;
              const pickNum = info.pickNumber ?? 0;
              if (orderLen >= 10) {
                d.players = 10;
                d.maxPlayers = 10;
                if (pickNum > 0) {
                  d.status = 'drafting';
                  // intentionally NOT setting d.currentPick — it's "turns
                  // until user's next pick", not absolute pick number, and
                  // we don't compute that here. Leaving it undefined keeps
                  // DraftRoomCard / LeagueTable from rendering bogus "N picks
                  // away" copy.
                }
                // Only check completion when pickNumber is at or past the end.
                if (pickNum >= TOTAL_PICKS) {
                  try {
                    const summary = await getDraftSummary(d.queueDraftId);
                    const made = summary.filter(p => p?.playerId).length;
                    if (made >= TOTAL_PICKS) d.status = 'completed';
                  } catch {}
                }
              }
            } catch {
              // Go API unavailable / no state yet → leave queue data as-is.
            }
          }));

          logger.debug('[Queue] Found', drafts.length, 'matching queue drafts out of', totalRounds, 'total rounds');
          setQueueDrafts(drafts);
        })
        .catch((e) => {
          console.error('[Queue] Poll failed:', e);
          // 5s poll — reportClientError's per-source throttle dedupes the spam.
          reportClientError({
            source: LOG_SOURCES.draft.QUEUE_POLL_FAILED,
            message: e instanceof Error ? e.message : String(e),
            route: 'drafting',
            actor: user?.walletAddress,
          });
        });
    };

    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [isLive, user?.id, user?.walletAddress]);

  const handleClaim = async (promo: Promo, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (claimedPromos.has(promo.id)) return;

    setClaimedPromos(prev => new Set([...Array.from(prev), promo.id]));
    const fallbackCount = promo.claimCount || 1;
    const claimResult = await promosQuery.claimPromo(promo.id);
    if (claimResult instanceof Error) {
      return;
    }
    if (!claimResult && user) {
      updateUser({ wheelSpins: (user.wheelSpins || 0) + fallbackCount });
    }
    setClaimSuccess({ show: true, count: claimResult?.spinsAdded ?? fallbackCount });
    setTimeout(() => setClaimSuccess({ show: false, count: 0 }), 2000);
  };

  const buildDraftRoomUrl = (draft: Draft) => {
    // Don't pass a numbered name for filling drafts — batch number only assigned after start
    const isFilling = draft.status === 'filling' || (draft.players || 0) < 10;
    const params = new URLSearchParams({
      id: draft.queueDraftId || draft.id,
      name: isFilling ? 'Draft Room' : draft.contestName,
      speed: draft.draftSpeed,
      players: String(draft.players),
    });
    if (isLive && user?.walletAddress) {
      params.set('mode', 'live');
      params.set('wallet', user.walletAddress);
    }
    if (draft.passType) params.set('passType', draft.passType);
    const st = draft.specialType || ((draft.type === 'jackpot' || draft.type === 'hof') && draft.draftSpeed === 'slow' ? draft.type : undefined);
    if (st) params.set('specialType', st);
    return `/draft-room?${params.toString()}`;
  };

  const handleDraftClick = async (draft: Draft) => {
    if (draft.specialType && draft.id.startsWith('queue-')) {
      if ((draft.players || 0) < 10) {
        router.push(buildDraftRoomUrl(draft));
        return;
      }

      // Reconciled to 10/10 with a draftId already on file → the actual draft
      // exists, just open it. Skips a redundant /api/queues/create-draft call
      // (which itself short-circuits to the same id, but we don't need the
      // round trip + bot-fill retry path).
      if (draft.queueDraftId) {
        router.push(buildDraftRoomUrl(draft));
        return;
      }

      setCreatingQueueDraft(draft.id);
      try {
        const parts = draft.id.split('-');
        const queueType = parts[1];
        const roundId = parseInt(parts[2] || '1', 10) || 1;
        const res = await fetchJson<{ draftId: string }>('/api/queues/create-draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user?.id || user?.walletAddress || '',
            queueType,
            roundId,
          }),
        });

        if (res.draftId) {
          let finalDraftId = res.draftId;
          try {
            const queues = await fetchJson<Record<string, { rounds?: Array<{ roundId: number; draftId?: string | null }> }>>('/api/queues');
            const round = queues[queueType]?.rounds?.find(r => r.roundId === roundId);
            if (round?.draftId) finalDraftId = round.draftId;
          } catch {}

          router.push(buildDraftRoomUrl({ ...draft, queueDraftId: finalDraftId }));
        }
      } catch (err) {
        console.error('Failed to create queue draft:', err);
      } finally {
        setCreatingQueueDraft(null);
      }
      return;
    }

    router.push(buildDraftRoomUrl(draft));
  };

  const enterDraftWithPassType = async (passType: 'paid' | 'free', speed: 'fast' | 'slow' = 'fast') => {
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
        draftRoom = await joinDraft(user.walletAddress, speed, 1, undefined, passType);
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
              route: 'drafting',
              actor: user.walletAddress,
              context: { passType, userId: user.id || user.walletAddress, status: res.status },
            });
          }
        })
        .catch((err) => {
          reportClientError({
            source: LOG_SOURCES.draft.JOIN_REFUND_FAILED,
            message: err instanceof Error ? err.message : String(err),
            route: 'drafting',
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
    // Stamp the moment we leave /drafting so the draft room can measure the
    // hand-off gap (the blank/flash before the lobby paints) and surface a
    // slow hand-off to the admin error feed. Best-effort; cleared on the room side.
    try { sessionStorage.setItem('sbs-join-nav-ts', String(Date.now())); } catch { /* ignore */ }
    router.push(`/draft-room?${params.toString()}`);
  };

  const handleEnterDraft = () => {
    if (!isDraftingOpen()) {
      alert('Drafting is closed for the season.');
      return;
    }
    if (!isLoggedIn) {
      // If this fires while you're actually logged in, the auth-blink alarm
      // (auth.spurious_login_modal in providers.tsx) catches it signal-only.
      setShowLoginModal(true);
      return;
    }

    const paidPasses = user?.draftPasses || 0;
    const freePasses = user?.freeDrafts || 0;
    if (paidPasses + freePasses <= 0) {
      setShowBuyPasses(true);
      return;
    }

    setShowEntryFlow(true);
  };

  const handleEntryComplete = (passType: 'paid' | 'free', speed: 'fast' | 'slow') => {
    setShowEntryFlow(false);
    void enterDraftWithPassType(passType, speed);
  };

  useEffect(() => {
    if (!isLive) return;

    let cancelled = false;
    const loadLiveDrafts = async () => {
      try {
        const { getOwnerDraftTokens } = await import('@/lib/api/owner');
        const raw = await getOwnerDraftTokens(user!.walletAddress!);
        if (cancelled) return;
        const tokens: ApiDraftToken[] = Array.isArray(raw) ? raw : [];

        const activeTokens = tokens.filter((t) => {
          if (!t.leagueId) return false;
          if (t.roster) {
            const rosterCount = (t.roster.QB?.length || 0)
              + (t.roster.RB?.length || 0)
              + (t.roster.WR?.length || 0)
              + (t.roster.TE?.length || 0)
              + (t.roster.DST?.length || 0);
            // Completed drafts (15 picks) leave My Drafts. In-progress drafts
            // are NEVER suppressed by the hidden list — if you hold a token
            // for a live draft you must always see it. "Clear All" blacklists
            // every current leagueId, and draft ids get reused, so an active
            // draft can wrongly land on the hidden list. Un-heal step below.
            if (rosterCount >= 15) return false;
          }
          return true;
        });

        // Self-heal: drop any live (non-completed) draft id from the hidden
        // list. Without this, one auto-hide permanently hides a draft the
        // user is actively in on that device. Exception: drafts the user
        // explicitly nuked via "Clear All" are NEVER un-hidden here — an
        // explicit Clear All overrides the active-draft protection.
        const wronglyHidden = activeTokens
          .map((t) => t.leagueId)
          .filter((id) => hiddenDraftIds.has(id) && !explicitlyClearedIds.has(id));
        if (wronglyHidden.length > 0) {
          clientLog('mydrafts', 'unhid.active.drafts', { ids: wronglyHidden });
          setHiddenDraftIds((prev) => {
            const next = new Set(prev);
            for (const id of wronglyHidden) next.delete(id);
            try { localStorage.setItem('banana-hidden-drafts', JSON.stringify([...next])); } catch { /* quota */ }
            return next;
          });
        }

        // Fetch current player count + drafting-state for each active draft.
        // numPlayers === 10 means the backend has created the draft state
        // (via /state/info fallback), so the draft has actually started.
        const stateResults = await Promise.all(
          activeTokens.map(async (t): Promise<{ players: number; isDrafting: boolean }> => {
            try {
              const res = await fetch(`/api/drafts/league-players?draftId=${encodeURIComponent(t.leagueId)}`);
              if (!res.ok) return { players: 1, isDrafting: false };
              const data = await res.json();
              const numPlayers = Number(data.numPlayers) || 0;
              return { players: Math.max(1, numPlayers), isDrafting: numPlayers >= 10 };
            } catch {
              return { players: 1, isDrafting: false };
            }
          }),
        );
        if (cancelled) return;

        const mapped: Draft[] = activeTokens.map((t, i) => {
          const { players, isDrafting } = stateResults[i];
          const draftSpeed: 'fast' | 'slow' = t.leagueId.includes('-slow-') ? 'slow' : 'fast';
          // Type is only known after the draft fills and the backend classifies
          // it (slot-machine reveal). While filling, the token still reports
          // level: "Pro" by default — use null to mark unrevealed so the UI
          // shows "Unrevealed" instead of lying "PRO ✓ Verified".
          let type: Draft['type'];
          if (t.level === 'Jackpot') type = 'jackpot';
          else if (t.level === 'Hall of Fame') type = 'hof';
          else type = isDrafting ? 'pro' : null;
          return {
            id: t.leagueId || t.cardId,
            // Trust the backend's displayName (sourced from doc.DisplayName).
            // Never fall back to slot-id-derived "League #N" — the slot
            // counter drifts from the global league number, so that fallback
            // produces the wrong number. Empty signals DraftRow to render
            // "League…" until useLeagueNumberForSlot resolves the real one.
            contestName: t.leagueDisplayName || '',
            status: isDrafting ? 'drafting' : 'filling',
            type,
            draftSpeed,
            players,
            maxPlayers: 10,
            lastUpdated: Date.now(),
            cardId: t.cardId,
          };
        });

        // Read hidden ids fresh from localStorage rather than the React-state
        // closure. confirmExitDraft writes the just-left id to localStorage
        // synchronously but setHiddenDraftIds is async; without this read,
        // a poll firing in the gap re-adds the draft because its closure
        // still has the stale set. That's the "had to leave twice" bug.
        let freshHiddenIds: Set<string> = hiddenDraftIds;
        try {
          const raw = localStorage.getItem('banana-hidden-drafts');
          if (raw) freshHiddenIds = new Set(JSON.parse(raw) as string[]);
        } catch { /* fall through to closure value */ }

        for (const d of mapped) {
          if (freshHiddenIds.has(d.id)) continue;
          // Whenever the API returns a fresh non-empty leagueDisplayName,
          // push the parsed league # into the global cache. Survives
          // stale localStorage / module cache from earlier sessions
          // where the value may have been wrong. Idempotent — same
          // value is a no-op.
          if (d.contestName) {
            const m = /^BBB\s*#(\d+)$/i.exec(d.contestName);
            if (m) setLeagueNumberInCache(d.id, Number(m[1]));
          }
          const existing = draftStore.getDraft(d.id);
          if (!existing) {
            draftStore.addDraft({
              ...d,
              liveWalletAddress: user!.walletAddress!,
              phase: d.status === 'drafting' ? 'drafting' : 'filling',
            });
            continue;
          }
          // Always refresh contestName when API has a fresh non-empty
          // value that differs from stored. The drafting-phase branch
          // below otherwise leaves contestName untouched, which means
          // any wrong value cached during a previous race stays wrong
          // forever — exactly what produced the "League #814" bug for
          // slot 814 (correct league # is 815, but store had a stale
          // "BBB #814" from an earlier API response and never refreshed).
          if (d.contestName && d.contestName !== existing.contestName) {
            draftStore.updateDraft(d.id, { contestName: d.contestName });
          }
          // Always refresh type / draftSpeed / draftType on rows that haven't
          // actually transitioned into drafting yet. These fields don't depend
          // on slot-machine / randomizing animation state, so stale values
          // from pre-fix deploys should get corrected even if preSpinStartedAt
          // or randomizingStartedAt happens to be lingering. We only guard
          // players/status against the drafting-confirmed case so the in-room
          // flow isn't reverted.
          // Heal liveWalletAddress on any row where we've confirmed the
          // current wallet owns this leagueId (the token came back from
          // /owner/{currentWallet}/draftToken/all). Without this, legacy rows
          // with no liveWalletAddress stamp get excluded from wallet-scoped
          // background loops and never receive currentPick/timer updates —
          // the UI falls back to generic "In progress" forever.
          const currentWallet = user!.walletAddress!;
          const needsWalletStamp = !existing.liveWalletAddress
            || existing.liveWalletAddress.toLowerCase() !== currentWallet.toLowerCase();

          const isConfirmedDrafting = existing.phase === 'drafting' || existing.status === 'drafting';
          // Heal cardId on any existing row missing it. Without cardId, the
          // Go API leave endpoint can't match (it requires ownerId AND
          // tokenId) and silently 500s — phantom drafts that won't leave.
          const needsCardId = !existing.cardId && !!d.cardId;
          if (!isConfirmedDrafting) {
            draftStore.updateDraft(d.id, {
              status: d.status,
              type: d.type,
              draftSpeed: d.draftSpeed,
              players: d.players,
              draftType: d.type,
              ...(needsWalletStamp ? { liveWalletAddress: currentWallet } : {}),
              ...(needsCardId ? { cardId: d.cardId } : {}),
            });
          } else {
            // For rows already drafting, we still heal speed/type if unset
            // and stamp the wallet so background polls actually run.
            const patch: Partial<typeof existing> = {};
            if (!existing.draftSpeed || existing.draftSpeed !== d.draftSpeed) patch.draftSpeed = d.draftSpeed;
            if (existing.type == null && d.type != null) patch.type = d.type;
            if (needsWalletStamp) patch.liveWalletAddress = currentWallet;
            if (needsCardId) patch.cardId = d.cardId;
            if (Object.keys(patch).length > 0) draftStore.updateDraft(d.id, patch);
          }
        }
        setLiveDrafts(mapped);

        // Cross-device leave sync: if the user left a draft on another
        // device, their token list (from /owner/{wallet}/draftToken/all)
        // no longer includes that draft, but this device's localStorage
        // still does. Drop any stored draft whose id isn't in the live
        // token set. Scoped to current wallet so we don't nuke another
        // account's cached rows during a wallet switch. Skips `pending-*`
        // placeholder ids (an in-flight join hasn't yielded a real id yet).
        const validLeagueIds = new Set(activeTokens.map(t => t.leagueId));
        const currentWalletLower = user!.walletAddress!.toLowerCase();
        for (const stored of draftStore.getActiveDrafts()) {
          if (!stored.id || stored.id.startsWith('pending-')) continue;
          if (stored.specialType) continue; // queue drafts have their own lifecycle
          const storedWallet = stored.liveWalletAddress?.toLowerCase();
          if (!storedWallet || storedWallet !== currentWalletLower) continue;
          if (!validLeagueIds.has(stored.id)) {
            draftStore.removeDraft(stored.id);
          }
        }
      } catch (err) {
        console.error('[Drafting] Failed to load live drafts:', err);
      } finally {
        if (!cancelled && user?.walletAddress) {
          setLiveDraftsLoadedFor(user.walletAddress);
        }
      }
    };

    void loadLiveDrafts();
    // Re-poll every 5s so a leave on another device clears this one within
    // ~5s instead of needing a manual refresh. Also re-poll on tab focus —
    // common case is user switches back from phone to laptop.
    const interval = setInterval(() => { void loadLiveDrafts(); }, 5000);
    const onFocus = () => { void loadLiveDrafts(); };
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [hiddenDraftIds, explicitlyClearedIds, isLive, user]);

  // Only poll filling drafts that belong to the currently-authenticated wallet.
  // Legacy rows with no liveWalletAddress are intentionally excluded — a missed
  // background poll is recoverable on the next mount; misattributing one is
  // not (see cross-wallet guard on the syncLiveDrafts effect below).
  const fillingLiveDraftIds = useMemo(
    () => {
      const currentWallet = user?.walletAddress?.toLowerCase();
      if (!currentWallet) return [] as string[];
      return localDrafts
        .filter(d =>
          (d.phase === 'filling' || d.status === 'filling')
          && d.liveWalletAddress
          && d.liveWalletAddress.toLowerCase() === currentWallet,
        )
        .map(d => d.id);
    },
    [localDrafts, user?.walletAddress],
  );

  // Live player counts on /drafting cards — uses Firebase RTDB directly
  // instead of polling our /api/drafts/league-players endpoint every 3s.
  // The Go API writes drafts/{draftId}/numPlayers to RTDB on every join, so
  // a frontend onValue subscription gets push updates within milliseconds.
  // Replaces a 3s polling loop that left a race window where a user's
  // "8/10" card was already actually 10/10. Same Firebase project + bandwidth
  // we already pay for; per-connection cost is effectively zero.
  useEffect(() => {
    if (fillingLiveDraftIds.length === 0) return;
    const unsubs = fillingLiveDraftIds.map((draftId) =>
      subscribeDraftNumPlayers(draftId, (count) => {
        if (count > 0) draftStore.updateDraft(draftId, { players: count });
      }),
    );
    return () => {
      for (const unsub of unsubs) {
        try { unsub(); } catch { /* ignore */ }
      }
    };
  }, [fillingLiveDraftIds]);

  // Live league display name on /drafting cards — Go API writes
  // drafts/{draftId}/displayName to RTDB at the moment of fill, so the
  // row label updates within ~100ms of slot filling. Replaces the
  // REST retry-on-404 path in useLeagueNumberForSlot for live drafts.
  //
  // IMPORTANT — subscribe for ALL live drafts (not just filling). The
  // displayName WRITE fires at the fill transition; if we filter to
  // 'filling' only, the draft's phase flips to 'drafting' / 'starting'
  // milliseconds after the write and unmounts our subscription before
  // onValue delivers. Result: we permanently miss the update for any
  // draft the user is in when its slot is the 10th joiner. Subscribing
  // for all live drafts (filling + drafting + pre-start countdown)
  // costs essentially nothing on Firebase and guarantees delivery.
  const liveDraftIdsForDisplayName = useMemo(() => {
    const currentWallet = user?.walletAddress?.toLowerCase();
    if (!currentWallet) return [] as string[];
    return localDrafts
      .filter(d =>
        d.liveWalletAddress
        && d.liveWalletAddress.toLowerCase() === currentWallet
        && (d.phase === 'filling' || d.status === 'filling' || d.status === 'drafting' || d.phase === 'drafting'),
      )
      .map(d => d.id);
  }, [localDrafts, user?.walletAddress]);

  // Stable string key — `liveDraftIdsForDisplayName` is a new array
  // reference on every render of useDraftingPageState (which happens
  // constantly while the user has a drafting draft, because per-pick
  // state updates churn `localDrafts`). Without this stable key, the
  // useEffect cleanup fires on every render → subscription is torn
  // down before Firebase's onValue has time to deliver the initial
  // value → displayName push is never received. Caught in the logs
  // when the rtdb.subscribe/unsubscribe loop showed up with no
  // rtdb.event ever firing.
  const liveDraftIdsKey = liveDraftIdsForDisplayName.join(',');

  useEffect(() => {
    const ids = liveDraftIdsKey ? liveDraftIdsKey.split(',') : [];
    clientLog('league#', 'mydrafts.subs.effect', { count: ids.length, ids });
    if (ids.length === 0) return;
    const unsubs = ids.map((draftId) =>
      subscribeDraftDisplayName(draftId, (displayName) => {
        clientLog('league#', 'mydrafts.handler.fired', { draftId, displayName });
        draftStore.updateDraft(draftId, { contestName: displayName });
        const m = /^BBB\s*#(\d+)$/i.exec(displayName);
        if (m) {
          clientLog('league#', 'mydrafts.handler.parsed', { draftId, n: Number(m[1]) });
          setLeagueNumberInCache(draftId, Number(m[1]));
        } else {
          clientLog('league#', 'mydrafts.handler.no-parse', { draftId, displayName });
        }
      }),
    );
    return () => {
      for (const unsub of unsubs) {
        try { unsub(); } catch { /* ignore */ }
      }
    };
  }, [liveDraftIdsKey]);

  useEffect(() => {
    if (!isLive || !user?.walletAddress) return;

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const syncLiveDrafts = async () => {
      // Wallet-scope every iteration of this loop. Using the auth context's
      // wallet (not the stale `banana-last-wallet` localStorage the useActiveDrafts
      // hook reads) so the filter tracks auth state directly. Legacy rows with
      // no liveWalletAddress are skipped: their promo attribution would be
      // guessing, and misattributing promo credit across wallets is a real
      // data-corruption risk, not cosmetic.
      const currentWallet = user?.walletAddress?.toLowerCase();
      if (!currentWallet) return;

      const allDrafts = draftStore.getActiveDrafts();
      const liveDraftsToSync = allDrafts.filter(
        d => d.liveWalletAddress
          && d.liveWalletAddress.toLowerCase() === currentWallet
          && (d.status === 'filling' || d.status === 'drafting' || d.phase === 'drafting'),
      );

      for (const draft of liveDraftsToSync) {
        if (cancelled) return;

        // Always fetch state — completion detection must NEVER be skipped.
        // The heartbeat guard below only opts out of mid-draft *state*
        // updates (so we don't fight the active WS connection), but a
        // completed draft must always be removed from My Drafts so the
        // next league shows up live.
        let info;
        try {
          info = await draftApi.getDraftInfo(draft.id);
        } catch (err) {
          console.warn(`[Drafting] Failed to sync draft ${draft.id}:`, err);
          continue;
        }
        if (cancelled) return;

        // Early completion exit — bypasses the heartbeat skip so a
        // freshly-completed draft disappears the instant the next 3s
        // sync runs, not after the WS heartbeat goes stale.
        // ALSO adds the id to hiddenDraftIds (persisted in localStorage)
        // so the next loadLiveDrafts() can't re-add it via the user's
        // active-token list — completed drafts stay completed.
        {
          const totalPicks = (info.draftOrder?.length || 10) * 15;
          if ((info.pickNumber ?? 0) >= totalPicks) {
            draftStore.removeDraft(draft.id);
            setHiddenDraftIds((prev) => {
              if (prev.has(draft.id)) return prev;
              const next = new Set(prev);
              next.add(draft.id);
              try { localStorage.setItem('banana-hidden-drafts', JSON.stringify([...next])); } catch { /* quota */ }
              return next;
            });
            continue;
          }
        }

        const heartbeat = localStorage.getItem(`draft-room-ws:${draft.id}`);
        if (heartbeat && Date.now() - Number(heartbeat) < 10_000) continue;

        try {
          const fresh = draftStore.getDraft(draft.id) || draft;
          const playerCount = info.draftOrder?.length || 0;
          const hasDraftStarted = playerCount >= 10 && info.pickNumber >= 1;
          const isFull = playerCount >= 10;
          const isPaid = draft.passType !== 'free';

          // Promo side-effects: fire only when this draft unambiguously belongs
          // to the authenticated user. Belt-and-suspenders on top of the outer
          // wallet filter — if anything leaks through (race during wallet
          // switch, future refactor), this guard prevents misattribution.
          const draftOwnedByUser = draft.liveWalletAddress
            && draft.liveWalletAddress.toLowerCase() === currentWallet;

          // Fire draft-complete for EVERY pass type (not just paid). The
          // server credits paid drafts to daily-drafts as before, and routes
          // free/jackpot/HOF drafts to the first-purchase popup gate only —
          // existing promo logic is unchanged (the free branch earns no
          // daily-drafts credit). pick10 stays paid-only below.
          if (isFull && user?.id && draftOwnedByUser) {
            const trackedKey = `promo-tracked:${draft.id}`;
            if (!localStorage.getItem(trackedKey)) {
              localStorage.setItem(trackedKey, '1');
              fetch('/api/promos/draft-complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: user.id, draftId: draft.id, passType: draft.passType || 'paid' }),
              }).catch(() => {});
            }

            if (isPaid && info.draftOrder && draft.liveWalletAddress) {
              const userIdx = info.draftOrder.findIndex(
                (e: { ownerId: string }) => e.ownerId.toLowerCase() === draft.liveWalletAddress!.toLowerCase(),
              );
              if (userIdx === 9) {
                const pick10Key = `promo-pick10:${draft.id}`;
                if (!localStorage.getItem(pick10Key)) {
                  localStorage.setItem(pick10Key, '1');
                  fetch('/api/promos/pick10', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: user.id, draftId: draft.id, draftName: draft.contestName, passType: draft.passType || 'paid' }),
                  }).catch(() => {});
                }
              }
            }
          }

          if (hasDraftStarted) {
            const { turnsUntilUserPick, isUserTurn, pickEndTimestamp } =
              computeTurnsFromServer(info, draft.liveWalletAddress!);

            const totalPicks = (info.draftOrder?.length || 10) * 15;
            const isCompleted = info.pickNumber >= totalPicks;
            if (isCompleted) {
              draftStore.removeDraft(draft.id);
              continue;
            }

            // /state/info doesn't carry the current pick's absolute
            // end-timestamp, so fetch it from league-players which proxies
            // RTDB `realTimeDraftInfo.pickEndTime`. Authoritative source —
            // overrides any stale value from a previous draft-room write.
            let rtdbPickEnd: number | undefined;
            try {
              const lpRes = await fetch(`/api/drafts/league-players?draftId=${encodeURIComponent(draft.id)}`);
              if (lpRes.ok) {
                const lpData = await lpRes.json();
                if (typeof lpData.pickEndTime === 'number' && lpData.pickEndTime > 0) {
                  rtdbPickEnd = lpData.pickEndTime;
                }
              }
            } catch { /* ignore — fall back to prior computation */ }

            const nowMs = Date.now();
            const effectivePickEnd = rtdbPickEnd ?? pickEndTimestamp ?? fresh.pickEndTimestamp;
            const animStillRunning = (() => {
              if (fresh.randomizingStartedAt && !fresh.preSpinStartedAt) {
                return (nowMs - fresh.randomizingStartedAt) < 63000;
              }
              if (fresh.preSpinStartedAt) {
                return ((nowMs - fresh.preSpinStartedAt) / 1000) < 60;
              }
              return false;
            })();

            const patch: Partial<DraftState> = {
              currentPick: turnsUntilUserPick,
              isYourTurn: isUserTurn,
              pickEndTimestamp: effectivePickEnd,
              timeRemaining: isUserTurn && effectivePickEnd
                ? Math.max(0, Math.ceil(effectivePickEnd - nowMs / 1000))
                : undefined,
              enginePickNumber: info.pickNumber,
            };

            if (animStillRunning) {
              draftStore.updateDraft(draft.id, patch);
            } else {
              // Draft is actively drafting (pickNumber >= 1) and we don't have
              // a still-running reveal animation in local state. Mark drafting
              // directly and CLEAR any stale animation timestamps. The previous
              // version kicked off a brand-new randomizingStartedAt here when
              // the user exited a mid-draft and re-landed on /drafting — which
              // made the lobby replay the slot-machine reveal for a draft that
              // was already in round 2. Never replay; if you missed the reveal
              // by being in the draft room, you missed it.
              draftStore.updateDraft(draft.id, {
                ...patch,
                status: 'drafting',
                phase: 'drafting',
                players: 10,
                type: fresh.type || fresh.draftType || null,
                draftType: fresh.draftType || fresh.type || null,
                randomizingStartedAt: undefined,
                preSpinStartedAt: undefined,
              });
            }
          } else if (isFull) {
            const patch: Partial<DraftState> = { players: 10 };

            if (info.draftStartTime) {
              const serverPreSpin = info.draftStartTime * 1000 - 60000;
              if (!fresh.preSpinStartedAt) {
                if (fresh.randomizingStartedAt) {
                  const barStillRunning = (Date.now() - fresh.randomizingStartedAt) < 3000;
                  if (!barStillRunning) {
                    patch.preSpinStartedAt = serverPreSpin;
                    patch.randomizingStartedAt = undefined;
                    patch.phase = 'pre-spin';
                  }
                } else {
                  // Trust the server's pre-spin timestamp. If we landed here
                  // without ever running the bar locally (common on mobile:
                  // user opens /drafting after the draft already filled, or
                  // after backgrounding the tab), don't restart the 3s + 60s
                  // cycle from now — that double-counts: type reveals early
                  // because the freshly-set timestamp puts us past elapsed=23s
                  // on subsequent polls, then the countdown visibly restarts.
                  // Only run the bar if we're still actually in the pre-fill
                  // window where serverPreSpin is in the future.
                  if (Date.now() >= serverPreSpin) {
                    patch.preSpinStartedAt = serverPreSpin;
                    patch.phase = 'pre-spin';
                  } else {
                    patch.randomizingStartedAt = Date.now();
                  }
                }
              } else if (Math.abs(fresh.preSpinStartedAt - serverPreSpin) > 2000) {
                patch.preSpinStartedAt = serverPreSpin;
              }
            }

            draftStore.updateDraft(draft.id, patch);
          } else if (playerCount > 0 && draft.status === 'filling') {
            draftStore.updateDraft(draft.id, { players: playerCount });
          }
        } catch (err) {
          console.warn(`[Drafting] Failed to sync draft ${draft.id}:`, err);
        }
      }
    };

    void syncLiveDrafts();

    let focusTimeout: ReturnType<typeof setTimeout> | null = null;
    const onFocus = () => {
      if (focusTimeout) clearTimeout(focusTimeout);
      focusTimeout = setTimeout(() => {
        void syncLiveDrafts();
      }, 500);
    };

    window.addEventListener('focus', onFocus);
    intervalId = setInterval(() => {
      void syncLiveDrafts();
    }, 3000);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      if (focusTimeout) clearTimeout(focusTimeout);
      if (intervalId) clearInterval(intervalId);
    };
  }, [isLive, user?.id, user?.walletAddress]);

  const wsConnectionsRef = useRef<Map<string, WebSocket>>(new Map());

  useEffect(() => {
    if (!isLive || !user?.walletAddress) return;

    const wallet = user.walletAddress.trim().toLowerCase();
    const serverUrl = getDraftServerUrl() || 'wss://sbs-drafts-server-staging-652484219017.us-central1.run.app';

    const syncConnections = () => {
      // WS connections are opened with the current wallet as the `address` param
      // — stale connections from a prior wallet would auth against the wrong
      // user and leak events into the wrong account. Scope by current wallet
      // and let the effect's cleanup (which re-runs on user.walletAddress
      // change, see dep at bottom) close prior-wallet connections.
      const allDrafts = draftStore.getActiveDrafts();
      const draftingDrafts = allDrafts.filter(
        d => d.liveWalletAddress
          && d.liveWalletAddress.toLowerCase() === wallet
          && d.phase === 'drafting'
          && d.status === 'drafting',
      );

      const activeIds = new Set(draftingDrafts.map(d => d.id));
      const conns = wsConnectionsRef.current;

      conns.forEach((ws, id) => {
        const heartbeat = localStorage.getItem(`draft-room-ws:${id}`);
        const draftRoomActive = heartbeat && Date.now() - Number(heartbeat) < 10_000;
        if (!activeIds.has(id) || draftRoomActive) {
          ws.close();
          conns.delete(id);
        }
      });

      for (const draft of draftingDrafts) {
        if (conns.has(draft.id)) continue;

        const heartbeat = localStorage.getItem(`draft-room-ws:${draft.id}`);
        if (heartbeat && Date.now() - Number(heartbeat) < 10_000) continue;

        const url = `${serverUrl}/ws?address=${encodeURIComponent(wallet)}&draftName=${encodeURIComponent(draft.id)}`;
        const ws = new WebSocket(url);
        conns.set(draft.id, ws);

        let pingInterval: ReturnType<typeof setInterval> | null = null;
        ws.onopen = () => {
          logger.debug(`[Drafting WS] connected to ${draft.id}`);
          pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'ping', payload: {} }));
            }
          }, 30_000);
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data) as DraftingPageSocketMessage;
            const { type } = data;
            const draftId = draft.id;

            if (isTimerUpdateMessage(data)) {
              const payload = data.payload;
              const endTs = payload.endOfTurnTimestamp;
              const currentDrafter = (payload.currentDrafter || '').toLowerCase();
              const isUserTurn = wallet === currentDrafter;
              draftStore.updateDraft(draftId, {
                pickEndTimestamp: endTs,
                isYourTurn: isUserTurn,
                timeRemaining: endTs ? Math.max(0, Math.ceil(endTs - Date.now() / 1000)) : undefined,
              });
            }

            if (isDraftInfoUpdateMessage(data)) {
              const info = data.payload;
              const currentDrafter = (info.currentDrafter || '').toLowerCase();
              const isUserTurn = wallet === currentDrafter;
              const userIndex = (info.draftOrder || []).findIndex(
                (entry: { ownerId: string }) => entry.ownerId.toLowerCase() === wallet,
              );

              let turnsUntilUserPick = 0;
              if (!isUserTurn && userIndex >= 0) {
                const totalPicks = (info.draftOrder?.length || 10) * 15;
                for (let i = 1; i <= totalPicks - info.pickNumber + 1; i++) {
                  if (getSnakeDrafterIndex(info.pickNumber + i) === userIndex) {
                    turnsUntilUserPick = i;
                    break;
                  }
                }
              }

              draftStore.updateDraft(draftId, {
                currentPick: turnsUntilUserPick,
                isYourTurn: isUserTurn,
                enginePickNumber: info.pickNumber,
              });
            }

            if (type === 'draft_complete') {
              draftStore.removeDraft(draftId);
              ws.close();
              conns.delete(draftId);
            }
          } catch {}
        };

        ws.onclose = () => {
          if (pingInterval) clearInterval(pingInterval);
          conns.delete(draft.id);
        };

        ws.onerror = () => {};
      }
    };

    syncConnections();
    const interval = setInterval(syncConnections, 3000);

    return () => {
      clearInterval(interval);
      const conns = wsConnectionsRef.current;
      conns.forEach((ws) => ws.close());
      conns.clear();
    };
  }, [isLive, user?.walletAddress]);

  const activeDrafts = useMemo(() => {
    // Not signed in → don't show anyone else's drafts cached in localStorage.
    // The drafting list belongs to the authenticated wallet only.
    if (!user?.walletAddress) {
      return [] as Draft[];
    }

    const currentWallet = user.walletAddress.toLowerCase();
    // Filter cached local drafts to the current wallet so switching accounts
    // in the same browser doesn't bleed another user's placeholders.
    const ownedLocalDrafts = localDrafts.filter(d => {
      if (!d.liveWalletAddress) return true; // legacy entries without wallet stamp — allow
      return d.liveWalletAddress.toLowerCase() === currentWallet;
    });

    let base: Draft[];
    if (!isLive) {
      base = ownedLocalDrafts;
    } else {
      const localIds = new Set(ownedLocalDrafts.map(d => d.id));
      const apiOnly = liveDrafts.filter(d => !localIds.has(d.id));
      base = [...ownedLocalDrafts, ...apiOnly];
    }

    const storeByDraftId = new Map(base.map(d => [d.id, d]));
    const mergedQueueDrafts = queueDrafts.map((qd) => {
      if (qd.queueDraftId) {
        const storeEntry = storeByDraftId.get(qd.queueDraftId);
        if (storeEntry) {
          storeByDraftId.delete(qd.queueDraftId);
          return {
            ...storeEntry,
            id: qd.id,
            queueDraftId: qd.queueDraftId,
            contestName: qd.contestName,
            specialType: qd.specialType,
            type: qd.type,
            draftSpeed: qd.draftSpeed,
            players: Math.max(storeEntry.players || 0, qd.players || 0),
            airplaneMode: undefined,
          };
        }
      }
      return qd;
    });

    const queueDraftIdSet = new Set(queueDrafts.map(qd => qd.queueDraftId).filter(Boolean));
    const remainingBase = base.filter((d) => {
      if (!storeByDraftId.has(d.id)) return false;
      if (d.specialType) return false;
      if (queueDraftIdSet.has(d.id)) return false;
      return true;
    });

    return [...remainingBase, ...mergedQueueDrafts].filter(
      d => (d.specialType || !hiddenDraftIds.has(d.id)) && d.status !== 'completed',
    );
  }, [hiddenDraftIds, isLive, liveDrafts, localDrafts, queueDrafts, user?.walletAddress]);

  // Sort key: the slot number embedded in draft.id ("2024-fast-draft-804"
  // → 804). Within the same speed/year the slot counter increments per
  // fill, so highest slot = most recently filled = should be at top.
  const sortedDrafts = [...activeDrafts].sort((a, b) => {
    if (a.isYourTurn && !b.isYourTurn) return -1;
    if (!a.isYourTurn && b.isYourTurn) return 1;

    const aIsDrafting = a.status === 'drafting';
    const bIsDrafting = b.status === 'drafting';
    if (aIsDrafting && !bIsDrafting) return -1;
    if (!aIsDrafting && bIsDrafting) return 1;
    if (aIsDrafting && bIsDrafting) {
      return (a.currentPick || 99) - (b.currentPick || 99);
    }

    return (a.joinedAt || 0) - (b.joinedAt || 0);
  });

  const specialDrafts = sortedDrafts.filter(d => d.id.startsWith('queue-'));
  const regularDrafts = sortedDrafts.filter(d => !d.id.startsWith('queue-'));

  useEffect(() => {
    const initial: Record<string, number> = {};
    activeDrafts.forEach((draft) => {
      if (draft.timeRemaining) initial[draft.id] = draft.timeRemaining;
    });
    setTimers(initial);
  }, [activeDrafts]);

  useEffect(() => {
    const interval = setInterval(() => {
      setTimers((prev) => {
        const updated = { ...prev };
        Object.keys(updated).forEach((id) => {
          if (updated[id] > 0) updated[id] = updated[id] - 1;
        });
        return updated;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const [, setRenderTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setRenderTick(t => t + 1), 100);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const allDrafts = draftStore.getActiveDrafts();

      for (const d of allDrafts) {
        if ((d.phase === 'filling' || d.status === 'filling')
          && !d.preSpinStartedAt) {
          const count = d.players || 0;

          if (count >= 10) {
            if (!d.randomizingStartedAt) {
              draftStore.updateDraft(d.id, { players: 10, randomizingStartedAt: now });
            } else if ((now - d.randomizingStartedAt) >= 3000) {
              draftStore.updateDraft(d.id, {
                phase: 'pre-spin',
                players: 10,
                preSpinStartedAt: now,
                randomizingStartedAt: undefined,
              });
            }
            continue;
          }
        }

        if (d.randomizingStartedAt && !d.preSpinStartedAt && (now - d.randomizingStartedAt) >= 3000) {
          draftStore.updateDraft(d.id, {
            phase: 'pre-spin',
            preSpinStartedAt: now,
            randomizingStartedAt: undefined,
          });
          continue;
        }

        if (['pre-spin', 'spinning', 'result', 'countdown'].includes(d.phase || '') && d.preSpinStartedAt) {
          if ((now - d.preSpinStartedAt) / 1000 >= 60) {
            draftStore.updateDraft(d.id, {
              phase: 'drafting',
              status: 'drafting',
              type: d.type || d.draftType || 'pro',
            });
          }
        }
      }
    };

    tick();
    const interval = setInterval(tick, 800);
    return () => clearInterval(interval);
  }, []);

  const getLiveState = (draft: Draft): LiveState => {
    const now = Date.now();
    const timers = getBarTimers();
    const timerStart = timers.get(draft.id);

    if (timerStart && !draft.preSpinStartedAt) {
      const elapsed = now - timerStart;
      if (elapsed < 3000) {
        const t = elapsed / 3000;
        return {
          displayPhase: 'randomizing',
          playerCount: 10,
          countdown: null,
          randomizingProgress: 0.99 * Math.pow(t, 0.6),
          isFilling: false,
        };
      }
      timers.delete(draft.id);
    }
    if (timerStart && draft.preSpinStartedAt) {
      timers.delete(draft.id);
    }

    if (draft.preSpinStartedAt) {
      const elapsed = (now - draft.preSpinStartedAt) / 1000;
      if (draft.specialType || draft.phase === 'countdown') {
        if (elapsed < 60) {
          const startIn = Math.max(0, Math.ceil(60 - elapsed));
          return { displayPhase: 'draft-starting', playerCount: 10, countdown: startIn > 0 ? startIn : null, randomizingProgress: null, isFilling: false };
        }
      } else if (elapsed < 15) {
        return { displayPhase: 'pre-spin-countdown', playerCount: 10, countdown: Math.max(0, Math.ceil(15 - elapsed)), randomizingProgress: null, isFilling: false };
      } else if (elapsed < 60) {
        const startIn = Math.max(0, Math.ceil(60 - elapsed));
        return { displayPhase: 'draft-starting', playerCount: 10, countdown: startIn > 0 ? startIn : null, randomizingProgress: null, isFilling: false };
      }
    }

    if (draft.status === 'drafting' && draft.phase === 'drafting' && !draft.randomizingStartedAt) {
      return { displayPhase: 'drafting', playerCount: 10, countdown: null, randomizingProgress: null, isFilling: false };
    }

    if (draft.randomizingStartedAt && !draft.preSpinStartedAt) {
      const elapsed = now - draft.randomizingStartedAt;
      if (elapsed >= 3000) {
        timers.delete(draft.id);
        const effectivePreSpin = draft.randomizingStartedAt + 3000;
        const cdElapsed = (now - effectivePreSpin) / 1000;
        if (cdElapsed < 15) return { displayPhase: 'pre-spin-countdown', playerCount: 10, countdown: Math.max(0, Math.ceil(15 - cdElapsed)), randomizingProgress: null, isFilling: false };
        if (cdElapsed < 60) return { displayPhase: 'draft-starting', playerCount: 10, countdown: Math.max(0, Math.ceil(60 - cdElapsed)), randomizingProgress: null, isFilling: false };
        return { displayPhase: 'drafting', playerCount: 10, countdown: null, randomizingProgress: null, isFilling: false };
      }
      if (!timers.has(draft.id)) timers.set(draft.id, draft.randomizingStartedAt);
      const t = elapsed / 3000;
      return { displayPhase: 'randomizing', playerCount: 10, countdown: null, randomizingProgress: 0.99 * Math.pow(t, 0.6), isFilling: false };
    }

    if (!draft.preSpinStartedAt && !draft.randomizingStartedAt && (draft.status === 'filling' || draft.phase === 'filling')) {
      const count = Math.min(10, draft.players || 1);
      if (count >= 10) {
        if (!timers.has(draft.id)) timers.set(draft.id, now);
        const tStart = timers.get(draft.id)!;
        const t = Math.min(1, (now - tStart) / 3000);
        return { displayPhase: 'randomizing', playerCount: 10, countdown: null, randomizingProgress: 0.99 * Math.pow(t, 0.6), isFilling: false };
      }
      return { displayPhase: 'filling', playerCount: count, countdown: null, randomizingProgress: null, isFilling: true };
    }

    if (draft.status === 'filling') {
      return { displayPhase: 'filling', playerCount: draft.players || 1, countdown: null, randomizingProgress: null, isFilling: true };
    }
    return { displayPhase: 'drafting', playerCount: draft.players, countdown: null, randomizingProgress: null, isFilling: false };
  };

  useEffect(() => {
    if (!promoAutoRotate || promoCount === 0) return;
    const interval = setInterval(() => {
      setPromoIndex(prev => (prev + 1) % promoCount);
    }, 5000);
    return () => clearInterval(interval);
  }, [promoAutoRotate, promoCount]);

  useEffect(() => {
    if (promoCount === 0) {
      setPromoIndex(0);
      return;
    }
    if (promoIndex >= promoCount) {
      setPromoIndex(0);
    }
  }, [promoCount, promoIndex]);

  const confirmExitDraft = async () => {
    if (!exitingDraft || !user?.walletAddress) return;
    const storedDraft = draftStore.getDraft(exitingDraft.id);

    // Local cleanup runs UNCONDITIONALLY. Was previously after `await leaveDraft`,
    // which meant a Go-API failure (auth, network, anything) left the draft
    // visible in the UI even though the user had asked to leave. The UI should
    // reflect the user's intent immediately — if the backend leave fails the
    // worst case is a stale Go-side row that the next reconcile clears.
    draftStore.removeDraft(exitingDraft.id);
    setLiveDrafts(prev => prev.filter(d => d.id !== exitingDraft.id));
    try {
      const newHidden = new Set([...Array.from(hiddenDraftIds), exitingDraft.id]);
      setHiddenDraftIds(newHidden);
      localStorage.setItem('banana-hidden-drafts', JSON.stringify(Array.from(newHidden)));
    } catch { /* ignore */ }

    try {
      await leaveDraft(exitingDraft.id, user.walletAddress, storedDraft?.cardId);
      // Refund the Firestore pass counter (Go side already returns the
      // card; without this the header counter stays decremented).
      // Awaited so the POST has a chance to land before any subsequent
      // navigation cancels it.
      const userId = user.id || user.walletAddress;
      const passType = storedDraft?.passType || exitingDraft.passType || 'paid';
      try {
        const refundRes = await fetch('/api/owner/refund-pass', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, passType, leagueId: exitingDraft.id, tokenId: storedDraft?.cardId || exitingDraft.cardId }),
        });
        if (!refundRes.ok) {
          // Money path: user left but the pass refund didn't land. Critical.
          reportClientError({
            source: LOG_SOURCES.draft.LEAVE_REFUND_FAILED,
            message: `Leave refund returned ${refundRes.status}`,
            route: 'drafting',
            actor: user.walletAddress,
            context: { leagueId: exitingDraft.id, passType, tokenId: storedDraft?.cardId || exitingDraft.cardId, status: refundRes.status },
          });
        }
        await refreshBalance();
      } catch (err) {
        console.warn('[Leave] Refund pass failed:', err);
        reportClientError({
          source: LOG_SOURCES.draft.LEAVE_REFUND_FAILED,
          message: err instanceof Error ? err.message : String(err),
          route: 'drafting',
          actor: user.walletAddress,
          context: { leagueId: exitingDraft.id, passType, network: true },
        });
      }
    } catch (err) {
      console.error('Failed to leave draft:', err);
      reportClientError({
        source: LOG_SOURCES.draft.LEAVE_FAILED,
        message: err instanceof Error ? err.message : String(err),
        route: 'drafting',
        actor: user.walletAddress,
        context: { leagueId: exitingDraft.id },
      });
    } finally {
      setExitingDraft(null);
    }
  };

  const clearAllDrafts = async () => {
    const allIds = activeDrafts.map(d => d.id);
    const storeIds = draftStore.getActiveDrafts().map(d => d.id);
    const liveTokenIds: string[] = [];

    try {
      const { getOwnerDraftTokens } = await import('@/lib/api/owner');
      if (user?.walletAddress) {
        const tokens = await getOwnerDraftTokens(user.walletAddress);
        for (const t of tokens) {
          // Only hide by leagueId — cardId is the persistent NFT token which
          // gets reassigned to future drafts. Hiding by cardId would also
          // suppress any new draft that reuses the same NFT.
          if (t.leagueId) liveTokenIds.push(t.leagueId);
        }
      }
    } catch {}

    const combinedIds = [...new Set([...allIds, ...storeIds, ...liveTokenIds])];
    const newHidden = new Set([...Array.from(hiddenDraftIds), ...combinedIds]);
    localStorage.setItem('banana-hidden-drafts', JSON.stringify(Array.from(newHidden)));
    setHiddenDraftIds(newHidden);
    // Mark these as explicit clears so the self-heal poll can't resurrect
    // them — Clear All overrides the active-draft protection.
    const newCleared = new Set([...Array.from(explicitlyClearedIds), ...combinedIds]);
    localStorage.setItem('banana-cleared-drafts', JSON.stringify(Array.from(newCleared)));
    setExplicitlyClearedIds(newCleared);
    setLiveDrafts([]);
    localStorage.removeItem('banana-active-drafts');
    localStorage.removeItem('banana-completed-drafts');
    setQueueDrafts([]);
    fetch('/api/admin/set-entries', { method: 'DELETE' }).catch(() => {});

    const wallet = user?.walletAddress;
    if (wallet && allIds.length > 0) {
      void Promise.allSettled(allIds.map(id => leaveDraft(id, wallet)));
    }
  };

  // Auth is loading, OR we're in live mode but haven't completed the first
  // live-drafts fetch for this wallet yet. The page renders a placeholder
  // skeleton instead of the "no drafts" empty state in either case, so a
  // refresh on a wallet that has active drafts doesn't flicker through the
  // welcome-screen hero before the API responds.
  const isLoading = authLoading || (isLive && liveDraftsLoadedFor !== user?.walletAddress);

  return {
    contest,
    promosQuery,
    promos,
    promoCount,
    isLoading,
    user,
    activeDrafts,
    regularDrafts,
    specialDrafts,
    creatingQueueDraft,
    exitingDraft,
    showBuyPasses,
    selectedPromo,
    claimedPromos,
    claimSuccess,
    promoIndex,
    showEntryFlow,
    joiningLobby,
    showContestDetails,
    infoTopic,
    handleEnterDraft,
    handleEntryComplete,
    handleDraftClick,
    handleClaim,
    confirmExitDraft,
    clearAllDrafts,
    getLiveState,
    setExitingDraft,
    setShowBuyPasses,
    setSelectedPromo,
    setPromoIndex,
    setPromoAutoRotate,
    setShowEntryFlow,
    setShowContestDetails,
    setInfoTopic,
  };
}
