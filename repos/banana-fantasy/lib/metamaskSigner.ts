'use client';

import type { ExternalEip1193 } from './externalSigner';

/**
 * Fresh MetaMask signing session for mobile purchase time.
 *
 * Why this exists (root-caused 2026-06-22 from v2_debug_events): on mobile, the
 * login signs in through MetaMask's SDK in one connect→sign burst over a LIVE
 * relay, which works. But the purchase happens later — and by then the relay
 * socket is dead (the app backgrounded when you switched to MetaMask) AND mobile
 * Safari often reloads the tab on return, wiping any cached provider. So reusing
 * the post-login provider hangs ("MetaMask opens, nothing to approve").
 *
 * The fix: at Buy time, establish a BRAND-NEW MetaMask connection right before
 * signing — the same proven burst the login uses — so the signature that follows
 * a moment later round-trips over a fresh, live relay.
 *
 * Module singleton: the SDK persists its session in localStorage, so after a
 * page reload a fresh instance resumes the same wallet on connect().
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sdkPromise: Promise<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getSdk(): Promise<any> {
  if (!sdkPromise) {
    sdkPromise = (async () => {
      const { default: MetaMaskSDK } = await import('@metamask/sdk');
      const sdk = new MetaMaskSDK({
        dappMetadata: {
          name: 'Banana Fantasy',
          url: typeof window !== 'undefined' ? window.location.origin : 'https://sbsfantasy.com',
        },
        useDeeplink: true,
        preferDesktop: false,
      });
      await sdk.init();
      return sdk;
    })().catch((e) => {
      // Reset so a later attempt can retry a clean init.
      sdkPromise = null;
      throw e;
    });
  }
  return sdkPromise;
}

/**
 * Open a live MetaMask session now and return its provider + address. Returns
 * null on any failure (caller falls through to the existing "reconnect" error —
 * never worse than today). The returned provider is the SDK's own EIP-1193
 * provider; the caller switches it to Base and requests the signature.
 */
export async function connectMetaMaskFresh(): Promise<{ provider: ExternalEip1193; address: string } | null> {
  try {
    const sdk = await getSdk();
    const accounts = (await sdk.connect()) as string[];
    if (!accounts || accounts.length === 0) return null;
    const provider = sdk.getProvider();
    if (!provider) return null;
    const { getAddress } = await import('ethers');
    return { provider: provider as ExternalEip1193, address: getAddress(accounts[0]) };
  } catch {
    return null;
  }
}
