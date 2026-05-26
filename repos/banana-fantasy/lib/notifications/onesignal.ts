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

/**
 * Send a OneSignal push; resolves to the recipient count.
 *
 * Two-step delivery so v2 SDK subscriptions (which leave the legacy
 * `notification_types` field null on /players) still receive pushes:
 *   1. List all players tagged with this wallet — the v1 /players
 *      endpoint's tag lookup works regardless of subscription schema
 *      version, unlike the send-time tag *filter* which silently
 *      excludes any player whose notification_types isn't >0.
 *   2. Send the notification with `include_player_ids: [...]` — direct
 *      targeting bypasses the broken filter and actually delivers to
 *      v2 subscriptions that OneSignal's dashboard shows as Subscribed
 *      but the v1 filter treats as ineligible.
 *
 * We treat the player-ID list length as the recipient count (real
 * delivery is decided by OneSignal + FCM/APNS asynchronously). If the
 * lookup finds zero tagged devices, return 0 — the dispatcher logs
 * PUSH_ZERO_RECIPIENTS for that case which is still the right signal.
 */
export async function sendOneSignalPush(opts: OneSignalPushOptions): Promise<number> {
  const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !apiKey) throw new Error('OneSignal not configured');

  // 1. Find every player tagged with this wallet (any subscription schema).
  const lookupRes = await fetch(
    `https://onesignal.com/api/v1/players?app_id=${appId}&limit=300`,
    { headers: { Authorization: `Key ${apiKey}` } },
  );
  if (!lookupRes.ok) {
    throw new Error(
      `OneSignal player lookup ${lookupRes.status}: ${await lookupRes.text().catch(() => '')}`,
    );
  }
  const lookupBody = (await lookupRes.json()) as {
    players?: Array<{
      id?: string;
      invalid_identifier?: boolean;
      tags?: Record<string, string>;
    }>;
  };
  const wallet = opts.walletAddress.toLowerCase();
  const playerIds = (lookupBody.players || [])
    .filter(
      (p) =>
        !!p.id &&
        !p.invalid_identifier &&
        (p.tags?.walletAddress || '').toLowerCase() === wallet,
    )
    .map((p) => p.id as string);

  if (playerIds.length === 0) return 0;

  // 2. Direct send to those player IDs.
  const res = await fetch('https://onesignal.com/api/v1/notifications', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // OneSignal's current key format (os_v2_app_…) uses the `Key` auth
      // scheme; the old `Basic` scheme was for legacy REST API keys.
      Authorization: `Key ${apiKey}`,
    },
    body: JSON.stringify({
      app_id: appId,
      include_player_ids: playerIds,
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
  // include_player_ids response: { id, external_id, errors? } — recipients
  // is only returned for segment/filter sends. If no invalid_player_ids
  // came back, every ID we sent was accepted by OneSignal.
  const result = (await res.json()) as {
    id?: string;
    errors?: { invalid_player_ids?: string[]; invalid_external_user_ids?: string[] };
  };
  const invalidCount = result.errors?.invalid_player_ids?.length ?? 0;
  return playerIds.length - invalidCount;
}
