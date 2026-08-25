/**
 * Linked wallets — two or more wallets that belong to ONE person.
 *
 * Rule (Richard, 2026-08-24): the same person must never hold two seats in the
 * same Jackpot / HOF / JackHOF special draft. The queue placement code
 * (findOpenRound in lib/db-firestore.ts) already refuses to seat one wallet
 * twice in a round; this extends that check to every wallet linked to it, so a
 * person's second wallet is routed to the next open round instead.
 *
 * Groups come from two places, merged:
 *   - LINKED_WALLET_GROUPS below (known pairs, ships with the code)
 *   - Firestore `system_config/linkedWallets` { groups: string[][] } — add new
 *     pairs there without a deploy. Read at most once a minute per instance.
 *
 * Origin: ticket-2661 — couch + Banana69 (same person) both landed in jackpot
 * round 11 (2025-slow-draft-33) on 8/24.
 */
import { getAdminFirestore } from '@/lib/firebaseAdmin';

export const LINKED_WALLET_GROUPS: string[][] = [
  // couch + Banana69 — same person (analytics merge rule since 2026-08-23)
  ['0x466d16ec1724f08aaeec2399816160f0d95d9d4f', '0xa551f64ae2791d0fc6c8cad23c22ac3529dbbd2e'],
];

const CONFIG = { col: 'system_config', doc: 'linkedWallets' } as const;
const TTL_MS = 60_000;

let cache: { at: number; groups: string[][] } | null = null;

async function loadGroups(): Promise<string[][]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.groups;
  let remote: string[][] = [];
  try {
    const snap = await getAdminFirestore().collection(CONFIG.col).doc(CONFIG.doc).get();
    const raw = snap.exists ? (snap.data()?.groups as unknown) : null;
    if (Array.isArray(raw)) {
      remote = raw
        .filter((g): g is unknown[] => Array.isArray(g))
        .map(g => g.filter((w): w is string => typeof w === 'string').map(w => w.toLowerCase()))
        .filter(g => g.length >= 2);
    }
  } catch {
    // Config unreadable — fall back to the shipped list; never block a join.
  }
  const groups = [...LINKED_WALLET_GROUPS.map(g => g.map(w => w.toLowerCase())), ...remote];
  cache = { at: Date.now(), groups };
  return groups;
}

/**
 * Every wallet that is the same person as `wallet` (lowercased, `wallet`
 * itself excluded). Empty array when the wallet isn't linked to anything.
 * Groups are transitive: if A~B and B~C are listed separately, A gets [B, C].
 */
export async function getLinkedWallets(wallet: string): Promise<string[]> {
  const w = wallet.toLowerCase();
  const groups = await loadGroups();
  const out = new Set<string>();
  const stack = [w];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const g of groups) {
      if (!g.includes(cur)) continue;
      for (const x of g) if (!seen.has(x)) stack.push(x);
    }
  }
  seen.delete(w);
  for (const x of seen) out.add(x);
  return [...out];
}

/** Wallets that must not share a special-draft round with `wallet`: itself + linked. */
export async function samePersonWallets(wallet: string): Promise<string[]> {
  const w = wallet.toLowerCase();
  return [w, ...(await getLinkedWallets(w))];
}
