'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getDraftInfo } from '@/lib/api/drafts';

export interface LobbyStatus {
  draftId: string;
  phase: 'waiting' | 'filling' | 'countdown' | 'drafting' | 'completed';
  currentUsers: number;
  maxUsers: number;
  draftStartTime: number | null;
  countdownSeconds: number | null;
  currentDrafter: string | null;
  draftOrder: Array<{ ownerId: string; tokenId: string }>;
  level: string;
}

interface UseLobbyStatusOptions {
  /** Poll interval in ms (default: 5000) */
  pollInterval?: number;
  /** Stop polling when draft starts */
  stopOnDraft?: boolean;
}

function mapInfoToLobbyStatus(draftId: string, info: Record<string, unknown>): LobbyStatus {
  const now = Date.now();
  const draftStartTime = info.draftStartTime ? Number(info.draftStartTime) : null;
  const currentUsers = Number(info.currentUsers ?? info.numPlayers ?? info.players ?? 0);
  const maxUsers = Number(info.maxUsers ?? info.maxPlayers ?? info.maxDrafters ?? 10);

  let phase: LobbyStatus['phase'] = 'waiting';
  if (info.status === 'completed' || info.draftComplete) {
    phase = 'completed';
  } else if (draftStartTime && now >= draftStartTime) {
    phase = 'drafting';
  } else if (draftStartTime && now < draftStartTime) {
    phase = 'countdown';
  } else if (currentUsers >= maxUsers) {
    phase = 'countdown';
  } else if (currentUsers > 0) {
    phase = 'filling';
  }

  return {
    draftId: String(info.draftId ?? draftId),
    phase,
    currentUsers,
    maxUsers,
    draftStartTime,
    countdownSeconds: draftStartTime ? Math.max(0, Math.floor((draftStartTime - now) / 1000)) : null,
    currentDrafter: info.currentDrafter ? String(info.currentDrafter) : null,
    draftOrder: Array.isArray(info.draftOrder) ? info.draftOrder as LobbyStatus['draftOrder'] : [],
    level: String(info.draftLevel ?? info.level ?? info._level ?? 'Pro'),
  };
}

export function useLobbyStatus(
  draftId: string | null,
  options: UseLobbyStatusOptions = {}
) {
  const { pollInterval = 5000, stopOnDraft = true } = options;
  const [status, setStatus] = useState<LobbyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stoppedRef = useRef(false);

  const fetchStatus = useCallback(async () => {
    if (!draftId || stoppedRef.current) return;

    try {
      // Call Go API directly (staging-aware via getDraftsApiUrl inside getDraftInfo)
      const info = await getDraftInfo(draftId);
      const data = mapInfoToLobbyStatus(draftId, info as unknown as Record<string, unknown>);
      setStatus(data);
      setError(null);
      setIsLoading(false);

      if (stopOnDraft && (data.phase === 'drafting' || data.phase === 'completed')) {
        stoppedRef.current = true;
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    } catch {
      // Draft may not exist yet — return default waiting state
      setStatus({
        draftId: draftId,
        phase: 'waiting',
        currentUsers: 0,
        maxUsers: 10,
        draftStartTime: null,
        countdownSeconds: null,
        currentDrafter: null,
        draftOrder: [],
        level: 'Pro',
      });
      setError(null);
      setIsLoading(false);
    }
  }, [draftId, stopOnDraft]);

  useEffect(() => {
    if (!draftId) {
      setIsLoading(false);
      return;
    }

    stoppedRef.current = false;
    setIsLoading(true);

    fetchStatus();
    intervalRef.current = setInterval(fetchStatus, pollInterval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [draftId, pollInterval, fetchStatus]);

  return { status, error, isLoading };
}
