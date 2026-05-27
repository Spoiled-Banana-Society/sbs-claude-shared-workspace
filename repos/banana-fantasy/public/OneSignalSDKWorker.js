// SBS custom notificationclick handler — runs BEFORE OneSignal's SDK
// import so we can intercept the click, find an existing SBS tab, focus
// it, and prevent OneSignal's default `openWindow` from also firing.
// Without this, every push click on desktop opens a fresh tab even when
// the user already has the draft open in another tab — they'd see a
// duplicate window and (worse) the new one starts at stale state.
//
// The URL matcher here MIRRORS the one in lib/notifications/swClickMatch.ts
// (which is unit-tested). If you change the logic in one, change both.
// Service workers can't import TS modules, so we inline.

function safeUrl(s) {
  try {
    return new URL(s);
  } catch (_e) {
    return null;
  }
}

function findMatchingClient(clients, targetUrlStr) {
  const target = safeUrl(targetUrlStr);
  if (!target) return null;
  let best = null;
  let bestSpecificity = -1;
  for (const client of clients) {
    const candidate = safeUrl(client.url);
    if (!candidate) continue;
    if (candidate.origin !== target.origin) continue;
    if (candidate.pathname !== target.pathname) continue;
    if (target.pathname === '/draft-room') {
      const targetDraftId = target.searchParams.get('id');
      const candidateDraftId = candidate.searchParams.get('id');
      if (!targetDraftId || targetDraftId !== candidateDraftId) continue;
    }
    const specificity = candidate.pathname.split('/').filter(Boolean).length;
    if (specificity > bestSpecificity) {
      bestSpecificity = specificity;
      best = client;
    }
  }
  return best;
}

self.addEventListener('notificationclick', (event) => {
  // OneSignal v16 stamps incoming notifications with `data.id` (their
  // notification id). If that's missing, this isn't a OneSignal-owned
  // notification — let other handlers (none today, but future-proof)
  // handle it normally.
  const data = event.notification && event.notification.data;
  const isOneSignalNotification = !!(data && (data.id || data.notificationId));
  if (!isOneSignalNotification) return;

  // OneSignal stores the target URL on `data.launchURL`. Older SDKs
  // used `data.url`. Cover both for safety.
  const targetUrl = (data && (data.launchURL || data.url)) || '/';

  // Stop OneSignal's default click listener from also running. We've
  // taken responsibility for opening / focusing the right window.
  if (typeof event.stopImmediatePropagation === 'function') {
    event.stopImmediatePropagation();
  }
  event.notification.close();

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      const match = findMatchingClient(allClients, targetUrl);
      if (match) {
        // Focus the existing tab. Optionally navigate it to the exact
        // URL so the canonical deep link wins over whatever the user
        // had in their query string.
        try {
          if ('navigate' in match && match.url !== targetUrl) {
            await match.navigate(targetUrl);
          }
        } catch (_e) {
          /* navigate is allowed-list restricted; safe to ignore */
        }
        try {
          // Tell the focused page to force-resync from the live source
          // of truth (Firebase RTDB + WS) so the user sees the current
          // pick/timer instantly, not whatever cached state was on the
          // page when they last looked at it.
          match.postMessage({ type: 'sbs:notification-clicked', targetUrl });
        } catch (_e) {
          /* ignore */
        }
        await match.focus();
        return;
      }
      // No matching open window — open a new one.
      await self.clients.openWindow(targetUrl);
    })(),
  );
});

importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
// deploy trigger 20260213000343
// reconnect test 20260213000915
