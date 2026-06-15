import { json, jsonError } from '@/lib/api/routeUtils';
import { getPrivyUser } from '@/lib/auth';
import { isFirestoreConfigured } from '@/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';

/**
 * Fires the one-time "Set up Draft Alerts" bell the FIRST time a user is in a
 * draft lobby (new or returning). Called from the draft room when the lobby
 * mounts; the dedupeKey makes it fire exactly once ever, so calling it on every
 * lobby entry is safe. Server-backed → real-time + synced across devices.
 * (Boris 2026-06-15: fire on first lobby experience, not on login.)
 */
export async function POST(req: Request) {
  try {
    if (!isFirestoreConfigured()) return json({ ok: false, reason: 'no-firestore' });
    const { walletAddress } = await getPrivyUser(req);
    if (!walletAddress) return json({ ok: false, reason: 'no-wallet' });
    const wallet = walletAddress.toLowerCase();

    const { createNotification } = await import('@/lib/queueNotifications');
    await createNotification(wallet, {
      type: 'draft_alerts',
      title: 'Set up Draft Alerts',
      message: "Get notified when your draft starts and when it's your pick. Tap to set it up.",
      link: '/notifications/settings',
      dedupeKey: 'draft-alerts-setup',
      icon: 'bellring',
    });
    return json({ ok: true });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : 'failed', 500);
  }
}
