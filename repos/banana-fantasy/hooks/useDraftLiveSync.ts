'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useRealTimeDraftInfo } from '@/hooks/useRealTimeDraftInfo';
import { useDraftWebSocket } from '@/hooks/useDraftWebSocket';
import { useTimeRemaining } from '@/hooks/useTimeRemaining';
import { useDraftEngine } from '@/hooks/useDraftEngine';
import * as draftApi from '@/lib/draftApi';
import * as draftStore from '@/lib/draftStore';
import { isStagingMode, getStagingApiUrl } from '@/lib/staging';
import { logger } from '@/lib/logger';
import type { RoomPhase } from '@/lib/draftRoomConstants';
import type {
  DraftInfoPayload,
  NewPickPayload,
  TimerPayload,
} from '@/hooks/useDraftWebSocket';

type PendingWsMessage =
  | { type: 'timer_update'; payload: TimerPayload }
  | { type: 'new_pick'; payload: NewPickPayload }
  | { type: 'draft_info_update'; payload: DraftInfoPayload };

function countSummaryPicks(summary: draftApi.DraftSummary): number {
  return summary.filter((item) => Boolean(item.playerInfo?.playerId)).length;
}

interface UseDraftLiveSyncParams {
  engine: ReturnType<typeof useDraftEngine>;
  isLiveMode: boolean;
  draftId: string;
  setDraftId: Dispatch<SetStateAction<string>>;
  walletParam: string;
  speedParam: 'fast' | 'slow' | null;
  passTypeParam: 'paid' | 'free' | null;
  promoTypeParam: 'jackpot' | 'hof' | 'pro' | null;
  phase: RoomPhase;
  liveDataReady: boolean;
  setLiveDataReady: Dispatch<SetStateAction<boolean>>;
  setFallbackLocal: Dispatch<SetStateAction<boolean>>;
  setPhase: Dispatch<SetStateAction<RoomPhase>>;
  setMainCountdown: Dispatch<SetStateAction<number>>;
  setShowSlotMachine: Dispatch<SetStateAction<boolean>>;
  draftIdRef: MutableRefObject<string>;
}

export function useDraftLiveSync({
  engine,
  isLiveMode,
  draftId,
  setDraftId,
  walletParam,
  speedParam,
  passTypeParam,
  promoTypeParam,
  phase,
  liveDataReady,
  setLiveDataReady,
  setFallbackLocal,
  setPhase,
  setMainCountdown,
  setShowSlotMachine,
  draftIdRef,
}: UseDraftLiveSyncParams) {
  const { getAccessToken } = usePrivy();
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [engineReady, setEngineReady] = useState(false);

  const liveInitializedRef = useRef(false);
  const joinCalledRef = useRef(false);
  const liveRetryCountRef = useRef(0);
  const loadLiveDataRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadLiveDataReadyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingWsMessagesRef = useRef<PendingWsMessage[]>([]);
  const lastWsUpdateRef = useRef<number>(Date.now());
  const lastFirebaseUpdateRef = useRef<number>(Date.now());
  // Slow-draft "your pick is up" push fires exclusively server-side via the
  // Firebase Cloud Function listening on drafts/{id}/realTimeDraftInfo; a
  // previous client-side trigger here was removed because proving "some
  // logged-in user" doesn't prove "this push target is legitimate." The
  // server path with a shared secret is the sole caller of /api/notifications/pick-up.

  const firebaseActive = isLiveMode && engineReady && !!draftId;
  const firebaseRtdb = useRealTimeDraftInfo(draftId || null, firebaseActive);

  useEffect(() => {
    if (!firebaseActive || !firebaseRtdb.data) return;
    engine.setFirebaseState(firebaseRtdb.data);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseActive, firebaseRtdb.data]);

  useEffect(() => {
    if (!firebaseActive || !firebaseRtdb.newPickDetected || !firebaseRtdb.detectedPick) return;

    logger.debug('[Firebase] New pick detected:', firebaseRtdb.detectedPick.playerId, 'pick#', firebaseRtdb.detectedPick.pickNum);
    engine.handleFirebaseNewPick(firebaseRtdb.detectedPick);
    firebaseRtdb.clearNewPick();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseActive, firebaseRtdb.newPickDetected, firebaseRtdb.detectedPick]);

  const firebaseEndOfTurn = firebaseRtdb.data?.pickEndTime ?? null;
  const firebaseDraftStart = firebaseRtdb.data?.draftStartTime ?? null;
  const firebaseTimeRemaining = useTimeRemaining(
    firebaseActive ? firebaseEndOfTurn : null,
    firebaseActive ? firebaseDraftStart : null,
  );

  useEffect(() => {
    if (firebaseRtdb.data) lastFirebaseUpdateRef.current = Date.now();
  }, [firebaseRtdb.data]);

  useEffect(() => {
    if (!isLiveMode || draftId || !walletParam || joinCalledRef.current) return;
    joinCalledRef.current = true;

    const pendingId = `pending-${Date.now()}`;
    const joinStartedAt = Date.now();
    draftStore.addDraft({
      id: pendingId,
      contestName: 'Joining...',
      status: 'filling',
      type: null,
      draftSpeed: speedParam || 'fast',
      players: 1,
      maxPlayers: 10,
      joinedAt: joinStartedAt,
      phase: 'filling',
      liveWalletAddress: walletParam,
      passType: passTypeParam || 'paid',
    });

    async function joinAndFill() {
      const MAX_JOIN_RETRIES = 3;
      let lastErr: unknown = null;

      // Auto-mint a token before joining so the wallet always has one available
      try {
        const { getStagingApiUrl } = await import('@/lib/staging');
        const apiBase = getStagingApiUrl();
        if (apiBase) {
          const mintId = Date.now();
          await fetch(`${apiBase}/owner/${walletParam}/draftToken/mint`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ minId: mintId, maxId: mintId }),
          });
        }
      } catch {
        // Mint may fail if token already exists — that's fine
      }

      for (let attempt = 1; attempt <= MAX_JOIN_RETRIES; attempt++) {
        try {
          const { joinDraft } = await import('@/lib/api/leagues');
          const draftRoom = await joinDraft(walletParam, speedParam || 'fast', 1, promoTypeParam ?? undefined, passTypeParam || 'paid');
          if (!draftRoom?.id) throw new Error('Join failed: no draft ID');

          const newId = draftRoom.id;
          logger.debug('[Draft Room] Joined draft:', newId, 'players:', draftRoom.players);
          setDraftId(newId);

          try {
            const hidden = JSON.parse(localStorage.getItem('banana-hidden-drafts') || '[]');
            if (hidden.includes(newId)) {
              localStorage.setItem('banana-hidden-drafts', JSON.stringify(hidden.filter((id: string) => id !== newId)));
            }
          } catch {}

          draftStore.removeDraft(pendingId);
          draftStore.addDraft({
            id: newId,
            contestName: draftRoom.contestName || `BBB League #${String(newId).split('-').pop() || newId}`,
            status: 'filling',
            type: null,
            draftSpeed: speedParam || 'fast',
            players: draftRoom.players || 1,
            maxPlayers: 10,
            joinedAt: joinStartedAt,
            phase: 'filling',
            liveWalletAddress: walletParam,
            passType: passTypeParam || 'paid',
            cardId: draftRoom.cardId,
          });

          return;
        } catch (err) {
          lastErr = err;
          console.warn(`[Draft Room] Join attempt ${attempt}/${MAX_JOIN_RETRIES} failed:`, err instanceof Error ? err.message : err);
          if (attempt < MAX_JOIN_RETRIES) {
            await new Promise(r => setTimeout(r, 2000 * attempt));
          }
        }
      }

      console.error('[Draft Room] Failed to join draft after retries:', lastErr);
      draftStore.removeDraft(pendingId);
      setLiveError(lastErr instanceof Error ? lastErr.message : 'Failed to join draft');
    }

    joinAndFill();
  }, [isLiveMode, draftId, walletParam, speedParam, passTypeParam, promoTypeParam, setDraftId]);

  const handleLiveDraft = useCallback((playerId: string) => {
    engine.markManualPick();
    if (!isLiveMode) {
      engine.draftPlayer(playerId);
      return;
    }

    const pickPayload = engine.draftPlayer(playerId);
    if (pickPayload && draftId) {
      // Submit pick via REST to draft-actions service
      draftApi.submitPickREST(draftId, walletParam, {
        playerId: pickPayload.playerId,
        displayName: pickPayload.displayName,
        team: pickPayload.team,
        position: pickPayload.position,
      }).then(() => {
        logger.debug('[REST] Pick submitted:', pickPayload.playerId);
      }).catch((err) => {
        if (engine.airplaneMode && engine.isUserTurn) {
          const msg = err?.message || '';
          const match = msg.match(/already picked (\S+)/);
          if (match) {
            const staleId = match[1];
            logger.debug('[Airplane] Removing stale player and retrying:', staleId);
            engine.removeFromAvailable(staleId);
            // Defer to next tick so removeFromAvailable settles before
            // getAutoPickPlayer runs. Was 300ms — no longer visible.
            setTimeout(() => {
              const nextPick = engine.getAutoPickPlayer();
              if (nextPick && draftId) {
                logger.debug('[Airplane] Retrying auto-pick with:', nextPick);
                const retryPayload = engine.draftPlayer(nextPick);
                if (retryPayload) {
                  draftApi.submitPickREST(draftId, walletParam, {
                    playerId: retryPayload.playerId,
                    displayName: retryPayload.displayName,
                    team: retryPayload.team,
                    position: retryPayload.position,
                  }).catch(e => console.error('[Airplane] Retry failed:', e));
                }
              }
            }, 0);
          }
        }
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLiveMode, draftId, walletParam, engine.draftPlayer, engine.markManualPick]);

  const handleLiveQueueSync = useCallback((queue: typeof engine.queuedPlayers) => {
    if (!isLiveMode || !draftId || !walletParam) return;
    const payload = queue.map(p => ({
      playerId: p.playerId,
      displayName: p.playerId,
      team: p.team,
      position: p.position,
      ownerAddress: walletParam,
      pickNum: 0,
      round: 0,
    }));
    draftApi.updateQueue(walletParam, draftId, payload).catch(err => {
      console.error('[Queue] REST sync failed:', err);
    });
  }, [isLiveMode, draftId, walletParam]);

  // Always enable WS — Firebase RTDB client reads are blocked by security rules on staging.
  // WS provides real-time draft state (timer, current drafter, picks).
  // Firebase can still supplement if it works, but WS is the primary source.
  const wsEnabled = isLiveMode;

  const ws = useDraftWebSocket({
    walletAddress: walletParam,
    draftName: draftId,
    enabled: wsEnabled,
    getToken: getAccessToken,
    onCountdownUpdate: (payload) => {
      engine.handleCountdownUpdate(payload);
    },
    onTimerUpdate: (payload) => {
      if (!liveInitializedRef.current) {
        pendingWsMessagesRef.current.push({ type: 'timer_update', payload });
        return;
      }
      engine.handleTimerUpdate(payload);
      lastWsUpdateRef.current = Date.now();
    },
    onNewPick: (payload) => {
      logger.debug('[WS] new_pick received:', payload?.playerId, 'pick#', payload?.pickNum, 'initialized:', liveInitializedRef.current);
      if (!liveInitializedRef.current) {
        pendingWsMessagesRef.current.push({ type: 'new_pick', payload });
        logger.debug('[WS] Queued new_pick (engine not ready). Queue size:', pendingWsMessagesRef.current.length);
        return;
      }
      engine.handleNewPick(payload);
      lastWsUpdateRef.current = Date.now();
    },
    onDraftInfoUpdate: (payload) => {
      if (!liveInitializedRef.current) {
        pendingWsMessagesRef.current.push({ type: 'draft_info_update', payload });
        return;
      }
      engine.handleDraftInfoUpdate(payload as unknown as Parameters<typeof engine.handleDraftInfoUpdate>[0]);
      lastWsUpdateRef.current = Date.now();
    },
    onDraftComplete: () => {
      engine.handleDraftComplete();
    },
    onFinalCard: (payload) => {
      engine.handleFinalCard(payload);
    },
    onInvalidPick: (payload) => {
      console.warn('[WS] Invalid pick rejected by server:', payload);
      if (engine.airplaneMode && engine.isUserTurn) {
        const msg = (payload as { errorMessage?: string })?.errorMessage || '';
        const match = msg.match(/already picked (\S+)/);
        if (match) {
          const staleId = match[1];
          logger.debug('[Airplane] Removing stale player and retrying:', staleId);
          engine.removeFromAvailable(staleId);
          setTimeout(() => {
            const nextPick = engine.getAutoPickPlayer();
            if (nextPick) {
              logger.debug('[Airplane] Retrying auto-pick with:', nextPick);
              const retryPayload = engine.draftPlayer(nextPick);
              if (retryPayload) ws.sendPick(retryPayload);
            }
          }, 300);
        }
      }
    },
    onNewQueue: (payload) => {
      const available = engine.availablePlayers;
      const queuePlayers = payload
        .map(q => available.find(a => a.playerId === q.playerId))
        .filter((p): p is NonNullable<typeof p> => p !== undefined);
      engine.reorderQueue(queuePlayers);
    },
    onOpen: () => {
      logger.debug('[WS] Connected to draft server');
      lastWsUpdateRef.current = Date.now();
      if (liveInitializedRef.current && draftId) {
        draftApi.getDraftSummary(draftId).then(summary => {
          const summaryArr = summary;
          if (summaryArr.length > 0) {
            engine.refreshSummaryPicks(summaryArr);
            logger.debug(`[WS Reconnect] Synced ${countSummaryPicks(summaryArr)} picks from summary`);
          }
        }).catch(() => {});
      }
    },
    onClose: () => {
      logger.debug('[WS] Disconnected from draft server');
    },
  });

  useEffect(() => {
    if (!isLiveMode || !draftId) return;
    // Cross-tab coordination: drafting page skips its own WS/poll for this
    // draft if our heartbeat is fresh (< 10s old). Contract is a numeric
    // timestamp. Ownership is handled by always overwriting — last writer
    // wins, and readers only care about recency, not identity.
    const key = `draft-room-ws:${draftId}`;
    const writeHeartbeat = () => localStorage.setItem(key, String(Date.now()));
    writeHeartbeat();
    const interval = setInterval(writeHeartbeat, 3_000);
    return () => {
      clearInterval(interval);
      localStorage.removeItem(key);
    };
  }, [isLiveMode, draftId]);

  useEffect(() => {
    if (!isLiveMode || liveInitializedRef.current || !liveDataReady || !draftId) return;

    async function retryAsync<T,>(fn: () => Promise<T>, maxRetries = 3, delayMs = 2000): Promise<T> {
      let lastError: Error | null = null;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          return await fn();
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          console.warn(`[loadLiveData] Attempt ${attempt + 1}/${maxRetries} failed:`, lastError.message);
          if (attempt < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }
        }
      }
      throw lastError!;
    }

    async function loadLiveData() {
      try {
        setLiveLoading(true);
        setLiveError(null);
        logger.debug('[Draft Room] Loading draft data for', draftId);

        const [rankingsResult, infoResult, rostersResult, queueResult, summaryResult] =
          await Promise.allSettled([
            retryAsync(() => draftApi.getPlayerRankings(draftId, walletParam)),
            retryAsync(() => draftApi.getDraftInfo(draftId)),
            draftApi.getDraftRosters(draftId),
            draftApi.getQueue(walletParam, draftId),
            draftApi.getDraftSummary(draftId),
          ]);

        const playerRankings = rankingsResult.status === 'fulfilled' ? rankingsResult.value : [];
        const draftInfo = infoResult.status === 'fulfilled' ? infoResult.value : null;
        const serverRosters = rostersResult.status === 'fulfilled'
          ? rostersResult.value
          : ({} as draftApi.RosterState);
        const queue = queueResult.status === 'fulfilled' ? queueResult.value : ([] as draftApi.PlayerStateInfo[]);
        const summary = summaryResult.status === 'fulfilled' ? summaryResult.value : ([] as draftApi.DraftSummaryItem[]);

        if (!draftInfo || (playerRankings as draftApi.PlayerDataResponse[]).length === 0) {
          throw new Error('Required draft data not available yet');
        }

        const serverDraftInfo = {
          draftId: draftInfo.draftId,
          displayName: draftInfo.displayName,
          draftStartTime: draftInfo.draftStartTime,
          pickLength: draftInfo.pickLength,
          currentDrafter: draftInfo.currentDrafter,
          pickNumber: draftInfo.pickNumber,
          roundNum: draftInfo.roundNum,
          pickInRound: draftInfo.pickInRound,
          draftOrder: draftInfo.draftOrder,
          adp: (draftInfo.adp || []).map(a => ({
            adp: a.adp,
            byeWeek: String(a.bye ?? a.byeWeek ?? ''),
            playerId: a.playerId,
          })),
        };

        const queuePayload = (queue as draftApi.PlayerStateInfo[]).map(q => ({
          playerId: q.playerId,
          displayName: q.displayName,
          team: q.team,
          position: q.position,
          ownerAddress: q.ownerAddress,
          pickNum: q.pickNum,
          round: q.round,
        }));

        const rostersForEngine: draftApi.RosterState = {};
        for (const [addr, roster] of Object.entries(serverRosters)) {
          rostersForEngine[addr] = roster;
        }

        const localQueue = engine.queuedPlayers;

        engine.initializeFromServer(
          serverDraftInfo,
          playerRankings,
          summary,
          rostersForEngine,
          queuePayload,
          walletParam,
        );

        if (queuePayload.length === 0 && localQueue.length > 0) {
          engine.reorderQueue(localQueue);
        }

        liveInitializedRef.current = true;
        setEngineReady(true);
        if (loadLiveDataRetryTimeoutRef.current) {
          clearTimeout(loadLiveDataRetryTimeoutRef.current);
          loadLiveDataRetryTimeoutRef.current = null;
        }
        if (loadLiveDataReadyTimeoutRef.current) {
          clearTimeout(loadLiveDataReadyTimeoutRef.current);
          loadLiveDataReadyTimeoutRef.current = null;
        }

        logger.debug('[Draft Room] Engine ready — draft data loaded successfully');

        if (pendingWsMessagesRef.current.length > 0) {
          logger.debug(`[Draft Room] Replaying ${pendingWsMessagesRef.current.length} queued WS messages`);
          for (const msg of pendingWsMessagesRef.current) {
            switch (msg.type) {
              case 'new_pick':
                engine.handleNewPick(msg.payload);
                break;
              case 'timer_update':
                engine.handleTimerUpdate(msg.payload);
                break;
              case 'draft_info_update':
                engine.handleDraftInfoUpdate(msg.payload as unknown as Parameters<typeof engine.handleDraftInfoUpdate>[0]);
                break;
            }
          }
          pendingWsMessagesRef.current = [];
        }
        lastWsUpdateRef.current = Date.now();
        setLiveLoading(false);

        const draftAlreadyStarted = draftInfo.pickNumber > 1 ||
          (draftInfo.draftStartTime && draftInfo.draftStartTime * 1000 < Date.now());
        if (draftAlreadyStarted) {
          logger.debug(`[Draft Room] Draft already at pick ${draftInfo.pickNumber} — skipping countdown, jumping to drafting`);
          setPhase('drafting');
          setMainCountdown(0);
          setShowSlotMachine(false);
          if (draftId) {
            draftStore.updateDraft(draftId, { phase: 'drafting', status: 'drafting', players: 10, isYourTurn: false });
          }
        }
      } catch (err) {
        const MAX_OUTER_RETRIES = 8;
        liveRetryCountRef.current += 1;
        console.error(`[Live Mode] loadLiveData attempt ${liveRetryCountRef.current}/${MAX_OUTER_RETRIES} failed:`, err);
        setLiveLoading(false);

        if (liveRetryCountRef.current >= MAX_OUTER_RETRIES) {
          logger.debug('[Draft Room] All retries exhausted — falling back to local mode');
          setFallbackLocal(true);
          liveInitializedRef.current = true;
        } else {
          logger.debug('[Live Mode] Auto-retrying in 5s...');
          if (loadLiveDataRetryTimeoutRef.current) clearTimeout(loadLiveDataRetryTimeoutRef.current);
          if (loadLiveDataReadyTimeoutRef.current) clearTimeout(loadLiveDataReadyTimeoutRef.current);
          loadLiveDataRetryTimeoutRef.current = setTimeout(() => {
            liveInitializedRef.current = false;
            setLiveDataReady(false);
            loadLiveDataReadyTimeoutRef.current = setTimeout(() => {
              setLiveDataReady(true);
              loadLiveDataReadyTimeoutRef.current = null;
            }, 100);
            loadLiveDataRetryTimeoutRef.current = null;
          }, 5000);
        }
      }
    }

    loadLiveData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLiveMode, draftId, walletParam, liveDataReady]);

  useEffect(() => {
    return () => {
      if (loadLiveDataRetryTimeoutRef.current) {
        clearTimeout(loadLiveDataRetryTimeoutRef.current);
        loadLiveDataRetryTimeoutRef.current = null;
      }
      if (loadLiveDataReadyTimeoutRef.current) {
        clearTimeout(loadLiveDataReadyTimeoutRef.current);
        loadLiveDataReadyTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isLiveMode || !draftId || engine.draftStatus === 'completed') return;

    const STALE_THRESHOLD = 30_000;
    const CHECK_INTERVAL = 10_000;

    const interval = setInterval(() => {
      const elapsed = Date.now() - lastFirebaseUpdateRef.current;

      if (elapsed > STALE_THRESHOLD) {
        console.warn(`[Watchdog] No Firebase RTDB update in ${Math.round(elapsed / 1000)}s — re-syncing from REST`);

        if (liveInitializedRef.current) {
          draftApi.getDraftSummary(draftId).then(summary => {
            const summaryArr = summary;
            if (summaryArr.length > 0) {
              engine.refreshSummaryPicks(summaryArr);
              logger.debug(`[Watchdog] Re-synced ${countSummaryPicks(summaryArr)} picks from REST`);
            }
          }).catch(() => {});

          draftApi.getDraftInfo(draftId).then(info => {
            engine.handleDraftInfoUpdate({
              draftId: info.draftId,
              displayName: info.displayName,
              draftStartTime: info.draftStartTime,
              pickLength: info.pickLength,
              currentDrafter: info.currentDrafter,
              pickNumber: info.pickNumber,
              roundNum: info.roundNum,
              pickInRound: info.pickInRound,
              draftOrder: info.draftOrder,
              adp: info.adp.map(a => ({
                adp: a.adp,
                byeWeek: String(a.bye ?? a.byeWeek ?? ''),
                playerId: a.playerId,
              })),
            });
            logger.debug(`[Watchdog] Re-synced draft info: pick ${info.pickNumber}, drafter ${info.currentDrafter.slice(0, 8)}...`);
          }).catch(() => {});
        }

        lastFirebaseUpdateRef.current = Date.now();
      }
    }, CHECK_INTERVAL);

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLiveMode, draftId, engine.draftStatus]);

  const retryLiveSync = useCallback(() => {
    if (loadLiveDataRetryTimeoutRef.current) {
      clearTimeout(loadLiveDataRetryTimeoutRef.current);
      loadLiveDataRetryTimeoutRef.current = null;
    }
    if (loadLiveDataReadyTimeoutRef.current) {
      clearTimeout(loadLiveDataReadyTimeoutRef.current);
      loadLiveDataReadyTimeoutRef.current = null;
    }
    liveRetryCountRef.current = 0;
    liveInitializedRef.current = false;
    setLiveError(null);
    setLiveDataReady(false);
    loadLiveDataReadyTimeoutRef.current = setTimeout(() => {
      setLiveDataReady(true);
      loadLiveDataReadyTimeoutRef.current = null;
    }, 100);
  }, [setLiveDataReady]);

  const bestTimeRemaining = useMemo(() => {
    const value = (firebaseActive && firebaseTimeRemaining !== null)
      ? firebaseTimeRemaining
      : engine.timeRemaining;
    return value ?? 0;
  }, [firebaseActive, firebaseTimeRemaining, engine.timeRemaining]);

  return {
    liveLoading,
    liveError,
    setLiveError,
    retryLiveSync,
    engineReady,
    setEngineReady,
    firebaseActive,
    firebaseRtdb,
    ws,
    bestTimeRemaining,
    handleLiveDraft,
    handleLiveQueueSync,
    liveInitializedRef,
    lastWsUpdateRef,
    draftIdRef,
  };
}
