'use client';

import { useEffect } from 'react';

/**
 * The app no longer registers its own service worker.
 *
 * `/sw.js` was a self-destructing worker whose only job was to clean up a
 * legacy SW that broke Next.js navigation. But this component re-registered
 * it on every page load — and because it claimed scope `/`, it kept
 * clobbering OneSignal's push worker (`OneSignalSDKWorker.js`). With
 * OneSignal's worker gone, incoming web pushes had nothing to receive them
 * (OneSignal delivery showed `received: 0` / `errored`).
 *
 * OneSignal now owns the single service worker. This component only
 * unregisters any stale `/sw.js` still left on a returning user's device —
 * it never touches OneSignal's worker.
 */
export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => {
        regs.forEach((reg) => {
          const url =
            reg.active?.scriptURL ||
            reg.installing?.scriptURL ||
            reg.waiting?.scriptURL ||
            '';
          // OneSignal owns the only service worker the app needs. Remove
          // any OTHER worker — the old self-destructing /sw.js, or stale
          // workers left from past builds — since a squatting worker
          // blocks OneSignal's from receiving web push. Never touch
          // OneSignal's own worker (its URL contains "OneSignal").
          if (url && !url.includes('OneSignal')) {
            reg.unregister().catch(() => {});
          }
        });
      })
      .catch(() => {
        /* non-fatal */
      });
  }, []);

  return null;
}
