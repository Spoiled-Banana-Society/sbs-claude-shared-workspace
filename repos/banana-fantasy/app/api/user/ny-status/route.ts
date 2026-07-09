export const dynamic = 'force-dynamic';

import { json } from '@/lib/api/routeUtils';
import { getPrivyUser } from '@/lib/auth';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { isNyBuyer, isNyOnrampEnabled, resolveUsState } from '@/lib/usState';
import { getRequestGeo } from '@/lib/geoLocation';
import { logger } from '@/lib/logger';

/**
 * GET /api/user/ny-status
 *
 * Tells the buy flow whether THIS authenticated buyer should get the New York
 * on-ramp path (buy USDC on Optimism → bridge to Base) instead of the direct
 * Base buy. Authoritative, server-side (the user doc's `usState` override + the
 * fresh IP region live here, not on the client).
 *
 * Returns:
 *   - `ny`        the effective decision the modal acts on: NY buyer AND the
 *                 branch is enabled. When the flag is off this is ALWAYS false,
 *                 so the modal can never route anyone to the NY path prematurely.
 *   - `isNy`      the raw detection (are they in NY?) — reported separately so we
 *                 can verify detection works independent of the flag.
 *   - `enabled`   whether the NY branch is turned on.
 *
 * Read-only. If anything errors, it returns ny:false so the buyer always falls
 * back to the normal Base flow — this can never block or break a purchase.
 */
export async function GET(req: Request) {
  try {
    let wallet: string | null = null;
    try {
      const u = await getPrivyUser(req);
      wallet = u.walletAddress?.toLowerCase() ?? null;
    } catch {
      return json({ ny: false, isNy: false, enabled: isNyOnrampEnabled() });
    }
    if (!wallet || !isFirestoreConfigured()) {
      return json({ ny: false, isNy: false, enabled: isNyOnrampEnabled() });
    }

    const db = getAdminFirestore();
    const data = (await db.collection('v2_users').doc(wallet).get()).data() ?? {};
    // Fall back to the live request IP if the doc has no region yet (e.g. a
    // brand-new session whose first geo write hasn't landed) — same signal,
    // just fresher. usState (manual override) still wins inside resolveUsState.
    const geo = getRequestGeo(req);
    const source = {
      usState: (data.usState as string) ?? null,
      usCountry: (data.usCountry as string) ?? null,
      ipCountry: (data.ipCountry as string) ?? geo.country,
      ipRegion: (data.ipRegion as string) ?? geo.region,
    };

    const isNy = isNyBuyer(source);
    const enabled = isNyOnrampEnabled();
    return json({ ny: isNy && enabled, isNy, enabled, state: resolveUsState(source) });
  } catch (err) {
    logger.warn('ny-status.failed', { err });
    // Never break a buy — default to the normal Base flow.
    return json({ ny: false, isNy: false, enabled: false });
  }
}
