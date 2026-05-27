/**
 * Friend system — Firestore-backed.
 *
 * Schema:
 *   friendships/{compositeId}
 *     compositeId = `${lowerA}_${lowerB}` where lowerA < lowerB alphabetically.
 *     fields:
 *       users: [walletA, walletB]           // sorted
 *       status: 'pending' | 'accepted'
 *       requestedBy: string                  // wallet that initiated
 *       requestedAt: number                  // epoch ms
 *       acceptedAt?: number
 *
 * One doc per pair — no duplicates in either direction. Lookups use the
 * `users` array via array-contains.
 */

import { getAdminFirestore } from '@/lib/firebaseAdmin';

const COLLECTION = 'friendships';

export type FriendshipStatus = 'pending' | 'accepted';

export interface Friendship {
  id: string;
  users: [string, string]; // sorted lowercase wallets
  status: FriendshipStatus;
  requestedBy: string;
  requestedAt: number;
  acceptedAt?: number;
}

export interface PublicUser {
  walletAddress: string;
  username: string;
  profilePicture?: string;
  /** The badge id the user has equipped, if any. Drives the badge overlay
   *  on avatars across messages / friends / DMs (matches the draft room). */
  equippedBadge?: string | null;
}

export function friendshipId(walletA: string, walletB: string): string {
  const a = walletA.toLowerCase();
  const b = walletB.toLowerCase();
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

function docRef(walletA: string, walletB: string) {
  return getAdminFirestore().collection(COLLECTION).doc(friendshipId(walletA, walletB));
}

// ─── Reads ─────────────────────────────────────────────────────────────────

export async function getFriendship(walletA: string, walletB: string): Promise<Friendship | null> {
  const snap = await docRef(walletA, walletB).get();
  if (!snap.exists) return null;
  const data = snap.data() as Partial<Friendship> | undefined;
  if (!data || !Array.isArray(data.users) || data.users.length !== 2) return null;
  return {
    id: snap.id,
    users: [data.users[0], data.users[1]] as [string, string],
    status: data.status === 'accepted' ? 'accepted' : 'pending',
    requestedBy: String(data.requestedBy ?? ''),
    requestedAt: typeof data.requestedAt === 'number' ? data.requestedAt : 0,
    acceptedAt: typeof data.acceptedAt === 'number' ? data.acceptedAt : undefined,
  };
}

interface FriendListBuckets {
  friends: PublicUser[];
  incoming: PublicUser[]; // pending requests I received
  outgoing: PublicUser[]; // pending requests I sent
}

export async function listForUser(walletAddress: string): Promise<FriendListBuckets> {
  const wallet = walletAddress.toLowerCase();
  const db = getAdminFirestore();
  const snap = await db
    .collection(COLLECTION)
    .where('users', 'array-contains', wallet)
    .get();

  const friendsWallets: string[] = [];
  const incomingWallets: string[] = [];
  const outgoingWallets: string[] = [];

  snap.forEach((doc) => {
    const d = doc.data() as Partial<Friendship>;
    if (!Array.isArray(d.users) || d.users.length !== 2) return;
    const other = d.users[0] === wallet ? d.users[1] : d.users[0];
    if (d.status === 'accepted') friendsWallets.push(other);
    else if (d.status === 'pending') {
      if (d.requestedBy === wallet) outgoingWallets.push(other);
      else incomingWallets.push(other);
    }
  });

  // Resolve display info in parallel.
  const allWallets = [...new Set([...friendsWallets, ...incomingWallets, ...outgoingWallets])];
  const profileMap = await getPublicUsers(allWallets);

  const toPublic = (w: string): PublicUser => profileMap.get(w.toLowerCase()) ?? {
    walletAddress: w,
    username: w.slice(0, 8),
  };

  return {
    friends: friendsWallets.map(toPublic),
    incoming: incomingWallets.map(toPublic),
    outgoing: outgoingWallets.map(toPublic),
  };
}

/**
 * Returns set of accepted friend wallets for a user, lowercased.
 * Used for mutual-friend computation.
 */
export async function getAcceptedFriendWallets(walletAddress: string): Promise<Set<string>> {
  const wallet = walletAddress.toLowerCase();
  const snap = await getAdminFirestore()
    .collection(COLLECTION)
    .where('users', 'array-contains', wallet)
    .where('status', '==', 'accepted')
    .get();
  const out = new Set<string>();
  snap.forEach((doc) => {
    const d = doc.data() as Partial<Friendship>;
    if (!Array.isArray(d.users) || d.users.length !== 2) return;
    const other = d.users[0] === wallet ? d.users[1] : d.users[0];
    out.add(other.toLowerCase());
  });
  return out;
}

export async function getMutualFriends(walletA: string, walletB: string): Promise<PublicUser[]> {
  const [aFriends, bFriends] = await Promise.all([
    getAcceptedFriendWallets(walletA),
    getAcceptedFriendWallets(walletB),
  ]);
  const mutual: string[] = [];
  for (const w of aFriends) if (bFriends.has(w)) mutual.push(w);
  const profileMap = await getPublicUsers(mutual);
  return mutual.map((w) => profileMap.get(w) ?? { walletAddress: w, username: w.slice(0, 8) });
}

// ─── Writes ────────────────────────────────────────────────────────────────

/**
 * Send a friend request. If a doc already exists:
 *  - status accepted → no-op (already friends)
 *  - status pending, requestedBy === sender → no-op (already sent)
 *  - status pending, requestedBy === recipient → ACCEPT (their request + my reciprocal = mutual yes)
 */
export async function sendRequest(senderWallet: string, targetWallet: string): Promise<Friendship> {
  const sender = senderWallet.toLowerCase();
  const target = targetWallet.toLowerCase();
  if (sender === target) throw new Error('cannot friend self');

  const id = friendshipId(sender, target);
  const ref = getAdminFirestore().collection(COLLECTION).doc(id);

  const existing = await ref.get();
  if (existing.exists) {
    const data = existing.data() as Partial<Friendship>;
    if (data.status === 'accepted') return (await getFriendship(sender, target))!;
    if (data.status === 'pending' && data.requestedBy === sender) {
      return (await getFriendship(sender, target))!;
    }
    // Their pending request + my send = mutual → auto-accept.
    if (data.status === 'pending' && data.requestedBy === target) {
      await ref.update({ status: 'accepted', acceptedAt: Date.now() });
      return (await getFriendship(sender, target))!;
    }
  }

  const users = sender < target ? [sender, target] : [target, sender];
  const doc: Omit<Friendship, 'id'> = {
    users: users as [string, string],
    status: 'pending',
    requestedBy: sender,
    requestedAt: Date.now(),
  };
  await ref.set(doc);
  return { id, ...doc };
}

export async function acceptRequest(acceptorWallet: string, otherWallet: string): Promise<Friendship | null> {
  const acceptor = acceptorWallet.toLowerCase();
  const other = otherWallet.toLowerCase();
  const ref = docRef(acceptor, other);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() as Partial<Friendship>;
  if (data.status !== 'pending') return getFriendship(acceptor, other);
  // Only the recipient can accept — not the original sender.
  if (data.requestedBy === acceptor) {
    throw new Error('only the recipient can accept');
  }
  await ref.update({ status: 'accepted', acceptedAt: Date.now() });
  return getFriendship(acceptor, other);
}

export async function rejectOrRemove(myWallet: string, otherWallet: string): Promise<void> {
  // Same operation either way — delete the doc. Friends: unfriend. Pending: reject/cancel.
  await docRef(myWallet, otherWallet).delete();
}

// ─── User profile resolution ───────────────────────────────────────────────

const STAGING_DRAFTS_API_URL = 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';

function getServerDraftsApiUrl(): string {
  return (process.env.STAGING_DRAFTS_API_URL || STAGING_DRAFTS_API_URL).replace(/\/$/, '');
}

interface GoApiOwnerPfp {
  displayName?: string;
  imageUrl?: string;
}

/**
 * Pull a display name from the Go API's `owners/{wallet}.pfp.displayName`
 * for wallets that don't have a username in v2_users. Many legacy wallets
 * only ever set their name in the old draft frontend, so v2_users misses
 * them entirely. Mirrors what /api/users/display-batch does for the draft
 * room. Returns null on miss or error — caller falls back to wallet slice.
 */
async function fetchGoApiOwnerPfp(wallet: string): Promise<GoApiOwnerPfp | null> {
  try {
    const res = await fetch(`${getServerDraftsApiUrl()}/owner/${wallet}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { pfp?: GoApiOwnerPfp };
    return body.pfp ?? null;
  } catch {
    return null;
  }
}

/**
 * Batch-load public profile info for a list of wallets. Keys returned in the
 * Map are lowercased wallet addresses.
 *
 * Resolution order per wallet:
 *  1. Firestore v2_users.username + profilePicture (authoritative for users
 *     who've set a name in banana-fantasy).
 *  2. Go API /owner/{wallet}.pfp.displayName + imageUrl (legacy users who
 *     only ever set a name in the old draft frontend — without this, every
 *     incoming friend request from a legacy wallet shows as "0xabc1...").
 *  3. Wallet slice as last resort.
 *
 * Also lazily backfills v2_users.username_lower for case-insensitive search.
 */
export async function getPublicUsers(wallets: string[]): Promise<Map<string, PublicUser>> {
  const out = new Map<string, PublicUser>();
  if (wallets.length === 0) return out;
  const db = getAdminFirestore();
  // Firestore allows up to 10 docs per `in` query; we use direct doc reads
  // since wallet === userId at v2_users.
  const refs = wallets.map((w) => db.collection('v2_users').doc(w.toLowerCase()));
  const snaps = await db.getAll(...refs);
  const backfills: Array<Promise<unknown>> = [];
  const needsGoApi: string[] = [];

  for (let i = 0; i < snaps.length; i++) {
    const snap = snaps[i];
    const wallet = wallets[i].toLowerCase();
    const data = snap.exists ? (snap.data() as { walletAddress?: string; username?: string; username_lower?: string; profilePicture?: string; equippedBadge?: string | null } | undefined) : undefined;
    if (data) {
      const w = (data.walletAddress || snap.id).toLowerCase();
      out.set(w, {
        walletAddress: w,
        username: data.username || '',
        profilePicture: data.profilePicture,
        equippedBadge: data.equippedBadge ?? null,
      });
      const expectedLower = data.username ? data.username.toLowerCase() : undefined;
      if (expectedLower && data.username_lower !== expectedLower) {
        backfills.push(snap.ref.set({ username_lower: expectedLower }, { merge: true }).catch(() => {}));
      }
    }
    // Anyone with no v2_users doc OR no username OR no pfp gets a Go API
    // fallback lookup so legacy wallets still show real names + avatars.
    const current = out.get(wallet);
    if (!current?.username || !current?.profilePicture) {
      needsGoApi.push(wallet);
    }
  }

  if (needsGoApi.length > 0) {
    const results = await Promise.all(needsGoApi.map(async (w) => [w, await fetchGoApiOwnerPfp(w)] as const));
    for (const [w, pfp] of results) {
      const existing = out.get(w);
      const dn = pfp?.displayName?.trim();
      const goName = dn && dn.toLowerCase() !== w ? dn : undefined;
      out.set(w, {
        walletAddress: w,
        username: existing?.username || goName || w.slice(0, 8),
        profilePicture: existing?.profilePicture || pfp?.imageUrl,
        equippedBadge: existing?.equippedBadge ?? null,
      });
    }
  }

  // Final pass: anyone still missing a username (no v2 doc, no Go API hit)
  // falls back to the wallet slice so the UI never shows empty.
  for (const w of wallets) {
    const lw = w.toLowerCase();
    if (!out.has(lw)) {
      out.set(lw, { walletAddress: lw, username: lw.slice(0, 8) });
    } else {
      const cur = out.get(lw)!;
      if (!cur.username) out.set(lw, { ...cur, username: lw.slice(0, 8) });
    }
  }
  // Don't await — page renders don't need to block on the backfill write.
  if (backfills.length > 0) void Promise.all(backfills);
  return out;
}

/**
 * Search users by username prefix (case-tolerant) OR exact wallet address.
 * Returns up to `limit` matches. Excludes the requesting wallet from results.
 *
 * Username prefix search uses Firestore's `>= q AND < q + ''` range
 * trick. Firestore is case-sensitive on string ranges and we don't keep a
 * denormalized lowercase field yet, so we run the range against a few
 * common casings of the query (as-typed, lowercase, Title Case, UPPER) and
 * merge — that covers "banana" finding "Banana #1234", "BananaKid", etc.
 */
export async function searchUsers(query: string, requesterWallet: string, limit = 10): Promise<PublicUser[]> {
  const q = query.trim();
  if (!q) return [];
  const requester = requesterWallet.toLowerCase();
  const db = getAdminFirestore();
  const out: PublicUser[] = [];

  // Wallet-shaped query → direct lookup.
  if (/^0x[a-f0-9]{40}$/i.test(q)) {
    const lower = q.toLowerCase();
    if (lower === requester) return [];
    const snap = await db.collection('v2_users').doc(lower).get();
    if (snap.exists) {
      const d = snap.data() as { walletAddress?: string; username?: string; profilePicture?: string } | undefined;
      if (d) out.push({
        walletAddress: lower,
        username: d.username || lower.slice(0, 8),
        profilePicture: d.profilePicture,
      });
    }
    return out;
  }

  // Fallback case variants for docs without username_lower yet.
  const titleCase = q.length > 0 ? q[0].toUpperCase() + q.slice(1).toLowerCase() : q;
  const prefixes = Array.from(new Set([q, q.toLowerCase(), q.toUpperCase(), titleCase]));
  const qLower = q.toLowerCase();

  //  is the highest Unicode private-use char — used as an upper bound
  // sentinel to express "anything starting with this prefix".
  const HIGH_SENTINEL = '';

  const seen = new Set<string>();
  const pushDoc = (doc: FirebaseFirestore.QueryDocumentSnapshot) => {
    const d = doc.data() as { walletAddress?: string; username?: string; profilePicture?: string };
    const wallet = (d.walletAddress || doc.id).toLowerCase();
    if (wallet === requester || seen.has(wallet)) return;
    seen.add(wallet);
    out.push({
      walletAddress: wallet,
      username: d.username || wallet.slice(0, 8),
      profilePicture: d.profilePicture,
    });
  };

  // Primary: prefix range on username_lower (truly case-insensitive once
  // the field is backfilled across all docs).
  const primary = db.collection('v2_users')
    .where('username_lower', '>=', qLower)
    .where('username_lower', '<', qLower + HIGH_SENTINEL)
    .limit(limit)
    .get();

  // Fallback: range on raw username across common casings, for docs that
  // haven't been backfilled with username_lower yet.
  const fallback = Promise.all(prefixes.map((prefix) =>
    db.collection('v2_users')
      .where('username', '>=', prefix)
      .where('username', '<', prefix + HIGH_SENTINEL)
      .limit(limit)
      .get()
  ));

  const [primarySnap, fallbackSnaps] = await Promise.all([primary, fallback]);
  primarySnap.forEach(pushDoc);
  fallbackSnaps.forEach((s) => s.forEach(pushDoc));

  // Stable order: shortest username first (best prefix matches), then alpha.
  out.sort((a, b) => a.username.length - b.username.length || a.username.localeCompare(b.username));
  return out.slice(0, limit);
}
