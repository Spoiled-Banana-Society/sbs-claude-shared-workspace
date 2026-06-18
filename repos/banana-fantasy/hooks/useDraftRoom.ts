'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { DraftWebSocketClient, type DraftWsMessage } from '@/lib/api/websocket';
import {
  getDraftInfo,
  getDraftSummary,
  getDraftRosters,
  getDraftPlayerStateRaw,
  type ApiDraftInfo,
  type ApiDraftPick,
} from '@/lib/api/drafts';

// ─── Types ───────────────────────────────────────────────────────────────

export type DraftPhase = 'connecting' | 'countdown' | 'drafting' | 'completed';
export type DraftLevel = 'Pro' | 'Hall of Fame' | 'Jackpot';
export type ViewTab = 'draft' | 'queue' | 'board' | 'roster';

export interface PlayerEntry {
  playerId: string;
  displayName: string;
  team: string;
  position: string;
  ownerAddress: string;
  adp: number;
  rank: number;
}

export interface PickEntry {
  playerId: string;
  displayName: string;
  team: string;
  position: string;
  ownerAddress: string;
  pickNum: number;
  round: number;
}

export interface QueueEntry {
  playerId: string;
  displayName: string;
  team: string;
  position: string;
}

export interface DraftRoomState {
  phase: DraftPhase;
  draftLevel: DraftLevel;
  draftInfo: ApiDraftInfo | null;
  draftSummaryRaw: ApiDraftPick[] | null;
  draftRostersRaw: unknown | null;
  draftRankingsRaw: unknown | null;
  isLoading: boolean;
  error: string | null;

  // Timer
  countdown: number | null; // pre-draft countdown seconds
  endOfTurnTimestamp: number | null;
  startOfTurnTimestamp: number | null;
  timeRemaining: number | null; // computed from timestamps

  // Picks & players
  currentDrafter: string | null;
  currentPickNumber: number | null;
  currentRound: number | null;
  picks: PickEntry[];
  availablePlayers: PlayerEntry[];
  rosters: Record<string, PlayerEntry[]>; // keyed by owner address

  // Queue
  queue: QueueEntry[];

  // User state
  canDraft: boolean;
  idleCount: number;
  turnsUntilPick: number | null;

  // Completion
  generatedCardUrl: string | null;

  // Audio
  audioOn: boolean;

  // Active tab
  activeTab: ViewTab;
}

const initialState: DraftRoomState = {
  phase: 'connecting',
  draftLevel: 'Pro',
  draftInfo: null,
  draftSummaryRaw: null,
  draftRostersRaw: null,
  draftRankingsRaw: null,
  isLoading: true,
  error: null,
  countdown: null,
  endOfTurnTimestamp: null,
  startOfTurnTimestamp: null,
  timeRemaining: null,
  currentDrafter: null,
  currentPickNumber: null,
  currentRound: null,
  picks: [],
  availablePlayers: [],
  rosters: {},
  queue: [],
  canDraft: false,
  idleCount: 0,
  turnsUntilPick: null,
  generatedCardUrl: null,
  audioOn: true,
  activeTab: 'draft',
};

// ─── Hook ────────────────────────────────────────────────────────────────

export function useDraftRoom(draftId: string | null) {
  const { user } = useAuth();
  const walletAddress = user?.walletAddress ?? null;

  const [state, setState] = useState<DraftRoomState>(initialState);
  const wsRef = useRef<DraftWebSocketClient | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPickRef = useRef<number | null>(null);

  // ── Helpers ──

  const updateState = useCallback((partial: Partial<DraftRoomState>) => {
    setState((prev) => ({ ...prev, ...partial }));
  }, []);

  const toNumberOrNull = (value: unknown): number | null => {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? num : null;
  };

  const toNonEmptyStringOrNull = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const toMs = (value: unknown): number | null => {
    const num = toNumberOrNull(value);
    if (num == null) return null;
    // Normalize unix seconds or epoch milliseconds to milliseconds.
    if (num < 10_000_000_000) return num * 1000;
    return num;
  };

  const deriveDraftLevel = (raw: unknown): DraftLevel => {
    if (raw === 'Hall of Fame' || raw === 'Jackpot' || raw === 'Pro') return raw;
    return 'Pro';
  };

  const deriveCanDraft = useCallback(
    (currentDrafter: string | null, timeRemaining: number | null): boolean => {
      if (!walletAddress || !currentDrafter) return false;
      const myTurn = currentDrafter.toLowerCase() === walletAddress.toLowerCase();
      if (!myTurn) return false;
      return timeRemaining == null || timeRemaining > 0;
    },
    [walletAddress]
  );

  // ── Timer tick ──

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);

    if (state.endOfTurnTimestamp != null) {
      timerRef.current = setInterval(() => {
        setState((prev) => {
          if (prev.endOfTurnTimestamp == null) return prev;
          const endMs = toMs(prev.endOfTurnTimestamp);
          if (endMs == null) return prev;
          const now = Date.now();
          const remaining = Math.max(0, Math.floor((endMs - now) / 1000));
          const nextCanDraft = deriveCanDraft(prev.currentDrafter, remaining);

          const shouldFreeze = remaining === 0 && prev.canDraft;
          if (prev.timeRemaining === remaining && !shouldFreeze && prev.canDraft === nextCanDraft) return prev;

          const updates: Partial<DraftRoomState> = { timeRemaining: remaining };
          if (shouldFreeze) {
            updates.canDraft = false;
            updates.idleCount = prev.idleCount + 1;
          } else if (prev.canDraft !== nextCanDraft) {
            updates.canDraft = nextCanDraft;
          }
          return { ...prev, ...updates };
        });
      }, 250);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [state.endOfTurnTimestamp, deriveCanDraft]);

  // ── WebSocket connection ──

  useEffect(() => {
    if (!draftId) {
      updateState({ isLoading: false, error: null });
      return;
    }

    let isActive = true;
    setState((prev) => ({
      ...initialState,
      audioOn: prev.audioOn,
      phase: 'connecting',
      isLoading: true,
      error: null,
    }));

    const ws = walletAddress
      ? new DraftWebSocketClient({
          walletAddress,
          draftId,
          debug: true,
        })
      : null;
    wsRef.current = ws;

    // Fetch initial state via REST
    const fetchInitialState = async () => {
      try {
        const [info, summary, rostersRaw, playerStateRaw] = await Promise.allSettled([
          getDraftInfo(draftId),
          getDraftSummary(draftId),
          getDraftRosters(draftId),
          walletAddress ? getDraftPlayerStateRaw(draftId, walletAddress) : Promise.reject('no-wallet'),
        ]);

        const draftInfo = info.status === 'fulfilled' ? info.value : null;
        const picks: PickEntry[] =
          summary.status === 'fulfilled'
            ? summary.value.map((p: ApiDraftPick) => ({
                playerId: p.playerId,
                displayName: p.displayName,
                team: p.team,
                position: p.position,
                ownerAddress: p.ownerAddress ?? '',
                pickNum: p.pickNum ?? 0,
                round: p.round ?? 0,
              }))
            : [];
        const draftSummaryRaw = summary.status === 'fulfilled' ? summary.value : null;
        const draftRostersRaw = rostersRaw.status === 'fulfilled' ? rostersRaw.value : null;
        const draftRankingsRaw = playerStateRaw.status === 'fulfilled' ? playerStateRaw.value : null;

        // Parse player rankings into available players
        let allPlayers: PlayerEntry[] = [];
        if (draftRankingsRaw) {
          const raw = draftRankingsRaw as unknown[];
          if (Array.isArray(raw)) {
            allPlayers = raw.map((item: unknown, idx: number) => {
              const obj = item as Record<string, unknown>;
              const stats = (obj.stats ?? obj.playerStateInfo ?? obj) as Record<string, unknown>;
              const stateInfo = (obj.playerStateInfo ?? obj) as Record<string, unknown>;
              return {
                playerId: String(stats.playerId ?? stateInfo.playerId ?? ''),
                displayName: String(stats.displayName ?? stateInfo.displayName ?? ''),
                team: String(stats.team ?? stateInfo.team ?? ''),
                position: String(stats.position ?? stateInfo.position ?? ''),
                ownerAddress: String(stateInfo.ownerAddress ?? ''),
                adp: Number(stats.adp ?? 0),
                rank: Number((obj.ranking as Record<string, unknown>)?.rank ?? idx + 1),
              };
            });
          }
        }

        const available = allPlayers.filter((p) => !p.ownerAddress);

        const currentPickNumber = draftInfo?.pickNumber ?? null;
        const lastPickNum = picks.reduce((max, pick) => Math.max(max, pick.pickNum), 0);
        if (lastPickNum > 0) {
          lastPickRef.current = lastPickNum;
        } else if (currentPickNumber != null) {
          lastPickRef.current = currentPickNumber;
        }

        if (!isActive) return;

        const draftStartMs = toMs(draftInfo?.draftStartTime);
        const phase = draftStartMs != null && Date.now() < draftStartMs ? 'countdown' : 'drafting';
        const computedRemaining =
          draftInfo?.currentPickEndTime != null
            ? Math.max(0, Math.floor(((toMs(draftInfo.currentPickEndTime) ?? Date.now()) - Date.now()) / 1000))
            : null;
        const currentDrafter = draftInfo?.currentDrafter ?? null;
        updateState({
          draftInfo,
          draftSummaryRaw,
          draftRostersRaw,
          draftRankingsRaw,
          picks,
          availablePlayers: available,
          currentPickNumber,
          currentRound: draftInfo?.roundNum ?? null,
          currentDrafter,
          endOfTurnTimestamp: toNumberOrNull(draftInfo?.currentPickEndTime),
          startOfTurnTimestamp: null,
          timeRemaining: computedRemaining,
          canDraft: deriveCanDraft(currentDrafter, computedRemaining),
          draftLevel: deriveDraftLevel(
            draftInfo?.draftLevel ?? draftInfo?.level ?? draftInfo?._level ?? draftInfo?.draftType
          ),
          phase,
          isLoading: false,
        });

        if (
          info.status === 'rejected' &&
          summary.status === 'rejected' &&
          rostersRaw.status === 'rejected' &&
          playerStateRaw.status === 'rejected'
        ) {
          updateState({ error: 'Failed to load draft data.', isLoading: false });
        }
      } catch (err) {
        if (!isActive) return;
        console.error('[useDraftRoom] Failed to fetch initial state:', err);
        updateState({ error: 'Failed to load draft data.', isLoading: false });
      }
    };

    // Handle WS messages
    const unsubscribe = ws?.onAny((msg: DraftWsMessage) => {
      if (!isActive) return;
      const raw = msg as DraftWsMessage;
      const eventType =
        typeof raw.eventType === 'string'
          ? raw.eventType
          : typeof (raw as { type?: unknown }).type === 'string'
            ? String((raw as { type?: unknown }).type)
            : 'unknown';
      const payload =
        raw.payload && typeof raw.payload === 'object'
          ? (raw.payload as Record<string, unknown>)
          : {};

      try {
        switch (eventType) {
          case 'countdown_update':
            setState((prev) => {
              const currentDrafter = toNonEmptyStringOrNull(payload.currentDrafter);
              const countdown = toNumberOrNull(payload.timeRemaining) ?? 0;
              return {
                ...prev,
                phase: 'countdown',
                countdown,
                currentDrafter,
                endOfTurnTimestamp: null,
                startOfTurnTimestamp: null,
                timeRemaining: null,
                canDraft: deriveCanDraft(currentDrafter, null),
              };
            });
            break;

          case 'timer_update': {
            const endTimestamp = toNumberOrNull(payload.endOfTurnTimestamp);
            const startTimestamp = toNumberOrNull(payload.startOfTurnTimestamp);
            const computedRemaining =
              endTimestamp != null
                ? Math.max(0, Math.floor(((toMs(endTimestamp) ?? Date.now()) - Date.now()) / 1000))
                : null;
            const currentDrafter = toNonEmptyStringOrNull(payload.currentDrafter);
            updateState({
              phase: 'drafting',
              endOfTurnTimestamp: endTimestamp,
              startOfTurnTimestamp: startTimestamp,
              currentDrafter,
              timeRemaining: computedRemaining,
              canDraft: deriveCanDraft(currentDrafter, computedRemaining),
              countdown: null,
            });
            break;
          }

          case 'new_pick': {
            const pickNum = toNumberOrNull(payload.pickNum);
            const round = toNumberOrNull(payload.round);
            const playerId = toNonEmptyStringOrNull(payload.playerId);
            if (pickNum == null || playerId == null) {
              console.warn('[useDraftRoom] Ignoring malformed new_pick payload:', payload);
              break;
            }

            const pick: PickEntry = {
              playerId,
              displayName: toNonEmptyStringOrNull(payload.displayName) ?? playerId,
              team: toNonEmptyStringOrNull(payload.team) ?? '',
              position: toNonEmptyStringOrNull(payload.position) ?? '',
              ownerAddress: toNonEmptyStringOrNull(payload.ownerAddress) ?? '',
              pickNum,
              round: round ?? 0,
            };

            setState((prev) => {
              if (lastPickRef.current != null && pick.pickNum <= lastPickRef.current) return prev;
              lastPickRef.current = pick.pickNum;
              const currentDrafter = toNonEmptyStringOrNull(payload.currentDrafter) ?? prev.currentDrafter;
              return {
                ...prev,
                picks: [...prev.picks, pick],
                currentDrafter,
                currentPickNumber: pick.pickNum + 1,
                currentRound: round ?? prev.currentRound,
                canDraft: deriveCanDraft(currentDrafter, prev.timeRemaining),
                availablePlayers: prev.availablePlayers.filter((p) => p.playerId !== pick.playerId),
                queue: prev.queue.filter((q) => q.playerId !== pick.playerId),
              };
            });
            break;
          }

          case 'draft_info_update': {
            setState((prev) => {
              const currentPickNumber = toNumberOrNull(payload.pickNumber) ?? prev.currentPickNumber;
              if (currentPickNumber != null && currentPickNumber > 0) lastPickRef.current = currentPickNumber;
              const currentDrafter = toNonEmptyStringOrNull(payload.currentDrafter) ?? prev.currentDrafter;
              return {
                ...prev,
                currentPickNumber,
                currentRound: toNumberOrNull(payload.roundNum) ?? prev.currentRound,
                currentDrafter,
                canDraft: deriveCanDraft(currentDrafter, prev.timeRemaining),
              };
            });
            break;
          }

          case 'draft_complete':
            updateState({ phase: 'completed', isLoading: false });
            ws.disconnect();
            break;

          case 'final_card':
            updateState({
              phase: 'completed',
              generatedCardUrl: toNonEmptyStringOrNull(payload._imageUrl) ?? '',
              isLoading: false,
            });
            ws.disconnect();
            break;

          case 'invalid_pick':
            console.warn('[useDraftRoom] Invalid pick:', payload);
            break;

          default:
            break;
        }
      } catch (err) {
        console.error('[useDraftRoom] Failed to process WS message:', eventType, payload, err);
      }
    });

    // Connect
    if (ws) {
      ws.connect()
        .then(() => {
          if (isActive) fetchInitialState();
        })
        .catch((err) => {
          console.error('[useDraftRoom] WebSocket connect failed:', err);
          // Still try REST
          if (isActive) fetchInitialState();
        });
    } else {
      // No wallet — fetch REST data only (read-only mode)
      fetchInitialState();
    }

    return () => {
      isActive = false;
      unsubscribe?.();
      ws?.disconnect();
      wsRef.current = null;
    };
  }, [draftId, walletAddress, updateState]);

  // ── Actions ──

  const makePick = useCallback(
    (player: { playerId: string; displayName: string; team: string; position: string }) => {
      if (!wsRef.current?.isConnected || !state.canDraft) return;

      const payload = {
        playerId: player.playerId,
        displayName: player.displayName,
        team: player.team,
        position: player.position,
        ownerAddress: walletAddress ?? '',
        pickNum: state.currentPickNumber ?? 0,
        round: state.currentRound ?? 0,
      };

      wsRef.current.send({ eventType: 'pick_received', payload });
    },
    [state.canDraft, state.currentPickNumber, state.currentRound, walletAddress]
  );

  const addToQueue = useCallback((player: QueueEntry) => {
    setState((prev) => {
      if (prev.queue.some((q) => q.playerId === player.playerId)) return prev;
      return { ...prev, queue: [...prev.queue, player] };
    });
  }, []);

  const removeFromQueue = useCallback((playerId: string) => {
    setState((prev) => ({
      ...prev,
      queue: prev.queue.filter((q) => q.playerId !== playerId),
    }));
  }, []);

  const reorderQueue = useCallback((fromIndex: number, toIndex: number) => {
    setState((prev) => {
      const q = [...prev.queue];
      const [item] = q.splice(fromIndex, 1);
      q.splice(toIndex, 0, item);
      return { ...prev, queue: q };
    });
  }, []);

  const setActiveTab = useCallback((tab: ViewTab) => {
    updateState({ activeTab: tab });
  }, [updateState]);

  const toggleAudio = useCallback(() => {
    setState((prev) => ({ ...prev, audioOn: !prev.audioOn }));
  }, []);

  return {
    ...state,
    makePick,
    addToQueue,
    removeFromQueue,
    reorderQueue,
    setActiveTab,
    toggleAudio,
    isConnected: wsRef.current?.isConnected ?? false,
  };
}
