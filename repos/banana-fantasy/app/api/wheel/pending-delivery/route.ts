import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { json, jsonError } from '@/lib/api/routeUtils';

export const dynamic = 'force-dynamic';

/**
 * Tells the wheel page whether a user has a won prize that the on-chain
 * delivery failed on and the auto-recovery cron is still working to deliver.
 *
 * Used to show a friendly "we're getting your prize ready" popup so a delayed
 * delivery is never silent. NO web3 wording is exposed to the client.
 *
 *  - status: 'pending' → a wheel win is owed and still inside the retry window
 *    (the cron will keep trying; the prize should land shortly).
 *  - status: 'stuck'   → auto-recovery has exhausted its retries; a human has
 *    been alerted to deliver it manually.
 *  - status: 'none'    → nothing owed.
 *
 * Mirrors the cron's record model (`failed_mints`). Card-purchase failures are
 * ignored here — this endpoint only reports WHEEL wins.
 */

const MAX_ATTEMPTS = 8; // keep in sync with crons/fulfill-failed-mints
const WALLET_REGEX = /^0x[0-9a-fA-F]{40}$/;

export async function GET(req: Request) {
  const wallet = (new URL(req.url).searchParams.get('wallet') ?? '').trim().toLowerCase();
  if (!WALLET_REGEX.test(wallet)) return jsonError('Invalid wallet', 400);
  if (!isFirestoreConfigured()) return json({ status: 'none' });

  const db = getAdminFirestore();
  // Single field-equality query (no composite index needed), filter the rest in
  // memory — same shape the recovery cron uses. The collection only holds
  // failures, so it stays small.
  const snap = await db.collection('failed_mints').where('retryable', '==', true).limit(200).get();

  let pending = false;
  let stuck = false;
  for (const doc of snap.docs) {
    const d = doc.data();
    if (String(d.userId ?? '').toLowerCase() !== wallet) continue;
    // Wheel wins are tagged with a spinId / wheel_spin reason. Skip card-mint.
    const isWheel = !!d.spinId || String(d.reason ?? '').startsWith('wheel_spin');
    if (!isWheel) continue;
    if (d.resolved === true) continue; // already delivered
    const attempts = Number(d.attempts ?? 0);
    if (attempts >= MAX_ATTEMPTS || d.needsManual === true) stuck = true;
    else pending = true;
  }

  // Pending wins (still being delivered) take priority over a stuck sibling.
  return json({ status: pending ? 'pending' : stuck ? 'stuck' : 'none' });
}
