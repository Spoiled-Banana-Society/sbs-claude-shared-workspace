'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { subscribeValue, isFirebaseAvailable } from '@/lib/api/firebase';
import { logger } from '@/lib/logger';

// ==================== TYPES ====================

export interface RealTimeDraftInfo {
  currentDrafter: string;
  pickNumber: number;
  roundNum: number;
  pickInRound: number;
  pickEndTime: number;       // Unix timestamp in seconds
  pickLength: number;        // Duration in seconds
  draftStartTime: number;    // Unix timestamp in seconds when draft starts
  lastPick: LastPickInfo | null;
  isDraftComplete: boolean;
  isDraftClosed: boolean;
}

export interface LastPickInfo {
  playerId: string;
  displayName: string;
  team: string;
  position: string;
  ownerAddress: string;
  pickNum: number;
  round: number;
}

export interface UseRealTimeDraftInfoReturn {
  /** The latest snapshot from Firebase RTDB, or null if not yet received */
  data: RealTimeDraftInfo | null;
  /** Whether a new pick was detected (pickNumber increased) — resets after consumption */
  newPickDetected: boolean;
  /** The last pick info when a new pick is detected */
  detectedPick: LastPickInfo | null;
  /** Clear the newPickDetected flag after consuming it */
  clearNewPick: () => void;
  /** Whether the listener is active */
  isListening: boolean;
  /** Whether Firebase had a connection/permission error (signals need for WS fallback) */
  hasError: boolean;
}

/**
 * Hook to listen to Firebase Realtime Database for draft state.
 *
 * Listens to `drafts/{draftId}/realTimeDraftInfo` and returns the latest snapshot.
 * Detects new picks by comparing pickNumber across snapshots.
 *
 * @param draftId - The draft/league ID to listen to
 * @param isActive - Whether the draft is currently active (enables/disables listener)
 */
export function useRealTimeDraftInfo(
  draftId: string | null,
  isActive: boolean,
): UseRealTimeDraftInfoReturn {
  const [data, setData] = useState<RealTimeDraftInfo | null>(null);
  const [newPickDetected, setNewPickDetected] = useState(false);
  const [detectedPick, setDetectedPick] = useState<LastPickInfo | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [hasError, setHasError] = useState(false);

  const lastPickNumberRef = useRef<number | null>(null);

  const clearNewPick = useCallback(() => {
    setNewPickDetected(false);
    setDetectedPick(null);
  }, []);

  useEffect(() => {
    if (!draftId || !isActive) {
      setIsListening(false);
      lastPickNumberRef.current = null;
      return;
    }

    // Skip if Firebase is not configured (missing env vars)
    if (!isFirebaseAvailable()) {
      console.warn('[Firebase RTDB] Firebase not available — env vars missing. Skipping subscription.');
      setIsListening(false);
      setHasError(true); // Signal callers to use fallback
      return;
    }

    const path = `drafts/${draftId}/realTimeDraftInfo`;
    logger.debug('[Firebase RTDB] Subscribing to', path);
    setIsListening(true);
    setHasError(false);

    // Set up a timeout: if we don't receive any data within 15s,
    // mark as error so the page can fall back to WebSocket.
    const timeoutId = setTimeout(() => {
      if (!data) {
        console.warn('[Firebase RTDB] No data received within 15s — marking as error for WS fallback');
        setHasError(true);
      }
    }, 15000);

    const unsub = subscribeValue<RealTimeDraftInfo>(
      path,
      (value) => {
        clearTimeout(timeoutId);

        if (!value) {
          console.warn(`[Firebase RTDB] No data at ${path}`);
          // If we get a null value on first callback, this often means the path doesn't exist
          // or we don't have permission. Signal error for WS fallback.
          setHasError(true);
          return;
        }

        // Data received successfully — clear any error state
        setHasError(false);
        setData(value);

        // Detect new picks by comparing pickNumber
        if (value.pickNumber > 1 && value.lastPick) {
          const currentPickNum = value.pickNumber;
          if (
            lastPickNumberRef.current === null ||
            currentPickNum > lastPickNumberRef.current
          ) {
            logger.debug(
              '[Firebase RTDB] New pick detected: pickNumber',
              currentPickNum,
              'player',
              value.lastPick.playerId,
            );
            setNewPickDetected(true);
            setDetectedPick(value.lastPick);
            lastPickNumberRef.current = currentPickNum;
          }
        } else {
          // Initialize tracking
          lastPickNumberRef.current = value.pickNumber;
        }
      },
      (error) => {
        // Firebase permission_denied or other errors — signal WS fallback
        clearTimeout(timeoutId);
        console.error('[Firebase RTDB] Subscription error:', error.message);
        setHasError(true);
        setIsListening(false);
      },
    );

    return () => {
      clearTimeout(timeoutId);
      logger.debug('[Firebase RTDB] Unsubscribing from', path);
      unsub();
      setIsListening(false);
      lastPickNumberRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, isActive]);

  return {
    data,
    newPickDetected,
    detectedPick,
    clearNewPick,
    isListening,
    hasError,
  };
}
