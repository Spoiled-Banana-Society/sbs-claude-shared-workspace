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

  // Rebuild: every wallet-keyed user doc = a user who has logged in here.
  const refs = await db.collection('v2_users').listDocuments();
  const wallets = Array.from(new Set(
    refs.map((r) => r.id).filter((id) => /^0x[0-9a-f]{40}$/i.test(id)).map((id) => id.toLowerCase()),
  ));
  const profileMap = await getPublicUsers(wallets);
  const users: RosterUser[] = wallets
    .map((w) => {
      const p = profileMap.get(w);
      return {
        walletAddress: w,
        username: p?.username || w,
        profilePicture: p?.profilePicture ?? null,
      };
    })
    .sort((a, b) => a.username.localeCompare(b.username));

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
