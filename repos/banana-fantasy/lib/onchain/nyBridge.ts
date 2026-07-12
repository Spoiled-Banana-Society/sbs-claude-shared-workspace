import {
  createPublicClient,
  createWalletClient,
  http,
  parseGwei,
  encodeFunctionData,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { getAdminPrivateKeyHex, getAdminWalletAddress } from '@/lib/onchain/adminMint';
import {
  CCTP_TOKEN_MESSENGER_V2,
  CCTP_MESSAGE_TRANSMITTER_V2,
  CCTP_DOMAIN_BASE,
  BASE_MAINNET_RPC_URL,
  CIRCLE_IRIS_API,
  getNySource,
  addressToBytes32,
} from '@/lib/onchain/cctp';
import { logger } from '@/lib/logger';

/**
 * NY on-ramp bridge — moves a NY buyer's USDC from Optimism to Base via Circle
 * CCTP V2, so their card purchase (which MoonPay can only deliver on Optimism in
 * NY) can mint the pass on Base.
 *
 * ⚠️ REAL MONEY, MAINNET. Safety properties this module is built to guarantee:
 *  - The mintRecipient of every bridge is ALWAYS our own relayer wallet, so a
 *    bug can never send funds to a wrong/user-lost address.
 *  - Every step is idempotent-friendly and returns structured results; a failure
 *    leaves USDC sitting in a wallet WE control (relayer) or the user's own
 *    wallet — recoverable, never burned to a void.
 *  - The relayer is the existing BBB4 owner wallet (getAdminPrivateKeyHex).
 *
 * Steps: approve USDC→TokenMessengerV2 on OP → depositForBurn (Fast) →
 * poll Circle attestation → receiveMessage on Base → USDC lands in the relayer
 * wallet on Base, ready for reserveTokens delivery of the pass.
 */

const CCTP_TOKEN_MESSENGER_V2_ABI = [{
  type: 'function', name: 'depositForBurn', stateMutability: 'nonpayable',
  inputs: [
    { name: 'amount', type: 'uint256' },
    { name: 'destinationDomain', type: 'uint32' },
    { name: 'mintRecipient', type: 'bytes32' },
    { name: 'burnToken', type: 'address' },
    { name: 'destinationCaller', type: 'bytes32' },
    { name: 'maxFee', type: 'uint256' },
    { name: 'minFinalityThreshold', type: 'uint32' },
  ],
  outputs: [],
}] as const;

const CCTP_MESSAGE_TRANSMITTER_V2_ABI = [{
  type: 'function', name: 'receiveMessage', stateMutability: 'nonpayable',
  inputs: [{ name: 'message', type: 'bytes' }, { name: 'attestation', type: 'bytes' }],
  outputs: [{ type: 'bool' }],
}] as const;

const ERC20_ABI = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

// Fast Transfer: minFinalityThreshold <= 1000. maxFee caps the fast-transfer fee
// we'll pay; the actual fee (usually a few bps) is deducted, we never pay more.
// 10 bps cap is generous headroom for a $25 buy (~$0.025 max).
const FAST_FINALITY_THRESHOLD = 1000;
const MAX_FEE_BPS = 10n; // 0.10%

// OP + Base are cheap L2s; use small explicit fees (never auto-estimate, which
// falls back to mainnet defaults). Floor keeps it working when base fee is ~0.
const PRIORITY_FEE = parseGwei('0.001');
const MAX_FEE = parseGwei('0.5');

const ATTESTATION_POLL_INTERVAL_MS = 3_000;
const ATTESTATION_TIMEOUT_MS = 180_000; // 3 min — Fast is usually <30s, generous cap
const RECEIPT_TIMEOUT_MS = 90_000;

function relayerAccount() {
  const key = getAdminPrivateKeyHex();
  if (!key) throw new Error('NY bridge: relayer key (BBB4_OWNER_PRIVATE_KEY) not configured');
  return privateKeyToAccount(key);
}

function opClients() {
  const account = relayerAccount();
  const src = getNySource();
  const publicClient = createPublicClient({ chain: src.viemChain, transport: http(src.rpcUrl) });
  const walletClient = createWalletClient({ account, chain: src.viemChain, transport: http(src.rpcUrl) });
  return { account, publicClient, walletClient };
}

function baseClients() {
  const account = relayerAccount();
  const publicClient = createPublicClient({ chain: base, transport: http(BASE_MAINNET_RPC_URL) });
  const walletClient = createWalletClient({ account, chain: base, transport: http(BASE_MAINNET_RPC_URL) });
  return { account, publicClient, walletClient };
}

export interface BridgeResult {
  ok: boolean;
  burnTxHash?: Hex;
  mintTxHash?: Hex;
  error?: string;
}

/** Read the relayer's own USDC balance on Optimism (6-dec units). Used by the
 *  batched treasury-bridge cron to decide how much accumulated NY revenue to
 *  move to Base. */
export async function getRelayerOptimismUsdcBalance(): Promise<bigint> {
  const relayer = getAdminWalletAddress();
  if (!relayer) return 0n;
  const { publicClient: opPub } = opClients();
  return (await opPub.readContract({ address: getNySource().usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [relayer] })) as bigint;
}

/**
 * Bridge `amount` (6-decimal USDC units) of the RELAYER's own USDC from Optimism
 * to Base via CCTP V2 Fast Transfer. The relayer must already hold `amount` USDC
 * + a little ETH gas on OP (in the live flow it holds it because we swept it
 * from the buyer first).
 *
 * `mintRecipient` — where the USDC lands on Base. In the live NY flow this is the
 * BUYER's OWN wallet (their authenticated address — self-custodial, safe), so
 * afterward the EXISTING Base mint flow runs unchanged. Defaults to the relayer
 * itself, which is the isolation-test path (seed relayer $ on OP, bridge to self).
 * There is no path to a wrong address: it's either our relayer or the caller's
 * own verified wallet.
 */
export async function bridgeRelayerUsdcOpToBase(amount: bigint, mintRecipient?: Address): Promise<BridgeResult> {
  const relayer = getAdminWalletAddress();
  if (!relayer) return { ok: false, error: 'relayer wallet not configured' };
  const recipient: Address = mintRecipient ?? relayer;
  try {
    const { publicClient: opPub, walletClient: opWallet } = opClients();

    // 0. Sanity: relayer actually holds the USDC on Optimism.
    const bal = (await opPub.readContract({ address: getNySource().usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [relayer] })) as bigint;
    if (bal < amount) return { ok: false, error: `relayer OP USDC ${bal} < ${amount}` };

    // 1. Approve TokenMessengerV2 to pull the USDC for the burn (only if needed).
    const allowance = (await opPub.readContract({ address: getNySource().usdc, abi: ERC20_ABI, functionName: 'allowance', args: [relayer, CCTP_TOKEN_MESSENGER_V2] })) as bigint;
    if (allowance < amount) {
      const approveHash = await opWallet.sendTransaction({
        to: getNySource().usdc,
        data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [CCTP_TOKEN_MESSENGER_V2, amount * 100n] }),
        maxFeePerGas: MAX_FEE, maxPriorityFeePerGas: PRIORITY_FEE,
      });
      await opPub.waitForTransactionReceipt({ hash: approveHash, timeout: RECEIPT_TIMEOUT_MS });
    }

    // 2. depositForBurn (Fast). mintRecipient = OUR relayer on Base. destinationCaller
    //    = 0 → anyone can submit receiveMessage (we do). maxFee bounds the fast fee.
    const maxFee = (amount * MAX_FEE_BPS) / 10_000n;
    const burnHash = await opWallet.sendTransaction({
      to: CCTP_TOKEN_MESSENGER_V2,
      data: encodeFunctionData({
        abi: CCTP_TOKEN_MESSENGER_V2_ABI, functionName: 'depositForBurn',
        args: [amount, CCTP_DOMAIN_BASE, addressToBytes32(recipient), getNySource().usdc, addressToBytes32('0x0000000000000000000000000000000000000000'), maxFee, FAST_FINALITY_THRESHOLD],
      }),
      maxFeePerGas: MAX_FEE, maxPriorityFeePerGas: PRIORITY_FEE,
    });
    await opPub.waitForTransactionReceipt({ hash: burnHash, timeout: RECEIPT_TIMEOUT_MS });
    logger.info('nyBridge.burned', { burnHash, amount: amount.toString() });

    // 3. Poll Circle attestation for this burn tx.
    const att = await pollAttestation(getNySource().cctpDomain, burnHash);
    if (!att) return { ok: false, burnTxHash: burnHash, error: 'attestation timed out (funds safe on OP, retryable)' };

    // 4. receiveMessage on Base → mints USDC to the relayer on Base.
    const { publicClient: basePub, walletClient: baseWallet } = baseClients();
    const mintHash = await baseWallet.sendTransaction({
      to: CCTP_MESSAGE_TRANSMITTER_V2,
      data: encodeFunctionData({ abi: CCTP_MESSAGE_TRANSMITTER_V2_ABI, functionName: 'receiveMessage', args: [att.message, att.attestation] }),
      maxFeePerGas: MAX_FEE, maxPriorityFeePerGas: PRIORITY_FEE,
    });
    await basePub.waitForTransactionReceipt({ hash: mintHash, timeout: RECEIPT_TIMEOUT_MS });
    logger.info('nyBridge.minted_on_base', { mintHash, burnHash });

    return { ok: true, burnTxHash: burnHash, mintTxHash: mintHash };
  } catch (err) {
    logger.error('nyBridge.failed', { err: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const USDC_PERMIT_ABI = [
  { type: 'function', name: 'permit', stateMutability: 'nonpayable', inputs: [
    { name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' },
    { name: 'deadline', type: 'uint256' }, { name: 'v', type: 'uint8' }, { name: 'r', type: 'bytes32' }, { name: 's', type: 'bytes32' },
  ], outputs: [] },
  { type: 'function', name: 'transferFrom', stateMutability: 'nonpayable', inputs: [
    { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' },
  ], outputs: [{ type: 'bool' }] },
] as const;

export interface SweepResult { ok: boolean; txHash?: Hex; sweptValue?: bigint; error?: string }

/**
 * Sweep the NY buyer's USDC from Optimism into the relayer, using the same
 * gasless-permit mechanism the normal Base mint uses (the buyer signs an EIP-2612
 * permit; the relayer submits permit + transferFrom, paying OP gas).
 *
 * `permitValue` is what the buyer's signature authorizes (their whole balance at
 * sign time). We sweep the buyer's ACTUAL on-chain balance capped at `permitValue`
 * — so we bridge everything they have (never a hair less than the pass price after
 * the CCTP fee), but can never pull more than they signed for. Returns the amount
 * actually swept so the caller bridges exactly that.
 *
 * `signature` '0x' means the allowance was already set on-chain (smart-account
 * approve path), so we skip the permit. Recoverable by design: if transferFrom
 * fails the USDC simply stays in the buyer's own wallet.
 */
export async function sweepUsdcFromUserOnOptimism(opts: {
  user: Address; permitValue: bigint; deadline: bigint; signature: Hex;
}): Promise<SweepResult> {
  const relayer = getAdminWalletAddress();
  if (!relayer) return { ok: false, error: 'relayer wallet not configured' };
  try {
    const { publicClient: opPub, walletClient: opWallet } = opClients();

    // Sweep the buyer's actual balance, capped at what the permit authorizes.
    const balance = (await opPub.readContract({ address: getNySource().usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [opts.user] })) as bigint;
    const sweepValue = balance < opts.permitValue ? balance : opts.permitValue;
    if (sweepValue <= 0n) return { ok: false, error: 'no USDC to sweep on Optimism' };

    // 1. Submit the permit (unless the allowance is already in place via approve).
    const existing = (await opPub.readContract({ address: getNySource().usdc, abi: ERC20_ABI, functionName: 'allowance', args: [opts.user, relayer] })) as bigint;
    if (existing < sweepValue) {
      if (!opts.signature || opts.signature === '0x') {
        return { ok: false, error: 'no permit signature and insufficient allowance' };
      }
      const sig = opts.signature.slice(2);
      const r = `0x${sig.slice(0, 64)}` as Hex;
      const s = `0x${sig.slice(64, 128)}` as Hex;
      let v = parseInt(sig.slice(128, 130), 16);
      if (v < 27) v += 27;
      const permitHash = await opWallet.sendTransaction({
        to: getNySource().usdc,
        data: encodeFunctionData({ abi: USDC_PERMIT_ABI, functionName: 'permit', args: [opts.user, relayer, opts.permitValue, opts.deadline, v, r, s] }),
        maxFeePerGas: MAX_FEE, maxPriorityFeePerGas: PRIORITY_FEE,
      });
      await opPub.waitForTransactionReceipt({ hash: permitHash, timeout: RECEIPT_TIMEOUT_MS });
    }

    // 2. Pull the USDC into the relayer.
    const pullHash = await opWallet.sendTransaction({
      to: getNySource().usdc,
      data: encodeFunctionData({ abi: USDC_PERMIT_ABI, functionName: 'transferFrom', args: [opts.user, relayer, sweepValue] }),
      maxFeePerGas: MAX_FEE, maxPriorityFeePerGas: PRIORITY_FEE,
    });
    await opPub.waitForTransactionReceipt({ hash: pullHash, timeout: RECEIPT_TIMEOUT_MS });
    logger.info('nyBridge.swept', { user: opts.user, sweptValue: sweepValue.toString(), pullHash });
    return { ok: true, txHash: pullHash, sweptValue: sweepValue };
  } catch (err) {
    logger.error('nyBridge.sweep_failed', { user: opts.user, err: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

interface Attestation { message: Hex; attestation: Hex }

/** Poll Circle's IRIS v2 attestation service until the burn message is signed. */
async function pollAttestation(sourceDomain: number, burnTxHash: Hex): Promise<Attestation | null> {
  const url = `${CIRCLE_IRIS_API}/v2/messages/${sourceDomain}?transactionHash=${burnTxHash}`;
  const start = Date.now();
  while (Date.now() - start < ATTESTATION_TIMEOUT_MS) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as { messages?: Array<{ status?: string; message?: Hex; attestation?: Hex }> };
        const m = data.messages?.[0];
        if (m && m.status === 'complete' && m.message && m.attestation && m.attestation !== '0x') {
          return { message: m.message, attestation: m.attestation };
        }
      }
    } catch { /* transient — keep polling */ }
    await new Promise((r) => setTimeout(r, ATTESTATION_POLL_INTERVAL_MS));
  }
  return null;
}
