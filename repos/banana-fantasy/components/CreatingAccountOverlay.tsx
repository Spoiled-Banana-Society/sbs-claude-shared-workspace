'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useAuth } from '@/hooks/useAuth';

/**
 * Clean, branded "Creating your account" screen shown ONLY while a genuinely
 * NEW user's account is being set up (the ~2-3s after a fresh web2 signup where
 * Privy builds the embedded wallet + we seed the account). Replaces the bare
 * grey loading skeleton with a clear message.
 *
 * Self-gating + safe by design:
 *   - shows only when `isNewUser` is true (returning users never see it — they
 *     fall back to the normal skeleton), and
 *   - auto-dismisses after a hard timeout so it can never get stuck if some
 *     auth state never settles (iOS Safari storage edge cases).
 */
export function CreatingAccountOverlay() {
  const { isLoggedIn, isNewUser, isLoading, isBalanceLoaded } = useAuth();
  const resolving = isLoading || (isLoggedIn && !isBalanceLoaded);
  const show = isLoggedIn && isNewUser && resolving;

  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (!show) { setTimedOut(false); return; }
    const t = setTimeout(() => setTimedOut(true), 6000);
    return () => clearTimeout(t);
  }, [show]);

  if (!show || timedOut) return null;

  return (
    <div className="fixed inset-0 z-[120] flex flex-col items-center justify-center bg-bg-primary px-6">
      <div className="relative mb-7">
        <div className="absolute inset-0 bg-banana/20 rounded-full blur-2xl scale-[1.8]" />
        <Image src="/sbs-logo.png" alt="SBS" width={52} height={52} className="relative z-10" priority />
      </div>
      <p className="text-white/90 text-lg md:text-xl font-medium tracking-tight flex items-center">
        Creating your account
        <span className="inline-flex ml-0.5">
          <span className="cc-dot">.</span>
          <span className="cc-dot">.</span>
          <span className="cc-dot">.</span>
        </span>
      </p>
    </div>
  );
}
