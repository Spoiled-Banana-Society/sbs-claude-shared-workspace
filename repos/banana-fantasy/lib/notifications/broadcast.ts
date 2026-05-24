/**
 * Broadcast helpers for admin DM-all-users flows.
 *
 * Distinct from the per-user dispatcher (`dispatch.ts`) which is wired
 * to draft events. Broadcasts carry freeform copy (title + body + link)
 * that doesn't fit the `NotifEventType` enum.
 *
 * Three flavors:
 *   - sendBroadcastPushToAll: one OneSignal API call, targets every
 *     opted-in device (cheapest, no per-user iteration).
 *   - sendBroadcastPushToWallets: same channel but filtered to a
 *     specific wallet list.
 *   - sendBroadcastEmailToAddresses: per-email fan-out via Postmark.
 *
 * Each function is independent — a missing env var only kills that one
 * channel, never the broadcast as a whole.
 *
 * Phase 5 of the admin overhaul (May 2026).
 */

const PUSH_ICON = '/icons/icon-192.png';

export interface BroadcastMessage {
  title: string;
  body: string;
  /** Where the click lands (full URL or relative path). */
  url: string;
}

export interface BroadcastResult {
  channel: 'push' | 'email';
  status: 'sent' | 'skipped' | 'failed';
  /** Provider-reported recipient count when available. */
  recipients?: number;
  /** Provider-side identifier (OneSignal id, Postmark MessageID) for tracing. */
  providerId?: string;
  /** Human-readable reason when skipped or failed. */
  reason?: string;
}

function trim(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/**
 * Broadcast a push to every opted-in OneSignal subscriber for this app.
 * One API call. Fastest path when the message is for "all users".
 */
export async function sendBroadcastPushToAll(msg: BroadcastMessage): Promise<BroadcastResult> {
  const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !apiKey) {
    return { channel: 'push', status: 'skipped', reason: 'OneSignal not configured' };
  }
  try {
    const res = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify({
        app_id: appId,
        // `included_segments: ['Subscribed Users']` targets every device
        // that has accepted push for this app. Standard OneSignal pattern.
        included_segments: ['Subscribed Users'],
        headings: { en: trim(msg.title, 64) },
        contents: { en: trim(msg.body, 240) },
        url: msg.url,
        chrome_web_badge: PUSH_ICON,
        chrome_web_icon: PUSH_ICON,
        ttl: 86_400,
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { channel: 'push', status: 'failed', reason: `OneSignal ${res.status}: ${txt.slice(0, 200)}` };
    }
    const json = await res.json();
    return {
      channel: 'push',
      status: 'sent',
      recipients: typeof json.recipients === 'number' ? json.recipients : undefined,
      providerId: typeof json.id === 'string' ? json.id : undefined,
    };
  } catch (err) {
    return { channel: 'push', status: 'failed', reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Broadcast a push targeted to a specific wallet list. OneSignal accepts
 * an OR-filter chain; we map each wallet → `tag walletAddress = …` filter.
 *
 * OneSignal's filter chain has limits — chunk into batches of 200 wallets
 * to stay well under their per-request limit.
 */
export async function sendBroadcastPushToWallets(
  msg: BroadcastMessage,
  wallets: string[],
): Promise<BroadcastResult> {
  const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !apiKey) {
    return { channel: 'push', status: 'skipped', reason: 'OneSignal not configured' };
  }
  if (wallets.length === 0) {
    return { channel: 'push', status: 'skipped', reason: 'No matching wallets' };
  }

  const BATCH = 200;
  let totalRecipients = 0;
  const ids: string[] = [];
  for (let i = 0; i < wallets.length; i += BATCH) {
    const batch = wallets.slice(i, i + BATCH);
    // Build filters: [{tag, =, w1}, {operator: OR}, {tag, =, w2}, …]
    const filters: Array<Record<string, string>> = [];
    batch.forEach((w, idx) => {
      if (idx > 0) filters.push({ operator: 'OR' });
      filters.push({ field: 'tag', key: 'walletAddress', relation: '=', value: w.toLowerCase() });
    });
    try {
      const res = await fetch('https://onesignal.com/api/v1/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Key ${apiKey}`,
        },
        body: JSON.stringify({
          app_id: appId,
          filters,
          headings: { en: trim(msg.title, 64) },
          contents: { en: trim(msg.body, 240) },
          url: msg.url,
          chrome_web_badge: PUSH_ICON,
          chrome_web_icon: PUSH_ICON,
          ttl: 86_400,
        }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        return { channel: 'push', status: 'failed', reason: `OneSignal ${res.status}: ${txt.slice(0, 200)}` };
      }
      const json = await res.json();
      if (typeof json.recipients === 'number') totalRecipients += json.recipients;
      if (typeof json.id === 'string') ids.push(json.id);
    } catch (err) {
      return { channel: 'push', status: 'failed', reason: err instanceof Error ? err.message : String(err) };
    }
  }
  return {
    channel: 'push',
    status: 'sent',
    recipients: totalRecipients,
    providerId: ids.join(','),
  };
}

/**
 * Broadcast email via Postmark to an explicit address list. Sent one
 * message per recipient so personalization (if added later) works; today
 * the body is identical for everyone.
 *
 * Postmark's free tier is generous — single sequential loop is fine for
 * a couple hundred recipients. If volume grows, swap for Postmark's
 * batch endpoint (`/email/batch`).
 */
export async function sendBroadcastEmailToAddresses(
  msg: BroadcastMessage,
  addresses: string[],
): Promise<BroadcastResult> {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  const from = process.env.POSTMARK_FROM_EMAIL;
  if (!token || !from) {
    return { channel: 'email', status: 'skipped', reason: 'Postmark not configured' };
  }
  if (addresses.length === 0) {
    return { channel: 'email', status: 'skipped', reason: 'No email addresses to send to' };
  }
  let sent = 0;
  let lastFail: string | null = null;
  for (const to of addresses) {
    try {
      const res = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Postmark-Server-Token': token,
        },
        body: JSON.stringify({
          From: from,
          To: to,
          Subject: trim(msg.title, 200),
          HtmlBody: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto">` +
            `<h2 style="color:#fbbf24;margin:0 0 12px">${escapeHtml(msg.title)}</h2>` +
            `<p style="font-size:16px;line-height:1.5;color:#111">${escapeHtml(msg.body).replace(/\n/g, '<br/>')}</p>` +
            (msg.url
              ? `<p><a href="${msg.url}" style="display:inline-block;background:#fbbf24;color:#000;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:8px">Open</a></p>`
              : '') +
            `</div>`,
          TextBody: `${msg.title}\n\n${msg.body}${msg.url ? `\n\n${msg.url}` : ''}`,
          MessageStream: 'outbound',
        }),
      });
      if (!res.ok) {
        lastFail = `Postmark ${res.status}`;
        continue;
      }
      sent += 1;
    } catch (err) {
      lastFail = err instanceof Error ? err.message : String(err);
    }
  }
  if (sent === 0) {
    return { channel: 'email', status: 'failed', reason: lastFail || 'All sends failed' };
  }
  return {
    channel: 'email',
    status: 'sent',
    recipients: sent,
    reason: lastFail ? `${sent}/${addresses.length} sent — last failure: ${lastFail}` : undefined,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
