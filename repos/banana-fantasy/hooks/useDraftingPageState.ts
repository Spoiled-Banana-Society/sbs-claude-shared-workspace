'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { useAuth } from '@/hooks/useAuth';
import { usePromos } from '@/hooks/usePromos';
import { isDraftingOpen } from '@/lib/draftTypes';
import { isStagingMode, getDraftServerUrl } from '@/lib/staging';
import { useActiveDrafts } from '@/hooks/useActiveDrafts';
import * as draftStore from '@/lib/draftStore';
import type { DraftState } from '@/lib/draftStore';
import { buildDraftRoomUrl as buildDraftRoomUrlForDraft } from '@/lib/draftRoomUrl';
import type { ApiDraftToken } from '@/lib/api/owner';
import * as draftApi from '@/lib/draftApi';
import { leaveDraft } from '@/lib/api/leagues';
import { useEnterDraft } from '@/hooks/useEnterDraft';
import { useDepositEntry } from '@/hooks/useDepositEntry';
import { useContests } from '@/hooks/useContests';
import { fetchJson } from '@/lib/appApiClient';
import { filterAndSortVisiblePromos } from '@/lib/promoFilter';
import type { DraftQueue, Promo } from '@/types';
import { logger } from '@/lib/logger';
import { subscribeDraftNumPlayers, subscribeDraftDisplayName, subscribeDraftType, subscribeRealTimeDraftInfo } from '@/lib/api/firebase';
import { setLeagueNumberInCache } from '@/hooks/useLeagueNumberForSlot';
import { clientLog } from '@/lib/clientLog';
import { reportClientError } from '@/lib/clientErrors';
import { safeSetItem } from '@/lib/safeStorage';
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

// Lobby live-row websocket is RETIRED (2026-06-26). The lobby's pick number,
// clock, your-turn state and type reveal are fully driven by the RTDB push
// (subscribeRealTimeDraftInfo) — the authoritative, monotonic source the draft
// room itself reads. The WS path only ever DEFERRED to RTDB and could write
// stale values; worse, opening the socket woke the retired WS draft server's
// per-pick timer, which auto-picked into Firestore-only (no RTDB write) and
// desynced live drafts → freeze. Flag kept so the dead block can be deleted in a
// follow-up. Flip true ONLY to resurrect the old path. (`as boolean` keeps the
// type wide so the guarded block below isn't flagged unreachable.)
const LOBBY_WS_ENABLED = false as boolean;

function getSnakeDrafterIndex(pickNumber: number): number {
  const round = Math.ceil(pickNumber / 10);
  const posInRound = (pickNumber - 1) % 10;
  return round % 2 === 1 ? posInRound : 9 - posInRound;
}

// Snake-draft "picks away": how many picks until the seat at `userIndex` is up,
// given the current pick number. Shared by the poll and the realtime push so
// both compute it identically. Returns 0 if it's the seat's turn now or unknown.
function picksAwayForSeat(pickNumber: number, userIndex: number, drafterCount = 10): number {
  if (userIndex < 0 || !Number.isFinite(pickNumber)) return 0;
  const totalPicks = drafterCount * 15;
  for (let i = 1; i <= totalPicks - pickNumber + 1; i++) {
    if (getSnakeDrafterIndex(pickNumber + i) === userIndex) return i;
  }
  return 0;
}

/**
 * Go clamps `pickNumber` at totalPicks, so "sitting on the unmade final pick"
 * and "finished" are indistinguishable in /state/info. Treating both as
 * completed removed the row from My Drafts for the one person on the clock for
 * it — on a slow draft that's an 8-hour window (FC / BBB #183, 2026-07-31).
 * The summary tells them apart: the last slot has no player name until the
 * pick actually lands.
 *
 * Rule #0: this sits inside a 3s sync loop, so the verdict is cached per draft
 * and only re-checked every FINAL_PICK_RECHECK_MS. Only drafts already at the
 * final pick ever get here, so it's at most a couple of ids per user. On any
 * error we return false = "not pending" = keep the old completion behavior,
 * so a flaky Go call can never strand a finished draft in the list forever.
 */
const FINAL_PICK_RECHECK_MS = 30_000;
const finalPickCache = new Map<string, { at: number; pending: boolean }>();

// 3s sync sweep shape (see syncLiveDrafts): rows in flight at once, and when
// each row was last swept so the next sweep starts from the stalest one.
// Module-level so the order survives effect re-runs (wallet/user changes).
const SYNC_CONCURRENCY = 3;
const lastSyncedAt = new Map<string, number>();

async function finalPickStillPending(draftId: string, totalPicks: number): Promise<boolean> {
  const hit = finalPickCache.get(draftId);
  const now = Date.now();
  if (hit && now - hit.at < FINAL_PICK_RECHECK_MS) return hit.pending;
  let pending = false;
  try {
    const summary = await draftApi.getDraftSummary(draftId);
    pending = summary.length >= totalPicks
      && !(summary[totalPicks - 1]?.playerInfo?.displayName ?? '').trim();
  } catch {
    pending = false; // fail closed — behave exactly as before the check existed
  }
  finalPickCache.set(draftId, { at: now, pending });
  return pending;
}

function computeTurnsFromServer(
  info: draftApi.DraftInfoResponse,
  walletAddress: string,
): { turnsUntilUserPick: number; isUserTurn: boolean; pickEndTimestamp: number | undefined; userIndex: number } {
  const wallet = walletAddress.toLowerCase();
  const currentDrafter = (info.currentDrafter || '').toLowerCase();
  const isUserTurn = wallet !== '' && wallet === currentDrafter;

  const userIndex = info.draftOrder.findIndex(
    entry => entry.ownerId.toLowerCase() === wallet,
  );

  const turnsUntilUserPick = isUserTurn
    ? 0
    : picksAwayForSeat(info.pickNumber, userIndex, info.draftOrder.length || 10);

  return {
    turnsUntilUserPick,
    isUserTurn,
    pickEndTimestamp: info.currentPickEndTime || undefined,
    userIndex,
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
  const [showBuyFromBalance, setShowBuyFromBalance] = useState(false);
  // Deposit bankroll one-tap entry (flag-gated) — shown instead of the buy
  // modal when the user has 0 passes but ≥ $25 balance.
  // Add Funds prompt — entering at 0 passes AND $0 balance lands here
  // (Richard 2026-07-21: Enter is the only CTA under the deposit flag).
  const [showAddFunds, setShowAddFunds] = useState(false);
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
      isLoggedIn,
      hasVisibleClaim: (p) => {
        if (!p.claimable || claimedPromos.has(p.id)) return false;
        if ((p.type === 'new-user' || p.type === 'tweet-engagement') && !isTwitterVerified) return false;
        return true;
      },
    });
  }, [rawPromos, isBB3Holder, newUserPromoClaimed, isTwitterVerified, claimedPromos, user?.firstPurchaseBonusGranted, user?.firstPurchasePromoUnlocked, isBalanceLoaded, isLoggedIn, user?.walletAddress]);
  const promoCount = promos.length;
  const [claimSuccess, setClaimSuccess] = useState<{ show: boolean; count: number }>({ show: false, count: 0 });
  // Manual-only browsing (auto-rotate removed 2026-06-09): promos never
  // advance on their own. The list is already sorted by the shared home-page
  // rules (claimable first, then closest to claim — lib/promoFilter.ts), so
  // the first card is always the actionable one; dots/arrows browse the rest.
  const [promoIndex, setPromoIndex] = useState(0);
  const [showEntryFlow, setShowEntryFlow] = useState(false);
  // True while the join network call is in flight after the user confirms
  // entry — drives the branded "Joining lobby…" overlay. Cleared on failure;
  // on success the page navigates away (drafting page unmounts) so it just
  // fades out with the route change.
  // Single shared entry flow (join-before-navigate + "Joining lobby" overlay).
  // Lives in useEnterDraft so the home page and this page use the exact same
  // implementation — no divergence, no glitch creeping back via one copy.
  const { joiningLobby, joinError, clearJoinError, enterDraftWithPassType } = useEnterDraft();
  const {
    buying: depositBuying,
    buyError: depositBuyError,
    clearBuyError: clearDepositBuyError,
    buyPassWithBalance,
    buyPassesWithBalance,
  } = useDepositEntry();
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
  // Go draftIds of wheel-pass queue rounds the user is NOT a member of (e.g. a
  // pass they sold while it was filling — the queue slot moved to the buyer). The
  // live queue is authoritative, so these are filtered out of the lobby and
  // blocked at the draft room, clearing any stale localStorage row that lingers.
  const [foreignQueueDraftIds, setForeignQueueDraftIds] = useState<Set<string>>(new Set());
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
          const foreign = new Set<string>();
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
              if (!isMember) {
                // A wheel-pass round that isn't ours (e.g. we sold the pass and
                // the slot moved to the buyer). Record its draftId so the lobby
                // hides any stale cached row for it and the draft room blocks us.
                if (r.draftId) foreign.add(String(r.draftId));
                continue;
              }

              drafts.push({
                id: `queue-${q.type}-${r.roundId}`,
                queueDraftId: r.draftId || undefined,
                contestName: `${q.type === 'jackpot' ? 'Jackpot' : q.type === 'hof' ? 'HOF' : 'JackHOF'} #${r.roundId}`,
                status: 'filling',
                type: q.type as 'jackpot' | 'hof' | 'jackhof',
                draftSpeed: 'slow',
                players: r.members?.length || 1,
                maxPlayers: 10,
                joinedAt: r.members?.find((m: { wallet?: string }) =>
                  m.wallet?.toLowerCase() === userId.toLowerCase() ||
                  m.wallet?.toLowerCase() === walletAddr?.toLowerCase(),
                )?.joinedAt || Date.now(),
                lastUpdated: Date.now(),
                specialType: q.type as 'jackpot' | 'hof' | 'jackhof',
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
          setForeignQueueDraftIds(foreign);
          // Permanently drop any cached local row for a slot that's no longer
          // ours. Guarded on existence so we don't re-notify listeners every poll.
          if (foreign.size) {
            const stored = draftStore.getActiveDrafts();
            for (const did of foreign) {
              if (stored.some(d => d.id === did)) draftStore.removeDraft(did);
            }
          }
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

  const buildDraftRoomUrl = (draft: Draft) =>
    buildDraftRoomUrlForDraft(draft, { live: isLive, wallet: user?.walletAddress });

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

    // One chooser for everyone (Richard 2026-07-22): pass / free pass / buy.
    // The zero-pass case lives inside it now — row 1 becomes the $25 buy-in,
    // or routes to Add Funds when the balance can't cover it.
    setShowEntryFlow(true);
  };

  const handleBuyFromBalance = async (qty: number) => {
    const ok = await buyPassesWithBalance(qty);
    if (!ok) return; // error stays visible in the sheet
    setShowBuyFromBalance(false);
  };

  const handleEntryComplete = async (
    passType: 'paid' | 'free' | 'balance',
    speed: 'fast' | 'slow',
    // ticket: tomalom 8/24 — this surface dropped forcePublic, so a private-
    // league member out of entries could never take the "public instead"
    // escape here: every join re-routed into the league and bounced. Home and
    // buy-drafts already forward it; now all three do.
    opts?: { forcePublic?: boolean },
  ) => {
    if (passType === 'balance') {
      // Paid seat bought from balance inside the chooser — keep the modal up
      // until the charge lands so a failure stays visible.
      const ok = await buyPassWithBalance();
      if (!ok) return;
      setShowEntryFlow(false);
      void enterDraftWithPassType('paid', speed, undefined, opts);
      return;
    }
    setShowEntryFlow(false);
    void enterDraftWithPassType(passType, speed, undefined, opts);
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
        // user is actively in on that device.
        //
        // 2026-07-23: the "explicit Clear All is NEVER un-hidden" exemption is
        // GONE — it was the root cause of the "I entered and it doesn't show,
        // no matter how many times" wave. Clear All backend-LEAVES every draft
        // and blacklists their ids; when a user then re-entered, the router
        // seated them right back into one of those same (now open again)
        // lobby ids — a real, current seat that the exemption kept invisible
        // forever. Server truth wins now: if the wallet currently holds a
        // token for a league (it's in activeTokens), that seat ALWAYS shows.
        // The blacklist still works for everything the server doesn't
        // re-confirm — a cleared dead/stuck draft stays hidden because its
        // token was refunded/consumed and never comes back in activeTokens.
        // Never resurrect a draft the completion sweep hid — the token
        // endpoint's roster can lag below 15 right after a draft finishes,
        // so "the wallet still holds an active-looking token" is NOT proof
        // the draft is live. Without this check the unhide fought the
        // completed-hider in a 3s loop (7/23 flicker).
        let completedLedger: Set<string>;
        try {
          const raw = localStorage.getItem('banana-completed-drafts');
          completedLedger = new Set(raw ? (JSON.parse(raw) as string[]) : []);
        } catch { completedLedger = new Set(); }
        const wronglyHidden = activeTokens
          .map((t) => t.leagueId)
          .filter((id) => hiddenDraftIds.has(id) && !completedLedger.has(id));
        if (wronglyHidden.length > 0) {
          clientLog('mydrafts', 'unhid.active.drafts', { ids: wronglyHidden });
          setHiddenDraftIds((prev) => {
            const next = new Set(prev);
            for (const id of wronglyHidden) next.delete(id);
            try { safeSetItem('banana-hidden-drafts', JSON.stringify([...next])); } catch { /* quota */ }
            return next;
          });
          // Purge from the explicit-clear ledger too, or the next Clear All
          // union re-blacklists and the tug-of-war resumes.
          setExplicitlyClearedIds((prev) => {
            const next = new Set(prev);
            for (const id of wronglyHidden) next.delete(id);
            try { safeSetItem('banana-cleared-drafts', JSON.stringify([...next])); } catch { /* quota */ }
            return next;
          });
        }

        // Fetch current player count + drafting-state for each active draft.
        // numPlayers === 10 means the backend has created the draft state
        // (via /state/info fallback), so the draft has actually started.
        // `wallet` makes the route also return the SERVER auto-pick flag for
        // drafting rows (Firestore sortOrders.AutoDraft) so the ✈️ badge on
        // My Drafts reflects toggles made on other devices and the server's
        // own missed-picks promotion — not just this device's draftStore.
        const walletQ = `&wallet=${encodeURIComponent(user!.walletAddress!.toLowerCase())}`;
        const stateResults = await Promise.all(
          activeTokens.map(async (t): Promise<{ players: number; isDrafting: boolean; draftStartTimeMs?: number; autoDraft?: boolean }> => {
            try {
              const res = await fetch(`/api/drafts/league-players?draftId=${encodeURIComponent(t.leagueId)}${walletQ}`);
              if (!res.ok) return { players: 1, isDrafting: false };
              const data = await res.json();
              const numPlayers = Number(data.numPlayers) || 0;
              // Server draft-start time (Unix s → ms) — present once the draft
              // fills. Lets the row run the reveal off the server clock from the
              // very first load, even on a device that never witnessed the fill.
              const dst = typeof data.draftStartTime === 'number' && data.draftStartTime > 0
                ? data.draftStartTime * 1000 : undefined;
              const autoDraft = typeof data.autoDraft === 'boolean' ? data.autoDraft : undefined;
              return { players: Math.max(1, numPlayers), isDrafting: numPlayers >= 10, draftStartTimeMs: dst, autoDraft };
            } catch {
              return { players: 1, isDrafting: false };
            }
          }),
        );
        if (cancelled) return;

        const mapped: Draft[] = activeTokens.map((t, i) => {
          const { players, isDrafting, draftStartTimeMs, autoDraft } = stateResults[i];
          const draftSpeed: 'fast' | 'slow' = t.leagueId.includes('-slow-') ? 'slow' : 'fast';
          // Type value is set once the draft is full; the DISPLAY gating ("show
          // the type vs 'Revealing…'") is owned by getLiveState's phase + DraftRow
          // (which keeps "Revealing…" until the reveal countdown drops below 37s).
          // So we don't null the type here — that would wrongly hide it during the
          // final reveal seconds.
          let type: Draft['type'];
          if (t.level === 'Jackpot') type = 'jackpot';
          else if (t.level === 'Hall of Fame') type = 'hof';
          else type = isDrafting ? 'pro' : null;
          return {
            id: t.leagueId || t.cardId,
            draftStartTimeMs,
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
            // Server-authoritative; undefined (filling / read failed) leaves
            // whatever the draft room wrote locally untouched.
            ...(autoDraft !== undefined ? { airplaneMode: autoDraft } : {}),
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
          // Server auto-pick flag wins over the local (room-written) one when
          // they disagree — the server is what actually makes the pick.
          const needsAirplane = d.airplaneMode !== undefined && d.airplaneMode !== !!existing.airplaneMode;
          if (!isConfirmedDrafting) {
            draftStore.updateDraft(d.id, {
              status: d.status,
              type: d.type,
              draftSpeed: d.draftSpeed,
              players: d.players,
              draftType: d.type,
              // Server reveal clock — refresh it so a row that just filled starts
              // running the reveal off draftStartTime immediately (drives the
              // server-clock branch in getLiveState).
              ...(d.draftStartTimeMs != null ? { draftStartTimeMs: d.draftStartTimeMs } : {}),
              ...(needsWalletStamp ? { liveWalletAddress: currentWallet } : {}),
              ...(needsCardId ? { cardId: d.cardId } : {}),
              ...(needsAirplane ? { airplaneMode: d.airplaneMode } : {}),
            });
          } else {
            // For rows already drafting, we still heal speed/type if unset
            // and stamp the wallet so background polls actually run.
            const patch: Partial<typeof existing> = {};
            if (!existing.draftSpeed || existing.draftSpeed !== d.draftSpeed) patch.draftSpeed = d.draftSpeed;
            if (existing.type == null && d.type != null) patch.type = d.type;
            if (needsWalletStamp) patch.liveWalletAddress = currentWallet;
            if (needsCardId) patch.cardId = d.cardId;
            if (needsAirplane) patch.airplaneMode = d.airplaneMode;
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
    // ~5s instead of needing a manual refresh. Also re-poll on tab focus AND
    // visibilitychange — mobile returning from the app switcher/background
    // fires visibilitychange (NOT focus), which is why the page showed a
    // stale cached phase ("randomizing…") for ~10s after coming back.
    const interval = setInterval(() => { void loadLiveDrafts(); }, 5000);
    const onFocus = () => { void loadLiveDrafts(); };
    const onVisible = () => { if (document.visibilityState === 'visible') void loadLiveDrafts(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
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

  // Live draft TYPE on /draft rows — instant RTDB push, the SAME source the
  // draft room reads (drafts/{id}/realTimeDraftInfo/type). The Go API stamps it
  // at fill, so the list row's PRO/HOF/JACKPOT flips the moment the type is
  // known, in lockstep with the room and identical across devices — no poll.
  // (DraftRow still gates the visual reveal behind the slot animation, so
  // writing the value early during filling never spoils the reveal.) Uses the
  // all-live key so the subscription survives the fill→drafting transition.
  useEffect(() => {
    const ids = liveDraftIdsKey ? liveDraftIdsKey.split(',') : [];
    if (ids.length === 0) return;
    const unsubs = ids.map((draftId) =>
      subscribeDraftType(draftId, (type) => {
        const existing = draftStore.getDraft(draftId);
        // Don't clobber a wheel-won draft's known specialType, and skip the
        // write if it already matches (avoids needless store churn/renders).
        if (existing?.specialType) return;
        if (existing?.type === type && existing?.draftType === type) return;
        draftStore.updateDraft(draftId, { type, draftType: type });
      }),
    );
    return () => {
      for (const unsub of unsubs) {
        try { unsub(); } catch { /* ignore */ }
      }
    };
  }, [liveDraftIdsKey]);

  // Live PICK PROGRESS on /draft rows — instant RTDB push (pick #, whose-turn,
  // countdown, "N picks away") off the SAME realTimeDraftInfo node the draft
  // room reads. A first attempt at this flickered because it dual-wrote with the
  // 3s poll and could read a stale reused-id node. This version is SAFE:
  //   • Stale-node reject: only trust a snapshot whose draftStartTime matches the
  //     row's known start (≤5s) — a reused-id's leftover state can't drive it.
  //   • Monotonic: the pick number can only move FORWARD; a snapshot behind the
  //     stored pick is ignored. So push + poll can never fight backward → no
  //     flicker (the poll above has the matching forward-only guard).
  //   • No completion-removal / phase writes here — the poll owns completion and
  //     getLiveState owns the reveal phase; this only refreshes the live pick
  //     fields, computing "N picks away" from the cached userSeat (snake math).
  useEffect(() => {
    const ids = liveDraftIdsKey ? liveDraftIdsKey.split(',') : [];
    if (ids.length === 0) return;
    const wallet = user?.walletAddress?.toLowerCase();
    const unsubs = ids.map((draftId) =>
      subscribeRealTimeDraftInfo(draftId, (info) => {
        if (!info) return;
        const pickNumber = typeof info.pickNumber === 'number' ? info.pickNumber : 0;
        // Load the reveal clock from THIS fast RTDB push even during the reveal
        // window (pickNumber 0), so getLiveState's server-clock branch fires
        // immediately and the type can't leak as "filling 10/10" before the
        // clock arrives via the slower league-players fetch (the mobile/refresh
        // "PRO before reveal" bug). Future-only guard: a just-filled draft's
        // start is ~60s out, so accept future/just-now values and REJECT a
        // stale reused-id PAST value. An already-started draft (past start) is
        // unaffected — it's driven by the pickNumber>=1 path below + the
        // enginePickNumber short-circuit, so this never replays its reveal.
        const revealStartMs = typeof info.draftStartTime === 'number' && info.draftStartTime > 0
          ? info.draftStartTime * 1000 : 0;
        if (revealStartMs && revealStartMs > Date.now() - 3000) {
          const ex = draftStore.getDraft(draftId);
          if (ex && ex.draftStartTimeMs !== revealStartMs) {
            draftStore.updateDraft(draftId, { draftStartTimeMs: revealStartMs });
          }
        }
        if (pickNumber < 1) return; // not drafting yet — reveal flow owns the row (clock set above)
        const existing = draftStore.getDraft(draftId);
        if (!existing) return;

        // Reject a STALE reused-id node: trust this snapshot only if its start
        // time matches the row's known draftStartTime.
        const snapStartMs = typeof info.draftStartTime === 'number' ? info.draftStartTime * 1000 : 0;
        if (!snapStartMs) return;
        let adoptStartMs: number | undefined;
        if (existing.draftStartTimeMs) {
          if (Math.abs(snapStartMs - existing.draftStartTimeMs) > 5000) return;
        } else {
          // The row never learned its server start (it was added AFTER the fill:
          // server hydration, the token poll on a fresh device, a store wipe…).
          // Until 2026-08-17 we bailed here forever, so such a row was driven
          // ONLY by the sequential 3s poll below — which on a 50-row mobile
          // lobby rarely reached it during a 10-20s visit. The row sat on a
          // stale "N picks away" and never flipped to "Pick", buried mid-list
          // for hours (vertig0, BBB #611: on the clock 1h25m across four visits
          // without ever seeing it; another draft surfaced at the 5-hour mark).
          // Adopt the snapshot's start when the row is already confirmed
          // drafting and the start is in the past; the monotonic pick guard
          // below still rejects anything behind what we show. A reused-slot
          // node for a NEW filling draft never reaches here (pickNumber < 1
          // returns above), and the token poll's leave-sync drops rows whose
          // league the wallet no longer holds.
          const confirmedDrafting = existing.status === 'drafting' || existing.phase === 'drafting';
          if (!confirmedDrafting || snapStartMs > Date.now()) return;
          adoptStartMs = snapStartMs;
        }

        // Monotonic: ignore a snapshot that's behind what we already show.
        if (typeof existing.enginePickNumber === 'number' && pickNumber < existing.enginePickNumber) return;

        // NOTE: we intentionally do NOT bail when the draft room is open on this
        // device. This RTDB push is the SAME authoritative source the room reads,
        // and the monotonic guard above makes it forward-only — so letting it
        // through keeps the lobby's pick number in lockstep with the room (it was
        // lagging a few seconds when the room was open, because the slow poll/WS
        // paths defer to the room). The poll + WS paths still defer (they can
        // write stale values); only this fast, monotonic push drives the row live.

        const isYourTurn = !!wallet
          && typeof info.currentDrafter === 'string'
          && info.currentDrafter.toLowerCase() === wallet;
        const seat = typeof existing.userSeat === 'number' ? existing.userSeat : -1;
        const patch: Partial<DraftState> = {
          enginePickNumber: pickNumber,
          isYourTurn,
          ...(adoptStartMs ? { draftStartTimeMs: adoptStartMs } : {}),
        };
        // Only set "N picks away" when we can compute it (your turn → 0, or a
        // known seat). If the seat hasn't been cached by the poll yet, leave
        // currentPick to the poll so we never flash a wrong "Picks complete".
        if (isYourTurn) patch.currentPick = 0;
        else if (seat >= 0) patch.currentPick = picksAwayForSeat(pickNumber, seat);
        if (typeof info.pickEndTime === 'number' && info.pickEndTime > 0) {
          patch.pickEndTimestamp = info.pickEndTime;
          patch.timeRemaining = isYourTurn
            ? Math.max(0, Math.ceil(info.pickEndTime - Date.now() / 1000))
            : undefined;
        }
        if (typeof info.pickStartTime === 'number' && info.pickStartTime > 0) {
          patch.pickStartTimestamp = info.pickStartTime;
        }
        // DIAGNOSTIC: capture when the lobby applies a FORWARD pick from the RTDB
        // push, so we can confirm it now flips in lockstep with the room (it was
        // ~2s late, waiting on the 3s poll while the room held the heartbeat).
        if (pickNumber !== existing.enginePickNumber) {
          clientLog('lobby-pick', 'rtdb.applied', { draftId, pickNumber, prev: existing.enginePickNumber ?? null });
        }
        draftStore.updateDraft(draftId, patch);
      }),
    );
    return () => {
      for (const unsub of unsubs) {
        try { unsub(); } catch { /* ignore */ }
      }
    };
  }, [liveDraftIdsKey, user?.walletAddress]);

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

      // One row per call so the sweep can run a few rows at a time. Every
      // `return` here used to be a `continue` in the old sequential for-loop.
      const syncOne = async (draft: Draft): Promise<void> => {
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
          return;
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
          if ((info.pickNumber ?? 0) >= totalPicks && !(await finalPickStillPending(draft.id, totalPicks))) {
            draftStore.removeDraft(draft.id);
            // Record WHY it's hidden: completed. Without this ledger the
            // active-seat un-heal in loadLiveDrafts can't distinguish
            // "hidden because finished" from "hidden wrongly" — and since the
            // token endpoint's roster can lag below 15 picks right after
            // completion, the un-heal saw an "active" token and un-hid the
            // finished draft, which this block then re-hid on the next 3s
            // pass. That hide/unhide loop re-rendered the whole list every
            // 3s (the 7/23 evening "row appears for .2s then disappears"
            // flicker, reported by FC post-v4). The ledger key is already in
            // the logout/Clear All cleanup lifecycle.
            try {
              const raw = localStorage.getItem('banana-completed-drafts');
              const ids: string[] = raw ? JSON.parse(raw) : [];
              if (Array.isArray(ids) && !ids.includes(draft.id)) {
                safeSetItem('banana-completed-drafts', JSON.stringify([...ids, draft.id]));
              }
            } catch { /* quota — worst case the unhide re-checks next pass */ }
            setHiddenDraftIds((prev) => {
              if (prev.has(draft.id)) return prev;
              const next = new Set(prev);
              next.add(draft.id);
              try { safeSetItem('banana-hidden-drafts', JSON.stringify([...next])); } catch { /* quota */ }
              return next;
            });
            return;
          }
        }

        const heartbeat = localStorage.getItem(`draft-room-ws:${draft.id}`);
        if (heartbeat && Date.now() - Number(heartbeat) < 10_000) return;

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
              safeSetItem(trackedKey, '1');
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
                  safeSetItem(pick10Key, '1');
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
            const { turnsUntilUserPick, isUserTurn, pickEndTimestamp, userIndex } =
              computeTurnsFromServer(info, draft.liveWalletAddress!);

            // Completion removal lives ONLY in the early exit above, which
            // consults finalPickStillPending() and writes the completed-drafts
            // ledger. A second unguarded `pickNumber >= totalPicks` removal here
            // defeated that guard for the person on the clock for the FINAL
            // pick (Go clamps pickNumber at totalPicks): the early exit kept
            // the row, this removed it, the active-token un-heal re-added it —
            // a 1-3s add/remove flicker of the "Pick Now" row for the whole
            // 8-hour window (FC, R15 P150, 2026-08-10). Don't re-add it.

            // /state/info doesn't carry the current pick's absolute
            // end-timestamp, so fetch it from league-players which proxies
            // RTDB `realTimeDraftInfo.pickEndTime`. Authoritative source —
            // overrides any stale value from a previous draft-room write.
            let rtdbPickEnd: number | undefined;
            let rtdbPickStart: number | undefined;
            let rtdbType: 'pro' | 'hof' | 'jackpot' | undefined;
            try {
              const lpRes = await fetch(`/api/drafts/league-players?draftId=${encodeURIComponent(draft.id)}`);
              if (lpRes.ok) {
                const lpData = await lpRes.json();
                if (typeof lpData.pickEndTime === 'number' && lpData.pickEndTime > 0) {
                  rtdbPickEnd = lpData.pickEndTime;
                }
                if (typeof lpData.pickStartTime === 'number' && lpData.pickStartTime > 0) {
                  rtdbPickStart = lpData.pickStartTime;
                }
                // Authoritative draft type off the SAME RTDB node the draft room
                // reads. Stamped synchronously at fill, so it's correct even if
                // the deferred per-card Level write lagged/failed — this is what
                // keeps the list row's PRO/HOF/JACKPOT in lockstep with the room
                // and identical across devices.
                if (lpData.type === 'pro' || lpData.type === 'hof' || lpData.type === 'jackpot') {
                  rtdbType = lpData.type;
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

            // Monotonic guard: the realtime RTDB push (below) is the primary,
            // instant source for pick #/turn/countdown. The pick number only ever
            // moves FORWARD, so if this 3s-poll snapshot is BEHIND what the push
            // already wrote, its pick fields are stale — don't let them overwrite
            // the live ones (that dual-writer fight is what made the row flicker
            // between rounds before). userSeat (static) + status/type still write.
            const pollPickStale = typeof fresh.enginePickNumber === 'number'
              && info.pickNumber < fresh.enginePickNumber;
            const patch: Partial<DraftState> = {
              // Cache the user's seat so the realtime push can compute "N picks
              // away" instantly without re-fetching the draft order.
              ...(userIndex >= 0 ? { userSeat: userIndex } : {}),
              // Heal the server start on rows that were added after the fill —
              // the RTDB push above verifies its snapshot against this and,
              // before 2026-08-17, a row without it was never push-driven.
              ...(!fresh.draftStartTimeMs && info.draftStartTime
                ? { draftStartTimeMs: info.draftStartTime * 1000 } : {}),
              ...(pollPickStale ? {} : {
                currentPick: turnsUntilUserPick,
                isYourTurn: isUserTurn,
                pickEndTimestamp: effectivePickEnd,
                ...(rtdbPickStart ? { pickStartTimestamp: rtdbPickStart } : {}),
                timeRemaining: isUserTurn && effectivePickEnd
                  ? Math.max(0, Math.ceil(effectivePickEnd - nowMs / 1000))
                  : undefined,
                enginePickNumber: info.pickNumber,
              }),
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
                // Prefer the authoritative RTDB type (same source as the room);
                // fall back to whatever's already stored so a transient RTDB
                // miss never blanks a known type.
                type: rtdbType || fresh.type || fresh.draftType || null,
                draftType: rtdbType || fresh.draftType || fresh.type || null,
                randomizingStartedAt: undefined,
                preSpinStartedAt: undefined,
              });
            }
          } else if (isFull) {
            // Reused-slot hygiene: the backend reports this draft as
            // full-but-not-started (pickNumber 0), so any enginePickNumber left
            // in the store is STALE from this slot's PREVIOUS draft. Clear it so
            // getLiveState's pick short-circuit can't flash the type pre-reveal.
            const patch: Partial<DraftState> = { players: 10, enginePickNumber: 0 };

            if (info.draftStartTime) {
              // Authoritative reveal clock for getLiveState's server-clock branch.
              patch.draftStartTimeMs = info.draftStartTime * 1000;
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
      };

      // Sweep order + shape (2026-08-17): the old loop walked the store in
      // insertion order, strictly one row at a time (2 round-trips each), and
      // a fresh sweep started every 3s with no overlap guard. On a 50-row
      // lobby (vertig0: 51 live slow drafts) a full pass took 25-50s on
      // mobile, so a 10-20s visit only ever refreshed the head of the list —
      // the tail rows never learned they were on the clock. Now: stalest row
      // first (so every visit makes progress across the whole list), a few
      // rows in flight at once, and at most one sweep running.
      const ordered = [...liveDraftsToSync].sort(
        (a, b) => (lastSyncedAt.get(a.id) ?? 0) - (lastSyncedAt.get(b.id) ?? 0),
      );
      let cursor = 0;
      const worker = async () => {
        while (!cancelled && cursor < ordered.length) {
          const draft = ordered[cursor++];
          lastSyncedAt.set(draft.id, Date.now());
          await syncOne(draft);
        }
      };
      await Promise.all(Array.from({ length: Math.min(SYNC_CONCURRENCY, ordered.length) }, worker));
    };

    let sweepInFlight = false;
    const runSweep = () => {
      if (sweepInFlight) return;
      sweepInFlight = true;
      void syncLiveDrafts().finally(() => { sweepInFlight = false; });
    };

    runSweep();

    let focusTimeout: ReturnType<typeof setTimeout> | null = null;
    const onFocus = () => {
      if (focusTimeout) clearTimeout(focusTimeout);
      focusTimeout = setTimeout(() => {
        runSweep();
      }, 500);
    };

    // visibilitychange too — mobile returning from background fires it (not
    // focus); without it the cached phase rendered stale for ~10s.
    const onVisible = () => { if (document.visibilityState === 'visible') onFocus(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    intervalId = setInterval(() => {
      runSweep();
    }, 3000);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      if (focusTimeout) clearTimeout(focusTimeout);
      if (intervalId) clearInterval(intervalId);
    };
  }, [isLive, user?.id, user?.walletAddress]);

  const wsConnectionsRef = useRef<Map<string, WebSocket>>(new Map());

  // Privy access token for the WS auth gate, via the ref pattern (Rule #0:
  // privy-derived callbacks must never enter effect deps). The Go WS server
  // verifies this JWT before upgrading — these lobby connections were
  // rejected 401 on EVERY attempt since auth was added because no token was
  // ever sent; the page silently fell back to polling and nobody noticed.
  const privyForWs = usePrivy();
  const getWsTokenRef = useRef(privyForWs.getAccessToken);
  getWsTokenRef.current = privyForWs.getAccessToken;

  useEffect(() => {
    // Disabled (2026-06-26): never open lobby sockets — see LOBBY_WS_ENABLED note
    // at top of file. Real-time lives in the RTDB push above; this socket only
    // added stale data + woke the retired WS server's rogue auto-pick timer.
    // Defensively close any straggler from a prior session, then bail.
    {
      const stale = wsConnectionsRef.current;
      stale.forEach((ws) => { try { ws.close(); } catch { /* ignore */ } });
      stale.clear();
    }
    if (!LOBBY_WS_ENABLED) return;
    if (!isLive || !user?.walletAddress) return;

    const wallet = user.walletAddress.trim().toLowerCase();
    const serverUrl = getDraftServerUrl() || 'wss://sbs-drafts-server-staging-652484219017.us-central1.run.app';

    let syncInFlight = false;
    const syncConnections = async () => {
      // Re-entrancy guard: the token fetch awaits, and an overlapping 3s tick
      // could double-connect the same draft.
      if (syncInFlight) return;
      syncInFlight = true;
      try {
        await syncConnectionsInner();
      } finally {
        syncInFlight = false;
      }
    };

    const syncConnectionsInner = async () => {
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

      // Fetch the Privy token ONCE per sync (same token for every draft).
      // Without it the server 401s the upgrade and we silently lose live
      // updates; on fetch failure we still attempt token-less (= today's
      // behavior: rejected → the 3s poll keeps the page fresh).
      let wsToken: string | null = null;
      if (draftingDrafts.some((d) => !conns.has(d.id))) {
        try {
          wsToken = (await getWsTokenRef.current?.()) ?? null;
        } catch { /* token-less attempt below; poll remains the fallback */ }
      }

      for (const draft of draftingDrafts) {
        if (conns.has(draft.id)) continue;

        const heartbeat = localStorage.getItem(`draft-room-ws:${draft.id}`);
        if (heartbeat && Date.now() - Number(heartbeat) < 10_000) continue;

        const tokenParam = wsToken ? `&token=${encodeURIComponent(wsToken)}` : '';
        const url = `${serverUrl}/ws?address=${encodeURIComponent(wallet)}&draftName=${encodeURIComponent(draft.id)}${tokenParam}`;
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

    void syncConnections();
    const interval = setInterval(() => { void syncConnections(); }, 3000);

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
            // Keep the store entry's airplaneMode (spread above) — DraftRow
            // already limits the ✈️ on wheel rows to status === 'drafting'.
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
      d => (d.specialType || !hiddenDraftIds.has(d.id)) && d.status !== 'completed'
        // Hide wheel-pass drafts whose slot now belongs to someone else (sold).
        && !foreignQueueDraftIds.has(d.id)
        && !(d.queueDraftId && foreignQueueDraftIds.has(d.queueDraftId)),
    );
  }, [hiddenDraftIds, isLive, liveDrafts, localDrafts, queueDrafts, foreignQueueDraftIds, user?.walletAddress]);

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

    // ── Server-clock reveal (authoritative + cross-device) ──────────────
    // The server's draftStartTime (= fill + 60s, stamped FRESH on every fill)
    // is the single source of truth for whether a draft has started. We check
    // it FIRST — before the enginePickNumber short-circuit below — because on a
    // REUSED slot id the store can still carry a stale enginePickNumber from
    // this slot's PREVIOUS draft. If the fresh clock says we're still in the
    // fill→reveal window (secs > 0), that leftover pick number is provably
    // stale and must NOT force "drafting" (the "PRO before reveal" bug: the
    // stale pick made getLiveState skip every reveal phase and show the type
    // instantly). When the clock is known, derive the ENTIRE
    // fill→reveal→drafting sequence from it so every device (and a fresh page
    // load) shows the SAME phase at the SAME wall-clock second:
    // 3s randomize bar → 15s slot-reveal countdown → draft-starting countdown
    // (DraftRow flips "Revealing…" → the type once that countdown drops < 37s).
    // Wheel specials keep their own pre-spin flow (handled below).
    if (!draft.specialType && draft.draftStartTimeMs && (draft.players ?? 0) >= 10) {
      const secs = (draft.draftStartTimeMs - now) / 1000; // seconds until drafting
      if (secs <= 0) {
        return { displayPhase: 'drafting', playerCount: 10, countdown: null, randomizingProgress: null, isFilling: false };
      }
      const sinceFill = 60 - secs;
      if (sinceFill < 3) {
        return { displayPhase: 'randomizing', playerCount: 10, countdown: null, randomizingProgress: 0.99 * Math.pow(Math.max(0, sinceFill) / 3, 0.6), isFilling: false };
      }
      if (secs > 45) {
        return { displayPhase: 'pre-spin-countdown', playerCount: 10, countdown: Math.max(0, Math.ceil(secs - 45)), randomizingProgress: null, isFilling: false };
      }
      return { displayPhase: 'draft-starting', playerCount: 10, countdown: Math.max(0, Math.ceil(secs)), randomizingProgress: null, isFilling: false };
    }

    // Authoritative "already drafting" short-circuit (FALLBACK — only when no
    // server clock is available above): if the engine reports a real pick in
    // progress, the draft is live — show drafting and NEVER replay the
    // randomize/reveal intro. A returning or late-loading client would
    // otherwise fabricate "Revealing…" off cached/`now` anchors for a draft
    // that already started (the bug behind a card stuck on "Revealing…" ~2s).
    if ((draft.enginePickNumber ?? 0) > 0) {
      return { displayPhase: 'drafting', playerCount: 10, countdown: null, randomizingProgress: null, isFilling: false };
    }

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
        // 10/10 but no authoritative server clock (draftStartTimeMs) or real
        // randomize anchor yet. DON'T fabricate a "Revealing…" bar from `now` —
        // a returning/late-loading client (cached "filling" 10/10) would wrongly
        // replay the reveal for a draft that already started. Show an honest
        // 10/10; the server-clock branch above owns randomize→reveal→drafting
        // the instant draftStartTimeMs lands (≈1s after a genuine live fill, as
        // it's fetched together with the player count), and the drafting branch
        // takes over once the backend reports the draft as started.
        return { displayPhase: 'filling', playerCount: 10, countdown: null, randomizingProgress: null, isFilling: true };
      }
      return { displayPhase: 'filling', playerCount: count, countdown: null, randomizingProgress: null, isFilling: true };
    }

    if (draft.status === 'filling') {
      return { displayPhase: 'filling', playerCount: draft.players || 1, countdown: null, randomizingProgress: null, isFilling: true };
    }
    return { displayPhase: 'drafting', playerCount: draft.players, countdown: null, randomizingProgress: null, isFilling: false };
  };

  // (Auto-rotate timer removed 2026-06-09 — promos on this page are
  // browse-on-click only, matching the home-page carousel.)

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
      safeSetItem('banana-hidden-drafts', JSON.stringify(Array.from(newHidden)));
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
          // reason:'leave' → server fires the admin "new user left the lobby"
          // ping (a join-failure refund omits it, so it never mis-pings).
          body: JSON.stringify({ userId, passType, leagueId: exitingDraft.id, tokenId: storedDraft?.cardId || exitingDraft.cardId, reason: 'leave' }),
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
    safeSetItem('banana-hidden-drafts', JSON.stringify(Array.from(newHidden)));
    setHiddenDraftIds(newHidden);
    // Mark these as explicit clears so the self-heal poll can't resurrect
    // them — Clear All overrides the active-draft protection.
    const newCleared = new Set([...Array.from(explicitlyClearedIds), ...combinedIds]);
    safeSetItem('banana-cleared-drafts', JSON.stringify(Array.from(newCleared)));
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
    joinError,
    clearJoinError,
    showContestDetails,
    infoTopic,
    handleEnterDraft,
    handleEntryComplete,
    showAddFunds,
    setShowAddFunds,
    depositBuying,
    depositBuyError,
    clearDepositBuyError,
    handleDraftClick,
    handleClaim,
    confirmExitDraft,
    clearAllDrafts,
    getLiveState,
    setExitingDraft,
    setShowBuyPasses,
    showBuyFromBalance,
    setShowBuyFromBalance,
    handleBuyFromBalance,
    setSelectedPromo,
    setPromoIndex,
    setShowEntryFlow,
    setShowContestDetails,
    setInfoTopic,
  };
}
