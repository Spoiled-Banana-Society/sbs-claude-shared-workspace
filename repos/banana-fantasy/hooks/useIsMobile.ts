'use client';

import { useEffect, useState } from 'react';

// Matches the app's compact/"mobile" layout breakpoint (below Tailwind `lg`),
// which is where the draft tiles pack the name close under the avatar.
const QUERY = '(max-width: 1023px)';

/**
 * True on small/compact viewports. Starts `false` (matching SSR) and resolves
 * on mount, so there's no hydration mismatch — just a one-frame settle on
 * mobile, which is fine for cosmetic tweaks like badge sizing.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(QUERY);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);
  return isMobile;
}
