'use client';

/**
 * Mobile external-wallet fallback for marketplace signing flows.
 *
 * On mobile, login happens through the wallet's OWN SDK (MetaMask SDK — see
 * MobileLoginModal), which AUTHENTICATES the user but never registers the
 * wallet with Privy — so `useWallets()` stays empty on that device, forever.
 * "Log out and back in" does not fix it: ticket-2681 (8/13), AceJohn re-logged
 * in via MetaMask and every offer_submit_clicked still showed walletCount:0.
 *
 * The mint flow solved this in June (useMintDraftPass): fall back to the
 * injected provider if one exists (wallet in-app browser), else open a fresh
 * MetaMask SDK session — a live connect→sign burst over a fresh relay — and
 * verify it resolves to the same address. This module is that same two-tier
 * fallback, shaped like a Privy ConnectedWallet so marketplace signing code
 * can use it interchangeably.
 */

import { clientLog } from '@/lib/clientLog';
import { connectMetaMaskFresh } from '@/lib/metamaskSigner';
import type { ExternalEip1193 } from '@/lib/externalSigner';

export type FallbackWallet = {
  address: string;
  walletClientType: string;
  getEthereumProvider: () => Promise<ExternalEip1193>;
  switchChain: (chainId: number) => Promise<void>;
};

function makeSwitchChain(provider: ExternalEip1193): (chainId: number) => Promise<void> {
  return async (chainId: number) => {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: `0x${chainId.toString(16)}` }],
    });
  };
}

/**
 * Recover a usable signer when Privy's useWallets() is empty for a logged-in
 * user. Returns null on failure — callers fall through to their existing
 * "reconnect" error, so this is never worse than today. `action` labels the
 * breadcrumbs (e.g. 'make_offer', 'accept_offer', 'list', 'cancel', 'buy').
 */
export async function resolveWalletFallback(
  walletAddress: string,
  action: string,
): Promise<FallbackWallet | null> {
  // Tier 1: injected provider (wallet in-app browser). Same trust model as
  // the mint flow — the signature/tx simply fails downstream on a mismatch.
  const injected = typeof window !== 'undefined'
    ? (window as unknown as { ethereum?: ExternalEip1193 }).ethereum
    : undefined;
  if (injected) {
    clientLog('marketplace#', 'wallet_injected_fallback', { action, addr: walletAddress });
    return {
      address: walletAddress,
      walletClientType: 'injected',
      getEthereumProvider: async () => injected,
      switchChain: makeSwitchChain(injected),
    };
  }

  // Tier 2: brand-new MetaMask SDK connection. Reusing the post-login provider
  // is NOT reliable (relay socket dies when the app backgrounds during login),
  // so connect fresh — the same proven burst the login and mint flows use.
  clientLog('marketplace#', 'wallet_mm_fresh_connect_start', { action });
  const fresh = await connectMetaMaskFresh();
  const matches = !!fresh && fresh.address.toLowerCase() === walletAddress.toLowerCase();
  clientLog('marketplace#', 'wallet_mm_fresh_connect_result', {
    action, connected: !!fresh, matches, addr: fresh?.address ?? null,
  });
  if (!fresh || !matches) return null;
  return {
    address: fresh.address,
    walletClientType: 'metamask',
    getEthereumProvider: async () => fresh.provider,
    switchChain: makeSwitchChain(fresh.provider),
  };
}
