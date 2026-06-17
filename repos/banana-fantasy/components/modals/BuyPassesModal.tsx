'use client';

import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatUnits, type Address } from 'viem';
import { useFundWallet, usePrivy } from '@privy-io/react-auth';
import { Modal } from '../ui/Modal';
import { useAuth } from '@/hooks/useAuth';
import { useMintDraftPass } from '@/hooks/useMintDraftPass';
import { draftPassPricing, feeForQty, FREE_DRAFT_CREDIT_CENTS } from '@/lib/pricing';
import { BASE_SEPOLIA, waitForUsdcArrival, getUsdcBalance } from '@/lib/contracts/bbb4';
import { isStagingMode, getDraftsApiUrl } from '@/lib/staging';
import { fetchJson } from '@/lib/appApiClient';
import { logger } from '@/lib/logger';
import { reportClientError } from '@/lib/clientErrors';
import { clientLog } from '@/lib/clientLog';
import { LOG_SOURCES } from '@/lib/logSources';
import {
  type FlowStep,
  type ModalPhase,
  getPurchaseFlow,
  subscribePurchaseFlow,
  setPurchaseFlow,
  resetPurchaseFlow,
  isPurchaseFlowActive,
} from '@/lib/purchaseFlow';

interface BuyPassesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPurchaseComplete?: (quantity: number) => void;
}

// Map raw on-chain / SDK errors to short, human copy. Users should never see a
// viem revert dump (e.g. "transferFrom reverted ... ERC20: transfer amount
// exceeds balance ... viem@2.52.2").
function friendlyPurchaseError(raw?: string | null): string {
  const fallback = 'Something went wrong with the purchase. Please try again.';
  if (!raw) return fallback;
  const m = raw.toLowerCase();
  if (m.includes('exceeds balance') || m.includes('insufficient')) return "The USDC payment didn't come through — please try again.";
  if (m.includes('allowance')) return "Approval didn't go through — please try again.";
  if (m.includes('wallet not ready')) return 'Wallet not ready — give it a second, then try again.';
  if (m.includes('not yet received') || m.includes('not yet')) return 'Still waiting on your payment to settle — try again in a moment.';
  if (m.includes('rejected') || m.includes('denied')) return 'Signature cancelled — tap Buy to try again.';
  if (m.includes('not active') || m.includes('maintenance') || m.includes('paused')) return 'Purchases are paused for a moment — please try again shortly.';
  if (m.includes('base network') || (m.includes('switch') && m.includes('base'))) return 'Switch your wallet to the Base network and try again.';
  // Hide anything that looks like a raw contract/SDK dump; keep already-short copy.
  if (m.includes('revert') || m.includes('viem') || m.includes('0x') || raw.length > 90) return fallback;
  return raw;
}

export function BuyPassesModal({
  isOpen,
  onClose,
  onPurchaseComplete,
}: BuyPassesModalProps) {
  const _router = useRouter();
  const { user, walletAddress, updateUser, refreshBalance, refreshBalanceUntil } = useAuth();
  const { mint, mintStep, error: mintError, paymentPending: mintPaymentPending, txHash, tokenPrice, mintActive } = useMintDraftPass();
  const { fundWallet } = useFundWallet({
    onUserExited: ({ balance, fundingMethod }) => {
      logger.debug('[BuyModal] Fund wallet exited:', { balance: balance?.toString(), fundingMethod });
    },
  });
  // Used to authenticate the session-beacon call (MoonPay path) so admin
  // sees opened-popup attempts even when the user closes Privy's flow
  // mid-purchase.
  const { getAccessToken } = usePrivy();

  // Purchase flow state lives in a module-level store so it survives modal
  // close/reopen — the card path opens MoonPay externally and a remount
  // mid-flow used to wipe the user's progress indicator. See lib/purchaseFlow.ts.
  const flow = useSyncExternalStore(subscribePurchaseFlow, getPurchaseFlow, getPurchaseFlow);
  const { quantity, flowStep, flowError, phase, mintedCount, joinError, isJoiningDraft } = flow;
  const setQuantity = (q: number) => setPurchaseFlow({ quantity: q });
  const setFlowStep = (s: FlowStep) => setPurchaseFlow({ flowStep: s });
  const setFlowError = (e: string | null) => setPurchaseFlow({ flowError: e });
  const setPhase = (p: ModalPhase) => setPurchaseFlow({ phase: p });
  const setMintedCount = (n: number) => setPurchaseFlow({ mintedCount: n });
  const setJoinError = (e: string | null) => setPurchaseFlow({ joinError: e });
  const setIsJoiningDraft = (b: boolean) => setPurchaseFlow({ isJoiningDraft: b });
  const joinInFlightRef = useRef(false);

  const loggedInWithWallet = user?.loginMethod === 'wallet';
  const [paymentMethod, setPaymentMethod] = useState<'usdc' | 'card'>('card');
  // Card path = MoonPay only for now. Coinbase Onramp was wired in
  // earlier but pulled until our CDP project gets approved out of
  // trial mode (default $5/transaction cap blocks $25 draft passes).
  // The plumbing (audit log, buy-session/buy-status endpoints) is
  // still in the codebase — easy to re-enable later by restoring
  // the picker UI + the Coinbase route in handlePurchase.
  const [paymentMethodInitialized, setPaymentMethodInitialized] = useState(false);

  // Lightweight "not enough USDC" notice for the USDC-on-Base path. Kept OUT of
  // the sticky error flowStep on purpose — it's a pre-flight validation, not a
  // failed purchase: it shows only when you tap Buy without enough USDC, and
  // clears the moment you close, change quantity, or switch payment method. Each
  // Buy tap re-reads the live balance, so the instant you actually have enough
  // it just goes through with no error.
  const [usdcShortfall, setUsdcShortfall] = useState<string | null>(null);

  // Referral code / username — paste who referred you (codes are name-based,
  // so the referrer's username works). Sets referredBy via /api/referrals/track
  // before the purchase, so the buy credits the referrer.
  const [referralCode, setReferralCode] = useState('');
  const [referralState, setReferralState] = useState<'idle' | 'applying' | 'applied' | 'error'>('idle');
  const [referralMsg, setReferralMsg] = useState<string | null>(null);
  const applyReferral = async () => {
    const code = referralCode.trim();
    const userId = walletAddress || user?.id;
    if (!code || referralState === 'applying') return;
    if (!userId) { setReferralState('error'); setReferralMsg('Sign in first.'); return; }
    setReferralState('applying'); setReferralMsg(null);
    try {
      const res = await fetch('/api/referrals/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ referrerCode: code, referredUserId: userId, referredUsername: user?.username }),
      });
      const data = await res.json().catch(() => ({} as { error?: string; eligible?: boolean }));
      if (!res.ok) {
        setReferralState('error');
        setReferralMsg(
          data?.error === 'Cannot refer yourself' ? "That's your own code."
            : data?.error === 'Invalid referral code' ? "We couldn't find that code."
            : 'Could not apply that code.',
        );
        return;
      }
      setReferralState('applied');
      // Eligible (new player) → spell out what THEY must do for the friend to
      // earn it. Not eligible (established account) → be honest it won't credit.
      setReferralMsg(
        data?.eligible === false
          ? "Code found ✓ — but your account isn’t new, so your friend won’t be credited."
          : 'Applied ✓ — for your friend to get credit: verify your X AND spin your free Banana Wheel, then buy.',
      );
    } catch {
      setReferralState('error');
      setReferralMsg('Network error — try again.');
    }
  };

  useEffect(() => {
    if (!paymentMethodInitialized && user?.loginMethod) {
      setPaymentMethod(loggedInWithWallet ? 'usdc' : 'card');
      setPaymentMethodInitialized(true);
    }
  }, [user?.loginMethod, loggedInWithWallet, paymentMethodInitialized]);

  // The USDC-shortfall notice is transient — clear it whenever the user closes,
  // changes quantity, or switches payment method, so it never lingers.
  useEffect(() => { setUsdcShortfall(null); }, [quantity, paymentMethod, isOpen]);

  // Reset state when modal opens — but ONLY if there's no in-flight purchase
  // to preserve. If the user closed mid-MoonPay or before clicking "Pick speed",
  // reopening shows the in-flight progress instead of starting over.
  useEffect(() => {
    if (isOpen && !isPurchaseFlowActive()) {
      resetPurchaseFlow();
      joinInFlightRef.current = false;
    }
  }, [isOpen]);

  const { pricePerPass } = draftPassPricing;
  const totalPrice = quantity * pricePerPass;
  const usdcTotal = tokenPrice ? tokenPrice * BigInt(quantity) : null;
  const quantityOptions = [1, 5, 10, 20, 30, 40];
  const isProcessing =
    flowStep === 'funding' ||
    flowStep === 'waiting-for-usdc' ||
    flowStep === 'signing' ||
    flowStep === 'processing';

  // The hook drives its own signing / processing / success state. Mirror
  // it into flowStep so both the USDC and Card paths render the same
  // unified stepper. The card path manages its own funding/waiting steps
  // before handing off to the hook.
  useEffect(() => {
    if (mintStep === 'signing') setFlowStep('signing');
    else if (mintStep === 'processing') setFlowStep('processing');
    else if (mintStep === 'success') setFlowStep('success');
    else if (mintStep === 'error') setFlowStep('error');
  }, [mintStep]);

  const setWaitingForUsdcStartedAt = (t: number | null) =>
    setPurchaseFlow({ waitingForUsdcStartedAt: t });

  // Heartbeat that drives the live progress bar. `stepStartedAt` resets on
  // every flowStep change so the bar can ease forward ("creep") within the
  // current step and snap exactly when the next real milestone fires. The
  // ticker only runs while a purchase is in flight.
  const [nowTick, setNowTick] = useState(Date.now());
  const [stepStartedAt, setStepStartedAt] = useState(Date.now());
  useEffect(() => {
    setStepStartedAt(Date.now());
    setNowTick(Date.now());
  }, [flowStep]);
  useEffect(() => {
    if (flowStep === 'idle' || flowStep === 'success' || flowStep === 'error') return;
    const id = setInterval(() => setNowTick(Date.now()), 300);
    return () => clearInterval(id);
  }, [flowStep]);

  // Cover Privy's vestigial funding modal on the CARD path once payment is
  // confirmed on-chain. Privy never auto-closes its "You've funded / Continue"
  // screen (confirmed in the SDK — the CTA is wired to closePrivyModal with no
  // auto-effect), so from `signing` onward it's just noise sitting on top of
  // our clean flow. We fade it out via Privy's stable element IDs. This is
  // PURELY COSMETIC: the purchase/mint never depend on it, and if Privy ever
  // renames those IDs the rule simply matches nothing → Privy shows exactly as
  // today, with zero impact on the buy. We only hide from `signing` (funds
  // confirmed) — never during funding/waiting, when the user still needs
  // Privy's modal to reach MoonPay. MoonPay's own window is closed by Privy
  // itself on completion. USDC has no Privy funding modal, so this is card-only.
  const coverPrivyModal =
    paymentMethod === 'card' &&
    (flowStep === 'signing' || flowStep === 'processing' || flowStep === 'success');
  useEffect(() => {
    if (!coverPrivyModal) return;
    const style = document.createElement('style');
    style.setAttribute('data-sbs-cover-privy', '');
    style.textContent =
      '#privy-dialog,#privy-dialog-backdrop{opacity:0!important;pointer-events:none!important;transition:opacity .25s ease;}';
    document.head.appendChild(style);
    return () => style.remove();
  }, [coverPrivyModal]);

  /**
   * Track a purchase in Firestore: create record → verify → promo updates.
   * This ensures buy-bonus, mint-promo, and referral milestones are tracked
   * identically in staging and production.
   */
  const trackPurchase = async (qty: number, hash: string) => {
    const userId = walletAddress || user?.id;
    if (!userId) return;

    // OPTIMISTIC UI: the on-chain tx has confirmed (we have a hash), which means
    // the NFT is already in the user's wallet. Reflect it in the UI immediately
    // instead of waiting on the Firestore sync round-trip. Best-in-class crypto
    // UX pattern — never make the user stare at stale counters when the chain
    // has already proven ownership.
    const expectedDraftPasses = (user?.draftPasses ?? 0) + qty;
    if (user) {
      updateUser({
        draftPasses: expectedDraftPasses,
      });
    }

    clientLog('payment', 'track_purchase_start', { userId, quantity: qty, txHash: hash, paymentMethod });

    try {
      const { purchase } = await fetchJson<{ purchase: { id: string } }>('/api/purchases/create', {
        method: 'POST',
        body: JSON.stringify({ userId, quantity: qty, paymentMethod: paymentMethod === 'usdc' ? 'usdc' : 'card' }),
      });
      const verifyRes = await fetchJson<{ user?: unknown }>('/api/purchases/verify', {
        method: 'POST',
        body: JSON.stringify({ purchaseId: purchase.id, txHash: hash }),
      });
      // Server confirmed — merge buy-bonus free drafts + wheel spins + promo
      // fields earned alongside the mint. Deliberately DO NOT clobber
      // `draftPasses` here: on-chain is the source of truth, and the next
      // refreshBalance() call will pull it from Alchemy. Overwriting with the
      // Firestore value would cause a flicker (optimistic bump → stale
      // cached value → real on-chain value).
      if (verifyRes.user) {
        const serverUser = verifyRes.user as Partial<import('@/types').User>;
        const { draftPasses: _ignore, ...rest } = serverUser;
        void _ignore;
        updateUser(rest);
      }
    } catch (err) {
      // Verify failed after a successful on-chain mint. The NFT is real; the
      // counter sync is behind. Log visibly so the user understands their
      // balance will catch up when the backend reconciles.
      console.warn('[BuyModal] Purchase tracking failed (mint succeeded):', err);
      reportClientError({
        source: LOG_SOURCES.payment.CARD_PURCHASE_TRACKING_FAILED,
        message: err instanceof Error ? err.message : String(err),
        route: 'buy-drafts',
        context: { userId, quantity: qty, txHash: hash, paymentMethod },
        stack: err instanceof Error ? err.stack : undefined,
      });
      // No user-facing ping on mint — the balance self-heals via the poll
      // below; the failure is logged for admins only.
    }
    // Live-sync: poll the balance endpoint until the on-chain count reflects
    // the new mint. Covers the 1–2s window where Alchemy's RPC edge can still
    // be serving the pre-mint balanceOf even though the tx has finalized.
    // Self-heals Firestore via the balance endpoint's writethrough, so the
    // header, admin panel, and any other Firestore-direct reader all converge.
    await refreshBalanceUntil((b) => b.draftPasses >= expectedDraftPasses, {
      timeoutMs: 10_000,
      intervalMs: 1_000,
    });
    await refreshBalance();
  };

  // Transition to pick-speed after successful USDC mint
  const txTrackedRef = useRef(false);
  // Abort flag for the card-funding wait loop, so the user can cancel /
  // change their order during funding without a hard refresh.
  const cancelledRef = useRef(false);
  const handleCancelCheckout = () => {
    cancelledRef.current = true;
    setWaitingForUsdcStartedAt(null);
    txTrackedRef.current = false;
    setFlowError(null);
    setFlowStep('idle');
    clientLog('payment', 'checkout_cancelled', { quantity, flowStep });
  };
  useEffect(() => {
    if (txHash && !mintError && phase === 'purchase' && !txTrackedRef.current) {
      txTrackedRef.current = true;
      // Track in Firestore, then transition
      trackPurchase(quantity, txHash).finally(() => {
        setMintedCount(quantity);
        setPhase('pick-speed');
        onPurchaseComplete?.(quantity);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txHash, mintError, phase, quantity, onPurchaseComplete]);

  // Reset txTracked when modal reopens
  useEffect(() => {
    if (isOpen) txTrackedRef.current = false;
  }, [isOpen]);

  const goToPickSpeed = (count: number) => {
    setMintedCount(count);
    setPhase('pick-speed');
    onPurchaseComplete?.(count);
    // No success ping on mint — the pick-speed screen IS the confirmation.
    // (Promo rewards earned alongside still surface their own toast.)
  };

  const handlePurchase = async () => {
    if (!Number.isFinite(quantity) || quantity <= 0) return;

    // One trail per attempt, all flows + login types. Filtering the admin Logs
    // by a wallet shows the full journey: purchase_started → (funding) → mint_*
    // → purchase_succeeded/failed → join_draft_*.
    clientLog('payment', 'purchase_started', {
      wallet: walletAddress,
      quantity,
      paymentMethod,
      loginMethod: user?.loginMethod ?? 'unknown',
    });

    setUsdcShortfall(null);

    if (paymentMethod === 'usdc') {
      try {
        // Pre-flight balance check (LIVE on-chain read each tap) — without it, a
        // user with too little USDC signs, the server transferFrom reverts, and
        // the modal hangs on "Processing." Show a transient inline notice (NOT
        // the sticky error screen) and stay on the form so they can fix it and
        // retry. Re-reads fresh every tap, so it clears itself once funded.
        if (walletAddress) {
          const needed = usdcTotal ?? BigInt(quantity * pricePerPass) * BigInt(10 ** 6);
          try {
            const bal = await getUsdcBalance(walletAddress as Address);
            clientLog('payment', 'usdc_preflight', {
              wallet: walletAddress,
              balanceUsd: (Number(bal) / 1e6).toFixed(2),
              neededUsd: totalPrice,
              sufficient: bal >= needed,
            });
            if (bal < needed) {
              const have = (Number(bal) / 1e6).toFixed(2);
              setUsdcShortfall(`Not enough USDC on Base — $${have} of $${totalPrice}. Add USDC or pay by card.`);
              return;
            }
          } catch {
            // RPC blip reading the balance — don't block; the server still guards.
          }
        }
        await mint(quantity, { paymentMethod: 'usdc' });
        clientLog('payment', 'purchase_succeeded', { wallet: walletAddress, quantity, paymentMethod: 'usdc' });
        // Phase transition handled by useEffect on txHash
      } catch (err) {
        clientLog('payment', 'purchase_failed', {
          wallet: walletAddress,
          quantity,
          paymentMethod: 'usdc',
          step: 'mint',
          error: err instanceof Error ? err.message : String(err),
        });
        // Error surfaced by mint hook
      }
      return;
    }

    // Card / Apple Pay flow
    if (!walletAddress) {
      setFlowError('No wallet connected. Please log in again.');
      setFlowStep('error');
      return;
    }

    if (isProcessing) return;

    cancelledRef.current = false;
    setFlowStep('funding');
    setFlowError(null);

    try {
      const fundingAmount = usdcTotal ? formatUnits(usdcTotal, 6) : String(quantity * pricePerPass);

      // Beacon a session_created record before opening the MoonPay popup
      // so admin sees opened-popup attempts even when the user closes
      // Privy's flow without completing. Fire-and-forget; never block
      // the purchase on it. The eventual completion (in card-mint route)
      // updates this same session to tx_completed.
      void (async () => {
        try {
          const token = await getAccessToken();
          await fetch('/api/onramp/log-session', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              walletAddress,
              provider: 'moonpay',
              amount: Number(fundingAmount),
            }),
          });
        } catch (err) {
          // Best-effort analytics beacon — log so a gap in onramp tracking is visible.
          reportClientError({
            source: LOG_SOURCES.payment.MOONPAY_SESSION_BEACON_FAILED,
            message: err instanceof Error ? err.message : String(err),
            route: 'buy-passes',
            actor: walletAddress,
            context: { provider: 'moonpay', amount: Number(fundingAmount) },
          });
        }
      })();

      // MoonPay-only path: Privy handles the popup, opens straight into
      // MoonPay via defaultFundingMethod='card' + preferredProvider.
      // Coinbase path is wired in the codebase (lib/cdpAuth.buildOnrampUrl,
      // /api/coinbase/buy-session, /api/coinbase/buy-status) but disabled
      // here until the CDP project is approved out of trial mode — the
      // default $5/transaction cap blocks $25 draft passes.
      // Open Privy's MoonPay funding flow and WAIT for it to finish. We tried
      // firing the mint the instant a balance read passed (parallel), but on
      // mobile that fires before the funds are reliably settled across RPC
      // nodes, so the server's transferFrom reverts ("exceeds balance"). Waiting
      // for fundWallet to resolve is the known-good sequencing.
      clientLog('payment', 'funding_opened', { wallet: walletAddress, quantity, amountUsd: fundingAmount });
      const result = await fundWallet({
        address: walletAddress,
        options: {
          chain: BASE_SEPOLIA,
          amount: fundingAmount,
          asset: 'USDC',
          defaultFundingMethod: 'card',
          card: {
            preferredProvider: 'moonpay',
          },
        },
      });
      clientLog('payment', 'funding_result', { wallet: walletAddress, status: result.status });

      if (result.status === 'cancelled') {
        setFlowStep('idle');
        return;
      }

      // Confirm the USDC actually landed before minting — event-driven via the
      // on-chain Transfer subscription (instant once it settles), no polling.
      setFlowStep('waiting-for-usdc');
      const usdcWaitStartedAt = Date.now();
      setWaitingForUsdcStartedAt(usdcWaitStartedAt);

      const totalCostUsdc = usdcTotal ?? BigInt(quantity * pricePerPass) * BigInt(10 ** 6);
      const maxWaitMs = 300_000; // 5 minutes max (MoonPay card payments can take a few minutes)

      const funded = await waitForUsdcArrival(walletAddress as Address, totalCostUsdc, {
        timeoutMs: maxWaitMs,
        isCancelled: () => cancelledRef.current,
        onError: (err) => {
          reportClientError({
            source: LOG_SOURCES.payment.USDC_BALANCE_POLL_FAILED,
            message: err instanceof Error ? err.message : String(err),
            route: 'buy-passes',
            actor: walletAddress,
            context: { totalCostUsdc: String(totalCostUsdc) },
          });
        },
      });
      if (cancelledRef.current) return;
      if (!funded) {
        clientLog('payment', 'usdc_timeout', { wallet: walletAddress, waitedMs: Date.now() - usdcWaitStartedAt });
        throw new Error('USDC not yet received. Please try minting again in a few minutes.');
      }
      clientLog('payment', 'usdc_arrived', { wallet: walletAddress, waitedMs: Date.now() - usdcWaitStartedAt });

      setWaitingForUsdcStartedAt(null);
      // mint() drives flowStep from here on via mintStep → useEffect above:
      // signing → processing → success / error. cardProvider passed for
      // admin onramp_attempts logging — currently always 'moonpay'.
      await mint(quantity, { paymentMethod: 'card', cardProvider: 'moonpay' });
      clientLog('payment', 'purchase_succeeded', { wallet: walletAddress, quantity, paymentMethod: 'card' });
      setFlowStep('success');
      setMintedCount(quantity);
      // Stop here. Don't auto-advance to pick-speed — the user needs to see
      // the success confirmation, otherwise they come back from MoonPay
      // wondering whether their card was charged. They click the explicit
      // "Pick draft speed" button below to continue.
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Payment failed. Please try again.';
      clientLog('payment', 'purchase_failed', {
        wallet: walletAddress,
        quantity,
        paymentMethod: 'card',
        error: message,
      });
      setFlowError(message);
      setFlowStep('error');
    }
  };

  const handlePickSpeed = async (speed: 'fast' | 'slow') => {
    if (joinInFlightRef.current) {
      console.warn('[BuyModal] Duplicate join blocked: join already in flight');
      return;
    }
    joinInFlightRef.current = true;
    setIsJoiningDraft(true);

    const addr = walletAddress || user?.id || 'staging-user';

    setPhase('joining');
    setJoinError(null);
    clientLog('payment', 'join_draft_start', { wallet: addr, speed });

    try {
      // Join a draft
      const apiBase = getDraftsApiUrl();
      logger.debug('[BuyModal] Joining draft:', { apiBase, speed, addr });
      // Draft TYPE is decided solely by the backend's provably-fair logic —
      // the client never sends a draftType (would be a rigged-outcome vector).
      const joinRes = await fetch(`${apiBase}/league/${speed}/owner/${addr}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numLeaguesToJoin: 1 }),
      });

      if (!joinRes.ok) {
        const errText = await joinRes.text().catch(() => 'Unknown error');
        throw new Error(`Join failed (${joinRes.status}): ${errText}`);
      }

      const joinData = await joinRes.json();
      logger.debug('[BuyModal] Join response:', JSON.stringify(joinData));
      // API returns an array of joined cards
      const card = Array.isArray(joinData) ? joinData[0] : joinData;
      const draftId = String(card?._leagueId ?? card?.draftId ?? card?.leagueId ?? card?.id ?? '');
      const contestName = String(card?._leagueDisplayName ?? card?.displayName ?? `Draft ${draftId}`);
      logger.debug('[BuyModal] Parsed:', { draftId, contestName });

      if (!draftId) throw new Error('No draft ID returned from join API');
      clientLog('payment', 'join_draft_success', { wallet: addr, speed, draftId });

      // In staging mode, bots will fill AFTER user lands in draft room lobby
      // (triggered by draft-room page once WebSocket connects)

      // Save to localStorage
      try {
        const existing = JSON.parse(localStorage.getItem('banana-active-drafts') || '[]');
        existing.push({
          id: draftId,
          contestName,
          status: 'filling',
          type: 'pro',
          draftSpeed: speed,
          players: 1,
          maxPlayers: 10,
          joinedAt: Date.now(),
        });
        localStorage.setItem('banana-active-drafts', JSON.stringify(existing));
      } catch { /* ignore */ }

      // Navigate to draft lobby with staging params
      const params = new URLSearchParams({
        id: draftId,
        name: contestName,
        speed,
      });
      if (isStagingMode() && addr) {
        params.set('mode', 'live');
        params.set('wallet', addr);
      }
      if (typeof window !== 'undefined') {
        const current = new URLSearchParams(window.location.search);
        if (current.get('staging') === 'true') params.set('staging', 'true');
        const apiUrl = current.get('apiUrl');
        const wsUrl = current.get('wsUrl');
        if (apiUrl) params.set('apiUrl', apiUrl);
        if (wsUrl) params.set('wsUrl', wsUrl);
      }
      const lobbyUrl = `/draft-room?${params.toString()}`;
      logger.debug('[BuyModal] Navigating to:', lobbyUrl);
      window.location.href = lobbyUrl;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to join draft';
      console.error('[BuyModal] Join error:', msg, err);
      clientLog('payment', 'join_draft_failed', { wallet: addr, speed, error: msg });
      joinInFlightRef.current = false;
      setIsJoiningDraft(false);
      setJoinError(msg);
      setPhase('error');
    }
  };

  const isWeb2 = user?.loginMethod === 'social';

  // Clean, crypto-free progress model. Each visible row maps to one or more
  // real internal stages (funding / waiting-for-usdc / signing / processing).
  // Card shows 3 rows; USDC prepends a "Confirm with your wallet" row — the
  // bottom three rows are identical across both flows. Same copy for everyone
  // (email, X, wallet), so it can never drift between segments.
  const internalOrder: FlowStep[] =
    paymentMethod === 'card'
      ? ['funding', 'waiting-for-usdc', 'signing', 'processing', 'success']
      : ['signing', 'processing', 'success'];
  const internalIdx =
    flowStep === 'error' || flowStep === 'idle'
      ? 0
      : Math.max(0, internalOrder.indexOf(flowStep));

  // completeAtIdx = internal index at which the row flips to ✓. The active
  // (spinning) row is derived as the first not-yet-complete row.
  type VisibleStep = { label: string; completeAtIdx: number; helper?: string };
  const cardSteps: VisibleStep[] = [
    { label: 'Payment confirmed', completeAtIdx: 2 },
    { label: 'Processing your purchase', completeAtIdx: 3 },
    { label: 'Adding draft pass to your account', completeAtIdx: 4 },
  ];
  const usdcSteps: VisibleStep[] = [
    { label: 'Confirm with your wallet', completeAtIdx: 1, helper: 'Check your wallet to approve.' },
    { label: 'Payment confirmed', completeAtIdx: 1 },
    { label: 'Processing your purchase', completeAtIdx: 2 },
    { label: 'Adding draft pass to your account', completeAtIdx: 2 },
  ];
  const visibleSteps = paymentMethod === 'card' ? cardSteps : usdcSteps;

  const stepStatuses = visibleSteps.map((s) => ({
    ...s,
    complete: flowStep === 'success' ? true : internalIdx >= s.completeAtIdx,
  }));
  // Active = first not-yet-complete row, only while a purchase is in flight.
  const activeRowIdx =
    flowStep === 'idle' || flowStep === 'success' || flowStep === 'error'
      ? -1
      : stepStatuses.findIndex((s) => !s.complete);

  // Real-time bar: snaps forward on each real milestone, and eases within the
  // active step so it always looks live (never frozen). The longer card-funding
  // wait gets a slower creep so it doesn't race to the end prematurely.
  const totalSteps = visibleSteps.length || 1;
  const completedCount = stepStatuses.filter((s) => s.complete).length;
  const activeElapsedSec = activeRowIdx >= 0 ? Math.max(0, (nowTick - stepStartedAt) / 1000) : 0;
  const activeTau = flowStep === 'funding' || flowStep === 'waiting-for-usdc' ? 9 : 3;
  const creep = activeRowIdx >= 0 ? (1 - Math.exp(-activeElapsedSec / activeTau)) * 0.85 : 0;
  const progressPct =
    flowStep === 'success' ? 100 : Math.min(99, ((completedCount + creep) / totalSteps) * 100);

  const modalTitle =
    phase === 'pick-speed'
      ? 'Choose Draft Speed'
      : phase === 'purchase'
        ? flowStep === 'success'
          ? 'Draft Pass ready'
          : isProcessing
            ? 'Draft Pass on the way'
            : 'Buy Draft Passes'
        : 'Joining Draft...';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={modalTitle} size="lg">
      <div className="space-y-5">

        {/* ═══ PHASE 1: PURCHASE ═══ */}
        {phase === 'purchase' && (
          <>
            {flowStep === 'idle' && (
            <>
            {/* Balance context — count paid and free passes separately so a
                user holding only a free pass doesn't read "0 draft passes". */}
            <p className="text-text-muted text-sm text-center -mt-2">
              {(() => {
                const paid = user?.draftPasses || 0;
                const free = user?.freeDrafts || 0;
                // Always label paid vs free when both kinds exist; otherwise
                // name the one kind they hold.
                if (paid === 0 && free === 0) return `You have 0 draft passes`;
                if (free === 0) return `You have ${paid} paid draft pass${paid !== 1 ? 'es' : ''}`;
                if (paid === 0) return `You have ${free} free draft pass${free !== 1 ? 'es' : ''}`;
                return `You have ${paid} paid + ${free} free draft pass${paid + free !== 1 ? 'es' : ''}`;
              })()}
            </p>

            {/* Quantity Selection */}
            <div>
              <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">Quantity</h3>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {quantityOptions.map((qty) => (
                  <button
                    key={qty}
                    onClick={() => setQuantity(qty)}
                    className={`py-2.5 rounded-xl font-bold text-[15px] transition-colors ${quantity === qty ? 'bg-banana text-bg-primary' : 'bg-bg-tertiary text-text-secondary hover:bg-bg-elevated hover:text-text-primary'}`}
                  >
                    {qty}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-3 mt-3">
                <span className="text-text-muted text-sm">Custom:</span>
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={quantity || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') setQuantity(0);
                    else setQuantity(Math.min(1000, Math.max(1, parseInt(val) || 1)));
                  }}
                  onBlur={() => { if (quantity < 1) setQuantity(1); }}
                  className="flex-1 bg-bg-tertiary border border-bg-elevated rounded-xl px-4 py-2 text-center text-text-primary font-medium focus:outline-none focus:border-banana transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
            </div>

            {/* Payment Method. Social (Gmail/X) login → Card only, one clean
                box. Wallet login → USDC on Base | Card toggle. The card option
                covers Card, Apple Pay, Venmo and PayPal (all via MoonPay). */}
            <div>
              <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">Payment</h3>
              {isWeb2 ? (
                <div className="flex items-center justify-center gap-2.5 py-3 px-4 rounded-2xl bg-bg-tertiary/60 border border-bg-elevated text-text-primary">
                  <svg viewBox="0 0 24 24" className="w-5 h-5 text-banana shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <rect x="3" y="5.5" width="18" height="13" rx="2.5"/>
                    <path d="M3 9.5h18M6.5 14.5h4"/>
                  </svg>
                  {/* All four read as equal options; wraps at the dots on narrow
                      screens but never splits "Apple Pay". */}
                  <span className="text-[15px] sm:text-base font-semibold tracking-tight leading-relaxed text-center">
                    Card · Apple{' '}Pay · PayPal · Venmo
                  </span>
                </div>
              ) : (
                // Stacked full-width so the Card row has room to show all four
                // payment options at equal size — same clean treatment as the
                // web2 box, even with USDC sitting above it.
                <div className="grid grid-cols-1 gap-1 p-1 rounded-2xl bg-bg-tertiary/60 border border-bg-elevated">
                  <button
                    onClick={() => setPaymentMethod('usdc')}
                    className={`flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl transition-colors ${paymentMethod === 'usdc' ? 'bg-bg-elevated text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
                  >
                    <svg viewBox="0 0 24 24" className={`w-5 h-5 shrink-0 ${paymentMethod === 'usdc' ? 'text-banana' : 'text-text-muted'}`} fill="none" stroke="currentColor" strokeWidth="1.8">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 7v10M9.5 9.2c0-1 1.1-1.6 2.5-1.6s2.5.6 2.5 1.6-1 1.5-2.5 1.7-2.5.7-2.5 1.7 1.1 1.6 2.5 1.6 2.5-.6 2.5-1.6" strokeLinecap="round" />
                    </svg>
                    <span className="text-[15px] sm:text-base font-semibold tracking-tight">USDC on Base</span>
                  </button>
                  <button
                    onClick={() => setPaymentMethod('card')}
                    className={`flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl transition-colors ${paymentMethod === 'card' ? 'bg-bg-elevated text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
                  >
                    <svg viewBox="0 0 24 24" className={`w-5 h-5 shrink-0 ${paymentMethod === 'card' ? 'text-banana' : 'text-text-muted'}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                      <rect x="3" y="5.5" width="18" height="13" rx="2.5"/>
                      <path d="M3 9.5h18M6.5 14.5h4"/>
                    </svg>
                    <span className="text-[15px] sm:text-base font-semibold tracking-tight leading-relaxed text-center">Card · Apple Pay · PayPal · Venmo</span>
                  </button>
                </div>
              )}
            </div>
            </>
            )}

            {/* Card-fee credit → free draft banner (live $ progress) */}
            {paymentMethod === 'card' && flowStep === 'idle' && (() => {
              const threshold = FREE_DRAFT_CREDIT_CENTS; // $25 in cents
              // Bar reflects ACTUAL accumulated credit — empty at $0, fills live
              // as real card purchases accrue (cardFeeCreditCents streams in).
              const current = Math.min(threshold, user?.cardFeeCreditCents || 0);
              const earnsNow = current + feeForQty(quantity || 1) >= threshold;
              const curPct = Math.min(100, (current / threshold) * 100);
              const remaining = Math.max(0, threshold - current);
              const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
              return (
              <div className="bg-banana/[0.06] border border-banana/10 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0 text-banana" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round">
                    <rect x="3.5" y="9" width="17" height="11" rx="1.5" /><path d="M3.5 13h17M12 9v11M12 9S10.5 5 8 5a2 2 0 0 0 0 4zM12 9s1.5-4 4-4a2 2 0 0 1 0 4z" />
                  </svg>
                  <p className="text-white/70 text-[12px] font-medium">
                    {earnsNow
                      ? 'This purchase earns you a draft pass!'
                      : "Your card fee is credited forward — at $25 it's a draft pass"
                    }
                  </p>
                </div>
                <div className="relative h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <div className="absolute inset-y-0 left-0 bg-banana rounded-full transition-all" style={{ width: `${curPct}%` }} />
                </div>
                <p className="text-white/30 text-[10px] mt-1.5">
                  {`${usd(current)} of ${usd(threshold)} toward your next draft pass${remaining > 0 ? ` — ${usd(remaining)} to go` : ''}`}
                </p>
              </div>
              );
            })()}

            {/* Referral code — paste a friend's username/code (works for both
                USDC + card). Applied before purchase so the buy credits them. */}
            {flowStep === 'idle' && (
              <div>
                <p className="text-text-muted text-[11px] uppercase tracking-wider mb-1.5">Referral code (optional)</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={referralCode}
                    onChange={(e) => { setReferralCode(e.target.value); if (referralState !== 'idle') { setReferralState('idle'); setReferralMsg(null); } }}
                    placeholder="Friend's username"
                    disabled={referralState === 'applied'}
                    className="flex-1 min-w-0 rounded-xl border border-bg-elevated bg-bg-tertiary px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-banana/50 disabled:opacity-60"
                  />
                  <button
                    onClick={applyReferral}
                    disabled={!referralCode.trim() || referralState === 'applying' || referralState === 'applied'}
                    className="shrink-0 rounded-xl border-2 border-banana px-4 py-2.5 text-sm font-semibold text-banana hover:bg-banana hover:text-black disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-banana transition-all"
                  >
                    {referralState === 'applying' ? 'Applying…' : referralState === 'applied' ? 'Applied ✓' : 'Apply'}
                  </button>
                </div>
                {referralMsg && (
                  <p className={`text-[11px] mt-1.5 ${referralState === 'error' ? 'text-error' : 'text-text-secondary'}`}>{referralMsg}</p>
                )}
              </div>
            )}

            {/* Live purchase progress — one real-time bar + clean, crypto-free
                steps. Same shell for card + USDC; USDC adds the wallet-confirm
                row. Bar advances on real milestones and eases between them. */}
            {flowStep !== 'idle' && (
              <div className="bg-bg-tertiary/60 border border-bg-elevated rounded-xl p-4 space-y-4">
                {/* Real-time progress bar + live percent (updates as each
                    on-chain milestone lands; eases between them). Slim &
                    minimal — thin flat banana on a quiet track, no glow. */}
                {flowStep !== 'error' && (
                  <div className="flex items-center gap-3">
                    <div className="relative h-2 flex-1 rounded-full bg-white/[0.06] overflow-hidden">
                      <div
                        className="absolute inset-y-0 left-0 min-w-[0.5rem] rounded-full bg-banana transition-[width] duration-500 ease-out"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                    <span className="w-9 shrink-0 text-right text-xs font-medium text-banana/90 tabular-nums">
                      {Math.round(progressPct)}%
                    </span>
                  </div>
                )}

                {/* Steps — minimal indicators: solid check (done) / pulsing dot
                    (active) / dim dot (pending). Consistent 20px slot so rows
                    line up cleanly on desktop and mobile. */}
                {flowStep !== 'error' && (
                  <div className="space-y-3.5">
                    {stepStatuses.map((step, i) => {
                      const isComplete = step.complete;
                      const isActive = i === activeRowIdx;
                      const helper = isActive ? step.helper : undefined;
                      return (
                        <div key={step.label} className="flex items-start gap-3 text-sm">
                          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
                            {isComplete ? (
                              // Done — solid banana circle + house check (went through)
                              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-banana">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-bg-primary">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              </span>
                            ) : isActive ? (
                              // Active — house banana spinner (clearly working now)
                              <span className="h-5 w-5 rounded-full border-2 border-banana border-t-transparent animate-spin" />
                            ) : (
                              // Pending — dim empty ring (not yet)
                              <span className="h-5 w-5 rounded-full border-2 border-white/10" />
                            )}
                          </span>
                          <div className="min-w-0 leading-5">
                            <p className={isComplete ? 'text-text-primary' : isActive ? 'text-text-primary font-medium' : 'text-text-muted'}>
                              {step.label}
                            </p>
                            {helper && <p className="text-text-muted text-[11px] mt-0.5 leading-snug">{helper}</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Gas line — USDC on Base only (card has no gas) */}
                {paymentMethod === 'usdc' && flowStep !== 'success' && flowStep !== 'error' && (
                  <div className="pt-2 mt-1 border-t border-bg-elevated/60 text-[11px] text-text-muted text-center">
                    We cover the gas.
                  </div>
                )}

                {flowStep === 'error' && mintPaymentPending ? (
                  // Payment succeeded, delivery pending — reassure, don't alarm.
                  <div className="rounded-xl border border-banana/40 bg-banana/[0.08] px-4 py-3">
                    <p className="text-banana font-semibold text-sm text-center">Payment received — pass on its way</p>
                    <p className="text-text-secondary text-xs text-center mt-1 leading-relaxed">It will land in your account shortly.</p>
                  </div>
                ) : flowStep === 'error' && (flowError || mintError) ? (
                  <div className="text-sm text-red-400 text-center">
                    {friendlyPurchaseError(flowError || mintError)}
                  </div>
                ) : null}
              </div>
            )}

            {/* USDC mint-active indicator (shown only before the user has clicked Buy) */}
            {paymentMethod === 'usdc' && flowStep === 'idle' && !mintActive && (
              <p className="text-red-400 text-center text-xs">Mint is currently inactive</p>
            )}

            {/* Order summary — line item + balance + total in one clean card.
                Hidden once a purchase is in flight so the progress screen stays
                focused on just the bar + steps. */}
            {flowStep === 'idle' && (
            <div className="space-y-3">
              <div className="rounded-2xl bg-bg-primary/60 border border-bg-tertiary p-4 space-y-2.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">{quantity} draft pass{quantity !== 1 ? 'es' : ''} × $25</span>
                  <span className="text-text-primary font-mono tabular-nums">${totalPrice}</span>
                </div>
                {paymentMethod === 'usdc' && user?.usdcBalance != null && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-secondary">Wallet balance</span>
                    <span className={`font-mono tabular-nums ${user.usdcBalance >= totalPrice ? 'text-text-secondary' : 'text-error'}`}>
                      {user.usdcBalance.toFixed(2)} USDC{user.usdcBalance < totalPrice ? ' (insufficient)' : ''}
                    </span>
                  </div>
                )}
                <div className="border-t border-bg-tertiary pt-2.5 flex items-center justify-between">
                  <span className="text-text-primary font-semibold">Total</span>
                  <span className="text-banana text-2xl font-bold tabular-nums">
                    {paymentMethod === 'usdc' && usdcTotal ? `${formatUnits(usdcTotal, 6)} USDC` : `$${totalPrice}`}
                  </span>
                </div>
              </div>
              {paymentMethod === 'usdc' && user?.usdcBalance != null && user.usdcBalance < totalPrice && flowStep === 'idle' && (
                <div className="bg-banana/[0.06] border border-banana/10 rounded-xl p-3">
                  <p className="text-text-secondary text-xs leading-relaxed">
                    Learn how to buy, swap, or bridge <span className="text-text-primary font-semibold">USDC on Base</span>. It&apos;s quick and easy.{' '}
                    <Link href="/get-usdc" className="text-banana font-semibold hover:brightness-110 whitespace-nowrap">Learn how →</Link>
                  </p>
                </div>
              )}
            </div>
            )}

            {/* Transient "not enough USDC" notice — sits above the Buy button,
                clears on close/change, re-checks live each tap. */}
            {flowStep === 'idle' && usdcShortfall && (
              <p className="text-center text-sm text-red-400 -mb-1">{usdcShortfall}</p>
            )}

            {/* CTA — only on idle (Buy) and success (Start Drafting). While a
                purchase is in flight the progress bar + steps carry the state,
                so there's no loud processing button competing with them. */}
            {(flowStep === 'idle' || flowStep === 'success') && (
              <button
                onClick={flowStep === 'success' ? () => goToPickSpeed(mintedCount || quantity) : handlePurchase}
                disabled={quantity < 1 || (flowStep === 'idle' && paymentMethod === 'usdc' && !mintActive)}
                className={`
                  ${flowStep === 'success' ? 'mx-auto block w-fit min-w-[220px] px-8 py-3' : 'w-full py-3.5 sm:py-4'} rounded-xl font-bold text-base sm:text-lg transition-all shadow-lg shadow-banana/20
                  ${quantity < 1
                    ? 'bg-banana/50 text-black/50 cursor-not-allowed'
                    : 'bg-banana text-black hover:brightness-110 hover:scale-[1.01]'
                  }
                `}
              >
                {flowStep === 'success' ? (
                  <span className="flex items-center justify-center gap-2">
                    Start Drafting
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                  </span>
                ) : (
                  `Buy ${quantity} Draft Pass${quantity !== 1 ? 'es' : ''}`
                )}
              </button>
            )}

            {/* Cancel — only while waiting on the card flow (pre-on-chain).
                Lets the user back out without a hard refresh. */}
            {(flowStep === 'funding' || flowStep === 'waiting-for-usdc') && (
              <button
                onClick={handleCancelCheckout}
                className="w-full py-3 rounded-2xl border border-bg-elevated text-text-secondary hover:text-text-primary hover:border-text-muted text-sm font-semibold transition-all"
              >
                Cancel
              </button>
            )}

            {/* Error retry */}
            {flowStep === 'error' && (
              <button
                onClick={() => { setFlowStep('idle'); setFlowError(null); }}
                className="w-full text-sm text-banana hover:underline text-center"
              >
                Try again
              </button>
            )}
          </>
        )}

        {/* ═══ PHASE 2: PICK DRAFT SPEED (matches in-app EntryFlowModal) ═══ */}
        {phase === 'pick-speed' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
            <p className="text-center text-white/50 text-sm mb-6">
              <span className="text-banana font-semibold">{mintedCount} pass{mintedCount !== 1 ? 'es' : ''}</span> purchased · pick a speed to enter
            </p>

            <div className="space-y-4">
              <button
                onClick={() => handlePickSpeed('fast')}
                disabled={isJoiningDraft}
                className="w-full group relative overflow-hidden rounded-xl border-2 border-yellow-500/30 bg-yellow-500/5 p-5 text-left transition-all duration-300 hover:border-yellow-500/60 hover:bg-yellow-500/10 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center">
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-yellow-400">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white">Fast Draft</h3>
                      <p className="text-yellow-400 text-sm font-medium">30 seconds per pick</p>
                    </div>
                  </div>
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/30 group-hover:text-yellow-400 transition-colors">
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </div>
              </button>

              <button
                onClick={() => handlePickSpeed('slow')}
                disabled={isJoiningDraft}
                className="w-full group relative overflow-hidden rounded-xl border-2 border-blue-500/30 bg-blue-500/5 p-5 text-left transition-all duration-300 hover:border-blue-500/60 hover:bg-blue-500/10 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white">Slow Draft</h3>
                      <p className="text-blue-400 text-sm font-medium">8 hours per pick</p>
                    </div>
                  </div>
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/30 group-hover:text-blue-400 transition-colors">
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </div>
              </button>
            </div>

            {/* Footer */}
            <div className="mt-6 flex items-center justify-between">
              <button
                onClick={onClose}
                disabled={isJoiningDraft}
                className="text-white/40 text-sm hover:text-white/60 transition-colors disabled:opacity-50"
              >
                Skip — I&apos;ll draft later
              </button>
              <p className="text-white/30 text-xs">1 pass will be used</p>
            </div>
          </div>
        )}

        {/* ═══ PHASE: JOINING ═══ */}
        {phase === 'joining' && (
          <div className="text-center py-8 space-y-4 animate-in fade-in duration-200">
            <div className="w-10 h-10 border-2 border-banana border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-text-primary font-semibold text-lg">Joining draft...</p>
            <p className="text-text-muted text-sm">You&apos;ll be redirected to the draft lobby</p>
          </div>
        )}

        {/* ═══ PHASE: ERROR ═══ */}
        {phase === 'error' && (
          <div className="text-center py-8 space-y-4 animate-in fade-in duration-200">
            <div className="text-4xl">⚠️</div>
            <p className="text-red-400 font-medium">{joinError || 'Something went wrong'}</p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setPhase('pick-speed')}
                className="px-5 py-2.5 bg-banana text-black font-semibold rounded-xl hover:brightness-110 transition-all"
              >
                Try Again
              </button>
              <button
                onClick={onClose}
                className="px-5 py-2.5 border border-white/20 text-text-secondary rounded-xl hover:bg-white/5 transition-all"
              >
                Skip
              </button>
            </div>
          </div>
        )}

      </div>
    </Modal>
  );
}
