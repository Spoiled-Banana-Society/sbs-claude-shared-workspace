/**
 * GET /api/marketplace/resolve-user?q=<username-or-wallet>
 *
 * Public people-lookup for the marketplace. Accepts either a wallet address or
 * a username and resolves to a canonical wallet (+ display username) so the
 * /u/[id] page can show that person's teams. No auth — read-only, anyone can
 * look up any public profile.
 *
 *   { wallet: '0x…', username: 'Foo' | null }   on success
 *   404 { error: 'not_found' }                   if the username isn't claimed
 */

export const dynamic = 'force-dynamic';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { getUserDisplayBatch } from '@/lib/db';

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;
const RESERVATIONS = 'usernames';
const USERS = 'v2_users';

export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  const q = (new URL(req.url).searchParams.get('q') || '').trim();
  if (!q) return jsonError('Missing q', 400);

  // A wallet address resolves to itself — just attach the display name if any.
  if (WALLET_RE.test(q)) {
    const wallet = q.toLowerCase();
    let username: string | null = null;
    try {
      const display = await getUserDisplayBatch([wallet]);
      username = display[wallet]?.username ?? null;
    } catch {
      // Display lookup is best-effort — the wallet still resolves.
    }
    return json({ wallet, username });
  }

  if (!isFirestoreConfigured()) return jsonError('not_found', 404);

  const lower = q.toLowerCase();
  const db = getAdminFirestore();

  // 1) The reservation collection is the source of truth for username → wallet.
  try {
    const res = await db.collection(RESERVATIONS).doc(lower).get();
    if (res.exists) {
      const wallet = String((res.data() as { walletAddress?: string })?.walletAddress || '').toLowerCase();
      if (WALLET_RE.test(wallet)) {
        const name = String((res.data() as { name?: string })?.name || '') || q;
        return json({ wallet, username: name });
      }
    }
  } catch {
    // fall through to the legacy index
  }

  // 2) Legacy names predate reservations — fall back to the mirrored index.
  try {
    const dupe = await db.collection(USERS).where('username_lower', '==', lower).limit(1).get();
    if (!dupe.empty) {
      const doc = dupe.docs[0];
      const wallet = doc.id.toLowerCase();
      if (WALLET_RE.test(wallet)) {
        const name = String((doc.data() as { username?: string })?.username || '') || q;
        return json({ wallet, username: name });
      }
    }
  } catch {
    // fall through to not_found
  }

  return jsonError('not_found', 404);
}
