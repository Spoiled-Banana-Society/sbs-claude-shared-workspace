'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect, useMemo, useRef } from 'react';
import { useSafePrivy as usePrivy, usePrivyAvailable } from '@/providers/PrivyProvider';
import { User } from '@/types';
import { getOwnerUser, getOwnerDraftTokens } from '@/lib/api/owner';
import { ApiError as ClientApiError } from '@/lib/api/client';

const USER_PROFILE_KEY = 'banana-fantasy-user-profile';
const USER_STORAGE_KEYS = [
  USER_PROFILE_KEY,
  'banana-active-drafts',
  'banana-completed-drafts',
  'banana-fantasy-onboarding-complete',
  'hasSeenOnboarding',
];

interface SavedProfile {
  username?: string;
  profilePicture?: string;
  nflTeam?: string;
  draftPasses?: number;
}

interface AuthContextType {
  user: User | null;
  walletAddress: string | null;
  isLoggedIn: boolean;
  isLoading: boolean;
  isNewUser: boolean;
  setIsNewUser: (isNew: boolean) => void;
  showOnboarding: boolean;
  setShowOnboarding: (show: boolean) => void;
  login: (method?: 'wallet' | 'social') => void;
  logout: () => void;
  updateUser: (updates: Partial<User>) => void;
  refreshBalance: () => Promise<void>;
  showLoginModal: boolean;
  setShowLoginModal: (show: boolean) => void;
  // Twitter/X verification
  isTwitterVerified: boolean;
  isTwitterLinking: boolean;
  twitterError: string | null;
  linkTwitter: () => void;
  newUserPromoClaimed: boolean;
  claimNewUserPromo: () => Promise<void>;
  isBB3Holder: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function getSavedProfile(): SavedProfile | null {
  if (typeof window === 'undefined') return null;
  try {
    const saved = localStorage.getItem(USER_PROFILE_KEY);
    if (!saved) return null;
    const profile = JSON.parse(saved);
    delete profile.profilePicture;
    return profile;
  } catch {
    return null;
  }
}

function saveProfile(profile: SavedProfile): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Ignore storage errors
  }
}

// ── Mock auth for local testing ──────────────────────────────────────
// Set NEXT_PUBLIC_MOCK_AUTH=true in .env.local to simulate a logged-in
// staging user without Privy. This lets the dev preview see the exact
// same code paths as a real authenticated user on staging.
const MOCK_AUTH = process.env.NEXT_PUBLIC_MOCK_AUTH === 'true';
const MOCK_WALLET = '0xd3301bC039faF4223dA98bcEB5Fb818C9993620';
const MOCK_USER: User | null = MOCK_AUTH
  ? {
      id: 'mock-user-001',
      username: 'TestUser',
      walletAddress: MOCK_WALLET,
      loginMethod: 'social',
      draftPasses: 21,
      usdcBalance: 0,
      freeDrafts: 0,
      wheelSpins: 0,
      jackpotEntries: 0,
      hofEntries: 0,
      isVerified: true,
      createdAt: '2025-01-01T00:00:00Z',
    }
  : null;

const REFERRAL_CODE_KEY = 'banana-referral-code';

export function AuthProvider({ children }: { children: ReactNode }) {
  const privy = usePrivy();
  const privyAvailable = usePrivyAvailable();
  const [user, setUser] = useState<User | null>(MOCK_USER);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [isNewUser, setIsNewUser] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Capture ?ref= param from URL into sessionStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const refCode = params.get('ref');
    if (refCode) {
      sessionStorage.setItem(REFERRAL_CODE_KEY, refCode);
    }
  }, []);

  // Twitter/X verification state
  const [isTwitterVerified, setIsTwitterVerified] = useState(false);
  const [isTwitterLinking, setIsTwitterLinking] = useState(false);
  const [twitterError, setTwitterError] = useState<string | null>(null);
  const [newUserPromoClaimed, setNewUserPromoClaimed] = useState(false);
  const [isBB3Holder, setIsBB3Holder] = useState(false);

  // Verify Twitter link with backend (anti-sybil check + Firestore storage)
  const verifyTwitterWithBackend = useCallback(async (
    twitterId: string,
    twitterHandle: string,
    wallet: string,
  ) => {
    try {
      const res = await fetch('/api/auth/verify-twitter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ twitterId, twitterHandle, walletAddress: wallet }),
      });
      const data = await res.json();
      if (data.verified) {
        setIsTwitterVerified(true);
        setTwitterError(null);
        setNewUserPromoClaimed(data.newUserPromoClaimed ?? false);
        setUser((prev) => prev ? { ...prev, xHandle: `@${data.handle}` } : prev);
      } else {
        setTwitterError(data.error || 'Verification failed');
        setIsTwitterVerified(false);
      }
    } catch {
      setTwitterError('Failed to verify X account');
    } finally {
      setIsTwitterLinking(false);
    }
  }, []);

  // Check if wallet already has a verified Twitter link (on login)
  const checkExistingTwitterLink = useCallback(async (wallet: string) => {
    try {
      const res = await fetch(`/api/auth/verify-twitter?walletAddress=${encodeURIComponent(wallet)}`);
      const data = await res.json();
      if (data.verified) {
        setIsTwitterVerified(true);
        setNewUserPromoClaimed(data.newUserPromoClaimed ?? false);
        setUser((prev) => prev ? { ...prev, xHandle: `@${data.handle}` } : prev);
      }
    } catch {
      // Silent — don't block auth if check fails
    }
  }, []);

  // Derive wallet address from Privy user — prioritize external wallets (MetaMask etc)
  const walletAddress = useMemo(() => {
    if (MOCK_AUTH) return MOCK_WALLET;
    if (!privy.user) return null;
    // First: look for an external (non-Privy) wallet
    const external = privy.user.linkedAccounts?.find(
      (a: { type: string; walletClientType?: string; walletClient?: string }) =>
        a.type === 'wallet' && a.walletClientType !== 'privy' && a.walletClient !== 'privy'
    ) as { address?: string } | undefined;
    if (external?.address) return external.address;
    // Fallback: any wallet (embedded Privy wallet)
    const anyWallet = privy.user.linkedAccounts?.find(
      (a: { type: string }) => a.type === 'wallet'
    ) as { address?: string } | undefined;
    if (anyWallet?.address) return anyWallet.address;
    // Last resort: wallet field
    const w = privy.user.wallet;
    return w?.address ?? null;
  }, [privy.user]);

  // Track whether we've already started fetching for this wallet
  const fetchingRef = useRef<string | null>(null);

  // Check for existing Twitter link on login (also triggers after linkTwitter OAuth redirect)
  useEffect(() => {
    if (!walletAddress) {
      setIsTwitterVerified(false);
      setTwitterError(null);
      return;
    }
    // Check Privy linkedAccounts first for already-linked Twitter
    const twitterAccount = privy.user?.linkedAccounts?.find(
      (a: { type: string }) => a.type === 'twitter_oauth'
    ) as { subject?: string; username?: string } | undefined;
    if (twitterAccount?.subject && twitterAccount?.username) {
      // Already linked via Privy — verify with backend
      verifyTwitterWithBackend(twitterAccount.subject, twitterAccount.username, walletAddress);
    } else {
      // Check backend for previously stored link
      checkExistingTwitterLink(walletAddress);
    }
  }, [walletAddress, privy.user, verifyTwitterWithBackend, checkExistingTwitterLink]);

  // Sync Privy auth state → local user (with real backend profile fetch)
  useEffect(() => {
    if (MOCK_AUTH) return; // Skip Privy sync in mock mode
    if (privy.ready && privy.authenticated && privy.user && walletAddress) {
      // Avoid duplicate fetches for the same wallet
      if (fetchingRef.current === walletAddress) return;
      fetchingRef.current = walletAddress;

      const savedProfile = getSavedProfile();
      // Determine login method: 'wallet' only if user has a non-embedded (external) wallet.
      // privy.user.wallet exists for ALL users (embedded wallets are auto-created),
      // so we check walletClientType to distinguish external wallet logins.
      const walletAccounts = privy.user.linkedAccounts?.filter(
        (a: { type: string }) => a.type === 'wallet'
      );
      console.log('[SBS Auth] Wallet accounts:', JSON.stringify(walletAccounts));
      console.log('[SBS Auth] All linked accounts types:', privy.user.linkedAccounts?.map((a: { type: string; walletClientType?: string; walletClient?: string }) => `${a.type}/${a.walletClientType || a.walletClient || 'none'}`));
      const hasExternalWallet = privy.user.linkedAccounts?.some(
        (a: { type: string; walletClientType?: string; walletClient?: string }) =>
          a.type === 'wallet' && a.walletClientType !== 'privy' && a.walletClient !== 'privy'
      );
      console.log('[SBS Auth] hasExternalWallet:', hasExternalWallet);
      const loginMethod: 'wallet' | 'social' = hasExternalWallet ? 'wallet' : 'social';
      console.log('[SBS Auth] loginMethod:', loginMethod);

      // Try to fetch real SBS profile from backend
      getOwnerUser(walletAddress)
        .then((backendUser) => {
          // Merge backend data with any locally saved profile overrides
          // Always use backend draftPasses (real token count from API)
          const merged: User = {
            ...backendUser,
            loginMethod,
            username: savedProfile?.username || backendUser.username,
            profilePicture: savedProfile?.profilePicture || backendUser.profilePicture,
            nflTeam: savedProfile?.nflTeam || backendUser.nflTeam,
          };
          setUser(merged);
          setIsNewUser(false);
          setShowOnboarding(false);
        })
        .catch((err) => {
          // Backend unreachable or user not found — fall back to Privy-only profile
          const isNotFound = err instanceof ClientApiError && err.status === 404;
          const fallbackUser: User = {
            id: privy.user!.id,
            username: savedProfile?.username || walletAddress.slice(0, 6) + '...' + walletAddress.slice(-4),
            walletAddress,
            loginMethod,
            profilePicture: savedProfile?.profilePicture,
            nflTeam: savedProfile?.nflTeam,
            xHandle: undefined,
            draftPasses: savedProfile?.draftPasses || 0,
            usdcBalance: 0,
            freeDrafts: 0,
            wheelSpins: 0,
            jackpotEntries: 0,
            hofEntries: 0,
            isVerified: false,
            createdAt: new Date().toISOString(),
          };
          setUser(fallbackUser);
          if (isNotFound) {
            setIsNewUser(true);
            setShowOnboarding(true);
            // Track referral if ref code exists
            const refCode = typeof window !== 'undefined' ? sessionStorage.getItem(REFERRAL_CODE_KEY) : null;
            if (refCode) {
              fetch('/api/referrals/track', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  referrerCode: refCode,
                  referredUserId: fallbackUser.id,
                  referredUsername: fallbackUser.username,
                }),
              })
                .then(() => sessionStorage.removeItem(REFERRAL_CODE_KEY))
                .catch(() => { /* silent — referral tracking is best-effort */ });
            }
          } else {
            setIsNewUser(false);
            setShowOnboarding(false);
          }
        });
    } else if (privy.ready && !privy.authenticated) {
      setUser(null);
      fetchingRef.current = null;
      setIsNewUser(false);
      setShowOnboarding(false);
    }
  }, [privy.ready, privy.authenticated, privy.user, walletAddress]);

  // Read on-chain NFT balance + USDC balance and sync to user
  // Runs on login, every 30s, and on network reconnect
  useEffect(() => {
    if (MOCK_AUTH) return; // Skip on-chain reads in mock mode
    if (!walletAddress || !user) return;

    const BBB4_ADDRESS = '0x14065412b3A431a660e6E576A14b104F1b3E463b';
    const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
    const balanceOfSig = '0x70a08231'; // balanceOf(address)
    const paddedAddr = walletAddress.slice(2).toLowerCase().padStart(64, '0');

    const readBalances = () => {
      // Batch both reads in one fetch using JSON-RPC batch
      fetch('https://mainnet.base.org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          {
            jsonrpc: '2.0', id: 1, method: 'eth_call',
            params: [{ to: BBB4_ADDRESS, data: balanceOfSig + paddedAddr }, 'latest'],
          },
          {
            jsonrpc: '2.0', id: 2, method: 'eth_call',
            params: [{ to: USDC_ADDRESS, data: balanceOfSig + paddedAddr }, 'latest'],
          },
        ]),
      })
        .then((res) => res.json())
        .then((results) => {
          if (!Array.isArray(results)) return;
          const nftResult = results.find((r: { id: number }) => r.id === 1);
          const usdcResult = results.find((r: { id: number }) => r.id === 2);

          setUser((prev) => {
            if (!prev) return prev;
            let changed = false;
            let updated = prev;

            // NFT on-chain balance — informational only.
            // draftPasses is set by getOwnerDraftTokens (server-side token count).
            // Do NOT overwrite draftPasses with on-chain NFT balance.

            // USDC balance (6 decimals)
            if (usdcResult?.result) {
              const rawUsdc = parseInt(usdcResult.result, 16);
              const usdcBalance = rawUsdc / 1e6;
              if (prev.usdcBalance !== usdcBalance) {
                updated = { ...updated, usdcBalance };
                changed = true;
              }
            }

            return changed ? updated : prev;
          });
        })
        .catch(() => { /* silent — don't break auth if RPC fails */ });
    };

    // Read immediately
    readBalances();

    // Poll every 30s
    const interval = setInterval(readBalances, 30_000);

    // Re-read on network reconnect
    const onOnline = () => { setTimeout(readBalances, 1000); };
    window.addEventListener('online', onOnline);

    return () => {
      clearInterval(interval);
      window.removeEventListener('online', onOnline);
    };
  }, [walletAddress, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Check BB3 (Eth mainnet) to identify returning players
  useEffect(() => {
    if (MOCK_AUTH) return;
    if (!walletAddress) return;

    const BB3_ADDRESS = '0x2BfF6f4284774836d867CEd2e9B96c27aAee55B7';
    const balanceOfSig = '0x70a08231';
    const paddedAddr = walletAddress.slice(2).toLowerCase().padStart(64, '0');

    fetch('https://eth.llamarpc.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{ to: BB3_ADDRESS, data: balanceOfSig + paddedAddr }, 'latest'],
      }),
    })
      .then(res => res.json())
      .then(result => {
        if (result?.result) {
          setIsBB3Holder(parseInt(result.result, 16) > 0);
        }
      })
      .catch(() => { /* silent */ });
  }, [walletAddress]);

  // Fetch wheelSpins / freeDrafts / entries from Firestore on login.
  // The Go backend (getOwnerUser) doesn't store these, so we need a
  // separate Firestore read to hydrate them on page load.
  const balanceFetchedRef = useRef<string | null>(null);
  useEffect(() => {
    const userId = user?.id;
    if (!userId) { balanceFetchedRef.current = null; return; }
    if (balanceFetchedRef.current === userId) return;
    balanceFetchedRef.current = userId;

    fetch(`/api/owner/balance?userId=${encodeURIComponent(userId)}`)
      .then(res => res.json())
      .then(data => {
        if (data && typeof data.wheelSpins === 'number') {
          setUser(prev => {
            if (!prev || prev.id !== userId) return prev;
            return {
              ...prev,
              wheelSpins: data.wheelSpins,
              freeDrafts: data.freeDrafts ?? prev.freeDrafts,
              jackpotEntries: data.jackpotEntries ?? prev.jackpotEntries,
              hofEntries: data.hofEntries ?? prev.hofEntries,
            };
          });
        }
      })
      .catch(() => { /* silent — don't block auth */ });
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback((_method?: 'wallet' | 'social') => {
    privy.login();
  }, [privy]);

  const logout = useCallback(async () => {
    await privy.logout();
    setUser(null);
    if (typeof window !== 'undefined') {
      USER_STORAGE_KEYS.forEach((key) => {
        try { localStorage.removeItem(key); } catch { /* ignore */ }
      });
    }
  }, [privy]);

  const updateUser = useCallback((updates: Partial<User>) => {
    setUser((prev) => {
      if (!prev) return null;
      const updated = { ...prev, ...updates };
      saveProfile({
        username: updated.username,
        profilePicture: updated.profilePicture,
        nflTeam: updated.nflTeam,
      });
      return updated;
    });
  }, []);

  // Re-fetch draftPasses (Go backend tokens) and freeDrafts/wheelSpins (Firestore).
  // Call after minting, purchasing, or claiming promos that affect balances.
  const refreshBalance = useCallback(async () => {
    const addr = walletAddress;
    const userId = user?.id;
    if (!addr && !userId) return;

    const [tokens, firestoreBalance] = await Promise.all([
      addr ? getOwnerDraftTokens(addr).catch(() => null) : null,
      userId
        ? fetch(`/api/owner/balance?userId=${encodeURIComponent(userId)}`)
            .then(r => r.json())
            .catch(() => null)
        : null,
    ]);

    setUser(prev => {
      if (!prev) return prev;
      const updated = { ...prev };
      if (tokens) {
        updated.draftPasses = tokens.filter(t => !t.leagueId).length;
      }
      if (firestoreBalance && typeof firestoreBalance.wheelSpins === 'number') {
        updated.wheelSpins = firestoreBalance.wheelSpins;
        updated.freeDrafts = firestoreBalance.freeDrafts ?? updated.freeDrafts;
        updated.jackpotEntries = firestoreBalance.jackpotEntries ?? updated.jackpotEntries;
        updated.hofEntries = firestoreBalance.hofEntries ?? updated.hofEntries;
      }
      return updated;
    });
  }, [walletAddress, user?.id]);

  // Trigger Privy's Twitter OAuth linking flow
  // linkTwitter() redirects to Twitter — when user returns, privy.user updates
  // with the new linkedAccount, which our effect above detects and verifies.
  const handleLinkTwitter = useCallback(() => {
    if (!privyAvailable || !walletAddress) return;
    setIsTwitterLinking(true);
    setTwitterError(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (privy as any).linkTwitter();
    } catch (err) {
      console.error('[SBS Auth] linkTwitter error:', err);
      setTwitterError('Failed to open X login');
      setIsTwitterLinking(false);
    }
  }, [privyAvailable, walletAddress, privy]);

  const claimNewUserPromo = useCallback(async () => {
    if (!walletAddress) return;
    try {
      await fetch('/api/auth/verify-twitter', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress }),
      });
      setNewUserPromoClaimed(true);
    } catch {
      // Silent — claim tracking is best-effort
    }
  }, [walletAddress]);

  return (
    <AuthContext.Provider
      value={{
        user,
        walletAddress: walletAddress ?? (MOCK_AUTH ? MOCK_WALLET : null),
        isLoggedIn: !!user,
        isLoading: MOCK_AUTH ? false : !privy.ready,
        isNewUser,
        setIsNewUser,
        showOnboarding,
        setShowOnboarding,
        login,
        logout,
        updateUser,
        refreshBalance,
        showLoginModal,
        setShowLoginModal,
        isTwitterVerified,
        isTwitterLinking,
        twitterError,
        linkTwitter: handleLinkTwitter,
        newUserPromoClaimed,
        claimNewUserPromo,
        isBB3Holder,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
