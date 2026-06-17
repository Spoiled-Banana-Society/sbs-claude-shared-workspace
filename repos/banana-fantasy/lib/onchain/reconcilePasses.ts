import { BBB4_CONTRACT_ADDRESS } from '@/lib/contracts/bbb4';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { listFreeOriginTokenIds } from '@/lib/onchain/passOrigin';
import { canonTokenId } from '@/lib/onchain/contractSupply';
import { recountFromInventory } from '@/lib/passLedger';
import { logger } from '@/lib/logger';
import { draftsApiServer } from '@/lib/draftsApiServer';

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
 * Reads Go API's current view of a wallet's passes: the on-chain token ids it
 * has recorded as `available` (unused, mintable for draft entry).
 */
export async function fetchGoApiAvailableTokenIds(wallet: string): Promise<string[]> {
  const lists = await fetchGoApiTokenLists(wallet);
  return lists.available.map((r) => r.onchainId).filter(Boolean);
}

/** A Go draft-token reference: its Firestore doc key (`cardId`) plus the decoded
 *  on-chain BBB4 token id (`realTokenId`, or the bare/staging-encoded cardId). */
export interface GoTokenRef { cardId: string; onchainId: string }

/** Decode the on-chain BBB4 token id from a Go record. `realTokenId` when set;
 *  else the cardId is the bare id (<=7 digits) or `<10-digit-secs><tokenId>`. */
function decodeGoOnchainId(cardId: string, realTokenId: string): string {
  const rt = String(realTokenId ?? '').trim();
  if (/^\d+$/.test(rt)) return canonTokenId(rt) ?? '';
  const c = String(cardId ?? '').trim();
  if (/^\d{1,7}$/.test(c)) return canonTokenId(c) ?? '';
  // slice(10) can yield a LEADING-ZERO id — canonicalize so it matches "43".
  if (/^\d{10}\d{1,7}$/.test(c)) return canonTokenId(c.slice(10)) ?? '';
  return '';
}

/**
 * Reads Go API's full per-wallet token state: `available` (unused) and `active`
 * (drafted). Each entry carries its `cardId` (Firestore doc key) AND its decoded
 * on-chain id — so the reconciler compares against on-chain ownership by the
 * on-chain id, NOT the cardId (which diverges for staging/synthetic records).
 */
export async function fetchGoApiTokenLists(
  wallet: string,
): Promise<{ available: GoTokenRef[]; active: GoTokenRef[] }> {
  const apiBase = getServerDraftsApiUrl();
  if (!apiBase) return { available: [], active: [] };
  const res = await fetch(`${apiBase}/owner/${wallet.toLowerCase()}/draftToken/all`);
  if (!res.ok) {
    logger.warn('reconcile.go_api_fetch_failed', { wallet, status: res.status });
    return { available: [], active: [] };
  }
  type GoRow = { _cardId?: string; CardId?: string; realTokenId?: string | number };
  const body = (await res.json()) as { available?: GoRow[]; active?: GoRow[] };
  const extract = (arr: GoRow[] | undefined): GoTokenRef[] =>
    (arr ?? [])
      .map((t) => {
        const cardId = String(t._cardId ?? t.CardId ?? '').trim();
        return { cardId, onchainId: decodeGoOnchainId(cardId, String(t.realTokenId ?? '')) };
      })
      .filter((r) => /^\d+$/.test(r.cardId));
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
import { tryGetServerDraftsApiUrl } from '@/lib/serverDraftsApiUrl';

/**
 * Returns the Go API's authoritative count of available draft passes for a
 * wallet, or `null` if the Go API is unreachable / unconfigured. Used by the
 * balance endpoints so the user-facing pass count comes from the same source
 * of truth that `getOwnerDraftTokens` uses on the client. A 200 with zero
 * available tokens returns 0 (not null) — a wallet legitimately has no passes.
 */
export async function fetchGoApiAvailableCount(wallet: string): Promise<number | null> {
  const apiBase = tryGetServerDraftsApiUrl();
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
async function registerTokensWithGoApi(wallet: string, tokenIds: number[], passType: 'paid' | 'free'): Promise<number> {
  if (tokenIds.length === 0) return 0;
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
  const normalizedWallet = wallet.toLowerCase();
  for (const [minId, maxId] of ranges) {
    try {
      const res = await draftsApiServer(`/owner/${normalizedWallet}/draftToken/mint`, {
        method: 'POST',
        wallet: normalizedWallet,
        body: { minId, maxId, passType },
      });
      if (res.ok) {
        registered += maxId - minId + 1;
      } else {
        // With the engine's collision-proof registration, a 2xx is now the
        // expected result even when the on-chain id was already taken (it gets
        // re-homed under a synthetic id). So a non-2xx here is a REAL failure,
        // not "already exists, fine" — surface it loudly. The caller recounts
        // from real inventory afterwards, so a miss shows up as a lower count
        // rather than a phantom pass.
        const text = await res.text().catch(() => '');
        logger.warn('reconcile.register_range_failed', {
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
 * Registers freshly-minted token ids into the Go API immediately at mint time,
 * stamped with their known passType — WITHOUT waiting for the Alchemy webhook
 * or a full reconcile. This is the guaranteed path: every mint call site
 * (staging-mint, card/MoonPay purchase, MetaMask purchase, wheel spin, admin
 * grant) knows the exact token ids and their type the moment it mints, so it
 * calls this directly. The Alchemy Transfer webhook remains a backstop (and the
 * only thing that catches secondary-market transfers), but entry never has to
 * wait on it.
 *
 * Does NOT touch the user's counter — each mint path owns its own
 * draftPasses/freeDrafts increment, so there's no Alchemy-indexing-lag race
 * (this only POSTs token ids to the Go API; it never reads on-chain balance).
 * Best-effort: callers should not let a failure here roll back a successful
 * on-chain mint. Already-registered ids are skipped by the Go API.
 */
export async function registerMintedTokens(
  wallet: string,
  tokenIds: Array<string | number>,
  passType: 'paid' | 'free',
): Promise<number> {
  const numeric = tokenIds
    .map((id) => (typeof id === 'number' ? id : Number.parseInt(String(id), 10)))
    .filter((n) => Number.isFinite(n));
  if (numeric.length === 0) return 0;
  const registered = await registerTokensWithGoApi(wallet.toLowerCase(), numeric, passType);

  // Make the fresh pass show up LIVE on OpenSea + our marketplace: seed its grey
  // draft-pass metadata doc, then ask OpenSea to (re)pull. Covers EVERY mint
  // path (USDC, card/MoonPay, promo grants, wheel spins) since they all funnel
  // through here. Best-effort + fire-and-forget — never blocks/rolls back a mint.
  void (async () => {
    try {
      const [{ writeDraftPassMetadata }, { refreshOpenSeaTokens }] = await Promise.all([
        import('@/lib/nftCardServer'),
        import('@/lib/opensea'),
      ]);
      await writeDraftPassMetadata(numeric);
      const refreshed = await refreshOpenSeaTokens(numeric);
      logger.info('nft.mint_pass_metadata_refreshed', { wallet, passType, count: numeric.length, refreshed });
    } catch (err) {
      logger.warn('reconcile.mint_metadata_refresh_failed', { wallet, err: (err as Error).message });
    }
  })();

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

  // 2. Go API's view: available (unused) + active (drafted), each with its
  //    DECODED on-chain id so we compare like-for-like with on-chain ownership.
  const { available: goAvailable, active: goActive } = await fetchGoApiTokenLists(w);
  // On-chain ids Go already knows under ANY cardId scheme, in EITHER pool. A
  // token Go records (incl. drafted teams the wallet still holds on-chain) must
  // never look "missing" just because its cardId != its on-chain id.
  const knownToGo = new Set([...goAvailable, ...goActive].map((r) => r.onchainId).filter(Boolean));

  // 3. Diff against on-chain reality, BY ON-CHAIN ID (not cardId).
  //    - missingFromGo: owned on-chain but Go has no record in either pool → backfill.
  //    - staleInGo: an AVAILABLE record whose on-chain id the wallet no longer
  //      owns → transferred out. DELETE BY cardId (the doc key), so a legit
  //      synthetic-cardId pass whose on-chain id IS owned is never wrongly cut.
  const missingFromGo = ownedNumericIds.filter((n) => !knownToGo.has(String(n)));
  const staleInGo = goAvailable
    .filter((r) => r.onchainId && !ownedSet.has(r.onchainId))
    .map((r) => r.cardId);

  // 4. Repair each side. Stamp each newly-registered token with its real
  //    passType: a token with a pass_origin doc (wheel/admin grant) is FREE,
  //    everything else is a PAID purchase. This is the source of truth the
  //    backend uses to honor the user's free/paid choice at entry and to keep
  //    free drafts out of promos.
  const freeOriginSet = new Set((await listFreeOriginTokenIds(w)).map((id) => String(id)));
  const freeMissing = missingFromGo.filter((n) => freeOriginSet.has(String(n)));
  const paidMissing = missingFromGo.filter((n) => !freeOriginSet.has(String(n)));
  const registered =
    (await registerTokensWithGoApi(w, paidMissing, 'paid')) +
    (await registerTokensWithGoApi(w, freeMissing, 'free'));
  const removed = await removeTransferredOutFromGoApi(w, staleInGo);

  // 5. Write the counter as a MIRROR of real spendable inventory — not from
  //    on-chain math. After the register/remove steps above, the engine's
  //    `validDraftTokens` holds exactly the tokens this wallet can spend, split
  //    by paid/free. Counting it (and writing draftPasses/freeDrafts to that
  //    count) means the user-facing number can never exceed tokens that
  //    actually exist. recountFromInventory also stamps passesSyncedAt.
  const { draftPasses: afterCounter, freeDrafts: afterFree } = await recountFromInventory(w);
  await userRef.set({ onchainSyncedAt: FieldValue.serverTimestamp() }, { merge: true });

  logger.info('reconcile.done', {
    wallet: w,
    before: beforeCounter,
    after: afterCounter,
    freeAfter: afterFree,
    onchainOwned: ownedNumericIds.length,
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
