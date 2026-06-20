'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { usePrivy } from '@privy-io/react-auth';
import { useAuth } from '@/hooks/useAuth';

// Mirror of useAuth's saved-profile key. A cached profile means this device has
// logged in before (a returning user) — they never see the creating screen.
const USER_PROFILE_KEY = 'banana-fantasy-user-profile';
function hasCachedProfile(): boolean {
  if (typeof window === 'undefined') return false;
  try { return !!localStorage.getItem(USER_PROFILE_KEY); } catch { return false; }
}

/**
 * Clean, branded "Creating your account" screen shown ONLY during the grey
 * window of a genuinely NEW signup: Privy is authenticated but our account
 * object hasn't loaded yet (the embedded wallet is being created + the account
 * seeded), and there's no cached profile on this device.
 *
 * Why this trigger (not `isNewUser`): `isNewUser` only flips true AFTER the
 * owner lookup returns — i.e. at the END of the grey window — so it was always
 * too late. `authenticated && !user` is exactly the grey window; `!cached`
 * keeps returning users from ever seeing it. Hard 8s timeout so it can never
 * stick if some auth state never settles (iOS Safari storage edge cases).
 */
export function CreatingAccountOverlay() {
  const privy = usePrivy();
  const { isLoggedIn } = useAuth(); // isLoggedIn === !!user
  const [cached] = useState(hasCachedProfile);

  const show = privy.ready && privy.authenticated && !isLoggedIn && !cached;

  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (!show) { setTimedOut(false); return; }
    const t = setTimeout(() => setTimedOut(true), 8000);
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
