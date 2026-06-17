'use client';

import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatUnits, type Address } from 'viem';
import { useFundWallet, usePrivy } from '@privy-io/react-auth';
import { Modal } from '../ui/Modal';
import { useAuth } from '@/hooks/useAuth';
import { firstPurchaseUpsell } from '@/lib/promoMath';
import { useMintDraftPass } from '@/hooks/useMintDraftPass';
import { draftPassPricing, feeForQty, FREE_DRAFT_CREDIT_CENTS } from '@/lib/pricing';
import { BASE_SEPOLIA, getUsdcBalance } from '@/lib/contracts/bbb4';
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

export function BuyPassesModal({
  isOpen,
  onClose,
  onPurchaseComplete,
}: BuyPassesModalProps) {
  const _router = useRouter();
  const { user, walletAddress, updateUser, refreshBalance, refreshBalanceUntil, isBB3Holder } = useAuth();
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
  // First-purchase bonus nudge — only on a user's first paid purchase (new OR
  // returning). Disappears once firstPurchaseBonusGranted flips true.
  const firstPurchaseEligible = !!user && !user.firstPurchaseBonusGranted;
  const upsell = firstPurchaseUpsell(quantity);
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

  // Track how long the "waiting for USDC to arrive" step has been running
  // so the modal can show an elapsed timer and an expected duration. MoonPay
  // can take anywhere from ~15s (card) to ~60s (Apple Pay first-run).
  const waitingForUsdcStartedAt = flow.waitingForUsdcStartedAt;
  const setWaitingForUsdcStartedAt = (t: number | null) =>
    setPurchaseFlow({ waitingForUsdcStartedAt: t });
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    if (flowStep !== 'waiting-for-usdc') return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [flowStep]);
  const waitingElapsedSec =
    waitingForUsdcStartedAt && flowStep === 'waiting-for-usdc'
      ? Math.max(0, Math.floor((nowTick - waitingForUsdcStartedAt) / 1000))
      : 0;

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

    if (paymentMethod === 'usdc') {
      try {
        await mint(quantity, { paymentMethod: 'usdc' });
        // Phase transition handled by useEffect on txHash
      } catch {
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

      if (result.status === 'cancelled') {
        setFlowStep('idle');
        return;
      }

      // Poll for USDC arrival before minting
      setFlowStep('waiting-for-usdc');
      setWaitingForUsdcStartedAt(Date.now());

      const totalCostUsdc = usdcTotal ?? BigInt(quantity * pricePerPass) * BigInt(10 ** 6);
      const maxWaitMs = 300_000; // 5 minutes max (MoonPay card payments can take a few minutes)
      const pollIntervalMs = 3_000; // check every 3s

      const waitForUsdc = async () => {
        const startTime = Date.now();
        while (Date.now() - startTime < maxWaitMs) {
          if (cancelledRef.current) return false;
          try {
            const balance = await getUsdcBalance(walletAddress as Address);
            if (balance >= totalCostUsdc) return true;
          } catch (err) {
            // A transient RPC blip shouldn't abort the whole payment — log it
            // (throttled per-source) and keep polling.
            reportClientError({
              source: LOG_SOURCES.payment.USDC_BALANCE_POLL_FAILED,
              message: err instanceof Error ? err.message : String(err),
              route: 'buy-passes',
              actor: walletAddress,
              context: { totalCostUsdc: String(totalCostUsdc) },
            });
          }
          await new Promise((r) => setTimeout(r, pollIntervalMs));
        }
        return false;
      };

      const funded = await waitForUsdc();
      // User cancelled mid-wait — handleCancelCheckout already reset the flow.
      if (cancelledRef.current) return;
      if (!funded) {
        throw new Error('USDC not yet received. Please try minting again in a few minutes.');
      }

      setWaitingForUsdcStartedAt(null);
      // mint() drives flowStep from here on via mintStep → useEffect above:
      // signing → processing → success / error. cardProvider passed for
      // admin onramp_attempts logging — currently always 'moonpay'.
      await mint(quantity, { paymentMethod: 'card', cardProvider: 'moonpay' });
      setFlowStep('success');
      setMintedCount(quantity);
      // Stop here. Don't auto-advance to pick-speed — the user needs to see
      // the success confirmation, otherwise they come back from MoonPay
      // wondering whether their card was charged. They click the explicit
      // "Pick draft speed" button below to continue.
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Payment failed. Please try again.';
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
      joinInFlightRef.current = false;
      setIsJoiningDraft(false);
      setJoinError(msg);
      setPhase('error');
    }
  };

  // Step labels are tailored per user segment:
  //   - Web2 (Privy social login) → friendly, no crypto jargon.
  //   - Web3 (external wallet) → accurate, since they know what a signature is.
  // The card path adds two leading steps (payment + funding) that the
  // USDC path skips — visibleSteps() filters by paymentMethod.
  const isWeb2 = user?.loginMethod === 'social';

  const stepLabels: Record<FlowStep, string> = isWeb2
    ? {
        idle: '',
        funding: 'Processing your payment…',
        'waiting-for-usdc': 'Preparing your funds…',
        signing: 'Confirming your purchase…',
        processing: 'Getting your passes ready…',
        success: 'All set! Your passes are live',
        error: '',
      }
    : {
        idle: '',
        funding: 'Purchasing USDC via MoonPay…',
        'waiting-for-usdc': 'Waiting for USDC to arrive…',
        signing: 'Waiting for your wallet signature…',
        processing: 'Processing on-chain…',
        success: 'Purchase complete!',
        error: '',
      };

  const stepHelper: Partial<Record<FlowStep, string>> = isWeb2
    ? {
        funding: 'After paying, tap Continue in the popup to proceed.',
        'waiting-for-usdc': 'Usually 15–60s. Closed the window or want to change your order? Tap Cancel below — your payment is safe.',
        signing: '',
        processing: 'Finalizing — just a few seconds.',
      }
    : {
        funding: 'After paying, tap Continue in the popup to proceed.',
        'waiting-for-usdc': 'Typically 15–60s. Closed the window or want a different amount? Tap Cancel below — any USDC you bought stays in your wallet.',
        signing: "Check your wallet — this is just a signature, it won't cost gas.",
        processing: 'Admin wallet is paying gas for you. ~5 seconds.',
      };

  const cardStepOrder: FlowStep[] = ['funding', 'waiting-for-usdc', 'signing', 'processing', 'success'];
  const usdcStepOrder: FlowStep[] = ['signing', 'processing', 'success'];
  const visibleStepOrder = paymentMethod === 'card' ? cardStepOrder : usdcStepOrder;

  const modalTitle = phase === 'purchase' ? 'Buy Draft Passes' : phase === 'pick-speed' ? 'Choose Draft Speed' : 'Joining Draft...';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={modalTitle} size="lg">
      <div className="space-y-5">

        {/* ═══ PHASE 1: PURCHASE ═══ */}
        {phase === 'purchase' && (
          <>
            {/* Balance context — count paid and free passes separately so a
                user holding only a free pass doesn't read "0 draft passes". */}
            <p className="text-text-muted text-sm text-center -mt-2">
              {(() => {
                const paid = user?.draftPasses || 0;
                const free = user?.freeDrafts || 0;
                if (paid === 0 && free > 0) return `You have ${free} free draft pass${free !== 1 ? 'es' : ''}`;
                if (free > 0) return `You have ${paid} draft pass${paid !== 1 ? 'es' : ''} + ${free} free`;
                return `You have ${paid} draft pass${paid !== 1 ? 'es' : ''}`;
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

              {/* First-purchase bonus nudge — first paid purchase only. Updates
                  live with the selected quantity (4 passes = 1 free spin). */}
              {firstPurchaseEligible && quantity > 0 && (
                <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                  <p className="text-xs text-text-muted leading-relaxed">
                    {upsell.spinsThisPurchase > 0 ? (
                      <>
                        <span className="font-semibold text-text-secondary">First purchase bonus:</span>{' '}
                        you&apos;ll earn{' '}
                        <span className="font-semibold text-text-secondary">
                          {upsell.spinsThisPurchase} free spin{upsell.spinsThisPurchase !== 1 ? 's' : ''}
                        </span>
                        ! Add {upsell.passesToNextSpin} more (total {upsell.nextSpinTotal}) for {upsell.spinsThisPurchase + 1}.
                      </>
                    ) : (
                      <>
                        <span className="font-semibold text-text-secondary">First purchase bonus:</span>{' '}
                        add{' '}
                        <span className="font-semibold text-text-secondary">{upsell.passesToNextSpin} more</span>{' '}
                        (total {upsell.nextSpinTotal}) to earn a free spin
                      </>
                    )}
                  </p>
                </div>
              )}

              {/* Stacked-value note — new users only (non-BB3). Reminds them the
                  spins stack with the "4 drafts a day → free spin" promo. */}
              {firstPurchaseEligible && !isBB3Holder && quantity > 0 && (
                <p className="mt-2 px-1 text-[11px] leading-relaxed text-text-muted">
                  And it stacks — complete 4 drafts in a day and earn{' '}
                  <span className="font-semibold text-text-secondary">another free spin</span>. Lots of value to start!
                </p>
              )}
            </div>

            {/* Payment Method. Social (Gmail/X) login → Card only, one clean
                button (no crypto option, Boris 2026-06-16). Wallet login → both. */}
            <div>
              <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">Payment</h3>
              {isWeb2 ? (
                <div className="flex items-center justify-center gap-2 py-2.5 rounded-2xl bg-bg-tertiary/60 border border-bg-elevated text-text-primary">
                  <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] text-banana" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <rect x="3" y="5.5" width="18" height="13" rx="2.5"/>
                    <path d="M3 9.5h18M6.5 14.5h4"/>
                  </svg>
                  <span className="text-sm font-semibold">Card</span>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-bg-tertiary/60 border border-bg-elevated">
                  <button
                    onClick={() => setPaymentMethod('usdc')}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-xl transition-colors ${paymentMethod === 'usdc' ? 'bg-bg-elevated text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
                  >
                    <svg viewBox="0 0 24 24" className={`w-[18px] h-[18px] ${paymentMethod === 'usdc' ? 'text-banana' : 'text-text-muted'}`} fill="none" stroke="currentColor" strokeWidth="1.8">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 7v10M9.5 9.2c0-1 1.1-1.6 2.5-1.6s2.5.6 2.5 1.6-1 1.5-2.5 1.7-2.5.7-2.5 1.7 1.1 1.6 2.5 1.6 2.5-.6 2.5-1.6" strokeLinecap="round" />
                    </svg>
                    <span className="text-sm font-semibold">USDC on Base</span>
                  </button>
                  <button
                    onClick={() => setPaymentMethod('card')}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-xl transition-colors ${paymentMethod === 'card' ? 'bg-bg-elevated text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
                  >
                    <svg viewBox="0 0 24 24" className={`w-[18px] h-[18px] ${paymentMethod === 'card' ? 'text-banana' : 'text-text-muted'}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                      <rect x="3" y="5.5" width="18" height="13" rx="2.5"/>
                      <path d="M3 9.5h18M6.5 14.5h4"/>
                    </svg>
                    <span className="text-sm font-semibold">Card</span>
                  </button>
                </div>
              )}
            </div>

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
                    placeholder="Friend's username or code"
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

            {/* Unified purchase progress stepper (both USDC + card paths) */}
            {flowStep !== 'idle' && (
              <div className="bg-bg-tertiary/60 border border-bg-elevated rounded-xl p-3 space-y-3">
                {visibleStepOrder.map((key) => {
                  const currentIdx = visibleStepOrder.indexOf(
                    flowStep === 'error' ? visibleStepOrder[0] : (flowStep as FlowStep),
                  );
                  const stepIdx = visibleStepOrder.indexOf(key);
                  const isComplete = flowStep === 'success' ? true : stepIdx < currentIdx;
                  const isActive = key === flowStep;
                  const label = stepLabels[key];
                  const helper = isActive ? stepHelper[key] : undefined;

                  return (
                    <div key={key} className="flex items-start justify-between gap-3 text-sm">
                      <div className="flex items-start gap-2 min-w-0">
                        <span className="mt-0.5 flex-shrink-0">
                          {isComplete ? (
                            <span className="h-4 w-4 rounded-full bg-banana/20 text-banana flex items-center justify-center">
                              <svg viewBox="0 0 20 20" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M5 10l3 3 7-7" />
                              </svg>
                            </span>
                          ) : isActive ? (
                            <span className="h-4 w-4 rounded-full border-2 border-banana/30 border-t-banana animate-spin inline-block" />
                          ) : (
                            <span className="h-4 w-4 rounded-full border border-bg-elevated inline-block" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <p className={isComplete ? 'text-text-primary' : isActive ? 'text-text-primary' : 'text-text-muted'}>
                            {label}
                          </p>
                          {helper && (
                            <p className="text-text-muted text-[11px] mt-0.5">{helper}</p>
                          )}
                          {isActive && key === 'waiting-for-usdc' && waitingElapsedSec > 0 && (
                            <p className="text-text-muted text-[11px] mt-0.5 tabular-nums">
                              {waitingElapsedSec}s elapsed
                            </p>
                          )}
                        </div>
                      </div>
                      {isComplete && <span className="text-text-muted text-xs flex-shrink-0">Done</span>}
                    </div>
                  );
                })}

                {/* Gas-covered badge — crypto users only, so it doesn't confuse web2 users */}
                {!isWeb2 && flowStep !== 'success' && flowStep !== 'error' && (
                  <div className="pt-2 mt-1 border-t border-bg-elevated/60 flex items-center gap-1.5 text-[11px] text-text-muted">
                    <svg viewBox="0 0 20 20" className="h-3 w-3 text-banana" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 6h8l2 2v7H4z" />
                      <path d="M14 11h2v2a1 1 0 01-1 1 1 1 0 01-1-1z" />
                    </svg>
                    <span>Gas fees covered by SBS — you only sign, we pay.</span>
                  </div>
                )}

                {flowStep === 'error' && mintPaymentPending && mintError ? (
                  // Payment succeeded, delivery pending — reassure, don't alarm.
                  <div className="rounded-xl border border-banana/40 bg-banana/[0.08] px-4 py-3 mt-1">
                    <p className="text-banana font-semibold text-sm text-center">✓ Payment received — pass on its way</p>
                    <p className="text-text-secondary text-xs text-center mt-1 leading-relaxed">{mintError}</p>
                  </div>
                ) : flowStep === 'error' && (flowError || mintError) ? (
                  <div className="text-sm text-red-400 text-center pt-1">
                    {flowError || mintError}
                  </div>
                ) : null}
              </div>
            )}

            {/* USDC mint-active indicator (shown only before the user has clicked Buy) */}
            {paymentMethod === 'usdc' && flowStep === 'idle' && !mintActive && (
              <p className="text-red-400 text-center text-xs">Mint is currently inactive</p>
            )}

            {/* Order summary (Option 2) — line item + balance + total in one
                clean card. Works full-width on mobile and desktop. */}
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

            {/* Payment-complete confirmation — small green line above the CTA,
                only after a successful purchase. */}
            {flowStep === 'success' && (
              <div className="flex items-center justify-center gap-2">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.8 10A10 10 0 1 1 17 3.3" /><path d="m9 11 3 3L22 4" />
                </svg>
                <span className="text-emerald-400 text-sm font-semibold">Payment complete</span>
              </div>
            )}

            {/* CTA Button — shorter clean rectangle, responsive for mobile */}
            <button
              onClick={flowStep === 'success' ? () => goToPickSpeed(mintedCount || quantity) : handlePurchase}
              disabled={isProcessing || quantity < 1 || (paymentMethod === 'usdc' && !mintActive)}
              className={`
                ${flowStep === 'success' ? 'mx-auto block w-fit min-w-[220px] px-8 py-3' : 'w-full py-3.5 sm:py-4'} rounded-xl font-bold text-base sm:text-lg transition-all shadow-lg shadow-banana/20
                ${isProcessing || quantity < 1
                  ? 'bg-banana/50 text-black/50 cursor-not-allowed'
                  : 'bg-banana text-black hover:brightness-110 hover:scale-[1.01]'
                }
              `}
            >
              {isProcessing ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  {stepLabels[flowStep as FlowStep] || 'Processing…'}
                </span>
              ) : flowStep === 'success' ? (
                <span className="flex items-center justify-center gap-2">
                  Start Drafting
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                </span>
              ) : (
                `Buy ${quantity} Draft Pass${quantity !== 1 ? 'es' : ''}`
              )}
            </button>

            {/* Cancel / change order — only while waiting on the card flow
                (pre-on-chain). Lets the user back out without a hard refresh. */}
            {(flowStep === 'funding' || flowStep === 'waiting-for-usdc') && (
              <button
                onClick={handleCancelCheckout}
                className="w-full py-3 rounded-2xl border border-bg-elevated text-text-secondary hover:text-text-primary hover:border-text-muted text-sm font-semibold transition-all"
              >
                ✕ Cancel / change order
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

            {/* Promo */}
            <div className="pt-2 border-t border-bg-elevated/40">
              <p className="text-sm text-text-muted text-center">
                <span className="text-text-secondary font-medium">Promo: Buy 10, get a FREE Banana Wheel spin.</span>
                {' '}<span className="text-banana font-medium">{(user?.draftPasses || 0) % 10}/10</span>
              </p>
            </div>
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
