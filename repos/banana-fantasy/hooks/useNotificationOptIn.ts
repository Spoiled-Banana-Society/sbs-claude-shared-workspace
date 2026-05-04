'use client';

import { useCallback, useEffect, useState } from 'react';
import OneSignal from 'react-onesignal';
import { usePrivy } from '@privy-io/react-auth';
import { useAuth } from '@/hooks/useAuth';

const DISMISSED_KEY = 'sbs_notif_dismissed';
const DISMISSED_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type NotifOptInTrigger = 'post-draft' | 'post-purchase' | 'manual';

/**
 * Manages notification opt-in prompt visibility and OneSignal subscription.
 * Shows prompt after first draft completion or purchase, respects 7-day dismiss cooldown.
 */
export function useNotificationOptIn() {
  const { user } = useAuth();
  const { getAccessToken } = usePrivy();
  const walletAddress = user?.walletAddress ?? null;
  const [showPrompt, setShowPrompt] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Check current subscription status on mount
  useEffect(() => {
    const checkSubscription = async () => {
      try {
        const permission = await OneSignal.Notifications.permissionNative;
        setIsSubscribed(permission === 'granted');
      } catch {
        // OneSignal not initialized yet, ignore
      }
    };
    checkSubscription();
  }, []);

  const isDismissed = useCallback((): boolean => {
    try {
      const raw = localStorage.getItem(DISMISSED_KEY);
      if (!raw) return false;
      const timestamp = Number(raw);
      return Date.now() - timestamp < DISMISSED_DURATION_MS;
    } catch {
      return false;
    }
  }, []);

  /**
   * Call this after a draft completes or a purchase is made.
   * Shows the opt-in prompt if user hasn't subscribed and hasn't dismissed recently.
   */
  const triggerOptIn = useCallback(
    (_trigger: NotifOptInTrigger = 'manual') => {
      if (isSubscribed) return;
      if (isDismissed()) return;
      setShowPrompt(true);
    },
    [isSubscribed, isDismissed]
  );

  /**
   * User accepts — request notification permission via OneSignal.
   * Also registers their wallet with our backend.
   */
  const acceptOptIn = useCallback(async () => {
    setIsLoading(true);
    try {
      // Request browser notification permission
      await OneSignal.Notifications.requestPermission();

      const permission = await OneSignal.Notifications.permissionNative;
      if (permission === 'granted') {
        setIsSubscribed(true);

        // Tag the user with their wallet address for targeted notifications.
        // Lowercase so the tag matches what the server sends to OneSignal —
        // every push route in this app lowercases the walletAddress filter,
        // and mixed-case tags would silently miss.
        if (walletAddress) {
          const normalized = walletAddress.toLowerCase();
          await OneSignal.User.addTag('walletAddress', normalized);

          // Register with our backend
          try {
            const playerId = await OneSignal.User.onesignalId;
            if (playerId) {
              const token = await getAccessToken();
              await fetch('/api/notifications/subscribe', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({ walletAddress: normalized, playerId }),
              });
            }
          } catch (err) {
            console.warn('Failed to register notification subscription:', err);
          }
        }
      }
    } catch (err) {
      console.error('Notification opt-in failed:', err);
    } finally {
      setIsLoading(false);
      setShowPrompt(false);
    }
  }, [walletAddress]);

  /**
   * User dismisses — hide for 7 days.
   */
  const dismissOptIn = useCallback(() => {
    try {
      localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    } catch {
      // ignore
    }
    setShowPrompt(false);
  }, []);

  return {
    showPrompt,
    isSubscribed,
    isLoading,
    triggerOptIn,
    acceptOptIn,
    dismissOptIn,
  };
}
