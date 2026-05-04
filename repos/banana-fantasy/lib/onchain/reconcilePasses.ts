import { BBB4_CONTRACT_ADDRESS } from '@/lib/contracts/bbb4';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

const USERS_COLLECTION = 'v2_users';

export interface ReconcileResult {
  wallet: string;
  beforeCounter: number;
  afterCounter: number;
  onChainCount: number;
  ownedTokenIds: string[];
  registeredWithGoApi: number; // how many we had to backfill into Go API
  removedFromGoApi: number;    // how many stale ones we had to remove
  note?: string;
}

/**
 * Builds the Alchemy NFT API URL for Base from the RPC URL env var.
 * The RPC URL looks like https://base-mainnet.g.alchemy.com/v2/{KEY};
 * the NFT API needs /nft/v3/{KEY} — same key, different path prefix.
 */
function alchemyNftBase(): string | null {
  const rpc = (process.env.NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL ?? '').trim();
  if (!rpc) return null;
  const m = rpc.match(/^(https?:\/\/[^/]+)\/v2\/([^/?#]+)/);
  if (!m) return null;
  const [, host, key] = m;
  return `${host}/nft/v3/${key}`;
}

interface AlchemyNftsResponse {
  ownedNfts: Array<{ tokenId?: string; contract?: { address?: string } }>;
  totalCount?: number;
  pageKey?: string;
}

/**
 * Authoritative owned-token lookup via Alchemy NFT API. One HTTP call, no
 * iteration through contract reads. Source of truth for reconciliation.
 */
async function fetchOwnedBbb4TokenIds(wallet: string): Promise<string[]> {
  const base = alchemyNftBase();
  if (!base) throw new Error('Alchemy NFT API URL not configured');

  const owned: string[] = [];
  let pageKey: string | undefined;
  // Paginate just in case a wallet owns many — usually one call is enough.
  for (let i = 0; i < 10; i++) {
    const params = new URLSearchParams({
      owner: wallet,
      withMetadata: 'false',
    });
    params.append('contractAddresses[]', BBB4_CONTRACT_ADDRESS);
    if (pageKey) params.set('pageKey', pageKey);

    const res = await fetch(`${base}/getNFTsForOwner?${params}`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`Alchemy NFT API ${res.status}: ${await res.text().catch(() => '')}`);
    }
    const body = (await res.json()) as AlchemyNftsResponse;
    for (const nft of body.ownedNfts ?? []) {
      if (nft.tokenId != null) owned.push(String(nft.tokenId));
    }
    if (!body.pageKey) break;
    pageKey = body.pageKey;
  }
  return owned;
}

/**
 * Reads Go API's current view of a wallet's passes: which tokenIds it has
 * recorded as `available` (unused, mintable for draft entry).
 */
export async function fetchGoApiAvailableTokenIds(wallet: string): Promise<string[]> {
  const lists = await fetchGoApiTokenLists(wallet);
  return lists.available;
}

/**
 * Reads Go API's full per-wallet token state: both `available` (unused) and
 * `active` (consumed in a league) cardIds. Used by the reconciler to compute
 * the correct "spendable" count = on-chain owned − active count.
 */
export async function fetchGoApiTokenLists(
  wallet: string,
): Promise<{ available: string[]; active: string[] }> {
  const apiBase = getServerDraftsApiUrl();
  if (!apiBase) return { available: [], active: [] };
  const res = await fetch(`${apiBase}/owner/${wallet.toLowerCase()}/draftToken/all`);
  if (!res.ok) {
    logger.warn('reconcile.go_api_fetch_failed', { wallet, status: res.status });
    return { available: [], active: [] };
  }
  const body = (await res.json()) as {
    available?: Array<{ _cardId?: string; CardId?: string }>;
    active?: Array<{ _cardId?: string; CardId?: string }>;
  };
  const extract = (arr: Array<{ _cardId?: string; CardId?: string }> | undefined) =>
    (arr ?? [])
      .map((t) => t._cardId ?? t.CardId ?? '')
      .filter((id) => /^\d+$/.test(id));
  return {
    available: extract(body.available),
    active: extract(body.active),
  };
}

/**
 * Resolve the Go API base URL for server-side use.
 *
 * The client-side `getDraftsApiUrl()` uses `isStagingMode()` to swap between
 * staging and prod, but that check requires `window` and silently returns the
 * prod URL in server contexts (Next.js API routes, SSR). This codebase is
 * staging-only per CLAUDE.md, so we explicitly prefer the staging URL.
 */
function getServerDraftsApiUrl(): string {
  const staging = (process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL ?? '').trim();
  if (staging) return staging;
  return (process.env.NEXT_PUBLIC_DRAFTS_API_URL ?? '').trim();
}

/**
 * Returns the Go API's authoritative count of available draft passes for a
 * wallet, or `null` if the Go API is unreachable / unconfigured. Used by the
 * balance endpoints so the user-facing pass count comes from the same source
 * of truth that `getOwnerDraftTokens` uses on the client. A 200 with zero
 * available tokens returns 0 (not null) — a wallet legitimately has no passes.
 */
export async function fetchGoApiAvailableCount(wallet: string): Promise<number | null> {
  const apiBase = getServerDraftsApiUrl();
  if (!apiBase) return null;
  try {
    const res = await fetch(`${apiBase}/owner/${wallet.toLowerCase()}/draftToken/all`);
    if (!res.ok) {
      logger.warn('balance.go_api_count_fetch_failed', { wallet, status: res.status });
      return null;
    }
    const body = (await res.json()) as { available?: unknown[] };
    return Array.isArray(body.available) ? body.available.length : 0;
  } catch (err) {
    logger.warn('balance.go_api_count_error', { wallet, err: (err as Error).message });
    return null;
  }
}

/**
 * Calls Go API /draftToken/mint to register on-chain tokens that aren't yet
 * in `owners/{wallet}/validDraftTokens`. Backfill for new mints or for
 * wallets that existed before we started recording token ids server-side.
 */
async function registerTokensWithGoApi(wallet: string, tokenIds: number[]): Promise<number> {
  if (tokenIds.length === 0) return 0;
  const apiBase = getServerDraftsApiUrl();
  if (!apiBase) return 0;
  // Go endpoint takes a minId/maxId range. For non-contiguous ids we call
  // once per id. BBB4 mint is sequential so contiguous is the common case.
  let registered = 0;
  tokenIds.sort((a, b) => a - b);
  let runStart = tokenIds[0];
  let runEnd = tokenIds[0];
  const ranges: Array<[number, number]> = [];
  for (let i = 1; i < tokenIds.length; i++) {
    if (tokenIds[i] === runEnd + 1) {
      runEnd = tokenIds[i];
    } else {
      ranges.push([runStart, runEnd]);
      runStart = tokenIds[i];
      runEnd = tokenIds[i];
    }
  }
  ranges.push([runStart, runEnd]);
  for (const [minId, maxId] of ranges) {
    try {
      const res = await fetch(`${apiBase}/owner/${wallet.toLowerCase()}/draftToken/mint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minId, maxId }),
      });
      if (res.ok) {
        registered += maxId - minId + 1;
      } else {
        // Go returns 500 when a token already exists — that's fine here.
        const text = await res.text().catch(() => '');
        logger.info('reconcile.register_range_skip_or_fail', {
          wallet,
          minId,
          maxId,
          status: res.status,
          body: text.slice(0, 200),
        });
      }
    } catch (err) {
      logger.warn('reconcile.register_range_error', { wallet, minId, maxId, err: (err as Error).message });
    }
  }
  return registered;
}

/**
 * Removes tokenIds from `owners/{wallet}/validDraftTokens` that the wallet
 * no longer owns on-chain (transferred out, sold on marketplace, etc.).
 */
async function removeTransferredOutFromGoApi(wallet: string, tokenIds: string[]): Promise<number> {
  if (tokenIds.length === 0) return 0;
  const db = getAdminFirestore();
  const col = db.collection(`owners/${wallet.toLowerCase()}/validDraftTokens`);
  const batch = db.batch();
  for (const id of tokenIds) batch.delete(col.doc(id));
  try {
    await batch.commit();
    return tokenIds.length;
  } catch (err) {
    logger.warn('reconcile.remove_stale_failed', { wallet, err: (err as Error).message });
    return 0;
  }
}

/**
 * Aligns Firestore + Go API to what BBB4 says on-chain.
 *
 * Computes Firestore `draftPasses` as **on-chain owned − Go API active**
 * (not raw on-chain owned). BBB4 doesn't burn NFTs on use, so the raw
 * `balanceOf` includes consumed tokens — using it here would silently undo
 * every legitimate decrement from a draft entry.
 *
 * Source of truth: Alchemy NFT API `getNFTsForOwner(wallet, BBB4)` paired
 * with the Go API's per-wallet `active` list.
 *
 * Called from: explicit admin reconcile endpoint, and the Alchemy Transfer
 * webhook on real BBB4 transfers in/out. Not called from balance-read
 * paths.
 */
export async function reconcilePassesForWallet(wallet: string): Promise<ReconcileResult> {
  const w = wallet.toLowerCase();
  const db = getAdminFirestore();
  const userRef = db.collection(USERS_COLLECTION).doc(w);
  const snap = await userRef.get();
  const beforeCounter = (snap.data()?.draftPasses as number | undefined) ?? 0;

  // 1. Authoritative on-chain owned tokens.
  const ownedNumericIds = (await fetchOwnedBbb4TokenIds(w))
    .map((id) => Number.parseInt(id, 10))
    .filter((n) => Number.isFinite(n));
  const ownedSet = new Set(ownedNumericIds.map((n) => String(n)));

  // 2. Go API's view: which tokens are available vs active.
  const { available: goApiAvailable, active: goApiActive } = await fetchGoApiTokenLists(w);
  const goApiSet = new Set(goApiAvailable);

  // 3. Diff against on-chain reality.
  //    - missingFromGo: on-chain tokens the Go API doesn't know about (yet
  //      to be backfilled).
  //    - staleInGo: Go-API-available tokens the wallet no longer owns
  //      on-chain (transferred out, sold) — these should be removed.
  const missingFromGo = ownedNumericIds.filter((n) => !goApiSet.has(String(n)));
  const staleInGo = goApiAvailable.filter((id) => !ownedSet.has(id));

  // 4. Repair each side.
  const registered = await registerTokensWithGoApi(w, missingFromGo);
  const removed = await removeTransferredOutFromGoApi(w, staleInGo);

  // 5. Compute the spendable count and write Firestore.
  //    spendable = on-chain owned tokens that aren't already consumed in a
  //    league. The Go API's `active` list is the authoritative record of
  //    consumption.
  const activeOnChain = goApiActive.filter((id) => ownedSet.has(id)).length;
  const afterCounter = Math.max(0, ownedNumericIds.length - activeOnChain);

  await userRef.set(
    { draftPasses: afterCounter, onchainSyncedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );

  logger.info('reconcile.done', {
    wallet: w,
    before: beforeCounter,
    after: afterCounter,
    onchainOwned: ownedNumericIds.length,
    activeInLeagues: activeOnChain,
    registered,
    removed,
  });

  return {
    wallet: w,
    beforeCounter,
    afterCounter,
    onChainCount: ownedNumericIds.length,
    ownedTokenIds: ownedNumericIds.map(String),
    registeredWithGoApi: registered,
    removedFromGoApi: removed,
  };
}
