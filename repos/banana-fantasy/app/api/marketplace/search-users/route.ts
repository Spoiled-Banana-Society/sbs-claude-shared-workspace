/**
 * GET /api/marketplace/search-users?q=<prefix>
 *
 * Public username type-ahead for the people lookup. Prefix-matches usernames
 * (case-insensitive) and returns a short list of candidates so the lookup box
 * can suggest users as you type. Read-only, no auth.
 *
 *   { users: [{ username, wallet, profilePicture, bananaNumber }] }
 *
 * Uses a single-field range query on `username_lower` (auto-indexed) — the
 * marketplace_activity composite-index caveat does NOT apply here.
 */

export const dynamic = 'force-dynamic';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';

const USERS = 'v2_users';
const LIMIT = 8;

interface UserHit {
  username: string;
  wallet: string;
  profilePicture: string | null;
  bananaNumber: number | null;
}

// Upper bound for a prefix range: bump the last char by one code unit so the
// half-open [prefix, prefixEnd) window captures every string starting with
// `prefix` ("bo" → ["bo", "bp")). Avoids relying on a high-unicode sentinel.
function prefixEnd(prefix: string): string {
  if (!prefix) return prefix;
  const last = prefix.charCodeAt(prefix.length - 1);
  return prefix.slice(0, -1) + String.fromCharCode(last + 1);
}

export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  const q = (new URL(req.url).searchParams.get('q') || '').trim().toLowerCase();
  // Need at least one char; don't suggest for wallet-shaped input.
  if (!q || /^0x/.test(q)) return json({ users: [] });
  if (!isFirestoreConfigured()) return json({ users: [] });

  try {
    const db = getAdminFirestore();
    const snap = await db.collection(USERS)
      .orderBy('username_lower')
      .startAt(q)
      .endBefore(prefixEnd(q))
      .limit(LIMIT)
      .get();

    const users: UserHit[] = [];
    for (const doc of snap.docs) {
      const data = doc.data() as { username?: string; profilePicture?: string; bananaNumber?: number };
      const wallet = doc.id.toLowerCase();
      const username = (data.username || '').trim();
      // Skip rows with no real username (username defaults to the raw wallet).
      if (!username || username.toLowerCase() === wallet) continue;
      users.push({
        username,
        wallet,
        profilePicture: data.profilePicture || null,
        bananaNumber: typeof data.bananaNumber === 'number' ? data.bananaNumber : null,
      });
    }
    return json({ users });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : 'search_failed', 500);
  }
}
