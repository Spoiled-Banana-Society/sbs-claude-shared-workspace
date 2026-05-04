'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect, useMemo, useRef } from 'react';
import { useSafePrivy as usePrivy, usePrivyAvailable } from '@/providers/PrivyProvider';
import { User } from '@/types';
import { getOwnerUser, updateOwnerDisplayName, updateOwnerPfpImage } from '@/lib/api/owner';
import { ApiError as ClientApiError } from '@/lib/api/client';
import { MobileLoginModal } from '@/components/modals/MobileLoginModal';
import { logger } from '@/lib/logger';

const USER_PROFILE_KEY = 'banana-fantasy-user-profile';
const USER_BALANCE_KEY = 'banana-fantasy-user-balance';
const USER_STORAGE_KEYS = [
  USER_PROFILE_KEY,
  USER_BALANCE_KEY,
  // NOTE: 'banana-active-drafts' intentionally NOT cleared on logout
  // so filling/in-progress drafts persist across login sessions
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
  isBalanceLoaded: boolean;
  isNewUser: boolean;
  setIsNewUser: (isNew: boolean) => void;
  showOnboarding: boolean;
  setShowOnboarding: (show: boolean) => void;
  login: (method?: 'wallet' | 'social') => void;
  logout: () => void;
  updateUser: (updates: Partial<User>) => void;
  refreshBalance: () => Promise<void>;
  /**
   * Poll /api/owner/balance every `intervalMs` until `predicate` returns true
   * for the latest balance snapshot or `timeoutMs` elapses. Each poll updates
   * the user state in place so the UI ticks the moment the on-chain truth
   * catches up — removes the "mint confirmed but balance still shows old"
   * 1–2s window caused by RPC edge caching.
   */
  refreshBalanceUntil: (
    predicate: (balance: {
      draftPasses: number;
      freeDrafts: number;
      wheelSpins: number;
      jackpotEntries: number;
      hofEntries: number;
    }) => boolean,
    opts?: { timeoutMs?: number; intervalMs?: number },
  ) => Promise<boolean>;
  showLoginModal: boolean;
  setShowLoginModal: (show: boolean) => void;
  isEmbeddedWallet: boolean;
  // Twitter/X verification
  isTwitterVerified: boolean;
  isTwitterLinking: boolean;
  twitterError: string | null;
  linkTwitter: () => void;
  newUserPromoClaimed: boolean;
  claimNewUserPromo: () => Promise<void>;
  isBB3Holder: boolean;
  showMobileLoginModal: boolean;
  setShowMobileLoginModal: (show: boolean) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function getSavedProfile(): SavedProfile | null {
  if (typeof window === 'undefined') return null;
  try {
    const saved = localStorage.getItem(USER_PROFILE_KEY);
    if (!saved) return null;
    const profile = JSON.parse(saved);
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

function getCachedUser(): User | null {
  if (typeof window === 'undefined') return null;
  try {
    const saved = localStorage.getItem(USER_BALANCE_KEY);
    if (!saved) return null;
    return JSON.parse(saved) as User;
  } catch {
    return null;
  }
}

function saveCachedUser(user: User | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (user) {
      localStorage.setItem(USER_BALANCE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(USER_BALANCE_KEY);
    }
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
      cardPurchaseCount: 0,
      isVerified: true,
      createdAt: '2025-01-01T00:00:00Z',
    }
  : null;

const REFERRAL_CODE_KEY = 'banana-referral-code';

export function AuthProvider({ children }: { children: ReactNode }) {
  const privy = usePrivy();
  const privyAvailable = usePrivyAvailable();
  const [user, setUser] = useState<User | null>(MOCK_USER);
  const [isBalanceLoaded, setIsBalanceLoaded] = useState(MOCK_AUTH);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showMobileLoginModal, setShowMobileLoginModal] = useState(false);
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
      const token = await privy.getAccessToken();
      const res = await fetch('/api/auth/verify-twitter', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
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
        // Auto-unlink the Twitter account from Privy so the user can retry
        // with a different X. Otherwise Privy's linkedAccounts keeps the
        // failed X attached and every reload re-runs the same conflict.
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (privy as any).unlinkTwitter?.(twitterId);
        } catch (unlinkErr) {
          console.warn('[SBS Auth] unlinkTwitter after failed verify failed:', unlinkErr);
        }
      }
    } catch {
      setTwitterError('Failed to verify X account');
    } finally {
      setIsTwitterLinking(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

      // Track current wallet (drafts are filtered by wallet in useActiveDrafts, not deleted)
      try {
        localStorage.setItem('banana-last-wallet', walletAddress.toLowerCase());
      } catch { /* ignore */ }

      const savedProfile = getSavedProfile();
      // Determine login method: 'wallet' only if user has a non-embedded (external) wallet.
      // privy.user.wallet exists for ALL users (embedded wallets are auto-created),
      // so we check walletClientType to distinguish external wallet logins.
      const walletAccounts = privy.user.linkedAccounts?.filter(
        (a: { type: string }) => a.type === 'wallet'
      );
      if (process.env.NEXT_PUBLIC_ENVIRONMENT === 'staging') {
        logger.debug('[SBS Auth] Wallet accounts:', JSON.stringify(walletAccounts));
        logger.debug('[SBS Auth] All linked accounts types:', privy.user.linkedAccounts?.map((a: { type: string; walletClientType?: string; walletClient?: string }) => `${a.type}/${a.walletClientType || a.walletClient || 'none'}`));
      }
      const hasExternalWallet = privy.user.linkedAccounts?.some(
        (a: { type: string; walletClientType?: string; walletClient?: string }) =>
          a.type === 'wallet' && a.walletClientType !== 'privy' && a.walletClient !== 'privy'
      );

      // Record wallet type + device for activity analytics. One-shot per
      // session — useful denormalized context on every activity event we
      // write downstream (purchases, spins, grants, etc.).
      const walletType = hasExternalWallet ? 'privy_external' : 'privy_embedded';
      fetch('/api/user/metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: walletAddress.toLowerCase(),
          walletType,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        }),
      }).catch(() => { /* best-effort analytics */ });
      if (process.env.NEXT_PUBLIC_ENVIRONMENT === 'staging') {
        logger.debug('[SBS Auth] hasExternalWallet:', hasExternalWallet);
      }
      const loginMethod: 'wallet' | 'social' = hasExternalWallet ? 'wallet' : 'social';
      if (process.env.NEXT_PUBLIC_ENVIRONMENT === 'staging') {
        logger.debug('[SBS Auth] loginMethod:', loginMethod);
      }

      // Track referral if a ref code is in sessionStorage and the user
      // hasn't already been linked to a referrer. Idempotent server-side
      // (trackReferral skips duplicate entries), but we additionally guard
      // here so we don't re-overwrite `referredBy` once it's set.
      const fireReferralTrack = (id: string, username: string) => {
        const refCode = typeof window !== 'undefined'
          ? sessionStorage.getItem(REFERRAL_CODE_KEY)
          : null;
        if (!refCode) return;
        fetch('/api/referrals/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            referrerCode: refCode,
            referredUserId: id,
            referredUsername: username,
          }),
        })
          .then(() => sessionStorage.removeItem(REFERRAL_CODE_KEY))
          .catch(() => { /* silent — referral tracking is best-effort */ });
      };

      // Try to fetch real SBS profile from backend
      getOwnerUser(walletAddress)
        .then((backendUser) => {
          // Merge backend data with any locally saved profile overrides
          // Always use backend draftPasses (real token count from API)
          const merged: User = {
            ...backendUser,
            loginMethod,
            username: backendUser.username || savedProfile?.username || backendUser.walletAddress,
            profilePicture: savedProfile?.profilePicture || backendUser.profilePicture,
            nflTeam: savedProfile?.nflTeam || backendUser.nflTeam,
          };
          setUser(merged);
          setIsNewUser(false);
          setShowOnboarding(false);
          // Auto-seeding on the backend can create the user before this
          // hook runs, so a 200 response doesn't mean "no referral to track".
          // Fire the track call if we have a code and no existing referrer.
          if (!merged.referredBy) {
            fireReferralTrack(merged.id, merged.username);
          }
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
            cardPurchaseCount: 0,
            isVerified: false,
            createdAt: new Date().toISOString(),
          };
          setUser(fallbackUser);
          if (isNotFound) {
            setIsNewUser(true);
            setShowOnboarding(true);
            fireReferralTrack(fallbackUser.id, fallbackUser.username);
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
      fetch(process.env.NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL || 'https://mainnet.base.org', {
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
            // draftPasses is sourced from Firestore (via /api/owner/balance and
            // the SSE stream). Do NOT overwrite it with on-chain BBB4 balance —
            // BBB4 doesn't burn on use, so balanceOf permanently inflates after
            // any pass is consumed in a draft.

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

  // Live balance sync — real-time push via Server-Sent Events.
  //
  // /api/owner/balance/stream is a long-lived SSE connection. The server
  // subscribes to Firestore onSnapshot on the user doc with the Admin SDK,
  // so any write — Alchemy Transfer webhook, balance writethrough, admin
  // grant, spin mint, promo claim — pushes a fresh payload to the client
  // within ~200ms of the on-chain event being confirmed.
  //
  // Replaces the old 15s polling loop. EventSource auto-reconnects if the
  // serverless function times out (~55s) or the network blips, so the
  // connection is effectively permanent from the client's perspective.
  //
  // Fallback: if SSE fails repeatedly (e.g. proxy strips streams), the
  // 15s polling interval kicks back in.
  useEffect(() => {
    const userId = user?.id;
    if (!userId) return;

    let cancelled = false;
    let eventSource: EventSource | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let consecutiveFailures = 0;

    const applyPayload = (data: unknown) => {
      if (cancelled || !data || typeof data !== 'object') return;
      const d = data as Record<string, unknown>;
      if (typeof d.wheelSpins !== 'number') return;
      setUser((prev) => {
        if (!prev || prev.id !== userId) return prev;
        return {
          ...prev,
          wheelSpins: (d.wheelSpins as number) ?? prev.wheelSpins,
          freeDrafts: (d.freeDrafts as number) ?? prev.freeDrafts,
          jackpotEntries: (d.jackpotEntries as number) ?? prev.jackpotEntries,
          hofEntries: (d.hofEntries as number) ?? prev.hofEntries,
          cardPurchaseCount: (d.cardPurchaseCount as number) ?? prev.cardPurchaseCount,
          draftPasses: typeof d.draftPasses === 'number' ? (d.draftPasses as number) : prev.draftPasses,
        };
      });
      setIsBalanceLoaded(true);
    };

    const startPollingFallback = () => {
      if (pollInterval) return;
      const refetch = async () => {
        try {
          const res = await fetch(`/api/owner/balance?userId=${encodeURIComponent(userId)}`);
          if (res.ok) applyPayload(await res.json());
        } catch { /* silent */ }
      };
      void refetch();
      pollInterval = setInterval(refetch, 15_000);
    };

    const connect = () => {
      if (cancelled || eventSource) return;
      try {
        const es = new EventSource(`/api/owner/balance/stream?userId=${encodeURIComponent(userId)}`);
        eventSource = es;

        const onMessage = (ev: MessageEvent) => {
          try { applyPayload(JSON.parse(ev.data)); } catch { /* ignore malformed */ }
          consecutiveFailures = 0;
        };
        es.addEventListener('snapshot', onMessage);
        es.addEventListener('update', onMessage);

        es.onerror = () => {
          consecutiveFailures++;
          // After 3 consecutive failures, fall back to polling. EventSource
          // keeps trying to reconnect in the background in case it recovers.
          if (consecutiveFailures >= 3) startPollingFallback();
        };
      } catch {
        startPollingFallback();
      }
    };

    connect();
    const onFocus = () => {
      // On focus: if SSE was torn down, reconnect. Otherwise a no-op.
      if (!eventSource || eventSource.readyState === 2 /* CLOSED */) {
        eventSource = null;
        connect();
      }
    };
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const isMobile = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  const login = useCallback((_method?: 'wallet' | 'social') => {
    if (isMobile) {
      setShowMobileLoginModal(true);
    } else {
      privy.login();
    }
  }, [privy, isMobile]);

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
      // Sync profile changes to Go API backend (best-effort, don't block UI)
      if (prev.walletAddress) {
        if (updates.username && updates.username !== prev.username) {
          updateOwnerDisplayName(prev.walletAddress, updates.username).catch(() => {});
        }
        if (updates.profilePicture && updates.profilePicture !== prev.profilePicture) {
          updateOwnerPfpImage(prev.walletAddress, updates.profilePicture).catch(() => {});
        }
      }
      return updated;
    });
  }, []);

  // Re-fetch every counter from Firestore (the user-facing source of truth).
  // Call after minting, purchasing, or claiming promos that affect balances.
  //
  // Critical: `draftPasses` MUST come from Firestore, not from the Go API
  // token list. Go API doesn't track staging mints (the staging-mint
  // endpoint writes Firestore directly), so reading `tokens.filter(!leagueId)`
  // here would return 0 right after a mint and clobber the SSE-pushed
  // correct value, causing the header to flicker 5 → 0 → 5.
  const refreshBalance = useCallback(async () => {
    const userId = user?.id;
    if (!userId) return;

    let firestoreBalance: {
      draftPasses?: number;
      freeDrafts?: number;
      wheelSpins?: number;
      jackpotEntries?: number;
      hofEntries?: number;
      cardPurchaseCount?: number;
    } | null = null;
    try {
      const res = await fetch(`/api/owner/balance?userId=${encodeURIComponent(userId)}`);
      if (res.ok) firestoreBalance = await res.json();
    } catch {
      // swallow — keep current state
    }

    if (!firestoreBalance) return;

    setUser(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        draftPasses: typeof firestoreBalance!.draftPasses === 'number' ? firestoreBalance!.draftPasses : prev.draftPasses,
        freeDrafts: typeof firestoreBalance!.freeDrafts === 'number' ? firestoreBalance!.freeDrafts : prev.freeDrafts,
        wheelSpins: typeof firestoreBalance!.wheelSpins === 'number' ? firestoreBalance!.wheelSpins : prev.wheelSpins,
        jackpotEntries: typeof firestoreBalance!.jackpotEntries === 'number' ? firestoreBalance!.jackpotEntries : prev.jackpotEntries,
        hofEntries: typeof firestoreBalance!.hofEntries === 'number' ? firestoreBalance!.hofEntries : prev.hofEntries,
        cardPurchaseCount: typeof firestoreBalance!.cardPurchaseCount === 'number' ? firestoreBalance!.cardPurchaseCount : prev.cardPurchaseCount,
      };
    });
  }, [user?.id]);

  const refreshBalanceUntil = useCallback(
    async (
      predicate: (balance: {
        draftPasses: number;
        freeDrafts: number;
        wheelSpins: number;
        jackpotEntries: number;
        hofEntries: number;
      }) => boolean,
      opts: { timeoutMs?: number; intervalMs?: number } = {},
    ): Promise<boolean> => {
      const userId = user?.id;
      if (!userId) return false;
      const timeoutMs = opts.timeoutMs ?? 10_000;
      const intervalMs = opts.intervalMs ?? 1_000;
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        try {
          const res = await fetch(`/api/owner/balance?userId=${encodeURIComponent(userId)}`);
          if (res.ok) {
            const data = await res.json();
            const snapshot = {
              draftPasses: typeof data.draftPasses === 'number' ? data.draftPasses : 0,
              freeDrafts: typeof data.freeDrafts === 'number' ? data.freeDrafts : 0,
              wheelSpins: typeof data.wheelSpins === 'number' ? data.wheelSpins : 0,
              jackpotEntries: typeof data.jackpotEntries === 'number' ? data.jackpotEntries : 0,
              hofEntries: typeof data.hofEntries === 'number' ? data.hofEntries : 0,
            };
            setUser((prev) => (prev ? { ...prev, ...snapshot } : prev));
            if (predicate(snapshot)) return true;
          }
        } catch {
          // swallow — retry on next tick
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
      return false;
    },
    [user?.id],
  );

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
        isLoading: MOCK_AUTH ? false : (!privy.ready || (privy.authenticated && !user)),
        isBalanceLoaded,
        isNewUser,
        setIsNewUser,
        showOnboarding,
        setShowOnboarding,
        login,
        logout,
        updateUser,
        refreshBalance,
        refreshBalanceUntil,
        showLoginModal,
        setShowLoginModal,
        isEmbeddedWallet: user?.loginMethod === 'social',
        isTwitterVerified,
        isTwitterLinking,
        twitterError,
        linkTwitter: handleLinkTwitter,
        newUserPromoClaimed,
        claimNewUserPromo,
        isBB3Holder,
        showMobileLoginModal,
        setShowMobileLoginModal,
      }}
    >
      {children}
      <MobileLoginModal
        isOpen={showMobileLoginModal}
        onClose={() => setShowMobileLoginModal(false)}
      />
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
