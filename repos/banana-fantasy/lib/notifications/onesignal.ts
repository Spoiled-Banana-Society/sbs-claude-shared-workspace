/**
 * Low-level OneSignal web-push call. Extracted from the original pick-up
 * route so the push channel sender stays a thin wrapper.
 *
 * Targets a user by the OneSignal tag `walletAddress` (set client-side by
 * `useNotificationOptIn`). Throws on misconfiguration or a non-OK response;
 * the channel sender turns that into a `ChannelResult`.
 */

const ICON = '/icons/icon-192.png';

export interface OneSignalPushOptions {
  walletAddress: string;
  title: string;
  body: string;
  url: string;
  ttlSeconds?: number;
}

/** Send a OneSignal push; resolves to the recipient count. */
export async function sendOneSignalPush(opts: OneSignalPushOptions): Promise<number> {
  const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !apiKey) throw new Error('OneSignal not configured');

  const res = await fetch('https://onesignal.com/api/v1/notifications', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${apiKey}`,
    },
    body: JSON.stringify({
      app_id: appId,
      filters: [
        { field: 'tag', key: 'walletAddress', relation: '=', value: opts.walletAddress },
      ],
      headings: { en: opts.title },
      contents: { en: opts.body },
      url: opts.url,
      chrome_web_badge: ICON,
      chrome_web_icon: ICON,
      ttl: opts.ttlSeconds ?? 600,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`OneSignal ${res.status}: ${errBody}`);
  }
  const result = await res.json();
  return typeof result.recipients === 'number' ? result.recipients : 0;
}
