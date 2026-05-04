'use client';

import { PrivyProvider as PrivyProviderBase, usePrivy as usePrivyBase } from '@privy-io/react-auth';
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
              primary: ['email', 'google', 'twitter', 'metamask', 'coinbase_wallet'],
              overflow: [],
            },
            embeddedWallets: {
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
