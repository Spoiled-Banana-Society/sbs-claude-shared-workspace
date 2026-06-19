'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useSyncedFlag } from '@/hooks/useSyncedFlag';

type OnboardingStep = 'tutorial' | 'profile';

interface OwnerProfilePayload {
  walletAddress: string;
  displayName: string;
  avatar?: string | null;
  onboardingComplete?: boolean;
}

async function callOwnerApi(method: 'POST' | 'PUT', payload: OwnerProfilePayload) {
  const res = await fetch('/api/owners', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Owner profile request failed');
  }
  return res.json() as Promise<unknown>;
}

export function useOnboarding() {
  const { user, updateUser, isNewUser, setShowOnboarding, setIsNewUser, isBB3Holder, returningResolved, isLoggedIn } = useAuth();
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('tutorial');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Account-synced onboarding completion (was per-device localStorage).
  const [onboardingDone, setOnboardingDone, onboardingLoaded] = useSyncedFlag<boolean>('onboardingComplete', false);

  // Decide whether to show the first-login tutorial from DURABLE, account-synced
  // state — NOT the backend 404. The Go API auto-seeds a new wallet's owner
  // record, so getOwnerUser returns 200 for genuine new users and useAuth's
  // 404-based trigger never fired (the tutorial was effectively dead). Instead,
  // show it once to real new users only:
  //   - logged in,
  //   - the account-synced `onboardingComplete` flag has LOADED (so we never
  //     flash it at someone who already finished it on another device), and is
  //     still false,
  //   - the returning-user determination has fully RESOLVED (`returningResolved`)
  //     — both the on-chain/allowlist check and the social-identity check have
  //     settled. Without this gate the tutorial flashes for ~a frame on refresh
  //     for returning users, because isBB3Holder starts false and only flips
  //     true once the async checks complete. We wait until we actually know.
  //   - and they are NOT a returning BBB4/BBB3 holder (those are veterans, not
  //     new users — isBB3Holder is set synchronously from the returning-user
  //     snapshot for known holders, and via on-chain balance otherwise).
  // Every exit path in OnboardingTutorial (Skip, "Let's Go", final slide) calls
  // completeOnboarding → sets onboardingComplete=true, so this can never re-trap
  // a user, and they never see it again across devices.
  const showOnboarding = Boolean(
    isLoggedIn && onboardingLoaded && returningResolved && !onboardingDone && !isBB3Holder,
  );

  useEffect(() => {
    if (showOnboarding) {
      setCurrentStep('tutorial');
      setError(null);
    }
  }, [showOnboarding]);

  const walletAddress = user?.walletAddress ?? null;

  const createProfile = useCallback(
    async (displayName: string, avatar?: string | null) => {
      if (!walletAddress) throw new Error('Missing wallet address');
      setIsSubmitting(true);
      setError(null);
      try {
        await callOwnerApi('POST', {
          walletAddress,
          displayName,
          avatar: avatar ?? undefined,
        });
        updateUser({
          username: displayName,
          profilePicture: avatar ?? undefined,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create profile';
        setError(message);
        throw err;
      } finally {
        setIsSubmitting(false);
      }
    },
    [updateUser, walletAddress],
  );

  const updateProfile = useCallback(
    async (displayName: string, avatar?: string | null) => {
      if (!walletAddress) throw new Error('Missing wallet address');
      setIsSubmitting(true);
      setError(null);
      try {
        await callOwnerApi('PUT', {
          walletAddress,
          displayName,
          avatar: avatar ?? undefined,
        });
        updateUser({
          username: displayName,
          profilePicture: avatar ?? undefined,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update profile';
        setError(message);
        throw err;
      } finally {
        setIsSubmitting(false);
      }
    },
    [updateUser, walletAddress],
  );

  const completeOnboarding = useCallback(
    async (opts?: { displayName?: string; avatar?: string | null }) => {
      if (!walletAddress) return;
      // Persist the onboarding-complete flag FIRST. The gate reads this
      // account-synced `onboardingComplete` client-state flag (NOT the owner
      // record), and this endpoint is no-auth (keyed by wallet) so it lands even
      // while a brand-new web2 wallet is still resolving server-side. Doing it
      // before the best-effort owner PUT means a slow/failed owner write — or a
      // mobile tab backgrounding right after — can never stop the flag from
      // landing, which was making the tutorial reappear on every refresh.
      try {
        await fetch('/api/user/client-state', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet: walletAddress.toLowerCase(), key: 'onboardingComplete', value: true }),
        });
      } catch { /* setOnboardingDone below still does the optimistic + synced write */ }
      setOnboardingDone(true);
      setShowOnboarding(false);
      setIsNewUser(false);
      // Best-effort: mirror the display name / avatar + completion onto the Go
      // owner record. Non-blocking for the gate above; errors are ignored.
      try {
        await callOwnerApi('PUT', {
          walletAddress,
          displayName: opts?.displayName || user?.username || walletAddress.slice(0, 6),
          avatar: opts?.avatar ?? user?.profilePicture ?? undefined,
          onboardingComplete: true,
        });
      } catch {
        // Ignore backend completion errors to avoid blocking the UI
      }
    },
    [setIsNewUser, setShowOnboarding, setOnboardingDone, user?.profilePicture, user?.username, walletAddress],
  );

  const hasCompletedOnboarding = onboardingDone;

  return {
    currentStep,
    setCurrentStep,
    isNewUser,
    showOnboarding,
    hasCompletedOnboarding,
    isSubmitting,
    error,
    createProfile,
    updateProfile,
    completeOnboarding,
  };
}
