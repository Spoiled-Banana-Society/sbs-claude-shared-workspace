'use client';

/**
 * Gasless marketplace flows for EXTERNAL wallets (MetaMask, Coinbase
 * Wallet, …). Embedded Privy wallets keep their `sponsor: true` path;
 * external wallets route here so SBS pays the gas everywhere:
 *
 *  - relayBuyExternal:      one free permit signature → server fulfills the
 *                           Seaport listing, NFT delivered to the buyer.
 *  - ensureConduitAllowanceGasless: free permit signature → server submits
 *                           the USDC approval (offers need conduit allowance).
 *  - topUpGasIfNeeded:      for the txs a wallet must send itself (NFT
 *                           approval, accept-offer, cancel) the server funds
 *                           the exact gas shortfall first.
 */

import { getAccessToken } from '@privy-io/react-auth';
import type { ConnectedWallet } from '@privy-io/react-auth';
import { createPublicClient, http, type Address, type Hex } from 'viem';

import {
  BASE,
  BASE_RPC_URL,
  BASE_SEPOLIA_USDC_ADDRESS,
  USDC_PERMIT_ABI,
} from '@/lib/contracts/bbb4';
import { buildUsdcPermitTypedData } from '@/lib/onchain/usdcPermit';
import { ensureBaseNetwork } from '@/lib/ensureBaseNetwork';

const PERMIT_DEADLINE_SECONDS = 10 * 60;
const OPENSEA_CONDUIT = '0x1e0049783f008a0085193e00003d00cd54003c71' as Address;
const MAX_UINT256 = 2n ** 256n - 1n;

const publicClient = createPublicClient({ chain: BASE, transport: http(BASE_RPC_URL) });

async function readJsonError(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error || fallback;
}

/** Sign an EIP-2612 USDC permit with the wallet's own provider (free, no gas). */
async function signUsdcPermit(opts: {
  wallet: ConnectedWallet;
  spender: Address;
  value: bigint;
}): Promise<{ signature: Hex; deadline: number }> {
  const owner = opts.wallet.address as Address;
  const provider = await opts.wallet.getEthereumProvider();

  const baseNet = await ensureBaseNetwork(provider);
  if (!baseNet.ok) {
    throw new Error(baseNet.message ?? 'Please switch your wallet to the Base network to continue.');
  }

  const nonce = (await publicClient.readContract({
    address: BASE_SEPOLIA_USDC_ADDRESS,
    abi: USDC_PERMIT_ABI,
    functionName: 'nonces',
    args: [owner],
  })) as bigint;

  const deadline = Math.floor(Date.now() / 1000) + PERMIT_DEADLINE_SECONDS;
  const typedData = buildUsdcPermitTypedData({
    owner,
    spender: opts.spender,
    value: opts.value,
    nonce,
    deadline: BigInt(deadline),
  });

  const signature = (await provider.request({
    method: 'eth_signTypedData_v4',
    params: [owner, JSON.stringify(typedData)],
  })) as Hex;

  return { signature, deadline };
}

/**
 * Buy a listing with zero gas and zero ETH: sign a USDC permit for the exact
 * listing price, then the server pulls the USDC and fulfills the Seaport
 * order with the NFT delivered straight to the buyer.
 */
export async function relayBuyExternal(opts: {
  wallet: ConnectedWallet;
  orderHash: string;
  protocolAddress: string;
  /**
   * Total listing price in USDC wei (6 decimals) — `price.current.value`
   * when available. Callers with only a float price may round UP a cent;
   * the server permits this value but only pulls the exact order total.
   */
  priceWei: bigint;
}): Promise<{ hash: string }> {
  const adminRes = await fetch('/api/purchases/admin-wallet').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const adminAddress = adminRes?.address as Address | undefined;
  if (!adminAddress) {
    throw new Error('Purchases are temporarily unavailable. Please try again in a few minutes.');
  }
  if (adminRes?.healthy === false) {
    throw new Error('Purchases are temporarily paused for maintenance. Your funds are safe — please try again in a few minutes.');
  }

  const { signature, deadline } = await signUsdcPermit({
    wallet: opts.wallet,
    spender: adminAddress,
    value: opts.priceWei,
  });

  const res = await fetch('/api/marketplace/relay-buy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      buyerAddress: opts.wallet.address.toLowerCase(),
      orderHash: opts.orderHash,
      protocolAddress: opts.protocolAddress,
      permitValue: opts.priceWei.toString(),
      deadline,
      signature,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { success?: boolean; txHash?: string; error?: string };
  if (!res.ok || !data.success || !data.txHash) {
    throw new Error(data.error || `Purchase failed (${res.status})`);
  }
  return { hash: data.txHash };
}

/**
 * Make sure the OpenSea conduit can pull this wallet's USDC (required to
 * make offers) without the user paying gas: free permit signature, the
 * server submits it. No-op when the allowance already exists.
 */
export async function ensureConduitAllowanceGasless(opts: {
  wallet: ConnectedWallet;
  requiredWei: bigint;
}): Promise<void> {
  const owner = opts.wallet.address as Address;
  const allowance = (await publicClient.readContract({
    address: BASE_SEPOLIA_USDC_ADDRESS,
    abi: [{
      type: 'function', stateMutability: 'view', name: 'allowance',
      inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
      outputs: [{ name: '', type: 'uint256' }],
    }] as const,
    functionName: 'allowance',
    args: [owner, OPENSEA_CONDUIT],
  })) as bigint;
  if (allowance >= opts.requiredWei) return;

  // Max allowance — mirrors the one-time max approve the embedded flow does.
  const { signature, deadline } = await signUsdcPermit({
    wallet: opts.wallet,
    spender: OPENSEA_CONDUIT,
    value: MAX_UINT256,
  });

  const res = await fetch('/api/marketplace/relay-permit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      owner: owner.toLowerCase(),
      value: MAX_UINT256.toString(),
      deadline,
      signature,
    }),
  });
  if (!res.ok) {
    throw new Error(await readJsonError(res, 'Could not set up USDC approval. Please try again.'));
  }
}

export type GasTopupAction = 'approve-nft' | 'accept-offer' | 'cancel';

/**
 * Ask the server to fund the wallet's exact gas shortfall for an action it
 * must send itself. Resolves once the ETH has landed (the server waits for
 * the receipt), so callers can fire the wallet tx immediately after.
 * Best-effort by design: on failure we proceed anyway — worst case the user
 * sees a normal gas prompt instead of a funded one.
 */
export async function topUpGasIfNeeded(action: GasTopupAction): Promise<void> {
  try {
    const token = await getAccessToken();
    if (!token) return;
    await fetch('/api/marketplace/gas-topup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action }),
    });
  } catch {
    // Non-fatal — the action still works, the user just pays cents of gas.
  }
}
