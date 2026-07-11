import type { Address, Hex } from 'viem';
import {
  waitForUsdcOnOptimism,
  getOptimismUsdcNonce,
  getOptimismUsdcBalance,
  buildOptimismUsdcPermitTypedData,
} from '@/lib/onchain/nyOptimismClient';
import { CHAIN_ID_OPTIMISM } from '@/lib/onchain/cctp';

/**
 * The NY on-ramp client dance, run AFTER MoonPay has delivered the buyer's USDC
 * to their OPTIMISM wallet and BEFORE the normal Base mint:
 *   1. wait for the USDC to land on Optimism,
 *   2. sign an Optimism USDC permit (embedded = silent; external = one popup),
 *   3. POST it to /api/purchases/ny-bridge, which sweeps + CCTP-bridges the USDC
 *      to the buyer's OWN Base wallet.
 * When this resolves, the USDC is on Base and the modal's EXISTING Base wait +
 * mint() run unchanged. All inside the same stepper — no new UI, no crypto words.
 *
 * Only ever called for NY buyers (gated by /api/user/ny-status in the modal), so
 * a non-NY buyer never executes any of this.
 */
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

export async function runNyOptimismBridge(deps: NyBridgeDeps): Promise<void> {
  const { user, quantity, passCost, signTypedData, wallets, getAccessToken, isCancelled, onStatus } = deps;

  // 1. Wait for AT LEAST the pass cost to settle on Optimism.
  onStatus?.('waiting-optimism');
  const arrived = await waitForUsdcOnOptimism(user, passCost, { isCancelled });
  if (isCancelled?.()) throw new Error('cancelled');
  if (!arrived) throw new Error('USDC not yet received. Please try again in a few minutes.');

  // 2. Read the buyer's ACTUAL Optimism balance — we sweep + bridge ALL of it, so
  //    the CCTP fee can't leave them a hair under the pass price on Base, and any
  //    leftover from a prior attempt rides along. The permit authorizes this exact
  //    amount (spender = relayer), so we can never pull more than they signed for.
  const sweepValue = await getOptimismUsdcBalance(user);
  if (sweepValue < passCost) throw new Error('USDC not yet received. Please try again in a few minutes.');

  // 3. Fetch the relayer (spender) + build the OP permit for the full balance.
  onStatus?.('signing');
  const relayerRes = await fetch('/api/purchases/admin-wallet').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const relayer = relayerRes?.address as Address | undefined;
  if (!relayer) throw new Error('Payment relay not available right now. Please try again.');

  const nonce = await getOptimismUsdcNonce(user);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + PERMIT_DEADLINE_SECONDS);
  const typedData = buildOptimismUsdcPermitTypedData({ owner: user, spender: relayer, value: sweepValue, nonce, deadline });

  // 3. Sign — embedded silent, external via provider (switch it to Optimism).
  const wallet = wallets.find((w) => w.address?.toLowerCase() === user.toLowerCase()) ?? wallets[0];
  let signature: Hex;
  if (wallet?.walletClientType === 'privy') {
    const res = await signTypedData(typedData, { uiOptions: { showWalletUIs: false }, address: user });
    signature = res.signature as Hex;
  } else {
    const provider = wallet?.getEthereumProvider ? await wallet.getEthereumProvider() : undefined;
    if (!provider) throw new Error('Wallet not connected — please reconnect and try again.');
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${CHAIN_ID_OPTIMISM.toString(16)}` }] });
    } catch { /* already on OP or user handles it */ }
    signature = (await provider.request({ method: 'eth_signTypedData_v4', params: [user, JSON.stringify(typedData)] })) as Hex;
  }

  // 4. Sweep + bridge server-side → USDC lands on the buyer's Base wallet.
  onStatus?.('bridging');
  const token = await getAccessToken();
  const res = await fetch('/api/purchases/ny-bridge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ quantity, permitValue: sweepValue.toString(), deadline: Number(deadline), signature }),
  });
  const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; paymentSucceeded?: boolean };
  if (!res.ok || !data.success) {
    // paymentSucceeded means the sweep worked but the bridge is finalizing — the
    // buyer's money is safe in our relayer; surface a reassuring pending error.
    throw new Error(data.error || 'Finalizing your payment — your draft pass is on its way.');
  }
  // USDC is now on Base; caller falls through to the normal Base wait + mint.
}
