/**
 * External mobile signer bridge.
 *
 * On mobile, login happens through a wallet's OWN SDK (MetaMask SDK /
 * Coinbase Base Account SDK) — see MobileLoginModal. Those SDKs hand back a
 * working EIP-1193 provider that signs the SIWE login. But that provider is
 * NEVER registered as a Privy wallet, so `useWallets()` stays empty and the
 * mint flow has nothing to sign with a few seconds after login
 * (root-caused 2026-06-22 from v2_debug_events: every mobile mint logged
 * `mint_wallet_state { walletsReady:true, hasSelected:false }`).
 *
 * The fix: when the SDK login succeeds, stash that exact, proven provider
 * here. The mint hook then reuses it as the signer when Privy's useWallets is
 * empty — it's the same object that already demonstrated it can deeplink to
 * the wallet and sign, so it's far more reliable than re-opening a connect
 * modal. The downstream mint code already switches the provider to Base
 * (`ensureBaseNetwork`) before signing, so a wrong-chain session self-heals.
 *
 * Module-level singleton (survives modal unmount + Privy useWallets churn).
 */

export type ExternalEip1193 = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

export type ExternalSignerSession = {
  provider: ExternalEip1193;
  address: string;
  walletType: string; // 'metamask' | 'coinbase' — drives downstream UX copy only
};

let session: ExternalSignerSession | null = null;

export function setExternalSigner(
  provider: ExternalEip1193 | null | undefined,
  address: string | null | undefined,
  walletType: string,
): void {
  if (!provider || !address) return;
  session = { provider, address, walletType };
}

export function getExternalSigner(): ExternalSignerSession | null {
  return session;
}

export function clearExternalSigner(): void {
  session = null;
}
