'use client';

import { useCallback, useMemo, useState } from 'react';
import { useSyncedFlag } from '@/hooks/useSyncedFlag';

export type TutorialState = {
  shouldShowTutorial: boolean;
  currentStep: number;
  totalSteps: number;
  nextStep: () => void;
  prevStep: () => void;
  skipTutorial: () => void;
  completeTutorial: () => void;
};

export function useTutorial(totalSteps: number): TutorialState {
  const [currentStep, setCurrentStep] = useState(0);
  // Account-synced: completing the draft tutorial on one device suppresses it
  // on all the user's devices.
  const [hasCompleted, setHasCompleted, loaded] = useSyncedFlag<boolean>('draftTutorialCompleted', false);

  const completeTutorial = useCallback(() => {
    setHasCompleted(true);
  }, [setHasCompleted]);

  const nextStep = useCallback(() => {
    setCurrentStep((prev) => {
      if (prev >= totalSteps - 1) {
        completeTutorial();
        return prev;
      }
      return prev + 1;
    });
  }, [completeTutorial, totalSteps]);

  const prevStep = useCallback(() => {
    setCurrentStep((prev) => Math.max(0, prev - 1));
  }, []);

  const skipTutorial = useCallback(() => {
    completeTutorial();
  }, [completeTutorial]);

  // Don't decide until the synced value has loaded — avoids a tutorial flash
  // on a fresh device before the server flag resolves.
  const shouldShowTutorial = useMemo(() => loaded && !hasCompleted, [loaded, hasCompleted]);

  return {
    shouldShowTutorial,
    currentStep,
    totalSteps,
    nextStep,
    prevStep,
    skipTutorial,
    completeTutorial,
  };
}
