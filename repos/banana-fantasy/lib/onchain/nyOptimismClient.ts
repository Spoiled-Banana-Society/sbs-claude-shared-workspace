import { createPublicClient, http, type Address } from 'viem';
import { getNySource } from '@/lib/onchain/cctp';

/**
 * Client-side Optimism USDC helpers for the NY on-ramp branch — the OP mirrors
 * of the Base helpers in `lib/contracts/bbb4.ts` + `lib/onchain/usdcPermit.ts`.
 * A NY buyer's card purchase lands USDC on Optimism; the modal reads it here,
 * signs an OP-domain permit, and hands it to `/api/purchases/ny-bridge`.
 *
 * USDC on Optimism (0x0b2c639c…) is Circle's FiatTokenV2_2, same EIP-712 name
 * "USD Coin" / version "2" as Base — only the chainId + verifyingContract differ.
 */

const USDC_EIP712_NAME = 'USD Coin';
const USDC_EIP712_VERSION = '2';

const USDC_READ_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'nonces', stateMutability: 'view', inputs: [{ name: 'o', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

function opClient() {
  const src = getNySource();
  return createPublicClient({ chain: src.viemChain, transport: http(src.rpcUrl) });
}

/** EIP-712 typed data for a USDC permit on the active NY SOURCE chain (Optimism
 *  or Arbitrum). Pass to eth_signTypedData_v4 / Privy signTypedData. Same shape as
 *  the Base permit; only chainId + verifyingContract differ by source chain. */
export function buildOptimismUsdcPermitTypedData(params: {
  owner: Address; spender: Address; value: bigint; nonce: bigint; deadline: bigint;
}) {
  const src = getNySource();
  return {
    domain: {
      name: USDC_EIP712_NAME,
      version: USDC_EIP712_VERSION,
      chainId: src.chainId,
      verifyingContract: src.usdc,
    },
    primaryType: 'Permit' as const,
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    message: {
      owner: params.owner,
      spender: params.spender,
      value: params.value.toString(),
      nonce: params.nonce.toString(),
      deadline: params.deadline.toString(),
    },
  };
}

/** Read the owner's current USDC permit nonce on Optimism. */
export async function getOptimismUsdcNonce(owner: Address): Promise<bigint> {
  return (await opClient().readContract({ address: getNySource().usdc, abi: USDC_READ_ABI, functionName: 'nonces', args: [owner] })) as bigint;
}

/** Read the owner's current USDC balance on Optimism (6-dec units). */
export async function getOptimismUsdcBalance(owner: Address): Promise<bigint> {
  return (await opClient().readContract({ address: getNySource().usdc, abi: USDC_READ_ABI, functionName: 'balanceOf', args: [owner] })) as bigint;
}

/** Poll the owner's USDC balance on Optimism until it reaches `minAmount` (the
 *  card purchase settling), or timeout. Mirrors Base `waitForUsdcArrival`. */
export async function waitForUsdcOnOptimism(
  address: Address,
  minAmount: bigint,
  opts: { timeoutMs?: number; isCancelled?: () => boolean; onError?: (e: unknown) => void } = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const client = opClient();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (opts.isCancelled?.()) return false;
    try {
      const bal = (await client.readContract({ address: getNySource().usdc, abi: USDC_READ_ABI, functionName: 'balanceOf', args: [address] })) as bigint;
      if (bal >= minAmount) return true;
    } catch (e) {
      opts.onError?.(e);
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  return false;
}
