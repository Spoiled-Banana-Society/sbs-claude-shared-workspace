import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

const ONESIGNAL_APP_ID = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
const ONESIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY;

/**
 * POST /api/notifications/draft-reminder
 * Sends a push notification to a user reminding them their draft starts soon.
 *
 * Body: { walletAddress: string, draftId: string, draftName?: string, minutesBefore?: number }
 *
 * Uses OneSignal REST API to send targeted notification via wallet tag.
 */
export async function POST(req: NextRequest) {
  try {
    if (!ONESIGNAL_APP_ID || !ONESIGNAL_REST_API_KEY) {
      return NextResponse.json(
        { error: 'OneSignal not configured' },
        { status: 503 }
      );
    }

    const body = await req.json();
    const { walletAddress, draftId, draftName, minutesBefore = 5 } = body;

    if (!walletAddress || typeof walletAddress !== 'string') {
      return NextResponse.json({ error: 'walletAddress required' }, { status: 400 });
    }
    if (!draftId || typeof draftId !== 'string') {
      return NextResponse.json({ error: 'draftId required' }, { status: 400 });
    }

    const title = '🍌 Draft Starting Soon!';
    const message = draftName
      ? `Your draft "${draftName}" starts in ${minutesBefore} minutes. Get ready to pick!`
      : `Your draft starts in ${minutesBefore} minutes. Get ready to pick!`;

    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${ONESIGNAL_REST_API_KEY}`,
      },
      body: JSON.stringify({
        app_id: ONESIGNAL_APP_ID,
        filters: [
          { field: 'tag', key: 'walletAddress', relation: '=', value: walletAddress },
        ],
        headings: { en: title },
        contents: { en: message },
        url: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.spoiledbananasociety.com'}/draft-room?id=${draftId}`,
        chrome_web_badge: '/banana-icon-192.png',
        chrome_web_icon: '/banana-icon-192.png',
        ttl: minutesBefore * 60, // expire after the draft would have started
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('[draft-reminder] OneSignal error:', response.status, errorBody);
      return NextResponse.json(
        { error: 'Failed to send notification' },
        { status: 502 }
      );
    }

    const result = await response.json();
    logger.debug(`[draft-reminder] Sent to wallet=${walletAddress} draftId=${draftId} recipients=${result.recipients}`);

    return NextResponse.json({ ok: true, recipients: result.recipients ?? 0 });
  } catch (err) {
    console.error('[draft-reminder] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
