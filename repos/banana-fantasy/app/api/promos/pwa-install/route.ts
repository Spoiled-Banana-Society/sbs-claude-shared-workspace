import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { json, jsonError, parseBody, requireString, getSearchParam } from '@/lib/api/routeUtils';

export const dynamic = 'force-dynamic';

const COLLECTION = 'pwa_install_entries';
const PROMO_END = '2026-04-01T00:00:00Z'; // Launch day + 48hrs — update at launch
const DRAW_TIME = '2026-04-01T02:00:00Z'; // PROMO_END + 2 hours

function isPromoActive(): boolean {
  return Date.now() < new Date(PROMO_END).getTime();
}

/** POST — Record a PWA install entry */
export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    const body = await parseBody<{ wallet: string; userId: string }>(req);
    const wallet = requireString(body.wallet, 'wallet');
    const userId = requireString(body.userId, 'userId');

    if (!isPromoActive()) {
      return jsonError('Promo has ended', 410);
    }

    const db = getAdminFirestore();
    const col = db.collection(COLLECTION);

    // Check if already entered
    const existing = await col.where('userId', '==', userId).limit(1).get();
    if (!existing.empty) {
      return json({ alreadyEntered: true, message: 'Already entered' }, 200);
    }

    // Record entry
    await col.add({
      wallet,
      userId,
      installedAt: new Date(),
      promoId: 'pwa-install-promo',
    });

    return json({ entered: true, message: "You're entered!" }, 201);
  } catch (err) {
    console.error('[pwa-install POST]', err);
    return jsonError('Internal Server Error', 500);
  }
}

/** GET — Check entry count + whether current user has entered */
export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    const db = getAdminFirestore();
    const col = db.collection(COLLECTION);

    // Total entry count
    const snapshot = await col.count().get();
    const entryCount = snapshot.data().count;

    // Check if specific user entered
    const userId = getSearchParam(req, 'userId');
    let hasEntered = false;
    if (userId) {
      const userEntry = await col.where('userId', '==', userId).limit(1).get();
      hasEntered = !userEntry.empty;
    }

    return json({
      entryCount,
      hasEntered,
      promoActive: isPromoActive(),
      promoEnd: PROMO_END,
      drawTime: DRAW_TIME,
    }, 200);
  } catch (err) {
    console.error('[pwa-install GET]', err);
    return jsonError('Internal Server Error', 500);
  }
}
