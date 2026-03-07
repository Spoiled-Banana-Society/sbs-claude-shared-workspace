'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatUnits, type Address } from 'viem';
import { useFundWallet } from '@privy-io/react-auth';
import { Modal } from '../ui/Modal';
import { useAuth } from '@/hooks/useAuth';
import { useMintDraftPass } from '@/hooks/useMintDraftPass';
import { draftPassPricing } from '@/lib/pricing';
import { BASE_SEPOLIA, getUsdcBalance } from '@/lib/contracts/bbb4';
import { isStagingMode, getStagingApiUrl, getDraftsApiUrl } from '@/lib/staging';
import { consumePromoDraftType, peekPromoDraftType } from '@/lib/promoDraftType';
import { fetchJson } from '@/lib/appApiClient';

type FlowStep = 'idle' | 'funding' | 'waiting-for-usdc' | 'minting' | 'success' | 'error';
type ModalPhase = 'purchase' | 'pick-speed' | 'joining' | 'error';

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
  const { user, walletAddress, updateUser, refreshBalance } = useAuth();
  const { mint, isApproving, isMinting, error: mintError, txHash, tokenPrice, mintActive } = useMintDraftPass();
  const { fundWallet } = useFundWallet({
    onUserExited: ({ balance, fundingMethod }) => {
      console.log('[BuyModal] Fund wallet exited:', { balance: balance?.toString(), fundingMethod });
    },
  });

  const [quantity, setQuantity] = useState(10);
  const [flowStep, setFlowStep] = useState<FlowStep>('idle');
  const [flowError, setFlowError] = useState<string | null>(null);

  // Post-mint phase
  const [phase, setPhase] = useState<ModalPhase>('purchase');
  const [mintedCount, setMintedCount] = useState(0);
  const [joinError, setJoinError] = useState<string | null>(null);
  const joinInFlightRef = useRef(false);
  const [isJoiningDraft, setIsJoiningDraft] = useState(false);

  const loggedInWithWallet = user?.loginMethod === 'wallet';
  const [paymentMethod, setPaymentMethod] = useState<'usdc' | 'card'>('card');
  const [paymentMethodInitialized, setPaymentMethodInitialized] = useState(false);

  useEffect(() => {
    if (!paymentMethodInitialized && user?.loginMethod) {
      setPaymentMethod(loggedInWithWallet ? 'usdc' : 'card');
      setPaymentMethodInitialized(true);
    }
  }, [user?.loginMethod, loggedInWithWallet, paymentMethodInitialized]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setFlowStep('idle');
      setFlowError(null);
      setPhase('purchase');
      setMintedCount(0);
      setJoinError(null);
      joinInFlightRef.current = false;
      setIsJoiningDraft(false);
    }
  }, [isOpen]);

  const { pricePerPass } = draftPassPricing;
  const totalPrice = quantity * pricePerPass;
  const usdcTotal = tokenPrice ? tokenPrice * BigInt(quantity) : null;
  const quantityOptions = [1, 5, 10, 20, 30, 40];
  const isUsdcProcessing = isApproving || isMinting;
  const isCardProcessing = flowStep === 'funding' || flowStep === 'waiting-for-usdc' || flowStep === 'minting';
  const isProcessing = paymentMethod === 'usdc' ? isUsdcProcessing : isCardProcessing;

  /**
   * Track a purchase in Firestore: create record → verify → promo updates.
   * This ensures buy-bonus, mint-promo, and referral milestones are tracked
   * identically in staging and production.
   */
  const trackPurchase = async (qty: number, hash: string) => {
    const userId = walletAddress || user?.id;
    if (!userId) return;
    try {
      const { purchase } = await fetchJson<{ purchase: { id: string } }>('/api/purchases/create', {
        method: 'POST',
        body: JSON.stringify({ userId, quantity: qty, paymentMethod: paymentMethod === 'usdc' ? 'usdc' : 'card' }),
      });
      const verifyRes = await fetchJson<{ user?: unknown }>('/api/purchases/verify', {
        method: 'POST',
        body: JSON.stringify({ purchaseId: purchase.id, txHash: hash }),
      });
      if (verifyRes.user) {
        updateUser(verifyRes.user as Partial<import('@/types').User>);
      }
    } catch (err) {
      console.warn('[BuyModal] Purchase tracking failed (mint succeeded):', err);
    }
    await refreshBalance();
  };

  // Transition to pick-speed after successful USDC mint
  const txTrackedRef = useRef(false);
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
  };

  const handlePurchase = async () => {
    if (!Number.isFinite(quantity) || quantity <= 0) return;

    if (paymentMethod === 'usdc') {
      try {
        await mint(quantity);
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

    if (isCardProcessing) return;

    setFlowStep('funding');
    setFlowError(null);

    try {
      const fundingAmount = usdcTotal ? formatUnits(usdcTotal, 6) : String(quantity * pricePerPass);

      const result = await fundWallet({
        address: walletAddress,
        options: {
          chain: BASE_SEPOLIA,
          amount: fundingAmount,
          asset: 'USDC',
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

      const totalCostUsdc = usdcTotal ?? BigInt(quantity * pricePerPass) * BigInt(10 ** 6);
      const maxWaitMs = 300_000; // 5 minutes max (MoonPay card payments can take a few minutes)
      const pollIntervalMs = 3_000; // check every 3s

      const waitForUsdc = async () => {
        const startTime = Date.now();
        while (Date.now() - startTime < maxWaitMs) {
          const balance = await getUsdcBalance(walletAddress as Address);
          if (balance >= totalCostUsdc) return true;
          await new Promise((r) => setTimeout(r, pollIntervalMs));
        }
        return false;
      };

      const funded = await waitForUsdc();
      if (!funded) {
        throw new Error('USDC not yet received. Please try minting again in a few minutes.');
      }

      setFlowStep('minting');
      await mint(quantity);
      setFlowStep('success');

      await new Promise((resolve) => setTimeout(resolve, 800));
      goToPickSpeed(quantity);
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
      const forcedDraftType = peekPromoDraftType();
      console.log('[BuyModal] Joining draft:', { apiBase, speed, addr, forcedDraftType });
      const joinRes = await fetch(`${apiBase}/league/${speed}/owner/${addr}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numLeaguesToJoin: 1, ...(forcedDraftType ? { draftType: forcedDraftType } : {}) }),
      });

      if (!joinRes.ok) {
        const errText = await joinRes.text().catch(() => 'Unknown error');
        throw new Error(`Join failed (${joinRes.status}): ${errText}`);
      }

      const joinData = await joinRes.json();
      console.log('[BuyModal] Join response:', JSON.stringify(joinData));
      // API returns an array of joined cards
      const card = Array.isArray(joinData) ? joinData[0] : joinData;
      const draftId = String(card?._leagueId ?? card?.draftId ?? card?.leagueId ?? card?.id ?? '');
      const contestName = String(card?._leagueDisplayName ?? card?.displayName ?? `Draft ${draftId}`);
      console.log('[BuyModal] Parsed:', { draftId, contestName });

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

      if (forcedDraftType) {
        consumePromoDraftType(forcedDraftType);
      }

      // In staging mode, fill the league with 9 bots so draft can start
      if (isStagingMode()) {
        try {
          const { stagingFillBots } = await import('@/lib/api/leagues');
          await stagingFillBots(speed, 9);
          console.log('[BuyModal] Staging bots filled');
        } catch (fillErr) {
          console.warn('[BuyModal] Bot fill failed (continuing anyway):', fillErr);
        }
        // Wait for backend to create draft state after 10th player joins
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

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
      console.log('[BuyModal] Navigating to:', lobbyUrl);
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

  const flowSteps = [
    { key: 'funding', label: 'Purchasing USDC via MoonPay...' },
    { key: 'waiting-for-usdc', label: 'Waiting for USDC to arrive...' },
    { key: 'minting', label: 'Minting draft passes...' },
    { key: 'success', label: 'Purchase complete!' },
  ];

  const modalTitle = phase === 'purchase' ? 'Buy Draft Passes' : phase === 'pick-speed' ? 'Pick Your Draft Speed' : 'Joining Draft...';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={modalTitle} size="lg">
      <div className="space-y-5">

        {/* ═══ PHASE 1: PURCHASE ═══ */}
        {phase === 'purchase' && (
          <>
            {/* Balance context */}
            <p className="text-text-muted text-sm text-center -mt-2">
              You have {user?.draftPasses || 0} draft pass{(user?.draftPasses || 0) !== 1 ? 'es' : ''}
            </p>

            {/* Quantity Selection */}
            <div>
              <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">Quantity</h3>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {quantityOptions.map((qty) => (
                  <button
                    key={qty}
                    onClick={() => setQuantity(qty)}
                    className={`
                      py-3 rounded-xl font-semibold text-lg transition-all duration-200
                      ${quantity === qty
                        ? 'bg-banana text-bg-primary shadow-lg shadow-banana/25 scale-[1.02]'
                        : 'bg-bg-tertiary text-text-secondary hover:bg-bg-elevated hover:text-text-primary'
                      }
                    `}
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

            {/* Payment Method */}
            <div>
              <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">Payment</h3>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setPaymentMethod('usdc')}
                  className={`p-3 rounded-xl border-2 text-left flex items-center gap-3 transition-all ${paymentMethod === 'usdc' ? 'border-banana bg-banana/5' : 'border-bg-elevated bg-bg-tertiary hover:border-bg-elevated/80'}`}
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${paymentMethod === 'usdc' ? 'bg-banana/20' : 'bg-bg-elevated'}`}>
                    <svg viewBox="0 0 24 24" className={`w-5 h-5 ${paymentMethod === 'usdc' ? 'text-banana' : 'text-text-muted'}`} fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <text x="12" y="16" textAnchor="middle" fill="currentColor" stroke="none" fontSize="12" fontWeight="bold">$</text>
                    </svg>
                  </div>
                  <div>
                    <p className={`font-semibold text-sm ${paymentMethod === 'usdc' ? 'text-text-primary' : 'text-text-secondary'}`}>USDC</p>
                    <p className="text-text-muted text-xs">USDC on Base</p>
                  </div>
                </button>

                <button
                  onClick={() => setPaymentMethod('card')}
                  className={`p-3 rounded-xl border-2 text-left flex items-center gap-3 transition-all ${paymentMethod === 'card' ? 'border-banana bg-banana/5' : 'border-bg-elevated bg-bg-tertiary hover:border-bg-elevated/80'}`}
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${paymentMethod === 'card' ? 'bg-banana/20' : 'bg-bg-elevated'}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" className={`w-5 h-5 ${paymentMethod === 'card' ? 'text-banana' : 'text-text-muted'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
                      <line x1="1" y1="10" x2="23" y2="10"/>
                    </svg>
                  </div>
                  <div>
                    <p className={`font-semibold text-sm ${paymentMethod === 'card' ? 'text-text-primary' : 'text-text-secondary'}`}>Card / Apple Pay</p>
                    <p className="text-text-muted text-xs">Instant checkout</p>
                  </div>
                </button>
              </div>
            </div>

            {/* Card flow status */}
            {paymentMethod === 'card' && flowStep !== 'idle' && (
              <div className="bg-bg-tertiary/60 border border-bg-elevated rounded-xl p-3 space-y-2">
                {flowSteps.map(({ key, label }) => {
                  const stepOrder = ['funding', 'waiting-for-usdc', 'minting', 'success'];
                  const currentIdx = stepOrder.indexOf(flowStep === 'error' ? 'funding' : flowStep);
                  const stepIdx = stepOrder.indexOf(key);
                  const isComplete = flowStep === 'success' ? true : stepIdx < currentIdx;
                  const isActive = key === flowStep;

                  return (
                    <div key={key} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        {isComplete ? (
                          <span className="h-4 w-4 rounded-full bg-banana/20 text-banana flex items-center justify-center">
                            <svg viewBox="0 0 20 20" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M5 10l3 3 7-7" />
                            </svg>
                          </span>
                        ) : isActive ? (
                          <span className="h-4 w-4 rounded-full border-2 border-banana/30 border-t-banana animate-spin" />
                        ) : (
                          <span className="h-4 w-4 rounded-full border border-bg-elevated" />
                        )}
                        <span className={`${isComplete ? 'text-text-primary' : isActive ? 'text-text-secondary' : 'text-text-muted'}`}>{label}</span>
                      </div>
                      {isComplete && <span className="text-text-muted text-xs">Done</span>}
                    </div>
                  );
                })}
                {flowStep === 'error' && flowError && (
                  <div className="text-sm text-red-400 text-center mt-1">{flowError}</div>
                )}
              </div>
            )}

            {/* USDC status */}
            {paymentMethod === 'usdc' && (
              <div className="space-y-1 text-xs">
                <p className={`${mintActive ? 'text-green-400' : 'text-red-400'} text-center`}>
                  {mintActive ? 'Mint is active' : 'Mint is currently inactive'}
                </p>
                {mintError && <p className="text-red-400 text-center text-sm">{mintError}</p>}
              </div>
            )}

            {/* Price + Total */}
            <div className="text-center space-y-1">
              <p className="text-text-muted text-sm">$25 per draft pass</p>
              {paymentMethod === 'usdc' && usdcTotal ? (
                <p className="text-3xl font-bold text-banana">{formatUnits(usdcTotal, 6)} USDC</p>
              ) : (
                <p className="text-3xl font-bold text-banana">${totalPrice}</p>
              )}
            </div>

            {/* CTA Button */}
            <button
              onClick={handlePurchase}
              disabled={isProcessing || quantity < 1 || (paymentMethod === 'usdc' && !mintActive) || flowStep === 'success'}
              className={`
                w-full py-5 rounded-2xl font-bold text-xl transition-all shadow-lg shadow-banana/20
                ${isProcessing || quantity < 1 || flowStep === 'success'
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
                  {paymentMethod === 'usdc'
                    ? isApproving ? 'Approving USDC...' : 'Minting...'
                    : flowStep === 'funding' ? 'Completing payment...' : flowStep === 'waiting-for-usdc' ? 'Waiting for USDC...' : 'Minting passes...'}
                </span>
              ) : flowStep === 'success' ? (
                'Success!'
              ) : (
                `Buy ${quantity} Draft Pass${quantity !== 1 ? 'es' : ''}`
              )}
            </button>

            {/* Staging: Free Entry button */}
            {isStagingMode() && (
              <button
                onClick={async () => {
                  try {
                    const userId = walletAddress || user?.id || 'staging-user';
                    // Use staging-mint API which does: Go mint + Firestore purchase + verify (promo updates)
                    const res = await fetch('/api/purchases/staging-mint', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ userId, quantity }),
                    });
                    const data = await res.json();
                    if (res.ok) {
                      if (data.user) updateUser(data.user as Partial<import('@/types').User>);
                      await refreshBalance();
                      goToPickSpeed(quantity);
                    } else {
                      alert('Staging mint failed: ' + (data.error || JSON.stringify(data)));
                    }
                  } catch (err) {
                    alert('Staging mint error: ' + (err instanceof Error ? err.message : 'Unknown'));
                  }
                }}
                className="w-full py-4 rounded-2xl font-bold text-lg bg-orange-500 text-black hover:brightness-110 transition-all"
              >
                🧪 Free Entry (Staging) — {quantity} Pass{quantity !== 1 ? 'es' : ''}
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

        {/* ═══ PHASE 2: PICK DRAFT SPEED ═══ */}
        {phase === 'pick-speed' && (
          <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="text-center">
              <div className="text-4xl mb-3">✅</div>
              <h3 className="text-2xl font-bold text-text-primary">
                {mintedCount} Pass{mintedCount !== 1 ? 'es' : ''} Minted!
              </h3>
              <p className="text-text-muted mt-1">Pick your draft speed to enter immediately</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => handlePickSpeed('fast')}
                disabled={isJoiningDraft}
                className={`group relative p-6 rounded-xl border-2 text-left transition-all ${isJoiningDraft ? 'border-banana/20 bg-banana/5 opacity-60 cursor-not-allowed' : 'border-banana/40 bg-banana/5 hover:bg-banana/15 hover:border-banana'}`}
              >
                <div className="text-3xl mb-2">⚡</div>
                <h4 className="text-lg font-bold text-text-primary">Fast Draft</h4>
                <p className="text-text-muted text-sm mt-1">30-second picks</p>
                <p className="text-text-muted text-xs mt-2">~15 min total</p>
              </button>
              <button
                onClick={() => handlePickSpeed('slow')}
                disabled={isJoiningDraft}
                className={`group relative p-6 rounded-xl border-2 text-left transition-all ${isJoiningDraft ? 'border-blue-500/20 bg-blue-500/5 opacity-60 cursor-not-allowed' : 'border-blue-500/40 bg-blue-500/5 hover:bg-blue-500/15 hover:border-blue-500'}`}
              >
                <div className="text-3xl mb-2">🐢</div>
                <h4 className="text-lg font-bold text-text-primary">Slow Draft</h4>
                <p className="text-text-muted text-sm mt-1">8-hour picks</p>
                <p className="text-text-muted text-xs mt-2">Draft at your pace</p>
              </button>
            </div>

            <button
              onClick={onClose}
              className="w-full text-center text-text-muted text-sm hover:text-text-secondary transition-colors py-2"
            >
              Skip — I&apos;ll draft later
            </button>
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
