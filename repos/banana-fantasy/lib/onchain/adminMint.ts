import {
  createPublicClient,
  createWalletClient,
  http,
  parseEventLogs,
  parseGwei,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  BASE,
  BASE_RPC_URL,
  BASE_SEPOLIA_USDC_ADDRESS,
  BBB4_ABI,
  BBB4_CONTRACT_ADDRESS,
  USDC_ABI,
  USDC_PERMIT_ABI,
} from '@/lib/contracts/bbb4';
import { ApiError } from '@/lib/api/errors';
import { logger } from '@/lib/logger';

const RECEIPT_TIMEOUT_MS = 60_000;

// Gas fees for admin txs (reserveTokens mint + USDC permit/transferFrom).
//
// We do NOT let viem auto-estimate: on Base it falls back to Ethereum-mainnet
// defaults (~1.5 gwei priority) and demands the wallet pre-fund a worst case of
// `gasLimit × maxFeePerGas` — 250–6000× the real cost. Instead we set explicit,
// Base-realistic fees with a SMALL priority tip.
//
// CRITICAL: maxFeePerGas must be ADAPTIVE to the live base fee. It used to be a
// fixed 0.1 gwei, which silently worked while Base base fee stayed below that —
// then on a congestion spike the base fee crossed 0.1 gwei and EVERY admin tx
// failed with "max fee per gas less than block base fee" (lost a user's spin
// reward). We now read the current base fee and set maxFee = 3× base fee +
// priority, floored at 0.1 gwei (keeps the cheap-network behavior) and capped so
// the wallet pre-fund demand stays bounded even at extreme base fees.
const PRIORITY_FEE = parseGwei('0.001');
const MAX_FEE_FLOOR = parseGwei('0.1'); // cheap-network behavior, unchanged
const MAX_FEE_CEIL = parseGwei('10');   // bounds gasLimit×maxFee pre-fund demand

async function resolveGasParams(publicClient: {
  getBlock: (args: { blockTag: 'latest' }) => Promise<{ baseFeePerGas: bigint | null }>;
}): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  let baseFee = MAX_FEE_FLOOR; // safe fallback if the RPC read fails
  try {
    const block = await publicClient.getBlock({ blockTag: 'latest' });
    if (typeof block.baseFeePerGas === 'bigint' && block.baseFeePerGas > 0n) {
      baseFee = block.baseFeePerGas;
    }
  } catch (e) {
    logger.warn('adminMint.basefee_read_failed', { err: (e as Error).message });
  }
  // 3× headroom covers the base fee rising between this read and inclusion.
  let maxFeePerGas = baseFee * 3n + PRIORITY_FEE;
  if (maxFeePerGas < MAX_FEE_FLOOR) maxFeePerGas = MAX_FEE_FLOOR;
  if (maxFeePerGas > MAX_FEE_CEIL) maxFeePerGas = MAX_FEE_CEIL;
  return { maxFeePerGas, maxPriorityFeePerGas: PRIORITY_FEE };
}

function loadPrivateKey(): Hex | null {
  const raw = process.env.BBB4_OWNER_PRIVATE_KEY?.trim();
  if (!raw) return null;
  const hex = raw.startsWith('0x') ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) return null;
  return hex as Hex;
}

export function isAdminMintConfigured(): boolean {
  return loadPrivateKey() !== null;
}

export interface ReserveTokensResult {
  txHash: Hex;
  tokenIds: string[];
}

/**
 * Calls BBB4.reserveTokens(to, count) from the configured owner wallet.
 * Returns the tx hash and minted tokenIds (parsed from Transfer event logs).
 *
 * Throws ApiError(503) if BBB4_OWNER_PRIVATE_KEY is missing — callers can
 * fall back to a Firestore-only path while the ops wallet is being set up.
 */
export async function reserveTokensToWallet(opts: {
  to: string;
  count: number;
}): Promise<ReserveTokensResult> {
  const { to, count } = opts;

  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) {
    throw new ApiError(400, 'Invalid recipient wallet');
  }
  if (!Number.isInteger(count) || count <= 0) {
    throw new ApiError(400, 'count must be a positive integer');
  }

  const key = loadPrivateKey();
  if (!key) {
    throw new ApiError(503, 'Admin mint is not configured (missing BBB4_OWNER_PRIVATE_KEY)');
  }

  const account = privateKeyToAccount(key);
  const walletClient = createWalletClient({
    account,
    chain: BASE,
    transport: http(BASE_RPC_URL),
  });
  const publicClient = createPublicClient({
    chain: BASE,
    transport: http(BASE_RPC_URL),
  });

  const recipient = to.toLowerCase() as Address;

  const txHash = await walletClient.writeContract({
    address: BBB4_CONTRACT_ADDRESS,
    abi: BBB4_ABI,
    functionName: 'reserveTokens',
    args: [recipient, BigInt(count)],
    ...(await resolveGasParams(publicClient)),
  });

  logger.info('adminMint.tx.sent', { to: recipient, count, txHash });

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    timeout: RECEIPT_TIMEOUT_MS,
  });

  if (receipt.status !== 'success') {
    throw new ApiError(500, `reserveTokens reverted (tx ${txHash})`);
  }

  const events = parseEventLogs({
    abi: BBB4_ABI,
    eventName: 'Transfer',
    logs: receipt.logs,
  });

  const tokenIds = events
    .filter((e) => e.args.to.toLowerCase() === recipient)
    .map((e) => e.args.tokenId.toString());

  if (tokenIds.length < count) {
    logger.warn('adminMint.tokenId_mismatch', {
      txHash,
      expected: count,
      parsed: tokenIds.length,
    });
  }

  return { txHash, tokenIds };
}

/**
 * Public address of the admin wallet (same key that signs `reserveTokens`).
 * Used as the `spender` on EIP-2612 permits issued by users so the server
 * can pull USDC on their behalf.
 */
export function getAdminWalletAddress(): Address | null {
  const key = loadPrivateKey();
  if (!key) return null;
  return privateKeyToAccount(key).address;
}

function buildWalletClients() {
  const key = loadPrivateKey();
  if (!key) {
    throw new ApiError(503, 'Admin mint is not configured (missing BBB4_OWNER_PRIVATE_KEY)');
  }
  const account = privateKeyToAccount(key);
  const walletClient = createWalletClient({
    account,
    chain: BASE,
    transport: http(BASE_RPC_URL),
  });
  const publicClient = createPublicClient({
    chain: BASE,
    transport: http(BASE_RPC_URL),
  });
  return { account, walletClient, publicClient };
}

/**
 * Submit an EIP-2612 USDC permit signed by the user. Admin wallet pays gas.
 * Returns the tx hash. Throws ApiError(400) if the permit is rejected (bad
 * signature, expired deadline, consumed nonce).
 */
export async function submitUsdcPermit(opts: {
  owner: Address;
  spender: Address;
  value: bigint;
  deadline: bigint;
  v: number;
  r: Hex;
  s: Hex;
}): Promise<Hex> {
  const { walletClient, publicClient } = buildWalletClients();

  try {
    const txHash = await walletClient.writeContract({
      address: BASE_SEPOLIA_USDC_ADDRESS,
      abi: USDC_PERMIT_ABI,
      functionName: 'permit',
      args: [opts.owner, opts.spender, opts.value, opts.deadline, opts.v, opts.r, opts.s],
      ...(await resolveGasParams(publicClient)),
    });
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      timeout: RECEIPT_TIMEOUT_MS,
    });
    if (receipt.status !== 'success') {
      throw new ApiError(400, `USDC permit reverted (tx ${txHash})`);
    }
    logger.info('adminMint.permit.ok', { owner: opts.owner, value: opts.value.toString(), txHash });
    return txHash;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const msg = (err as Error).message || 'USDC permit failed';
    throw new ApiError(400, `USDC permit failed: ${msg}`);
  }
}

/**
 * Pull USDC from `owner` to `to` via ERC-20 transferFrom. Requires the
 * admin wallet to already have allowance (via a prior `submitUsdcPermit`
 * or an on-chain approve). Admin wallet pays gas.
 */
export async function pullUsdcFromUser(opts: {
  owner: Address;
  to: Address;
  amount: bigint;
}): Promise<Hex> {
  const { walletClient, publicClient } = buildWalletClients();

  const txHash = await walletClient.writeContract({
    address: BASE_SEPOLIA_USDC_ADDRESS,
    abi: USDC_ABI,
    functionName: 'transferFrom',
    args: [opts.owner, opts.to, opts.amount],
    ...(await resolveGasParams(publicClient)),
  });
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    timeout: RECEIPT_TIMEOUT_MS,
  });
  if (receipt.status !== 'success') {
    throw new ApiError(402, `USDC transferFrom reverted (tx ${txHash})`);
  }
  logger.info('adminMint.transferFrom.ok', {
    owner: opts.owner,
    to: opts.to,
    amount: opts.amount.toString(),
    txHash,
  });
  return txHash;
}
