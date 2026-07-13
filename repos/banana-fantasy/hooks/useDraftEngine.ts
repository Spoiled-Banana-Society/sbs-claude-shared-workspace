'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ALL_POSITIONS,
  DRAFT_PLAYERS,
  TOTAL_PICKS,
  positionFromPlayerId,
  slotFromPlayerId,
} from '@/lib/draftRoomConstants';
import type { PlayerData, DraftPick, PositionRoster } from '@/lib/draftRoomConstants';
import type { RealTimeDraftInfo, LastPickInfo } from '@/hooks/useRealTimeDraftInfo';
import { logger } from '@/lib/logger';
import { reportClientEvent } from '@/lib/clientErrors';
import { LOG_SOURCES } from '@/lib/logSources';
import { DEFAULT_POSITION_LIMITS, type Position, type PositionLimits } from '@/lib/positionLimits';
import { usePositionLimits } from '@/hooks/usePositionLimits';
import { bananaPlaceholderName } from '@/utils/helpers';

export type DraftPlayer = typeof DRAFT_PLAYERS[number];
export type DraftMode = 'local' | 'live';

// How long to keep the live board on screen after the FINAL pick lands, before
// flipping to the completion / card-generation overlay. Just long enough for
// everyone to see the last auto/manual pick render in the board + last box
// (mobile + desktop), then move on.
const FINAL_PICK_REVEAL_MS = 1000;

export interface DraftEngineState {
  picks: DraftPick[];
  currentPickNumber: number;
  currentRound: number;
  currentDrafterIndex: number;
  draftOrder: DraftPlayer[];
  userDraftPosition: number;
  availablePlayers: PlayerData[];
  queuedPlayers: PlayerData[];
  rosters: Record<string, PositionRoster>;
  timeRemaining: number;
  isUserTurn: boolean;
  turnsUntilUserPick: number;
  upcomingUserPicks: number[];
  draftStatus: 'waiting' | 'active' | 'completed';
  mostRecentPick: DraftPick | null;
  draftSummary: DraftSummarySlot[];
}

export interface DraftSummarySlot {
  pickNum: number;
  round: number;
  ownerName: string;
  ownerIndex: number;
  playerId: string;
  position: string;
  team: string;
}

// Types for LIVE mode server payloads
export interface ServerPickPayload {
  playerId: string;
  displayName: string;
  team: string;
  position: string;
  ownerAddress: string;
  pickNum: number;
  round: number;
}

export interface ServerTimerPayload {
  endOfTurnTimestamp: number;
  startOfTurnTimestamp: number;
  currentDrafter: string;
  timeRemaining?: number;
}

export interface ServerDraftInfoPayload {
  draftId?: string;
  displayName: string;
  draftStartTime: number;
  pickLength: number;
  currentDrafter: string;
  pickNumber: number;
  roundNum: number;
  pickInRound: number;
  draftOrder: { ownerId: string; tokenId: string }[];
  adp?: { adp: number; byeWeek: string; playerId: string }[];
  currentPickEndTime?: number;
}

// The Go server broadcasts flat PlayerInfo as the new_pick payload.
// (The SendPickMessage struct with newPick/nextDrafter/currentPick exists in event.go but is dead code.)
// The draft_info_update message (handled separately) advances pickNumber/currentDrafter.
export type ServerNewPickPayload = ServerPickPayload;

export interface ServerFinalCardPayload {
  cardId: string;
  imageUrl: string;
  roster?: Record<string, unknown>;
}

type ProcessablePick = Pick<
  ServerPickPayload,
  'playerId' | 'team' | 'position' | 'ownerAddress' | 'pickNum' | 'round'
>;

// Server player data format (from REST API)
export interface ServerPlayerData {
  playerId: string;
  playerStateInfo: {
    playerId: string;
    displayName: string;
    team: string;
    position: string;
    ownerAddress: string;
    pickNum: number;
    round: number;
  };
  stats: {
    playerId: string;
    averageScore: number;
    highestScore: number;
    top5Finishes: number;
    adp: number;
    byeWeek: number;
    playersFromTeam: string[] | null;
  };
  ranking: {
    playerId: string;
    rank: number;
    score: number;
  };
}

export interface ServerDraftSummaryItem {
  playerInfo: {
    playerId: string;
    displayName: string;
    team: string;
    position: string;
    ownerAddress: string;
    pickNum: number;
    round: number;
  };
  pfpInfo: {
    imageUrl: string;
    nftContract: string;
    displayName: string;
  };
}

type ServerRosterEntry = string | { playerId: string };

type ServerRosterState = Record<
  string,
  { QB: ServerRosterEntry[]; RB: ServerRosterEntry[]; WR: ServerRosterEntry[]; TE: ServerRosterEntry[]; DST: ServerRosterEntry[] }
>;

function getRosterPlayerId(entry: ServerRosterEntry): string {
  return typeof entry === 'string' ? entry : entry.playerId;
}

function createEmptyRoster(): PositionRoster {
  return { QB: [], RB: [], WR: [], TE: [], DST: [] };
}

/** Get drafter index for a given pick number in snake draft (10 players) */
function getSnakeDrafterIndex(pickNumber: number): number {
  const round = Math.ceil(pickNumber / 10);
  const posInRound = ((pickNumber - 1) % 10);
  return round % 2 === 1 ? posInRound : 9 - posInRound;
}

/** Count how many turns until a specific player index picks again */
function calculateTurnsUntilPick(currentPick: number, targetIndex: number): number {
  for (let i = 1; i <= TOTAL_PICKS - currentPick + 1; i++) {
    if (getSnakeDrafterIndex(currentPick + i) === targetIndex) {
      return i;
    }
  }
  return 0;
}

/** Generate pre-computed draft summary slots */
function generateDraftSummary(draftOrder: DraftPlayer[]): DraftSummarySlot[] {
  const slots: DraftSummarySlot[] = [];
  for (let pick = 1; pick <= TOTAL_PICKS; pick++) {
    const round = Math.ceil(pick / 10);
    const drafterIdx = getSnakeDrafterIndex(pick);
    const owner = draftOrder[drafterIdx];
    slots.push({
      pickNum: pick,
      round,
      ownerName: owner?.name || '',
      ownerIndex: drafterIdx,
      playerId: '',
      position: '',
      team: '',
    });
  }
  return slots;
}

/** Per-player ADP/bye/rank lookup. Live (server) values override the static
 *  ALL_POSITIONS baseline — see `playerStatsById` below. */
export type PlayerStat = { adp: number; byeWeek: number; rank: number };

// Static baseline derived from the bundled ALL_POSITIONS file. Used only before
// the server payload arrives (filling/local mode); replaced by live server data
// in initializeFromServer so the roster panel never reads a stale hardcoded ADP.
const STATIC_STATS_BY_ID: Record<string, PlayerStat> = Object.fromEntries(
  ALL_POSITIONS.map((p) => [p.playerId, { adp: p.adp, byeWeek: p.byeWeek, rank: p.rank }]),
);

export function useDraftEngine(mode: DraftMode = 'local') {
  const [draftOrder, setDraftOrder] = useState<DraftPlayer[]>([]);
  const [userDraftPosition, setUserDraftPosition] = useState(0);
  const [picks, setPicks] = useState<DraftPick[]>([]);
  const [currentPickNumber, setCurrentPickNumber] = useState(1);
  const [availablePlayers, setAvailablePlayers] = useState<PlayerData[]>(ALL_POSITIONS);
  // Live ADP/bye/rank for EVERY player (including already-picked ones), so the
  // roster panel/tab show the SAME ADP as the live board + results page instead
  // of the static ALL_POSITIONS file (which must be hand-regenerated and drifts).
  // Seeded with the static baseline; overwritten by the server payload below.
  const [playerStatsById, setPlayerStatsById] = useState<Record<string, PlayerStat>>(STATIC_STATS_BY_ID);
  const [queuedPlayers, setQueuedPlayers] = useState<PlayerData[]>([]);
  const [rosters, setRosters] = useState<Record<string, PositionRoster>>({});
  const [timeRemaining, setTimeRemaining] = useState(30);
  const [draftStatus, setDraftStatus] = useState<'waiting' | 'active' | 'completed'>('waiting');
  const [mostRecentPick, setMostRecentPick] = useState<DraftPick | null>(null);
  const [draftSummary, setDraftSummary] = useState<DraftSummarySlot[]>([]);

  // LIVE mode additional state
  const [preTimeRemaining, setPreTimeRemaining] = useState(0);
  const [currentDrafterAddress, setCurrentDrafterAddress] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const walletAddressRef = useRef(''); // Ref mirror for stable callbacks (handleNewPick)
  const [finalCard, setFinalCard] = useState<{ cardId: string; imageUrl: string } | null>(null);
  const [endOfTurnTimestamp, setEndOfTurnTimestamp] = useState(0);
  // Phase tracking — matches old useDraftRoom.ts "phase" concept:
  // 'countdown' = pre-draft 60s countdown (server sends countdown_update)
  // 'live' = draft is active, picks are happening (server sends timer_update)
  const [draftPhase, setDraftPhase] = useState<'countdown' | 'live'>('countdown');

  // ==================== AIRPLANE MODE STATE ====================
  // When user lets timer expire 2 picks in a row, airplane mode auto-enables.
  // While active, auto-picks immediately when it's the user's turn.
  const [airplaneMode, setAirplaneMode] = useState(false);
  const [autoPickSortPreference, setAutoPickSortPreference] = useState<'adp' | 'rank'>('adp');
  const consecutiveTimeoutsRef = useRef(0);
  // Tracks whether the user manually picked during their current turn (for live mode detection)
  const userPickedManuallyRef = useRef(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const botTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isProcessingRef = useRef(false);
  // Track highest pickNum seen — rejects duplicate/stale picks (matches old useDraftRoom.ts pattern)
  const lastPickRef = useRef<number>(0);
  // Holds the deferred "draft completed" timer so the FINAL pick paints on the
  // board/last box (mobile + desktop) before the completion overlay covers it.
  const completionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Computed values
  const currentRound = Math.ceil(currentPickNumber / 10);
  const currentDrafterIndex = getSnakeDrafterIndex(currentPickNumber);
  const currentDrafter = draftOrder[currentDrafterIndex];

  // isUserTurn: different logic for local vs live
  const isUserTurn = mode === 'live'
    ? draftStatus === 'active' && currentDrafterAddress.toLowerCase() === walletAddress.toLowerCase() && walletAddress !== ''
    : draftStatus === 'active' && currentDrafter?.isYou === true;

  const turnsUntilUserPick = draftStatus === 'active' && !isUserTurn
    ? (mode === 'live'
      ? calculateTurnsUntilPick(currentPickNumber, userDraftPosition)
      : calculateTurnsUntilPick(currentPickNumber, draftOrder.findIndex(p => p.isYou)))
    : 0;

  // The user's next two overall pick numbers, strictly after the pick on the
  // clock (while the user is picking, only the following pick matters).
  // Powers the "YOUR PICK · N" divider in the player list. Empty when the
  // draft isn't active or the viewer isn't a drafter (findIndex → -1).
  const upcomingUserPickIndex = mode === 'live' ? userDraftPosition : draftOrder.findIndex(p => p.isYou);
  const upcomingUserPicks = useMemo(() => {
    const picks: number[] = [];
    if (draftStatus !== 'active' || upcomingUserPickIndex < 0 || draftOrder.length === 0) return picks;
    for (let pick = currentPickNumber + 1; pick <= TOTAL_PICKS && picks.length < 2; pick++) {
      if (getSnakeDrafterIndex(pick) === upcomingUserPickIndex) picks.push(pick);
    }
    return picks;
  }, [draftStatus, upcomingUserPickIndex, currentPickNumber, draftOrder.length]);

  // ==================== LOCAL MODE: INITIALIZE DRAFT ====================
  const initializeDraft = useCallback((shuffledOrder: DraftPlayer[]) => {
    setDraftOrder(shuffledOrder);
    const userPos = shuffledOrder.findIndex(p => p.isYou);
    setUserDraftPosition(userPos);

    const initialRosters: Record<string, PositionRoster> = {};
    shuffledOrder.forEach(p => {
      initialRosters[p.name] = createEmptyRoster();
    });
    setRosters(initialRosters);

    setAvailablePlayers([...ALL_POSITIONS]);
    setPicks([]);
    setCurrentPickNumber(1);
    setTimeRemaining(30);
    setDraftStatus('active');
    setDraftPhase('live');
    setMostRecentPick(null);
    setQueuedPlayers([]);
    setDraftSummary(generateDraftSummary(shuffledOrder));
  }, []);

  // ==================== LOCAL MODE: RESTORE DRAFT FROM SAVED STATE ====================
  const restoreDraft = useCallback((
    shuffledOrder: DraftPlayer[],
    savedPicks: DraftPick[],
    savedPickNumber: number,
    savedQueue?: PlayerData[],
  ) => {
    setDraftOrder(shuffledOrder);
    const userPos = shuffledOrder.findIndex(p => p.isYou);
    setUserDraftPosition(userPos);

    // Rebuild rosters from picks
    const builtRosters: Record<string, PositionRoster> = {};
    shuffledOrder.forEach(p => {
      builtRosters[p.name] = createEmptyRoster();
    });
    for (const pick of savedPicks) {
      const basePos = positionFromPlayerId(pick.playerId) as keyof PositionRoster;
      if (builtRosters[pick.ownerName]?.[basePos]) {
        builtRosters[pick.ownerName][basePos] = [...builtRosters[pick.ownerName][basePos], pick.playerId];
      }
    }
    setRosters(builtRosters);

    // Remove picked players from available
    const pickedIds = new Set(savedPicks.map(p => p.playerId));
    setAvailablePlayers([...ALL_POSITIONS].filter(p => !pickedIds.has(p.playerId)));

    // Restore queue, filtering out any that were picked
    if (savedQueue) {
      setQueuedPlayers(savedQueue.filter(q => !pickedIds.has(q.playerId)));
    } else {
      setQueuedPlayers([]);
    }

    setPicks(savedPicks);
    setCurrentPickNumber(savedPickNumber);
    setTimeRemaining(30);
    setDraftStatus(savedPickNumber > TOTAL_PICKS ? 'completed' : 'active');
    setMostRecentPick(savedPicks[savedPicks.length - 1] || null);

    // Rebuild draft summary
    const summary = generateDraftSummary(shuffledOrder);
    for (const pick of savedPicks) {
      const idx = pick.pickNumber - 1;
      if (summary[idx]) {
        summary[idx] = { ...summary[idx], playerId: pick.playerId, position: pick.position, team: pick.team };
      }
    }
    setDraftSummary(summary);
  }, []);

  // ==================== LIVE MODE: INITIALIZE FROM SERVER ====================
  const initializeFromServer = useCallback((
    draftInfo: ServerDraftInfoPayload,
    playerRankings: ServerPlayerData[],
    summary: ServerDraftSummaryItem[],
    serverRosters: ServerRosterState,
    queue: ServerPickPayload[],
    userWallet: string,
  ) => {
    setWalletAddress(userWallet.toLowerCase());
    walletAddressRef.current = userWallet.toLowerCase();

    // Build draft order from server draftOrder
    const order: DraftPlayer[] = draftInfo.draftOrder.map((u, idx) => ({
      id: String(idx + 1),
      name: u.ownerId, // In live mode, name is the wallet address (kept raw — it's the usersMap lookup key)
      displayName: bananaPlaceholderName(u.ownerId), // never the raw wallet OR a hash-derived Banana##### (hash collides across users) — neutral placeholder until the real handle layers in from usersMap
      isYou: u.ownerId.toLowerCase() === userWallet.toLowerCase(),
      avatar: '🍌',
    }));
    setDraftOrder(order);

    const userPos = order.findIndex(p => p.isYou);
    setUserDraftPosition(userPos);

    // Build available players from rankings
    const available: PlayerData[] = playerRankings
      .filter(p => p.playerStateInfo.ownerAddress === '')
      .map(p => ({
        playerId: p.playerStateInfo.playerId,
        team: p.playerStateInfo.team,
        position: p.playerStateInfo.position,
        adp: p.stats.adp,
        rank: p.ranking.rank,
        byeWeek: p.stats.byeWeek,
        playersFromTeam: p.stats.playersFromTeam || [],
      }));
    setAvailablePlayers(available);

    // Build the live per-player stats map from the FULL ranking list (NOT the
    // available-only filter above) — picked players carry an ownerAddress but
    // still have their real stats here. This is the single source the roster
    // views read ADP/bye from, so a picked player's ADP always matches the
    // live board. Falls back to the static baseline for any id the server omits.
    const liveStats: Record<string, PlayerStat> = { ...STATIC_STATS_BY_ID };
    for (const p of playerRankings) {
      const id = p.playerStateInfo.playerId || p.playerId;
      if (!id) continue;
      liveStats[id] = { adp: p.stats.adp, byeWeek: p.stats.byeWeek, rank: p.ranking.rank };
    }
    setPlayerStatsById(liveStats);

    // Build picks from summary — filter on playerId (not ownerAddress!) because the server
    // pre-populates ownerAddress for ALL 150 slots (assigned drafter), but only sets playerId
    // when a pick is actually made. Using ownerAddress would include all 150 slots, setting
    // lastPickRef=150 and causing EVERY WS new_pick to be rejected as "stale".
    const existingPicks: DraftPick[] = summary
      .filter(s => s.playerInfo.playerId !== '')
      .map(s => ({
        pickNumber: s.playerInfo.pickNum,
        round: s.playerInfo.round || Math.ceil(s.playerInfo.pickNum / 10),
        pickInRound: ((s.playerInfo.pickNum - 1) % 10) + 1,
        ownerName: s.playerInfo.ownerAddress,
        ownerIndex: getSnakeDrafterIndex(s.playerInfo.pickNum),
        playerId: s.playerInfo.playerId,
        position: s.playerInfo.position,
        team: s.playerInfo.team,
      }));
    setPicks(existingPicks);

    // Build rosters
    const builtRosters: Record<string, PositionRoster> = {};
    for (const [addr, roster] of Object.entries(serverRosters)) {
      builtRosters[addr] = {
        QB: (roster.QB || []).map(getRosterPlayerId),
        RB: (roster.RB || []).map(getRosterPlayerId),
        WR: (roster.WR || []).map(getRosterPlayerId),
        TE: (roster.TE || []).map(getRosterPlayerId),
        DST: (roster.DST || []).map(getRosterPlayerId),
      };
    }
    setRosters(builtRosters);

    // Build draft summary
    const draftSummarySlots = generateDraftSummary(order);
    for (const pick of existingPicks) {
      const idx = pick.pickNumber - 1;
      if (draftSummarySlots[idx]) {
        draftSummarySlots[idx] = {
          ...draftSummarySlots[idx],
          playerId: pick.playerId,
          position: pick.position,
          team: pick.team,
        };
      }
    }
    setDraftSummary(draftSummarySlots);

    // Build queue from server
    const queuePlayers: PlayerData[] = queue
      .map(q => available.find(a => a.playerId === q.playerId))
      .filter((p): p is PlayerData => p !== undefined);
    setQueuedPlayers(queuePlayers);

    // Set current state
    setCurrentPickNumber(draftInfo.pickNumber || 1);
    setCurrentDrafterAddress(draftInfo.currentDrafter || '');
    setDraftStatus(draftInfo.pickNumber > TOTAL_PICKS ? 'completed' : 'active');
    setMostRecentPick(existingPicks[existingPicks.length - 1] || null);

    // Initialize lastPickRef from existing picks so WS dedup rejects replayed picks
    const highestPick = existingPicks.reduce((max, p) => Math.max(max, p.pickNumber), 0);
    lastPickRef.current = highestPick;

    // Timer initialization — matches old useTimer.tsx approach:
    // 1. If draft hasn't started yet → countdown to draftStartTime
    // 2. If draft is active → use pickLength as default; WS timer_update will override with exact endOfTurnTimestamp
    const now = Date.now();
    if (draftInfo.draftStartTime && now < draftInfo.draftStartTime * 1000) {
      // Draft hasn't started yet — show countdown to start
      const remaining = Math.max(0, Math.ceil((draftInfo.draftStartTime * 1000 - now) / 1000));
      setTimeRemaining(remaining);
      setEndOfTurnTimestamp(draftInfo.draftStartTime);
      setDraftPhase('countdown');
    } else {
      // Draft is active — use pickLength as reasonable default
      // The WS timer_update message will quickly override this with the precise endOfTurnTimestamp
      setTimeRemaining(draftInfo.pickLength || 30);
      setDraftPhase('live');
      // Don't set endOfTurnTimestamp here — let the WS timer_update set it accurately
    }
  }, []);

  // ==================== LIVE MODE HANDLERS ====================

  const handleCountdownUpdate = useCallback((payload: { timeRemaining: number; currentDrafter: string }) => {
    setPreTimeRemaining(payload.timeRemaining);
    setCurrentDrafterAddress(payload.currentDrafter || '');
    setDraftPhase('countdown');
  }, []);

  const handleTimerUpdate = useCallback((payload: ServerTimerPayload) => {
    setCurrentDrafterAddress(payload.currentDrafter);
    setEndOfTurnTimestamp(payload.endOfTurnTimestamp);
    // Calculate remaining from server timestamps (server sends UNIX seconds, convert to ms)
    const remaining = Math.max(0, Math.ceil((payload.endOfTurnTimestamp * 1000 - Date.now()) / 1000));
    setTimeRemaining(remaining);
    setDraftPhase('live'); // First timer_update = draft has started, picks are happening
  }, []);

  // Flip the draft to "completed" — but on a short delay so the FINAL pick has
  // a chance to paint on the board + last box (mobile + desktop) before the
  // DraftComplete overlay (z-[60]) covers it. Live completion can arrive from
  // several places that all land in the SAME Firebase snapshot as the last pick
  // (processPick's pickNum>=TOTAL, setFirebaseState's isDraftComplete, the WS
  // draft_complete/final_card messages) — routing them all through here means
  // whichever fires the deferral wins and reschedules to one clean delay.
  // Idempotent: re-calls just reset the single pending timer.
  const scheduleCompletion = useCallback(() => {
    if (completionTimerRef.current) return; // already scheduled — keep the one delay
    // Server-shipped (admin Logs) so we can SEE that the final pick is being held
    // on the board before completion — and for how long — to debug the
    // "last pick didn't show, jumped straight to next phase" report.
    reportClientEvent({
      source: LOG_SOURCES.draft.COMPLETE_TRACE,
      message: '[Complete] final pick in — holding board for reveal',
      route: 'useDraftEngine.scheduleCompletion',
      actor: walletAddressRef.current,
      context: { event: 'hold_scheduled', delayMs: FINAL_PICK_REVEAL_MS },
    }, { skipThrottle: true });
    completionTimerRef.current = setTimeout(() => {
      completionTimerRef.current = null;
      reportClientEvent({
        source: LOG_SOURCES.draft.COMPLETE_TRACE,
        message: '[Complete] reveal window elapsed — flipping to completed',
        route: 'useDraftEngine.scheduleCompletion',
        actor: walletAddressRef.current,
        context: { event: 'hold_elapsed' },
      }, { skipThrottle: true });
      setDraftStatus('completed');
    }, FINAL_PICK_REVEAL_MS);
  }, []);

  const processPick = useCallback((pickData: ProcessablePick) => {
    const basePos = positionFromPlayerId(pickData.playerId);

    const pick: DraftPick = {
      pickNumber: pickData.pickNum,
      round: pickData.round,
      pickInRound: ((pickData.pickNum - 1) % 10) + 1,
      ownerName: pickData.ownerAddress,
      ownerIndex: getSnakeDrafterIndex(pickData.pickNum),
      playerId: pickData.playerId,
      position: pickData.position,
      team: pickData.team,
    };

    setPicks(prev => [...prev, pick]);
    setAvailablePlayers(prev => prev.filter(player => player.playerId !== pickData.playerId));
    setMostRecentPick(pick);

    setRosters(prev => {
      const updated = { ...prev };
      const ownerAddr = pickData.ownerAddress;
      const roster = { ...(updated[ownerAddr] || createEmptyRoster()) };
      const rosterKey = basePos as keyof PositionRoster;
      if (roster[rosterKey] && !roster[rosterKey].includes(pickData.playerId)) {
        roster[rosterKey] = [...roster[rosterKey], pickData.playerId];
      }
      updated[ownerAddr] = roster;
      return updated;
    });

    setDraftSummary(prev => {
      const updated = [...prev];
      const idx = pickData.pickNum - 1;
      if (updated[idx]) {
        updated[idx] = {
          ...updated[idx],
          playerId: pickData.playerId,
          position: pickData.position,
          team: pickData.team,
        };
      }
      return updated;
    });

    setQueuedPlayers(prev => prev.filter(player => player.playerId !== pickData.playerId));

    const wallet = walletAddressRef.current;
    if (wallet && pickData.ownerAddress.toLowerCase() === wallet) {
      // BUG 1 FIX (multi-device airplane): do NOT infer a "missed pick" from
      // this device's local userPickedManuallyRef. That flag is only set on the
      // device that actually tapped the player, so when a user had the same
      // draft open on both desktop and phone, a MANUAL pick made on desktop
      // arrived at the phone looking like a server auto-pick. The phone then
      // incremented its own counter and, after two such picks, wrongly flipped
      // itself into airplane mode and started auto-drafting for the user.
      //
      // The server's numPicksMissedConsecutive is device-independent and resets
      // on any manual pick from ANY device. It is mirrored into the engine after
      // every pick by the post-pick preferences sync in page.tsx (via
      // setConsecutiveTimeouts / setAirplaneMode), so it is now the single
      // source of truth for the counter and airplane state. The local counter is
      // still reset instantly on the tapping device by markManualPick() for snappy
      // feedback; here we only clear the manual flag as housekeeping.
      userPickedManuallyRef.current = false;
    }

    if (pickData.pickNum >= TOTAL_PICKS) {
      // Confirms the FINAL pick was processed onto the board (setPicks /
      // setDraftSummary above) before completion — the thing that was silently
      // skipped when detection keyed on pickNumber. If this trace is present,
      // the last pick rendered on the board.
      reportClientEvent({
        source: LOG_SOURCES.draft.COMPLETE_TRACE,
        message: '[Complete] final pick processed onto board',
        route: 'useDraftEngine.processPick',
        actor: walletAddressRef.current,
        context: { event: 'final_pick_processed', pickNum: pickData.pickNum, playerId: pickData.playerId },
      }, { skipThrottle: true });
      scheduleCompletion();
    }
  }, [scheduleCompletion]);

  const handleNewPick = useCallback((payload: ServerNewPickPayload) => {
    // Go server sends flat PlayerInfo: { playerId, displayName, team, position, ownerAddress, pickNum, round }
    const pickData = payload;
    logger.debug('[handleNewPick] Received:', pickData.playerId, 'pick#', pickData.pickNum, 'lastPickRef:', lastPickRef.current);
    if (!pickData.playerId) {
      console.warn('[handleNewPick] Empty playerId, skipping');
      return;
    }

    // Guard: reject duplicate/stale picks (matches production useDraftRoom.ts pattern)
    if (pickData.pickNum <= lastPickRef.current) {
      console.warn('[handleNewPick] Rejecting stale pick:', pickData.pickNum, '<=', lastPickRef.current);
      return;
    }
    lastPickRef.current = pickData.pickNum;
    processPick(pickData);
  }, [processPick]);

  const handleDraftInfoUpdate = useCallback((payload: ServerDraftInfoPayload) => {
    // Guard: never go backwards — stale/duplicate server messages can send lower pickNumber
    setCurrentPickNumber(prev => {
      if (payload.pickNumber < prev) {
        console.warn(`[Draft] Ignoring backwards draft_info_update: server sent pick ${payload.pickNumber}, current is ${prev}`);
        return prev;
      }
      return payload.pickNumber;
    });
    setCurrentDrafterAddress(payload.currentDrafter);
    // Note: do NOT update lastPickRef here. The server sends pickNumber = N+1 (next pick)
    // after pick N is made. Setting lastPickRef = N+1 would cause new_pick for pick N+1 to be
    // rejected (N+1 <= N+1). lastPickRef is only safely updated by handleNewPick (set to pickNum)
    // and initializeFromServer (set to highest existing pick).
  }, []);

  const handleDraftComplete = useCallback(() => {
    scheduleCompletion();
  }, [scheduleCompletion]);

  const handleFinalCard = useCallback((payload: ServerFinalCardPayload) => {
    setFinalCard({ cardId: payload.cardId, imageUrl: payload.imageUrl });
    scheduleCompletion();
  }, [scheduleCompletion]);

  // ==================== LIVE MODE: Firebase RTDB state handler ====================
  // Accepts a Firebase RTDB snapshot and updates engine state accordingly.
  // This replaces the WebSocket timer_update, new_pick, and draft_info_update handlers.
  const setFirebaseState = useCallback((rtdb: RealTimeDraftInfo) => {
    // Update current drafter
    setCurrentDrafterAddress(rtdb.currentDrafter);

    // Update pick number (never go backwards)
    setCurrentPickNumber(prev => {
      if (rtdb.pickNumber < prev) {
        console.warn(`[Firebase] Ignoring backwards pickNumber: ${rtdb.pickNumber} < ${prev}`);
        return prev;
      }
      return rtdb.pickNumber;
    });

    // Update timer from pickEndTime (replaces WS timer_update)
    if (rtdb.pickEndTime) {
      setEndOfTurnTimestamp(rtdb.pickEndTime);
      const remaining = Math.max(0, Math.ceil((rtdb.pickEndTime * 1000 - Date.now()) / 1000));
      setTimeRemaining(prev => prev === remaining ? prev : remaining);
      setDraftPhase('live');
    }

    // Detect draft start countdown
    if (rtdb.draftStartTime && Date.now() < rtdb.draftStartTime * 1000) {
      const remaining = Math.max(0, Math.ceil((rtdb.draftStartTime * 1000 - Date.now()) / 1000));
      setPreTimeRemaining(remaining);
      setDraftPhase('countdown');
    }

    // Check completion. The final pick (lastPick.pickNum === TOTAL) and
    // isDraftComplete arrive in the SAME RTDB snapshot, so flipping completed
    // here synchronously would cover the board before the last pick paints.
    // Defer it so the final pick is visible first.
    if (rtdb.isDraftComplete) {
      scheduleCompletion();
    }
  }, [scheduleCompletion]);

  // Process a new pick detected by the Firebase RTDB listener.
  // Called by the page when useRealTimeDraftInfo signals newPickDetected.
  const handleFirebaseNewPick = useCallback((pick: LastPickInfo) => {
    if (!pick.playerId) {
      console.warn('[handleFirebaseNewPick] Empty playerId, skipping');
      return;
    }

    // Guard: reject duplicate/stale picks
    if (pick.pickNum <= lastPickRef.current) {
      console.warn('[handleFirebaseNewPick] Rejecting stale pick:', pick.pickNum, '<=', lastPickRef.current);
      return;
    }
    lastPickRef.current = pick.pickNum;
    processPick(pick);
  }, [processPick]);

  // ==================== LOCAL MODE: DRAFT A PLAYER ====================
  const draftPlayer = useCallback((playerId: string): ServerPickPayload | null => {
    if (draftStatus !== 'active' || currentPickNumber > TOTAL_PICKS) return null;

    // In LIVE mode, just build the payload — don't update local state
    // (server will send new_pick back which triggers handleNewPick)
    // Matches production useDraftRoom.ts makePick() — no 500ms buffer, just check canDraft equivalent
    if (mode === 'live') {
      const player = availablePlayers.find(p => p.playerId === playerId);
      if (!player) {
        console.warn('[Draft] Pick rejected — player not found in availablePlayers:', playerId);
        return null;
      }

      // Match production useDraftRoom.ts makePick() payload exactly
      const payload = {
        playerId: player.playerId,
        displayName: player.playerId, // Production also uses playerId as displayName for picks
        team: player.team,
        position: positionFromPlayerId(player.playerId),
        ownerAddress: walletAddress, // Already lowercased by initializeFromServer
        pickNum: currentPickNumber,
        round: currentRound,
      };
      logger.debug('[Draft] Sending pick:', payload);
      return payload;
    }

    // LOCAL mode: full local state update
    if (isProcessingRef.current) return null;
    isProcessingRef.current = true;

    const player = availablePlayers.find(p => p.playerId === playerId);
    if (!player) { isProcessingRef.current = false; return null; }

    const drafter = draftOrder[currentDrafterIndex];
    const basePos = positionFromPlayerId(playerId);

    const newPick: DraftPick = {
      pickNumber: currentPickNumber,
      round: currentRound,
      pickInRound: ((currentPickNumber - 1) % 10) + 1,
      ownerName: drafter.name,
      ownerIndex: currentDrafterIndex,
      playerId,
      position: player.position,
      team: player.team,
    };

    setPicks(prev => [...prev, newPick]);
    setAvailablePlayers(prev => prev.filter(p => p.playerId !== playerId));
    setMostRecentPick(newPick);

    setRosters(prev => {
      const updated = { ...prev };
      const roster = { ...updated[drafter.name] };
      const rosterKey = basePos as keyof PositionRoster;
      if (roster[rosterKey]) {
        roster[rosterKey] = [...roster[rosterKey], playerId];
      }
      updated[drafter.name] = roster;
      return updated;
    });

    setDraftSummary(prev => {
      const updated = [...prev];
      const idx = currentPickNumber - 1;
      if (updated[idx]) {
        updated[idx] = { ...updated[idx], playerId, position: player.position, team: player.team };
      }
      return updated;
    });

    setQueuedPlayers(prev => prev.filter(p => p.playerId !== playerId));

    const nextPick = currentPickNumber + 1;
    if (nextPick > TOTAL_PICKS) {
      scheduleCompletion();
      setCurrentPickNumber(nextPick);
    } else {
      setCurrentPickNumber(nextPick);
      setTimeRemaining(30);
    }

    isProcessingRef.current = false;
    return null;
  }, [mode, draftStatus, currentPickNumber, availablePlayers, draftOrder, currentDrafterIndex, currentRound, walletAddress, endOfTurnTimestamp, scheduleCompletion]);

  // ==================== AUTO-PICK AI ====================
  // positionLimits caps the auto-picker so a single seat can't grind out 8 QBs.
  // Caps filter BPA candidates ONLY — the queue bypasses them, because a queued
  // player is a deferred manual pick and manual picks bypass caps entirely
  // (jetsonjets22 draft-77: caps silently overrode his queued WR2s). If every
  // position is at its cap, we relax and pick BPA so the draft never stalls
  // (caps block, they never force fills).
  const autoPickForPlayer = useCallback((
    playerRoster: PositionRoster,
    queue: PlayerData[],
    available: PlayerData[],
    _round: number,
    sortBy: 'adp' | 'rank' = 'adp',
    positionLimits: PositionLimits = DEFAULT_POSITION_LIMITS,
    capsEnabled: boolean = true,
  ): string => {
    const isAtCap = (playerId: string): boolean => {
      if (!capsEnabled) return false; // user turned auto-draft position limits off
      // Caps are per TIERED slot (WR1/WR2/RB1/RB2 limited separately).
      const slot = slotFromPlayerId(playerId) as Position;
      const cap = positionLimits[slot];
      if (typeof cap !== 'number') return false;
      // The roster array is keyed by BASE position (QB/RB/WR/...), so count only
      // the entries that match this exact tiered slot.
      const basePos = positionFromPlayerId(playerId) as keyof PositionRoster;
      const haveOfSlot = (playerRoster[basePos] ?? []).filter(
        (pid) => slotFromPlayerId(pid) === slot,
      ).length;
      return haveOfSlot >= cap;
    };
    const sortByMetric = (a: PlayerData, b: PlayerData) =>
      sortBy === 'adp' ? a.adp - b.adp : a.rank - b.rank;

    // 1. Queue first — a queued player is a deferred MANUAL pick, so position
    //    caps do NOT apply here (same as clicking the player live). The queue
    //    always beats the caps.
    if (queue.length > 0) {
      const queuePick = queue.find(q =>
        available.some(a => a.playerId === q.playerId),
      );
      if (queuePick) return queuePick.playerId;
    }

    // 2. Best player available filtered by position caps — every round.
    const filtered = available.filter(p => !isAtCap(p.playerId)).sort(sortByMetric);
    if (filtered.length > 0) return filtered[0].playerId;

    // 3. RELAX: every position is at cap. Fall back to unconstrained BPA
    //    so the draft never stalls.
    const sorted = [...available].sort(sortByMetric);
    return sorted[0]?.playerId || '';
  }, []);

  // User's per-wallet limits (loaded from Firestore via usePositionLimits).
  // Falls back to defaults until loaded or for non-wallet contexts.
  const { limits: userLimits, enabled: userLimitsEnabled } = usePositionLimits();

  // ==================== AIRPLANE MODE FUNCTIONS ====================

  /** Returns the playerId that auto-pick would select right now */
  const getAutoPickPlayer = useCallback((): string => {
    const rosterKey = mode === 'live' ? walletAddress : (currentDrafter?.name || '');
    const roster = rosters[rosterKey] || createEmptyRoster();
    return autoPickForPlayer(roster, queuedPlayers, availablePlayers, currentRound, autoPickSortPreference, userLimits, userLimitsEnabled);
  }, [mode, walletAddress, currentDrafter, rosters, queuedPlayers, availablePlayers, currentRound, autoPickSortPreference, autoPickForPlayer, userLimits, userLimitsEnabled]);

  /** Called by the page when user manually picks a player */
  const markManualPick = useCallback(() => {
    consecutiveTimeoutsRef.current = 0;
    userPickedManuallyRef.current = true;
  }, []);

  /**
   * Reset the consecutive-timeout counter without altering airplane state
   * or the manual-pick flag. Used when the live-mode toggle flips airplane
   * off via setAirplaneMode directly (instead of toggleAirplaneMode, which
   * resets the counter as a side effect). Without this, a user who hits
   * the 2-strike auto-enable, then toggles off, would re-trigger airplane
   * after a SINGLE further miss instead of the expected two.
   */
  const resetAirplaneTimeoutCounter = useCallback(() => {
    consecutiveTimeoutsRef.current = 0;
  }, []);

  /**
   * Mirror the server-authoritative consecutive-missed-pick counter into the
   * engine. Called from page.tsx after each Firebase pick when GET preferences
   * returns. The engine's own counter can race the server's around pick #1
   * (initializeFromServer can set lastPickRef before Firebase delivers pick
   * #1, so engine's counter never increments for it). Using the server's
   * value as the source of truth eliminates that drift.
   */
  const setConsecutiveTimeouts = useCallback((n: number) => {
    consecutiveTimeoutsRef.current = n;
  }, []);

  /** Toggle airplane mode on/off. Turning off resets the consecutive timeout counter. */
  const toggleAirplaneMode = useCallback(() => {
    setAirplaneMode(prev => {
      if (prev) {
        // Turning OFF — reset counter so it doesn't immediately re-enable
        consecutiveTimeoutsRef.current = 0;
      }
      return !prev;
    });
  }, []);

  // ==================== QUEUE MANAGEMENT ====================
  const addToQueue = useCallback((player: PlayerData) => {
    setQueuedPlayers(prev => {
      if (prev.some(p => p.playerId === player.playerId)) return prev;
      return [...prev, player];
    });
  }, []);

  const removeFromQueue = useCallback((playerId: string) => {
    setQueuedPlayers(prev => prev.filter(p => p.playerId !== playerId));
  }, []);

  const reorderQueue = useCallback((newOrder: PlayerData[]) => {
    setQueuedPlayers(newOrder);
  }, []);

  const refreshAvailablePlayers = useCallback((players: PlayerData[]) => {
    setAvailablePlayers(players);
  }, []);

  const removeFromAvailable = useCallback((playerId: string) => {
    setAvailablePlayers(prev => prev.filter(p => p.playerId !== playerId));
  }, []);

  // Re-populate draftSummary from REST summary data on reconnect
  // summaryData is array of { playerInfo: { playerId, position, team, ownerAddress, pickNum } }
  const refreshSummaryPicks = useCallback((summaryData: Array<{ playerInfo: { playerId: string; position: string; team: string; ownerAddress: string; pickNum: number } }>) => {
    const pickedEntries = summaryData
      .map((entry) => entry.playerInfo)
      .filter((pi) => pi.playerId && pi.pickNum > 0)
      .sort((a, b) => a.pickNum - b.pickNum);
    const pickedIds = new Set(pickedEntries.map((pi) => pi.playerId));

    // Stale-response guard: this rebuilds rosters/board/picks WHOLESALE from
    // `summaryData`. If the summary is older than what we've already applied
    // (e.g. a turn-start refresh whose fetch returns AFTER the user's own pick
    // has already echoed in), applying it would drop that newer pick AND bump
    // lastPickRef so the live feed never re-adds it → blank roster until a
    // manual reload. Apply only when the summary is at least as current as the
    // highest pick we've seen; a strictly-older one is never useful. ('===' the
    // applied high-water mark still passes, so the missed-intermediate-pick
    // heal keeps working — only strictly-stale responses are dropped.)
    const summaryMaxPick = pickedEntries.length > 0
      ? pickedEntries[pickedEntries.length - 1].pickNum
      : 0;
    if (summaryMaxPick < lastPickRef.current) {
      logger.debug('[refreshSummaryPicks] Skipping stale summary (max', summaryMaxPick, '< applied', lastPickRef.current, ')');
      return;
    }

    setDraftSummary(prev => {
      const updated = prev.map((slot) => ({
        ...slot,
        playerId: '',
        position: '',
        team: '',
      }));
      for (const pi of pickedEntries) {
        const idx = pi.pickNum - 1;
        if (updated[idx]) {
          updated[idx] = { ...updated[idx], playerId: pi.playerId, position: pi.position, team: pi.team };
        }
      }
      return updated;
    });

    setAvailablePlayers(prev => prev.filter(p => !pickedIds.has(p.playerId)));

    const rebuiltPicks: DraftPick[] = pickedEntries.map((pi) => ({
      pickNumber: pi.pickNum,
      round: Math.ceil(pi.pickNum / 10),
      pickInRound: ((pi.pickNum - 1) % 10) + 1,
      ownerName: pi.ownerAddress,
      ownerIndex: getSnakeDrafterIndex(pi.pickNum),
      playerId: pi.playerId,
      position: pi.position,
      team: pi.team,
    }));
    setPicks(rebuiltPicks);

    const rebuiltRosters: Record<string, PositionRoster> = {};
    for (const pick of rebuiltPicks) {
      const ownerKey = pick.ownerName;
      const roster = rebuiltRosters[ownerKey] || createEmptyRoster();
      const rosterKey = pick.position.replace(/[0-9]/g, '') as keyof PositionRoster;
      if (!roster[rosterKey].includes(pick.playerId)) {
        roster[rosterKey] = [...roster[rosterKey], pick.playerId];
      }
      rebuiltRosters[ownerKey] = roster;
    }
    setRosters(rebuiltRosters);

    const latestPick = rebuiltPicks[rebuiltPicks.length - 1] || null;
    setMostRecentPick(latestPick);
    lastPickRef.current = Math.max(lastPickRef.current, latestPick?.pickNumber ?? 0);
  }, []);

  const isInQueue = useCallback((playerId: string) => {
    return queuedPlayers.some(p => p.playerId === playerId);
  }, [queuedPlayers]);

  // Clear the deferred final-pick completion timer on unmount.
  useEffect(() => {
    return () => {
      if (completionTimerRef.current) clearTimeout(completionTimerRef.current);
    };
  }, []);

  // ==================== LOCAL MODE TIMER ====================
  useEffect(() => {
    if (mode === 'live') return; // Live mode timer handled below
    if (draftStatus !== 'active' || currentPickNumber > TOTAL_PICKS) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    timerRef.current = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) return 0;
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [mode, draftStatus, currentPickNumber]);

  // ==================== LIVE MODE TIMER (display countdown from server timestamp) ====================
  useEffect(() => {
    if (mode !== 'live') return;
    if (draftStatus !== 'active' || endOfTurnTimestamp === 0) return;

    // 250ms interval matches production useDraftRoom.ts for smooth countdown display
    timerRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((endOfTurnTimestamp * 1000 - Date.now()) / 1000));
      setTimeRemaining(prev => prev === remaining ? prev : remaining);
    }, 250);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [mode, draftStatus, endOfTurnTimestamp]);

  // ==================== LOCAL MODE AUTO-PICK ON TIMEOUT ====================
  useEffect(() => {
    if (mode === 'live') return; // Server handles auto-pick in live mode
    if (!isUserTurn || timeRemaining > 0 || draftStatus !== 'active') return;

    // Track consecutive timeouts for airplane mode
    consecutiveTimeoutsRef.current += 1;
    if (consecutiveTimeoutsRef.current >= 2 && !airplaneMode) {
      logger.debug('[Airplane] 2 consecutive timeouts — enabling airplane mode');
      setAirplaneMode(true);
    }

    const roster = rosters[currentDrafter?.name || ''] || createEmptyRoster();
    const pickId = autoPickForPlayer(roster, queuedPlayers, availablePlayers, currentRound, autoPickSortPreference, userLimits, userLimitsEnabled);
    if (pickId) {
      draftPlayer(pickId);
    }
  }, [mode, isUserTurn, timeRemaining, draftStatus, rosters, currentDrafter, queuedPlayers, availablePlayers, currentRound, autoPickForPlayer, autoPickSortPreference, draftPlayer, airplaneMode, userLimits, userLimitsEnabled]);

  // ==================== LOCAL MODE BOT AUTO-PICK ====================
  useEffect(() => {
    if (mode === 'live') return; // No bots in live mode
    if (draftStatus !== 'active' || currentPickNumber > TOTAL_PICKS) return;

    const drafter = draftOrder[getSnakeDrafterIndex(currentPickNumber)];
    if (!drafter || drafter.isYou) return;

    const delay = 1000 + Math.random() * 2000;
    botTimeoutRef.current = setTimeout(() => {
      const roster = rosters[drafter.name] || createEmptyRoster();
      // Bots in local mode use defaults; they don't have wallets / per-user
      // overrides. Mirrors the live-mode behavior we'll mirror in the Go
      // API once Boris ships the server-side change.
      const pickId = autoPickForPlayer(roster, [], availablePlayers, currentRound, 'adp', DEFAULT_POSITION_LIMITS);
      if (pickId) {
        draftPlayer(pickId);
      }
    }, delay);

    return () => {
      if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current);
    };
  }, [mode, draftStatus, currentPickNumber, draftOrder, rosters, availablePlayers, currentRound, autoPickForPlayer, draftPlayer]);

  return {
    // State
    picks,
    currentPickNumber,
    currentRound,
    currentDrafterIndex,
    draftOrder,
    userDraftPosition,
    availablePlayers,
    playerStatsById,
    queuedPlayers,
    rosters,
    timeRemaining,
    // Absolute server pick-end timestamp (Unix seconds), set from the SAME
    // WS/RTDB pickEndTime everyone shares. Exposed so the live-sync timer can
    // anchor to it (floor(end − now)) instead of the per-device local countdown
    // — keeps desktop/mobile identical from the first tick.
    endOfTurnTimestamp,
    isUserTurn,
    turnsUntilUserPick,
    upcomingUserPicks,
    draftStatus,
    mostRecentPick,
    draftSummary,
    mode,

    // LIVE mode state
    preTimeRemaining,
    currentDrafterAddress,
    walletAddress,
    finalCard,
    draftPhase,

    // LOCAL mode actions
    initializeDraft,
    restoreDraft,
    draftPlayer,

    // LIVE mode actions
    initializeFromServer,
    handleCountdownUpdate,
    handleTimerUpdate,
    handleNewPick,
    handleDraftInfoUpdate,
    handleDraftComplete,
    handleFinalCard,

    // Firebase RTDB actions (replaces WS handlers)
    setFirebaseState,
    handleFirebaseNewPick,

    // Shared actions
    addToQueue,
    removeFromQueue,
    reorderQueue,
    refreshAvailablePlayers,
    removeFromAvailable,
    refreshSummaryPicks,
    isInQueue,

    // Airplane mode
    airplaneMode,
    setAirplaneMode,
    toggleAirplaneMode,
    autoPickSortPreference,
    setAutoPickSortPreference,
    markManualPick,
    resetAirplaneTimeoutCounter,
    setConsecutiveTimeouts,
    getAutoPickPlayer,
    consecutiveTimeouts: consecutiveTimeoutsRef.current,
  };
}
