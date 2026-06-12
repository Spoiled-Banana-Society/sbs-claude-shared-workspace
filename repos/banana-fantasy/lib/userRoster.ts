// Resolved roster of every user who has logged into the new site (every
// wallet-keyed v2_users doc — ensureUserSeeded creates one at first login,
// new and returning users alike). Names + pfps fully resolved via the same
// chain as everywhere else (v2 username → Go legacy name → wallet-derived
// Banana default), so the directory and friend search never show a raw 0x….
//
// Resolution hits the Go API for legacy wallets, so the built roster is
// cached in Firestore for 10 minutes — search and the All Users directory
// read the cache, not 200+ live lookups per request.

import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { getPublicUsers } from '@/lib/friends';

export interface RosterUser {
  walletAddress: string;
  username: string;
  profilePicture?: string | null;
}

// Known test wallets — never shown in the directory (Boris 2026-06-11:
// only real members; his + Richard's ADMIN wallets are pre-stamped, the
// piles of throwaway test wallets are not).
const ROSTER_EXCLUDE = new Set([
  '0xd3301bc039faf4223da98bceb5fb81abc9399362', // Boris old Privy login wallet
  '0xd3301bc039faf4223da98bceb5fb818c9993620',  // corrupted mock dup
  '0xbd2e09c009a7834cd32f9fa8a87073c5b3083f11', // Richard test wallet (r8)
  '0xc0f982492c323fcd314af56d6c1a35cc9b0fc31e', // team test wallet
  '0x27fe00a5a1212e9294b641ba860a383783016c67', // team test wallet
]);

const CACHE_COLLECTION = 'system_cache';
const CACHE_DOC = 'userRoster';
const TTL_MS = 10 * 60_000;

export async function getUserRoster(): Promise<RosterUser[]> {
  const db = getAdminFirestore();
  const cacheRef = db.collection(CACHE_COLLECTION).doc(CACHE_DOC);

  try {
    const snap = await cacheRef.get();
    const cached = snap.exists ? (snap.data() as { builtAt?: number; users?: RosterUser[] }) : null;
    if (cached?.builtAt && Date.now() - cached.builtAt < TTL_MS && Array.isArray(cached.users) && cached.users.length > 0) {
      return cached.users;
    }
  } catch { /* rebuild below */ }

  // Rebuild: ONLY wallets that actually logged into the new product —
  // firstLoginAt is stamped at login (returning-check). Doc existence alone
  // would drag in BBB1-3 imports, referral stubs, and bot wallets that have
  // never touched the site (Boris 2026-06-11). List starts short, grows as
  // people sign in; newest members first.
  const snap = await db.collection('v2_users')
    .orderBy('firstLoginAt', 'desc')
    .limit(2000)
    .get();
  const wallets = snap.docs
    .map((d) => d.id)
    .filter((id) => /^0x[0-9a-f]{40}$/i.test(id))
    .map((id) => id.toLowerCase())
    .filter((w) => !ROSTER_EXCLUDE.has(w));
  const profileMap = await getPublicUsers(wallets);
  const users: RosterUser[] = wallets.map((w) => {
    const p = profileMap.get(w);
    return {
      walletAddress: w,
      username: p?.username || w,
      profilePicture: p?.profilePicture ?? null,
    };
  });

  await cacheRef.set({ builtAt: Date.now(), users }).catch(() => {});
  return users;
}

/** Roster entries matching a name/wallet query (case-insensitive substring). */
export async function searchRoster(query: string, excludeWallet: string, limit = 10): Promise<RosterUser[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const me = excludeWallet.toLowerCase();
  const roster = await getUserRoster();
  return roster
    .filter((u) => u.walletAddress !== me)
    .filter((u) => u.username.toLowerCase().includes(q) || u.walletAddress.startsWith(q))
    .slice(0, limit);
}
