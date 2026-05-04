import { NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { requireAdmin } from '@/lib/adminAuth';
import { ApiError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';

const ONESIGNAL_APP_ID = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
const ONESIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY;
const ENTRIES_COLLECTION = 'pwa_install_entries';
const PROMO_ID = 'pwa-install-promo';

/**
 * POST /api/promos/pwa-raffle-notify
 * Admin-only: sends push + in-app notifications to all raffle entrants
 * telling them the draw is happening in 2 hours.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin(req);
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getAdminFirestore();
    const entries = await db.collection(ENTRIES_COLLECTION)
      .where('promoId', '==', PROMO_ID)
      .get();

    if (entries.empty) {
      return NextResponse.json({ error: 'No entrants found' }, { status: 404 });
    }

    const wallets = entries.docs.map(doc => doc.data().wallet as string);
    let pushRecipients = 0;

    // Send OneSignal push to each entrant's wallet tag
    if (ONESIGNAL_APP_ID && ONESIGNAL_REST_API_KEY) {
      // Build OR filters for all wallets
      const filters: Array<Record<string, string>> = [];
      wallets.forEach((wallet, i) => {
        if (i > 0) filters.push({ field: 'OR' });
        filters.push({ field: 'tag', key: 'walletAddress', relation: '=', value: wallet });
      });

      const res = await fetch('https://onesignal.com/api/v1/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${ONESIGNAL_REST_API_KEY}`,
        },
        body: JSON.stringify({
          app_id: ONESIGNAL_APP_ID,
          filters,
          headings: { en: '🎰 Raffle Draw in 2 Hours!' },
          contents: { en: 'The PWA install raffle is about to be drawn. Come watch the winner get picked live!' },
          url: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://banana-fantasy-sbs.vercel.app'}/banana-wheel/raffle`,
          chrome_web_badge: '/banana-icon-192.png',
          chrome_web_icon: '/banana-icon-192.png',
          ttl: 7200, // 2 hours
        }),
      });

      if (res.ok) {
        const result = await res.json();
        pushRecipients = result.recipients ?? 0;
      } else {
        console.error('[pwa-raffle-notify] OneSignal error:', res.status, await res.text());
      }
    }

    return NextResponse.json({
      ok: true,
      entrantCount: wallets.length,
      pushRecipients,
    });
  } catch (err) {
    console.error('[pwa-raffle-notify]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
