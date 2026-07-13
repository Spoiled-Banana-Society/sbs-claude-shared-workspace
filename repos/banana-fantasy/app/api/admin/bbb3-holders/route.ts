import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = 'force-dynamic';

import { json, jsonError } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { getReturningWalletAllowlist, BBB3_CONTRACT_ADDRESS } from '@/lib/returningUsers';

const SNAPSHOT_DOC = 'bbb3_holders/_snapshot';
const USERS_COLLECTION = 'v2_users';
const BURN_ADDRESSES = new Set([
  '0x0000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000dead',
]);

interface HolderRow {
  wallet: string;
  hasAccount: boolean;
  username?: string | null;
  banned?: boolean;
  firstPurchaseBonusGranted?: boolean;
  source: 'snapshot' | 'allowlist';
}

/** Alchemy NFT API base for Eth mainnet, derived from the configured key. */
function alchemyEthNftBase(): string | null {
  const explicit = (process.env.ALCHEMY_ETH_RPC_URL ?? '').trim();
  const rpc = explicit || (process.env.NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL ?? '').trim();
  const m = /\/v2\/([^/?#]+)/.exec(rpc);
  if (!m) return null;
  return `https://eth-mainnet.g.alchemy.com/nft/v3/${m[1]}`;
}

async function fetchHoldersFromChain(): Promise<string[]> {
  const base = alchemyEthNftBase();
  if (!base) throw new ApiError(500, 'Alchemy key not configured');
  const owners = new Set<string>();
  let pageKey: string | undefined;
  for (let i = 0; i < 200; i++) {
    const params = new URLSearchParams({ contractAddress: BBB3_CONTRACT_ADDRESS, withTokenBalances: 'false' });
    if (pageKey) params.set('pageKey', pageKey);
    const res = await fetch(`${base}/getOwnersForContract?${params}`, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new ApiError(502, `Alchemy ${res.status}`);
    const body = (await res.json()) as { owners?: string[]; pageKey?: string };
    for (const o of body.owners ?? []) {
      const w = String(o).toLowerCase();
      if (!BURN_ADDRESSES.has(w)) owners.add(w);
    }
    if (!body.pageKey) break;
    pageKey = body.pageKey;
  }
  return [...owners];
}

/** Read the stored snapshot, allowlist, and join against v2_users for detail. */
async function buildResponse() {
  const db = getAdminFirestore();
  const snap = await db.doc(SNAPSHOT_DOC).get();
  const data = snap.exists ? (snap.data() as { wallets?: string[]; count?: number; snapshotAt?: string }) : null;

  const snapshotWallets = (data?.wallets ?? []).map((w) => w.toLowerCase());
  const allowlist = getReturningWalletAllowlist();
  const allWallets = Array.from(new Set([...snapshotWallets, ...allowlist]));

  // Join against v2_users (chunked getAll) so each row shows whether the holder
  // has actually logged in and their account state.
  const detail = new Map<string, { username?: string | null; banned?: boolean; firstPurchaseBonusGranted?: boolean }>();
  const CHUNK = 300;
  for (let i = 0; i < allWallets.length; i += CHUNK) {
    const refs = allWallets.slice(i, i + CHUNK).map((w) => db.collection(USERS_COLLECTION).doc(w));
    const docs = await db.getAll(...refs);
    for (const d of docs) {
      if (!d.exists) continue;
      const u = d.data() as Record<string, unknown>;
      detail.set(d.id.toLowerCase(), {
        username: (u.displayName as string) ?? (u.username as string) ?? null,
        banned: !!u.banned,
        firstPurchaseBonusGranted: !!u.firstPurchaseBonusGranted,
      });
    }
  }

  const allowSet = new Set(allowlist);
  const holders: HolderRow[] = allWallets.map((wallet) => {
    const d = detail.get(wallet);
    return {
      wallet,
      hasAccount: !!d,
      username: d?.username ?? null,
      banned: d?.banned,
      firstPurchaseBonusGranted: d?.firstPurchaseBonusGranted,
      source: snapshotWallets.includes(wallet) ? 'snapshot' : (allowSet.has(wallet) ? 'allowlist' : 'snapshot'),
    };
  });

  const loggedIn = holders.filter((h) => h.hasAccount).length;
  return {
    contract: BBB3_CONTRACT_ADDRESS,
    count: allWallets.length,
    snapshotCount: snapshotWallets.length,
    allowlistCount: allowlist.length,
    loggedIn,
    snapshotAt: data?.snapshotAt ?? null,
    holders,
  };
}

export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;
  try {
    await requireAdmin(req);
    return json(await buildResponse(), 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[admin/bbb3-holders] GET failed:', err);
    return jsonError('Internal Server Error', 500);
  }
}

// Re-run the on-chain snapshot and persist it, then return the joined view.
export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;
  try {
    await requireAdmin(req);
    const wallets = await fetchHoldersFromChain();
    const snapshotAt = new Date().toISOString();
    await getAdminFirestore().doc(SNAPSHOT_DOC).set({
      wallets, count: wallets.length, contract: BBB3_CONTRACT_ADDRESS, snapshotAt,
    });
    return json(await buildResponse(), 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[admin/bbb3-holders] POST failed:', err);
    return jsonError('Internal Server Error', 500);
  }
}
