import type { Address, Hex } from 'viem';
import {
  waitForUsdcOnOptimism,
  getOptimismUsdcNonce,
  getOptimismUsdcBalance,
  buildOptimismUsdcPermitTypedData,
} from '@/lib/onchain/nyOptimismClient';
import { getNySource } from '@/lib/onchain/cctp';

/**
 * The NY on-ramp client dance, run AFTER MoonPay has delivered the buyer's USDC
 * to their OPTIMISM wallet:
 *   1. wait for the USDC to land on Optimism,
 *   2. sign an Optimism USDC permit (embedded = silent; external = one popup),
 *   3. POST it to /api/purchases/ny-mint, which sweeps the USDC (payment secured)
 *      and IMMEDIATELY owner-mints the paid pass — the pass is delivered here, so
 *      the caller shows success and does NOT run a second Base mint. The USDC→Base
 *      treasury bridge happens server-side in the background, unseen.
 * All inside the same stepper — no new UI, no crypto words.
 *
 * Only ever called for NY buyers (gated by /api/user/ny-status in the modal), so
 * a non-NY buyer never executes any of this.
 */
export interface NyMintResult {
  success: boolean;
  minted?: number;
  tokenIds?: string[];
  draftPasses?: number | null;
  promoAwards?: { mintMilestonesEarned: number; buyBonusMilestonesEarned: number; firstPurchaseSpinsEarned: number };
  cardFreeDraftsEarned?: number;
}

export interface NyBridgeDeps {
  user: Address;
  quantity: number;
  /** The pass cost (6-dec USDC) — the MINIMUM that must land on Optimism before
   *  we sweep. We then sweep the buyer's WHOLE balance (not just this), so the
   *  CCTP bridge fee can't leave them a hair under the pass price on Base, and any
   *  prior leftover rides along too. */
  passCost: bigint;
  /** Privy embedded silent signer (from useSignTypedData). */
  signTypedData: (typedData: unknown, opts?: { uiOptions?: { showWalletUIs?: boolean }; address?: string }) => Promise<{ signature: string }>;
  /** Connected wallets (from useWallets) — to pick the signing path. */
  wallets: Array<{ address: string; walletClientType?: string; getEthereumProvider?: () => Promise<{ request: (a: { method: string; params?: unknown[] }) => Promise<unknown> }> }>;
  getAccessToken: () => Promise<string | null>;
  isCancelled?: () => boolean;
  onStatus?: (s: string) => void;
}

const PERMIT_DEADLINE_SECONDS = 10 * 60;

/** Shared NY client dance steps 1-3: wait for the USDC to settle on the source
 *  chain, read the ACTUAL balance (we sweep-all so fees can't strand dust), and
 *  sign the source-chain permit for it (embedded silent; external one popup).
 *  Used by both the pass buy (runNyMint) and Add Funds (runNyDeposit). */
async function waitAndSignNySweep(deps: {
  user: Address;
  /** Minimum that must land on the source chain before we sweep. */
  floor: bigint;
  signTypedData: NyBridgeDeps['signTypedData'];
  wallets: NyBridgeDeps['wallets'];
  isCancelled?: () => boolean;
  onStatus?: (s: string) => void;
}): Promise<{ sweepValue: bigint; deadline: bigint; signature: Hex }> {
  const { user, floor, signTypedData, wallets, isCancelled, onStatus } = deps;

  // 1. Wait for AT LEAST the floor to settle on the source chain.
  onStatus?.('waiting-optimism');
  const arrived = await waitForUsdcOnOptimism(user, floor, { isCancelled });
  if (isCancelled?.()) throw new Error('cancelled');
  if (!arrived) throw new Error('USDC not yet received. Please try again in a few minutes.');

  // 2. Read the buyer's ACTUAL source-chain balance — we sweep + bridge ALL of
  //    it, so the CCTP fee can't leave them a hair short on Base, and any
  //    leftover from a prior attempt rides along. The permit authorizes this
  //    exact amount (spender = relayer), so we can never pull more than signed.
  const sweepValue = await getOptimismUsdcBalance(user);
  if (sweepValue < floor) throw new Error('USDC not yet received. Please try again in a few minutes.');

  // 3. Fetch the relayer (spender) + build + sign the source-chain permit.
  onStatus?.('signing');
  const relayerRes = await fetch('/api/purchases/admin-wallet').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const relayer = relayerRes?.address as Address | undefined;
  if (!relayer) throw new Error('Payment relay not available right now. Please try again.');

  const nonce = await getOptimismUsdcNonce(user);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + PERMIT_DEADLINE_SECONDS);
  const typedData = buildOptimismUsdcPermitTypedData({ owner: user, spender: relayer, value: sweepValue, nonce, deadline });

  // Sign — embedded silent, external via provider (switch it to the source chain).
  const wallet = wallets.find((w) => w.address?.toLowerCase() === user.toLowerCase()) ?? wallets[0];
  let signature: Hex;
  if (wallet?.walletClientType === 'privy') {
    const res = await signTypedData(typedData, { uiOptions: { showWalletUIs: false }, address: user });
    signature = res.signature as Hex;
  } else {
    const provider = wallet?.getEthereumProvider ? await wallet.getEthereumProvider() : undefined;
    if (!provider) throw new Error('Wallet not connected — please reconnect and try again.');
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${getNySource().chainId.toString(16)}` }] });
    } catch { /* already on the source chain or user handles it */ }
    signature = (await provider.request({ method: 'eth_signTypedData_v4', params: [user, JSON.stringify(typedData)] })) as Hex;
  }
  return { sweepValue, deadline, signature };
}

export async function runNyMint(deps: NyBridgeDeps): Promise<NyMintResult> {
  const { user, quantity, passCost, signTypedData, wallets, getAccessToken, isCancelled, onStatus } = deps;

  const { sweepValue, deadline, signature } = await waitAndSignNySweep({
    user, floor: passCost, signTypedData, wallets, isCancelled, onStatus,
  });

  // 4. Sweep + owner-mint server-side → the paid pass is delivered right here.
  //    (The USDC→Base treasury bridge happens in the background server-side.)
  onStatus?.('bridging');
  const token = await getAccessToken();
  const res = await fetch('/api/purchases/ny-mint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ quantity, permitValue: sweepValue.toString(), deadline: Number(deadline), signature }),
  });
  const data = (await res.json().catch(() => ({}))) as NyMintResult & { error?: string; paymentSucceeded?: boolean };
  if (!res.ok || !data.success) {
    // paymentSucceeded means the sweep worked but the mint is finalizing — the
    // buyer's money is safe; surface a reassuring pending error.
    throw new Error(data.error || 'Finalizing your payment — your draft pass is on its way.');
  }
  // Pass is delivered. Caller shows success and does NOT run a second Base mint.
  return data;
}

/**
 * The NY ADD FUNDS dance — same steps as runNyMint but the destination is the
 * depositor's OWN Base wallet, not a pass: wait for the MoonPay USDC on the
 * source chain, sign the sweep permit, then POST /api/deposits/ny-deposit which
 * sweeps + CCTP-bridges ALL of it to the user's Base wallet. The caller's
 * existing Base waitForUsdcArrival then sees the money land, so the normal
 * deposit tail (balance refresh, card-fee credit, onFunded) runs untouched.
 *
 * `depositCost` = the 6-dec USDC amount the user chose to receive — the MINIMUM
 * that must land on the source chain before we sweep (the fiat gross-up in the
 * modal guarantees the MoonPay net clears it).
 */
export async function runNyDeposit(deps: {
  user: Address;
  depositCost: bigint;
  signTypedData: NyBridgeDeps['signTypedData'];
  wallets: NyBridgeDeps['wallets'];
  getAccessToken: () => Promise<string | null>;
  isCancelled?: () => boolean;
  onStatus?: (s: string) => void;
}): Promise<{ success: boolean }> {
  const { user, depositCost, signTypedData, wallets, getAccessToken, isCancelled, onStatus } = deps;

  const { sweepValue, deadline, signature } = await waitAndSignNySweep({
    user, floor: depositCost, signTypedData, wallets, isCancelled, onStatus,
  });

  onStatus?.('bridging');
  const token = await getAccessToken();
  const res = await fetch('/api/deposits/ny-deposit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ permitValue: sweepValue.toString(), deadline: Number(deadline), signature }),
  });
  const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; paymentSucceeded?: boolean };
  if (!res.ok || !data.success) {
    // paymentSucceeded = swept but the bridge is finalizing — money is safe and
    // inbound; the caller's Base arrival wait (or its soft-timeout done state)
    // covers the user either way, so surface a reassuring pending error.
    throw new Error(data.error || 'Finalizing your deposit — your balance is on its way.');
  }
  return { success: true };
}
