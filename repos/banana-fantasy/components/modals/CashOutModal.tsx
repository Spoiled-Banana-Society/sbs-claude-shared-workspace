'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { Modal } from '../ui/Modal';
import { VerificationModal } from './VerificationModal';
import { useAuth } from '@/hooks/useAuth';

const RETURNING_USER_KEY = 'banana-fantasy-cashout-returning';
const ACTIVE_TX_KEY = 'banana-fantasy-cashout-active-tx';

interface CashOutModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Maximum USDC the user can cash out (in USD/USDC, e.g. 250 = $250). */
  maxAmount: number;
  /** Whether this is tied to a specific prize (locks amount to prize value). */
  fixedAmount?: boolean;
  draftId?: string;
  userId?: string;
  walletAddress?: string;
  /** Called when the user picks "Keep as USDC" — opens the old wallet-send flow. */
  onSwitchToUsdc?: () => void;
  /** If set, modal opens directly into the status timeline (used after redirect). */
  initialStatusMode?: boolean;
}

type Step =
  | 'intro'
  | 'amount'
  | 'loading_quotes'
  | 'quotes'
  | 'launching'
  | 'opened'
  | 'status'
  | 'error';

type SelectableMethod = 'ACH_BANK_ACCOUNT' | 'FIAT_WALLET' | 'CRYPTO_ACCOUNT' | 'USDC';

interface QuoteResult {
  method: 'ACH_BANK_ACCOUNT' | 'RTP' | 'CARD' | 'APPLE_PAY' | 'PAYPAL' | 'FIAT_WALLET' | 'CRYPTO_ACCOUNT';
  label: string;
  speed: string;
  description: string;
  available: boolean;
  error?: string;
  quoteId?: string;
  fiatAmount?: number;
  cryptoAmount?: number;
  totalFee?: number;
}

interface TimelineStep {
  key: 'sent' | 'received' | 'converting' | 'paying_out' | 'complete';
  label: string;
  status: 'done' | 'active' | 'pending' | 'failed';
}

interface ActiveTx {
  partnerUserId: string;
  amount: number;
  startedAt: number;
  // The destination the user picked. Used to render correct status copy
  // ("arrives in your bank in 1–3 days" vs. "in your Coinbase wallet in 5 min").
  method?: 'ACH_BANK_ACCOUNT' | 'FIAT_WALLET' | 'CRYPTO_ACCOUNT';
}

// Friendly per-method copy shown on the status screen so users know what to
// expect for the destination they actually picked, not a hardcoded ACH line.
function getStatusCopy(method?: ActiveTx['method']): {
  arrival: string;
  destination: string;
} {
  if (method === 'FIAT_WALLET') {
    return {
      arrival: 'USD will appear in your Coinbase USD wallet within 5 minutes.',
      destination: 'Coinbase USD wallet',
    };
  }
  if (method === 'CRYPTO_ACCOUNT') {
    return {
      arrival: 'USDC will appear in your Coinbase crypto account within 5 minutes.',
      destination: 'Coinbase crypto account',
    };
  }
  // Default to ACH for backwards compatibility / unknown method.
  return {
    arrival: 'Bank deposits typically arrive in 1–3 business days.',
    destination: 'your bank',
  };
}

function formatCurrency(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function rememberActiveTx(tx: ActiveTx) {
  try {
    localStorage.setItem(ACTIVE_TX_KEY, JSON.stringify(tx));
  } catch {
    /* ignore */
  }
}

function readActiveTx(): ActiveTx | null {
  try {
    const raw = localStorage.getItem(ACTIVE_TX_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ActiveTx;
  } catch {
    return null;
  }
}

function clearActiveTx() {
  try {
    localStorage.removeItem(ACTIVE_TX_KEY);
  } catch {
    /* ignore */
  }
}

export function CashOutModal({
  isOpen,
  onClose,
  maxAmount,
  fixedAmount,
  draftId,
  userId,
  walletAddress,
  onSwitchToUsdc,
  initialStatusMode,
}: CashOutModalProps) {
  const privy = usePrivy();
  const { login: triggerLogin, logout: triggerLogout } = useAuth();
  const [step, setStep] = useState<Step>('intro');
  // True when our backend rejected the request because the Privy access token
  // was missing or invalid. Switches the error UI from "Try Again" to a
  // "Sign In" CTA that re-runs the auth flow.
  const [requiresReauth, setRequiresReauth] = useState(false);
  // True when the backend rejected for a jurisdiction / age / parish reason.
  // Switches the error UI from generic "Try Again" to a non-actionable
  // "Withdrawal not available — contact support" path with TOS link.
  const [isBlocked, setIsBlocked] = useState(false);
  const [amountInput, setAmountInput] = useState<string>(maxAmount > 0 ? String(maxAmount) : '');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<QuoteResult[] | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<SelectableMethod | null>(null);
  const [sessionUrl, setSessionUrl] = useState<string | null>(null);
  const [isReturning, setIsReturning] = useState(false);
  const [showVerification, setShowVerification] = useState<'basic' | 'kyc' | null>(null);
  const [timeline, setTimeline] = useState<TimelineStep[] | null>(null);
  const [pollVersion, setPollVersion] = useState(0);
  // Seconds since polling started for the current attempt — drives the
  // staged messaging on the status screen ("Confirming..." → "Still waiting..."
  // → "We didn't see a transaction") so users aren't staring at a vague spinner.
  const [pollElapsed, setPollElapsed] = useState(0);
  // Set once we've polled past the give-up threshold without seeing any tx.
  // Stops the loop and shows a recovery prompt instead of spinning forever.
  const [pollGaveUp, setPollGaveUp] = useState(false);

  // Try to get a fresh Privy access token. If unavailable (silent session
  // expiry, half-state where local user object lingers but JWT is gone),
  // surface a clear "Sign In" prompt instead of letting the request go out
  // headerless and 401 with the cryptic "Missing authorization token" error.
  const getAuthTokenOrPromptReauth = async (): Promise<string | null> => {
    try {
      const token = await privy.getAccessToken();
      if (!token) {
        setRequiresReauth(true);
        setErrorMessage('Your session has expired. Please sign in again to cash out.');
        setStep('error');
        return null;
      }
      return token;
    } catch {
      setRequiresReauth(true);
      setErrorMessage('Your session has expired. Please sign in again to cash out.');
      setStep('error');
      return null;
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const returning =
      typeof window !== 'undefined' && localStorage.getItem(RETURNING_USER_KEY) === '1';
    setIsReturning(returning);
    setErrorMessage(null);
    setQuotes(null);
    setSelectedMethod(null);
    setSessionUrl(null);
    setShowVerification(null);
    setTimeline(null);
    setRequiresReauth(false);
    setIsBlocked(false);

    setPollElapsed(0);
    setPollGaveUp(false);

    if (initialStatusMode && readActiveTx()) {
      setStep('status');
      setPollVersion((v) => v + 1);
    } else {
      setStep(returning ? 'amount' : 'intro');
      setAmountInput(maxAmount > 0 ? String(maxAmount) : '');
    }
  }, [isOpen, maxAmount, initialStatusMode]);

  useEffect(() => {
    if (step !== 'status') return;
    const active = readActiveTx();
    if (!active) return;

    // Stop polling after this many seconds with no tx seen. Past this point,
    // the user almost certainly closed the Coinbase popup without completing
    // the sign step — so we surface a recovery prompt instead of an infinite
    // spinner.
    const GIVE_UP_AFTER_SEC = 120;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();
    setPollElapsed(0);
    setPollGaveUp(false);

    const tickElapsed = () => {
      if (cancelled) return;
      const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
      setPollElapsed(elapsedSec);
    };

    // 1Hz UI ticker so the staged messaging swaps without waiting for the
    // next poll response (poll runs every 5–10s; copy should still feel live).
    const elapsedTimer = setInterval(tickElapsed, 1000);

    const poll = async () => {
      const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
      // Give up if past threshold AND we've never seen a timeline.
      if (elapsedSec >= GIVE_UP_AFTER_SEC) {
        if (cancelled) return;
        // Use a callback to avoid stale-closure on `timeline`.
        setTimeline((current) => {
          if (current && current.length > 0) return current;
          setPollGaveUp(true);
          return current;
        });
        return;
      }
      try {
        // Polling is silent — if Privy session is gone we just stop polling.
        // The user-visible reauth prompt will fire on their next interactive
        // cashout attempt, where it can be acted on.
        const token = await privy.getAccessToken();
        if (!token) {
          if (cancelled) return;
          return; // skip this poll; let the give-up timer eventually surface a UI prompt
        }
        const res = await fetch(
          `/api/coinbase/tx-status?partnerUserId=${encodeURIComponent(active.partnerUserId)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        if (!res.ok) throw new Error(`Status fetch failed (${res.status})`);
        const data = (await res.json()) as { timeline: TimelineStep[]; transaction: { status: string } | null };
        if (cancelled) return;
        setTimeline(data.timeline);
        const isTerminal = data.timeline.some(
          (s) => s.key === 'complete' && (s.status === 'done' || s.status === 'failed'),
        );
        if (isTerminal) {
          if (!data.timeline.some((s) => s.status === 'failed')) {
            clearActiveTx();
          }
          return;
        }
        timer = setTimeout(poll, 5000);
      } catch {
        if (cancelled) return;
        timer = setTimeout(poll, 10000);
      }
    };

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      clearInterval(elapsedTimer);
    };
  }, [step, pollVersion]);

  const parsedAmount = useMemo(() => {
    const n = Number(amountInput);
    if (!Number.isFinite(n)) return NaN;
    return Math.round(n * 100) / 100;
  }, [amountInput]);

  const amountValid =
    Number.isFinite(parsedAmount) && parsedAmount > 0 && parsedAmount <= maxAmount;

  const fetchQuotes = async () => {
    if (!walletAddress || !amountValid) return;
    setStep('loading_quotes');
    setErrorMessage(null);
    try {
      const token = await getAuthTokenOrPromptReauth();
      if (!token) return; // Re-auth prompt was set; abort this attempt.
      const res = await fetch('/api/coinbase/quotes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ walletAddress, cryptoAmount: parsedAmount }),
      });
      if (!res.ok) {
        if (res.status === 401) {
          setRequiresReauth(true);
          setErrorMessage('Your session has expired. Please sign in again to cash out.');
          setStep('error');
          return;
        }
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || `Failed to fetch quotes (${res.status})`);
      }
      const data = (await res.json()) as { quotes: QuoteResult[] };
      setQuotes(data.quotes);
      const ach = data.quotes.find((q) => q.method === 'ACH_BANK_ACCOUNT' && q.available);
      const firstAvail = data.quotes.find((q) => q.available);
      const defaultMethod = ach?.method ?? firstAvail?.method;
      // Only auto-select if the default method is one we render. The
      // SelectableMethod type tracks the rendered options.
      if (
        defaultMethod === 'ACH_BANK_ACCOUNT' ||
        defaultMethod === 'FIAT_WALLET' ||
        defaultMethod === 'CRYPTO_ACCOUNT'
      ) {
        setSelectedMethod(defaultMethod);
      }
      setStep('quotes');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not load quotes');
      setStep('error');
    }
  };

  const launchCoinbase = async () => {
    if (!walletAddress || !amountValid || !selectedMethod || selectedMethod === 'USDC') return;

    setStep('launching');
    setErrorMessage(null);

    const popup =
      typeof window !== 'undefined'
        ? window.open('about:blank', 'coinbase-cashout', 'width=480,height=720')
        : null;

    try {
      const token = await getAuthTokenOrPromptReauth();
      if (!token) {
        popup?.close();
        return;
      }
      const res = await fetch('/api/coinbase/sell-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          walletAddress,
          cryptoAmount: parsedAmount,
          paymentMethod: selectedMethod,
          ...(draftId ? { draftId } : {}),
          ...(userId ? { userId } : {}),
        }),
      });

      if (!res.ok) {
        if (res.status === 401) {
          popup?.close();
          setRequiresReauth(true);
          setErrorMessage('Your session has expired. Please sign in again to cash out.');
          setStep('error');
          return;
        }
        const data = (await res.json().catch(() => null)) as
          | {
              error?: string;
              requiresVerification?: 'basic' | 'kyc';
              blockCode?: string;
              blockDetail?: string;
            }
          | null;
        if (data?.requiresVerification) {
          popup?.close();
          setShowVerification(data.requiresVerification);
          setStep('quotes');
          return;
        }
        if (data?.blockCode) {
          // Jurisdiction / age / parish block. Surface the backend's
          // user-friendly reason and disable retry — there's nothing the
          // user can do from this screen to fix it.
          popup?.close();
          setIsBlocked(true);
          setErrorMessage(
            data.error || 'Withdrawal is not permitted from your location at this time.',
          );
          setStep('error');
          return;
        }
        throw new Error(data?.error || `Failed to start cash out (${res.status})`);
      }

      const { url } = (await res.json()) as { url: string };

      if (popup && !popup.closed) {
        popup.location.href = url;
        popup.focus();
      } else {
        window.location.href = url;
        return;
      }

      try {
        localStorage.setItem(RETURNING_USER_KEY, '1');
      } catch {
        /* ignore */
      }
      rememberActiveTx({
        partnerUserId: userId || walletAddress.toLowerCase(),
        amount: parsedAmount,
        startedAt: Date.now(),
        method:
          selectedMethod === 'ACH_BANK_ACCOUNT' ||
          selectedMethod === 'FIAT_WALLET' ||
          selectedMethod === 'CRYPTO_ACCOUNT'
            ? selectedMethod
            : undefined,
      });

      setSessionUrl(url);
      setStep('opened');
    } catch (err) {
      popup?.close();
      setErrorMessage(err instanceof Error ? err.message : 'Could not start cash out');
      setStep('error');
    }
  };

  const proceedFromQuotes = () => {
    if (selectedMethod === 'USDC') {
      onClose();
      onSwitchToUsdc?.();
      return;
    }
    launchCoinbase();
  };

  // ---- intro ----
  if (step === 'intro') {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Cash Out to Bank" size="md">
        <div className="space-y-5">
          <div className="rounded-xl bg-banana/10 border border-banana/30 p-4">
            <p className="text-banana font-semibold text-sm mb-1">First-time setup</p>
            <p className="text-text-secondary text-sm">
              First time takes ~5 minutes. After that, future cash outs take ~30 seconds.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-text-primary mb-3">How it works</h3>
            <ol className="space-y-3">
              {[
                ['Pick how you want it.', 'Bank in 1–3 days, or instant to your Coinbase account.'],
                ['Connect Coinbase.', 'Sign in or sign up — Coinbase handles dollars. We never touch your money.'],
                ['Verify identity (first time).', 'Coinbase asks for ID — required by US law for crypto-to-cash.'],
                ['Add a payout method (first time).', 'Bank account, or keep funds in your Coinbase wallet.'],
                ['Confirm + sign in your wallet.', 'After tapping Cash out now in Coinbase, your wallet pops up to approve sending the USDC. One tap to sign.'],
              ].map(([title, body], i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-bg-tertiary text-text-primary text-xs font-bold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <div className="text-sm text-text-secondary">
                    <span className="text-text-primary font-medium">{title}</span> {body}
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="rounded-xl bg-bg-tertiary/60 border border-bg-tertiary p-3 space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">Available to cash out</span>
              <span className="text-text-primary font-semibold">{formatCurrency(maxAmount)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">Service</span>
              <span className="text-text-primary font-medium">Coinbase</span>
            </div>
          </div>

          <button
            onClick={() => setStep('amount')}
            className="w-full py-3.5 rounded-xl font-bold text-base bg-banana text-black hover:brightness-110 hover:scale-[1.01] transition-all"
          >
            Got it — Continue
          </button>
        </div>
      </Modal>
    );
  }

  // ---- amount ----
  if (step === 'amount') {
    const setMax = () => setAmountInput(String(maxAmount));
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Cash Out to Bank" size="md">
        <div className="space-y-5">
          {isReturning && (
            <div className="rounded-xl bg-bg-tertiary/60 border border-bg-tertiary p-3 flex items-start gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-success mt-0.5 flex-shrink-0">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <p className="text-text-secondary text-sm">
                Welcome back. Coinbase will use your saved payout method.
              </p>
            </div>
          )}

          <div>
            <label className="text-sm font-semibold text-text-primary mb-2 block">
              {fixedAmount ? 'Cashing out' : 'How much do you want to cash out?'}
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted text-2xl font-semibold">$</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                max={maxAmount}
                step="0.01"
                disabled={fixedAmount}
                value={amountInput}
                onChange={(e) => {
                  setAmountInput(e.target.value);
                  setErrorMessage(null);
                }}
                placeholder="0"
                className={`w-full pl-10 pr-20 py-4 rounded-xl bg-bg-tertiary border text-text-primary text-2xl font-bold focus:outline-none transition-colors ${
                  errorMessage ? 'border-error/60' : 'border-bg-elevated focus:border-banana/50'
                } ${fixedAmount ? 'opacity-80 cursor-not-allowed' : ''}`}
              />
              {!fixedAmount && (
                <button
                  type="button"
                  onClick={setMax}
                  className="absolute right-3 top-1/2 -translate-y-1/2 px-3 py-1 rounded-md text-xs font-bold bg-banana/20 text-banana hover:bg-banana/30 transition-colors"
                >
                  MAX
                </button>
              )}
            </div>
            <div className="flex items-center justify-between mt-2 text-xs">
              <span className="text-text-muted">Available: {formatCurrency(maxAmount)}</span>
              {amountInput && !amountValid && (
                <span className="text-error">
                  {parsedAmount > maxAmount ? `Max is ${formatCurrency(maxAmount)}` : 'Enter a valid amount'}
                </span>
              )}
            </div>
          </div>

          <button
            onClick={fetchQuotes}
            disabled={!amountValid}
            className={`w-full py-4 rounded-xl font-bold text-base transition-all flex items-center justify-center gap-2 ${
              amountValid ? 'bg-banana text-black hover:brightness-110 hover:scale-[1.01]' : 'bg-bg-tertiary text-text-muted cursor-not-allowed'
            }`}
          >
            See payout options
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>

          {!isReturning && (
            <button onClick={() => setStep('intro')} className="w-full text-text-muted text-xs hover:text-text-secondary transition-colors">
              ← Back to overview
            </button>
          )}
        </div>

        {showVerification && userId && (
          <VerificationModal
            isOpen={true}
            onClose={() => setShowVerification(null)}
            userId={userId}
            onComplete={() => {
              setShowVerification(null);
              fetchQuotes();
            }}
          />
        )}
      </Modal>
    );
  }

  // ---- loading_quotes ----
  if (step === 'loading_quotes') {
    return (
      <Modal isOpen={isOpen} onClose={() => undefined} title="Cash Out to Bank" size="md">
        <div className="flex flex-col items-center justify-center py-12 space-y-4">
          <svg className="animate-spin h-10 w-10 text-banana" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <p className="text-text-secondary text-base">Getting current rates from Coinbase…</p>
        </div>
      </Modal>
    );
  }

  // ---- quotes ----
  if (step === 'quotes' && quotes) {
    const usdcReceived = parsedAmount;
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Cash Out to Bank" size="md">
        <div className="space-y-5">
          <div>
            <p className="text-text-muted text-sm">You&apos;re cashing out</p>
            <p className="text-3xl font-bold text-banana">{formatCurrency(parsedAmount)}</p>
          </div>

          <div>
            <p className="text-sm font-semibold text-text-primary mb-3">Pick how you want to receive it</p>
            <div className="space-y-2">
              {quotes
                // Only render methods that returned a successful quote.
                // Coinbase rejects unsupported (country, asset, payment-method)
                // combos with available:false — hiding them keeps the UI
                // clean instead of surfacing raw "InvalidRequest" errors.
                .filter((q) => q.available)
                .map((q) => {
                  const fee = q.totalFee ?? 0;
                  const isFree = fee < 0.01;
                  const selected = selectedMethod === q.method;
                  const disabled = !q.available;
                  return (
                    <button
                      key={q.method}
                      type="button"
                      disabled={disabled}
                      onClick={() => setSelectedMethod(q.method as SelectableMethod)}
                      className={`w-full text-left rounded-xl border p-3.5 transition-all ${
                        disabled
                          ? 'border-bg-tertiary bg-bg-tertiary/30 opacity-50 cursor-not-allowed'
                          : selected
                          ? 'border-banana bg-banana/10'
                          : 'border-bg-tertiary bg-bg-tertiary/30 hover:border-bg-elevated'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${selected ? 'border-banana bg-banana' : 'border-text-muted'}`}>
                              {selected && (
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="ml-px mt-px">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              )}
                            </span>
                            <span className="text-text-primary font-semibold">{q.label}</span>
                            <span className="text-text-muted text-xs">· {q.speed}</span>
                          </div>
                          <p className="text-text-muted text-xs ml-6 mt-0.5">{q.description}</p>
                          {disabled && q.error && <p className="text-error text-xs ml-6 mt-1">{q.error}</p>}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-text-primary font-bold">{formatCurrency(q.fiatAmount)}</p>
                          <p className={`text-xs ${isFree ? 'text-success' : 'text-text-muted'}`}>
                            {isFree ? 'No extra fee' : `+${formatCurrency(fee)} fee`}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}

              <button
                type="button"
                onClick={() => setSelectedMethod('USDC')}
                className={`w-full text-left rounded-xl border p-3.5 transition-all ${
                  selectedMethod === 'USDC' ? 'border-banana bg-banana/10' : 'border-bg-tertiary bg-bg-tertiary/30 hover:border-bg-elevated'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${selectedMethod === 'USDC' ? 'border-banana bg-banana' : 'border-text-muted'}`}>
                        {selectedMethod === 'USDC' && (
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="ml-px mt-px">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </span>
                      <span className="text-text-primary font-semibold">Keep as USDC</span>
                      <span className="text-text-muted text-xs">· Instant</span>
                    </div>
                    <p className="text-text-muted text-xs ml-6 mt-0.5">
                      Send to any wallet — no Coinbase needed. Spend or sell later.
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-text-primary font-bold">{usdcReceived.toFixed(2)} USDC</p>
                    <p className="text-xs text-success">No fees</p>
                  </div>
                </div>
              </button>
            </div>
          </div>

          <div className="rounded-xl bg-bg-tertiary/60 border border-bg-tertiary p-3 text-xs text-text-muted">
            <span className="text-text-primary font-medium">FYI:</span> rates above include
            Coinbase&apos;s conversion spread. Fees marked &quot;extra&quot; are fast-rails fees on top.
          </div>

          <button
            onClick={proceedFromQuotes}
            disabled={!selectedMethod}
            className={`w-full py-4 rounded-xl font-bold text-base transition-all ${
              selectedMethod ? 'bg-banana text-black hover:brightness-110 hover:scale-[1.01]' : 'bg-bg-tertiary text-text-muted cursor-not-allowed'
            }`}
          >
            {selectedMethod === 'USDC' ? 'Continue with USDC' : 'Continue to Coinbase'}
          </button>

          <button onClick={() => setStep('amount')} className="w-full text-text-muted text-xs hover:text-text-secondary transition-colors">
            ← Change amount
          </button>
        </div>

        {/* Verification gate — fires when sell-session backend returns
            requiresVerification: 'kyc'. Without this here, launchCoinbase()
            sets showVerification + setStep('quotes') but the VerificationModal
            never renders because the original render was scoped to step==='amount'. */}
        {showVerification && userId && (
          <VerificationModal
            isOpen={true}
            onClose={() => setShowVerification(null)}
            userId={userId}
            onComplete={() => {
              setShowVerification(null);
              // After verification completes, retry the cashout launch
              // automatically so the user doesn't have to tap Continue again.
              launchCoinbase();
            }}
          />
        )}
      </Modal>
    );
  }

  // ---- launching ----
  if (step === 'launching') {
    return (
      <Modal isOpen={isOpen} onClose={() => undefined} title="Cash Out to Bank" size="md">
        <div className="flex flex-col items-center justify-center py-12 space-y-4">
          <svg className="animate-spin h-10 w-10 text-banana" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <p className="text-text-secondary text-base">Connecting to Coinbase…</p>
        </div>
      </Modal>
    );
  }

  // ---- opened ----
  if (step === 'opened') {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Cash Out to Bank" size="md">
        <div className="space-y-5">
          <div className="flex flex-col items-center pt-2">
            <div className="w-16 h-16 rounded-full bg-banana/20 flex items-center justify-center mb-3">
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-banana">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-text-primary text-center">Coinbase opened in a new window</h3>
            <p className="text-text-secondary text-sm text-center mt-2">
              Complete the steps in the Coinbase window. You&apos;ll come back here when finished.
            </p>
          </div>

          <div className="rounded-xl bg-bg-tertiary/60 border border-bg-tertiary p-3 space-y-2 text-sm">
            <p className="text-text-primary font-semibold">In the Coinbase window</p>
            <ul className="space-y-1.5 text-text-secondary text-xs">
              <li>• Sign in or create your Coinbase account</li>
              <li>• Verify ID and link your payout method (first time only)</li>
              <li>• Tap <strong>Cash out now</strong> to confirm the amount</li>
              <li>
                • Your wallet (MetaMask / Coinbase Wallet) will pop up to approve sending USDC. Tap{' '}
                <strong>Sign / Confirm</strong> in your wallet to finish.
              </li>
            </ul>
          </div>

          <div className="flex gap-3">
            {sessionUrl && (
              <button
                onClick={() => launchCoinbase()}
                className="flex-1 py-3 rounded-xl font-semibold text-sm bg-bg-tertiary text-text-primary hover:bg-bg-elevated transition-all"
              >
                Reopen Coinbase
              </button>
            )}
            <button
              onClick={() => {
                setPollVersion((v) => v + 1);
                setStep('status');
              }}
              className="flex-1 py-3 rounded-xl font-semibold text-sm bg-banana text-black hover:brightness-110 transition-all"
            >
              I&apos;m Done — Track It
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  // ---- status ----
  if (step === 'status') {
    const tx = readActiveTx();
    const copy = getStatusCopy(tx?.method);

    // Staged status text driven by elapsed time — keeps the user informed
    // about WHAT is happening rather than just spinning silently.
    const noTimelineYet = !timeline || timeline.length === 0;
    const stageText = (() => {
      if (timeline && timeline.length > 0) return null; // real timeline takes over
      if (pollGaveUp) {
        return {
          title: "We didn't see a transaction",
          body:
            "It looks like the cash-out didn't complete in Coinbase. If you closed the popup before signing, you can try again. Otherwise reopen Coinbase to finish.",
        };
      }
      if (pollElapsed >= 60) {
        return {
          title: 'Still no transaction yet',
          body:
            "You may need to complete the final sign step in Coinbase. If you closed the popup, tap Reopen Coinbase to resume.",
        };
      }
      if (pollElapsed >= 30) {
        return {
          title: 'Confirming with Coinbase...',
          body: 'This usually takes under 30 seconds — hang tight.',
        };
      }
      return {
        title: 'Confirming with Coinbase...',
        body: 'Verifying your transaction on Base.',
      };
    })();

    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Cash Out Status" size="md">
        <div className="space-y-5">
          <div className="flex items-baseline justify-between">
            <p className="text-text-secondary text-sm">Cashing out</p>
            <p className="text-2xl font-bold text-banana">{formatCurrency(tx?.amount)}</p>
          </div>

          {noTimelineYet && stageText && (
            <div
              className={`rounded-xl p-4 ${
                pollGaveUp
                  ? 'bg-error/10 border border-error/30'
                  : 'bg-banana/10 border border-banana/30'
              }`}
            >
              <p
                className={`font-semibold text-sm mb-1 ${
                  pollGaveUp ? 'text-error' : 'text-banana'
                }`}
              >
                {stageText.title}
              </p>
              <p className="text-text-secondary text-sm">{stageText.body}</p>
            </div>
          )}

          <div className="space-y-3">
            {timeline ? (
              timeline.map((s, i) => (
                <div key={s.key} className="flex items-start gap-3">
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                        s.status === 'done'
                          ? 'bg-success text-black'
                          : s.status === 'active'
                          ? 'bg-banana text-black'
                          : s.status === 'failed'
                          ? 'bg-error text-white'
                          : 'bg-bg-tertiary text-text-muted'
                      }`}
                    >
                      {s.status === 'done' ? (
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : s.status === 'active' ? (
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                          <circle className="opacity-30" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" />
                          <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : s.status === 'failed' ? (
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      ) : (
                        <span className="text-xs">{i + 1}</span>
                      )}
                    </div>
                    {i < timeline.length - 1 && (
                      <div className={`w-0.5 h-6 ${s.status === 'done' ? 'bg-success' : 'bg-bg-tertiary'}`} />
                    )}
                  </div>
                  <p
                    className={`text-sm pt-1 ${
                      s.status === 'done'
                        ? 'text-text-primary'
                        : s.status === 'active'
                        ? 'text-banana font-semibold'
                        : s.status === 'failed'
                        ? 'text-error'
                        : 'text-text-muted'
                    }`}
                  >
                    {s.label}
                  </p>
                </div>
              ))
            ) : (
              <div className="flex items-center justify-center py-8">
                <svg className="animate-spin h-8 w-8 text-banana" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              </div>
            )}
          </div>

          <div className="rounded-xl bg-bg-tertiary/60 border border-bg-tertiary p-3 text-xs text-text-muted">
            {copy.arrival} You can close this window — we&apos;ll keep tracking in the background.
          </div>

          {pollGaveUp || (noTimelineYet && pollElapsed >= 60) ? (
            <div className="flex gap-3">
              <button
                onClick={() => {
                  // Re-open Coinbase with a fresh session so the user can
                  // complete the sign step. Reset polling state so the new
                  // attempt isn't pre-tagged as "gave up".
                  setPollGaveUp(false);
                  setPollElapsed(0);
                  setTimeline(null);
                  launchCoinbase();
                }}
                className="flex-1 py-3 rounded-xl font-semibold text-sm bg-bg-tertiary text-text-primary hover:bg-bg-elevated transition-all"
              >
                Reopen Coinbase
              </button>
              <button
                onClick={onClose}
                className="flex-1 py-3 rounded-xl font-semibold text-sm bg-banana text-black hover:brightness-110 transition-all"
              >
                Close
              </button>
            </div>
          ) : (
            <button
              onClick={onClose}
              className="w-full py-3 rounded-xl font-semibold text-sm bg-banana text-black hover:brightness-110 transition-all"
            >
              Close
            </button>
          )}
        </div>
      </Modal>
    );
  }

  // ---- error ----
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Cash Out to Bank" size="md">
      <div className="space-y-5">
        <div className="rounded-xl bg-error/10 border border-error/30 p-4">
          <p className="text-error font-semibold mb-1">
            {requiresReauth
              ? 'Signed out'
              : isBlocked
                ? 'Withdrawal not available'
                : 'Something went wrong'}
          </p>
          <p className="text-text-secondary text-sm">
            {errorMessage || 'Please try again in a moment.'}
          </p>
          {isBlocked && (
            <p className="text-text-muted text-xs mt-2">
              See our{' '}
              <a
                href="/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-text-secondary"
              >
                Terms of Service
              </a>{' '}
              for details on supported jurisdictions.
            </p>
          )}
        </div>
        <div className="flex gap-3">
          {requiresReauth ? (
            <button
              onClick={async () => {
                // Clear the half-state Privy session, then trigger fresh login.
                // We close the modal so the login flow has the screen to itself —
                // the user re-taps Cash Out after signing in.
                onClose();
                try {
                  await triggerLogout();
                } catch {
                  /* ignore */
                }
                triggerLogin();
              }}
              className="flex-1 py-3 rounded-xl font-bold text-base bg-banana text-black hover:brightness-110 transition-all"
            >
              Sign In
            </button>
          ) : isBlocked ? (
            // Block-rule rejections aren't retryable — only show Close.
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-xl font-bold text-base bg-banana text-black hover:brightness-110 transition-all"
            >
              Close
            </button>
          ) : (
            <>
              <button
                onClick={() => {
                  setErrorMessage(null);
                  setStep(quotes ? 'quotes' : isReturning ? 'amount' : 'intro');
                }}
                className="flex-1 py-3 rounded-xl font-bold text-base bg-bg-tertiary text-text-primary hover:bg-bg-elevated transition-all"
              >
                Try Again
              </button>
              <button
                onClick={onClose}
                className="flex-1 py-3 rounded-xl font-bold text-base bg-banana text-black hover:brightness-110 transition-all"
              >
                Close
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
