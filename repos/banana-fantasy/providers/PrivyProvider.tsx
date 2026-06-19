'use client';

import { PrivyProvider as PrivyProviderBase, usePrivy as usePrivyBase, useCreateWallet as useCreateWalletBase, useWallets as useWalletsBase } from '@privy-io/react-auth';
import { base } from 'viem/chains';
import React, { ReactNode, useState, useEffect, createContext, useContext } from 'react';

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

// Track whether Privy is actually available
const PrivyAvailableContext = createContext(false);
export const usePrivyAvailable = () => useContext(PrivyAvailableContext);

// Safe usePrivy that returns a fallback when Privy is not available
const PRIVY_FALLBACK = {
  ready: true,
  authenticated: false,
  user: null,
  login: () => {},
  logout: async () => {},
  linkWallet: async () => {},
} as unknown as ReturnType<typeof usePrivyBase>;

export function useSafePrivy() {
  const available = usePrivyAvailable();
  try {
    if (!available) return PRIVY_FALLBACK;
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return usePrivyBase();
  } catch {
    return PRIVY_FALLBACK;
  }
}

// Safe wrapper around useCreateWallet — used to force-create the embedded wallet
// for new social users on mobile Safari, where Privy's createOnLogin auto-create
// silently fails (the original mobile-signup bug). No-op when Privy isn't ready.
const CREATE_WALLET_FALLBACK = { createWallet: async () => null } as unknown as ReturnType<typeof useCreateWalletBase>;
export function useSafeCreateWallet() {
  const available = usePrivyAvailable();
  try {
    if (!available) return CREATE_WALLET_FALLBACK;
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useCreateWalletBase();
  } catch {
    return CREATE_WALLET_FALLBACK;
  }
}

// Safe wrapper around useWallets — surfaces the embedded wallet (with a `ready`
// flag) often before privy.user.linkedAccounts repopulates, so we can detect it
// faster and know the exact moment it's safe to force-create one.
const WALLETS_FALLBACK = { wallets: [], ready: false } as unknown as ReturnType<typeof useWalletsBase>;
export function useSafeWallets() {
  const available = usePrivyAvailable();
  try {
    if (!available) return WALLETS_FALLBACK;
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useWalletsBase();
  } catch {
    return WALLETS_FALLBACK;
  }
}

class PrivyErrorBoundary extends React.Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: Error) {
    console.warn('[Privy] Init failed, running without auth:', error.message);
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

export function PrivyProvider({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Skip Privy during SSR/prerendering or when no app ID
  if (!mounted || !appId) {
    return (
      <PrivyAvailableContext.Provider value={false}>
        {children}
      </PrivyAvailableContext.Provider>
    );
  }

  return (
    <PrivyErrorBoundary
      fallback={
        <PrivyAvailableContext.Provider value={false}>
          {children}
        </PrivyAvailableContext.Provider>
      }
    >
      <PrivyAvailableContext.Provider value={true}>
        <PrivyProviderBase
          appId={appId}
          config={{
            defaultChain: base,
            supportedChains: [base],
            appearance: {
              theme: 'dark',
              accentColor: '#f59e0b',
              logo: '/sbs-logo.png',
              showWalletLoginFirst: true,
              walletList: ['base_account', 'metamask', 'coinbase_wallet'],
            },
            loginMethodsAndOrder: {
              // Privy caps `primary` at 4 (it warns + can render oddly on mobile
              // if you exceed it). Keep the 4 highest-priority methods primary
              // and move the rest to overflow ("more options") so every login
              // method stays available without the >4 warning.
              primary: ['email', 'google', 'twitter', 'metamask'],
              overflow: ['coinbase_wallet'],
            },
            embeddedWallets: {
              // Embedded (email/social) wallets sign SILENTLY — no Privy "Sign
              // message" modal. Transactions were already silenced per-call
              // (sendTransaction uiOptions: showWalletUIs:false); this extends that
              // to SIGNATURES too, so the Seaport listing/offer order signs in the
              // background and listing/offering is fully web2 for embedded users.
              // External wallets (MetaMask/Coinbase) still use their own prompts.
              showWalletUIs: false,
              ethereum: {
                createOnLogin: 'users-without-wallets',
              },
            },
            walletConnectCloudProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
            fundingMethodConfig: {
              moonpay: { useSandbox: false },
            },
          }}
        >
          {children}
        </PrivyProviderBase>
      </PrivyAvailableContext.Provider>
    </PrivyErrorBoundary>
  );
}
