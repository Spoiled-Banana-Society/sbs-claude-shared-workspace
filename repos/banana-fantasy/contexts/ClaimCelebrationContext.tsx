'use client';

import React, { createContext, useCallback, useContext, useState } from 'react';
import { ClaimSuccessModal } from '@/components/ClaimSuccessModal';

interface CelebrationData {
  count: number;
  /** Used to choose the secondary CTA — buy-bonus → "Go Draft", everything else → "Spin the Wheel". */
  promoType?: string;
}

interface ClaimCelebrationContextValue {
  /**
   * Fire the celebration modal + banana-confetti burst. Safe to call
   * from any component (server-side calls are no-ops via the SSR guard
   * inside ClaimSuccessModal).
   *
   * The modal renders at the app level (mounted in providers.tsx), so
   * any page that triggers a successful claim — homepage carousel,
   * /promos, /drafting, /banana-wheel — fires the exact same UX. No
   * per-page wiring needed beyond calling this once on claim success.
   */
  celebrate: (data: CelebrationData) => void;
}

const ClaimCelebrationContext = createContext<ClaimCelebrationContextValue>({
  celebrate: () => {},
});

export function useClaimCelebration() {
  return useContext(ClaimCelebrationContext);
}

export function ClaimCelebrationProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<CelebrationData>({ count: 0 });

  const celebrate = useCallback((next: CelebrationData) => {
    if (!next.count || next.count <= 0) return;
    setData(next);
    setOpen(true);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  return (
    <ClaimCelebrationContext.Provider value={{ celebrate }}>
      {children}
      {open && (
        <ClaimSuccessModal
          count={data.count}
          promoType={data.promoType}
          onClose={close}
        />
      )}
    </ClaimCelebrationContext.Provider>
  );
}
