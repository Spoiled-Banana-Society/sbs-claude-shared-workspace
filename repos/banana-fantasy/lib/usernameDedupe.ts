/**
 * One-time migration: make all existing usernames unique.
 *
 * Before unique-username enforcement shipped, multiple accounts could share a
 * name (e.g. several "BananaKing99"). This walks v2_users, finds case-insensitive
 * collisions, keeps one owner per name (the earliest-created, else lowest
 * wallet — deterministic), and renames every other owner to their on-brand
 * "Banana #1234567" default (suffixed if that itself collides). It also seeds
 * the `usernames/{lower}` reservation collection for every named account so the
 * runtime uniqueness gate (lib/usernames.ts) has an authoritative source.
 *
 * Idempotent: a second run finds no collisions and just re-seeds reservations.
 * Pass apply=false (default) for a dry-run plan that writes nothing.
 *
 * NOTE: updates Firestore only (v2_users + reservations). The Go backend's
 * owner displayName is NOT rewritten here — getPublicUsers treats v2_users as
 * authoritative, so the deduped name is what shows. If you also want the Go
 * store cleaned, run a backend pass.
 */

import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { bananaDefaultName } from '@/utils/helpers';

const USERS = 'v2_users';
const RESERVATIONS = 'usernames';
const BATCH_SIZE = 400; // Firestore caps at 500 writes per batch.

/** A real, user-chosen name — not empty, a placeholder, or a wallet form. */
function isRealName(name: string | undefined, wallet: string): boolean {
  const t = (name || '').trim();
  if (!t) return false;
  if (/^user-0x[0-9a-fA-F]/i.test(t)) return false; // seeded `User-0x…` placeholder
  if (/^0x[0-9a-fA-F]{4,}/.test(t)) return false;
  if (t.toLowerCase() === wallet.toLowerCase()) return false;
  if (['testname', 'testuser', 'test'].includes(t.toLowerCase())) return false;
  return true;
}

export interface DedupeResult {
  apply: boolean;
  scanned: number;          // total v2_users docs
  named: number;            // docs with a real username
  collidingNames: number;   // names held by more than one account
  renamed: number;          // accounts renamed
  reservationsWritten: number;
  /** First 200 planned/applied renames, for review. */
  renames: Array<{ wallet: string; from: string; to: string }>;
  timestamp: number;
}

export async function dedupeUsernames(apply: boolean, now: number): Promise<DedupeResult> {
  const db = getAdminFirestore();
  const snap = await db.collection(USERS).get();

  type Rec = { wallet: string; name: string; createdAt: number };
  const byLower = new Map<string, Rec[]>();
  let scanned = 0;
  let named = 0;

  for (const doc of snap.docs) {
    scanned++;
    const d = doc.data() as { walletAddress?: string; username?: string; createdAt?: number } | undefined;
    const wallet = (d?.walletAddress || doc.id).toLowerCase();
    if (!isRealName(d?.username, wallet)) continue;
    named++;
    const name = (d!.username as string).trim();
    const createdAt = typeof d?.createdAt === 'number' ? d!.createdAt : Number.MAX_SAFE_INTEGER;
    const arr = byLower.get(name.toLowerCase()) ?? [];
    arr.push({ wallet, name, createdAt });
    byLower.set(name.toLowerCase(), arr);
  }

  // Every current name starts out "taken"; new names must avoid the whole set.
  const taken = new Set<string>(byLower.keys());
  const finalName = new Map<string, { name: string; lower: string }>();
  const renamedWallets = new Set<string>();
  const renames: Array<{ wallet: string; from: string; to: string }> = [];
  let collidingNames = 0;

  for (const [lower, recs] of byLower) {
    recs.sort((a, b) => a.createdAt - b.createdAt || (a.wallet < b.wallet ? -1 : 1));
    const keeper = recs[0];
    finalName.set(keeper.wallet, { name: keeper.name, lower });
    if (recs.length === 1) continue;
    collidingNames++;
    for (let i = 1; i < recs.length; i++) {
      const loser = recs[i];
      let candidate = bananaDefaultName(loser.wallet);
      let cl = candidate.toLowerCase();
      let n = 2;
      while (taken.has(cl)) { candidate = `${bananaDefaultName(loser.wallet)} (${n++})`; cl = candidate.toLowerCase(); }
      taken.add(cl);
      finalName.set(loser.wallet, { name: candidate, lower: cl });
      renamedWallets.add(loser.wallet);
      renames.push({ wallet: loser.wallet, from: loser.name, to: candidate });
    }
  }

  let reservationsWritten = 0;

  if (apply) {
    let batch = db.batch();
    let inBatch = 0;
    const commits: Array<Promise<unknown>> = [];
    const maybeFlush = () => {
      if (inBatch >= BATCH_SIZE) { commits.push(batch.commit()); batch = db.batch(); inBatch = 0; }
    };

    for (const [wallet, fin] of finalName) {
      // Seed the reservation for every named account.
      batch.set(db.collection(RESERVATIONS).doc(fin.lower), { walletAddress: wallet, name: fin.name, updatedAt: now });
      reservationsWritten++; inBatch++; maybeFlush();
      // Only rewrite v2_users for accounts we actually renamed.
      if (renamedWallets.has(wallet)) {
        batch.set(db.collection(USERS).doc(wallet), { username: fin.name, username_lower: fin.lower }, { merge: true });
        inBatch++; maybeFlush();
      }
    }
    if (inBatch > 0) commits.push(batch.commit());
    await Promise.all(commits);
  }

  return {
    apply,
    scanned,
    named,
    collidingNames,
    renamed: renames.length,
    reservationsWritten,
    renames: renames.slice(0, 200),
    timestamp: now,
  };
}
