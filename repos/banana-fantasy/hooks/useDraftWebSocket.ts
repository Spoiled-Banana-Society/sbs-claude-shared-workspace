'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { getDraftServerUrl } from '@/lib/staging';
import { logger } from '@/lib/logger';

// ==================== PAYLOAD TYPES ====================

export interface PlayerInfo {
  playerId: string;
  displayName: string;
  team: string;
  position: string;
  ownerAddress: string;
  pickNum: number;
  round: number;
}

/** PlayerStateInfo is the same shape as PlayerInfo — used for queue items */
export type PlayerStateInfo = PlayerInfo;

export interface CountdownPayload {
  timeRemaining: number;
  currentDrafter: string;
}

export interface TimerPayload {
  endOfTurnTimestamp: number;
  startOfTurnTimestamp: number;
  currentDrafter: string;
}

// Go server broadcasts flat PlayerInfo as new_pick payload (not wrapped in { newPick, nextDrafter, currentPick }).
// The draft_info_update message (separate WS event) handles advancing pickNumber/currentDrafter.
export type NewPickPayload = PlayerInfo;

export interface DraftInfoPayload {
  draftId: string;
  displayName: string;
  draftStartTime: number;
  pickLength: number;
  currentDrafter: string;
  pickNumber: number;
  roundNum: number;
  pickInRound: number;
  draftOrder: { ownerId: string; tokenId: string }[];
  adp: PlayerInfo[];
}

export interface DraftCompletePayload {
  hasCompletedClosing: boolean;
}

export interface FinalCardPayload {
  cardId: string;
  imageUrl: string;
  roster: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PickPayload {
  playerId: string;
  displayName: string;
  team: string;
  position: string;
  ownerAddress: string;
  pickNum: number;
  round: number;
}

// ==================== HOOK OPTIONS & RETURN ====================

export interface UseDraftWebSocketOptions {
  walletAddress: string;
  draftName: string;
  enabled: boolean;
  onCountdownUpdate?: (payload: CountdownPayload) => void;
  onTimerUpdate?: (payload: TimerPayload) => void;
  onNewPick?: (payload: NewPickPayload) => void;
  onDraftInfoUpdate?: (payload: DraftInfoPayload) => void;
  onDraftComplete?: (payload: DraftCompletePayload) => void;
  onFinalCard?: (payload: FinalCardPayload) => void;
  onInvalidPick?: (payload: { errorMessage: string }) => void;
  onNewQueue?: (payload: PlayerStateInfo[]) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

export interface UseDraftWebSocketReturn {
  isConnected: boolean;
  sendPick: (pick: PickPayload) => void;
  sendQueueUpdate: (queue: PlayerStateInfo[]) => void;
  forceReconnect: () => void;
  disconnect: () => void;
  lastMessageRef: React.MutableRefObject<number>;
}

// ==================== CONSTANTS ====================

const DEFAULT_SERVER_URL = 'wss://sbs-drafts-server-w5wydprnbq-uc.a.run.app';
const MAX_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;
const PING_INTERVAL_MS = 30_000;

// ==================== HOOK ====================

export function useDraftWebSocket(options: UseDraftWebSocketOptions): UseDraftWebSocketReturn {
  const {
    walletAddress,
    draftName,
    enabled,
    onCountdownUpdate,
    onTimerUpdate,
    onNewPick,
    onDraftInfoUpdate,
    onDraftComplete,
    onFinalCard,
    onInvalidPick,
    onNewQueue,
    onOpen,
    onClose,
  } = options;

  const [isConnected, setIsConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const intentionalCloseRef = useRef(false);
  const mountedRef = useRef(true);
  const lastMessageRef = useRef(Date.now());

  // Store callbacks in refs so the WebSocket message handler always sees latest
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
  }, []);

  const closeSocket = useCallback(() => {
    clearTimers();
    if (wsRef.current) {
      intentionalCloseRef.current = true;
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  }, [clearTimers]);

  const send = useCallback((type: string, payload: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }));
    }
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    clearTimers();
    intentionalCloseRef.current = false;

    const serverUrl = getDraftServerUrl() || DEFAULT_SERVER_URL;
    // Normalize wallet address to lowercase — matches production DraftWebSocketClient.buildWsUrl()
    // which calls normalizeWalletAddress(). The Go server does case-sensitive comparison
    // between c.address (from URL) and newPick.OwnerAddress (from payload), so they MUST match.
    const normalizedAddress = walletAddress.trim().toLowerCase();
    const url = `${serverUrl}/ws?address=${encodeURIComponent(normalizedAddress)}&draftName=${encodeURIComponent(draftName)}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) { ws.close(); return; }
      setIsConnected(true);
      backoffRef.current = INITIAL_BACKOFF_MS;
      callbacksRef.current.onOpen?.();

      // Start keepalive pings
      pingTimerRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping', payload: {} }));
        }
      }, PING_INTERVAL_MS);
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        const { type, payload } = data;
        const cbs = callbacksRef.current;

        // Track last message time for stale connection detection
        lastMessageRef.current = Date.now();

        // Log all non-timer messages (timer is too frequent)
        if (type !== 'timer_update') {
          logger.debug(`[WS raw] type=${type}`, payload ? JSON.stringify(payload).slice(0, 120) : 'no payload');
        }

        switch (type) {
          case 'countdown_update':
            cbs.onCountdownUpdate?.(payload as CountdownPayload);
            break;
          case 'timer_update':
            cbs.onTimerUpdate?.(payload as TimerPayload);
            break;
          case 'new_pick':
            cbs.onNewPick?.(payload as NewPickPayload);
            break;
          case 'draft_info_update':
            cbs.onDraftInfoUpdate?.(payload as DraftInfoPayload);
            break;
          case 'draft_complete':
            cbs.onDraftComplete?.(payload as DraftCompletePayload);
            break;
          case 'final_card':
            cbs.onFinalCard?.(payload as FinalCardPayload);
            break;
          case 'invalid_pick':
            cbs.onInvalidPick?.(payload as { errorMessage: string });
            break;
          case 'new_queue':
            cbs.onNewQueue?.(payload as PlayerStateInfo[]);
            break;
        }
      } catch {
        // Ignore non-JSON messages (e.g. pong frames)
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setIsConnected(false);
      callbacksRef.current.onClose?.();

      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }

      // Reconnect unless intentionally closed
      if (!intentionalCloseRef.current) {
        const delay = backoffRef.current;
        backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
        reconnectTimerRef.current = setTimeout(() => {
          if (mountedRef.current) connect();
        }, delay);
      }
    };

    ws.onerror = () => {
      // The close event will fire after error, which handles reconnection
    };
  }, [walletAddress, draftName, clearTimers]);

  // Connect/disconnect based on `enabled`
  useEffect(() => {
    if (enabled && walletAddress && draftName) {
      connect();
    } else {
      closeSocket();
    }

    return () => {
      closeSocket();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, walletAddress, draftName]);

  // Handle page visibility changes — reconnect when tab becomes visible
  useEffect(() => {
    if (!enabled) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // If disconnected while tab was hidden, reconnect
        if (wsRef.current?.readyState !== WebSocket.OPEN && !intentionalCloseRef.current) {
          backoffRef.current = INITIAL_BACKOFF_MS;
          // Cancel any pending reconnect before starting a new visible-tab reconnect.
          clearTimers();
          connect();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, connect]);

  // Track mounted state for cleanup
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Stable send functions
  const sendPick = useCallback((pick: PickPayload) => {
    send('pick_received', pick);
  }, [send]);

  const sendQueueUpdate = useCallback((queue: PlayerStateInfo[]) => {
    send('queue_update', queue);
  }, [send]);

  const forceReconnect = useCallback(() => {
    clearTimers();
    intentionalCloseRef.current = true;
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    intentionalCloseRef.current = false;
    setIsConnected(false);
    backoffRef.current = INITIAL_BACKOFF_MS;
    reconnectTimerRef.current = setTimeout(() => {
      if (mountedRef.current) connect();
    }, 1000);
  }, [clearTimers, connect]);

  const disconnect = useCallback(() => {
    closeSocket();
  }, [closeSocket]);

  return {
    isConnected,
    sendPick,
    sendQueueUpdate,
    forceReconnect,
    disconnect,
    lastMessageRef,
  };
}
