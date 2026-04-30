'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { VerificationModal } from './VerificationModal';

const RETURNING_USER_KEY = 'banana-fantasy-cashout-returning';

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
  /** Called after the Coinbase popup is opened — for analytics/state tracking. */
  onSessionOpened?: (sessionUrl: string) => void;
}

type Step = 'intro' | 'amount' | 'launching' | 'opened' | 'error';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

export function CashOutModal({
  isOpen,
  onClose,
  maxAmount,
  fixedAmount,
  draftId,
  userId,
  walletAddress,
  onSessionOpened,
}: CashOutModalProps) {
  const [step, setStep] = useState<Step>('intro');
  const [amountInput, setAmountInput] = useState<string>(maxAmount > 0 ? String(maxAmount) : '');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sessionUrl, setSessionUrl] = useState<string | null>(null);
  const [isReturning, setIsReturning] = useState(false);
  const [showVerification, setShowVerification] = useState<'basic' | 'kyc' | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const returning =
      typeof window !== 'undefined' && localStorage.getItem(RETURNING_USER_KEY) === '1';
    setIsReturning(returning);
    setStep(returning ? 'amount' : 'intro');
    setAmountInput(maxAmount > 0 ? String(maxAmount) : '');
    setErrorMessage(null);
    setSessionUrl(null);
    setShowVerification(null);
  }, [isOpen, maxAmount]);

  const parsedAmount = useMemo(() => {
    const n = Number(amountInput);
    if (!Number.isFinite(n)) return NaN;
    return Math.round(n * 100) / 100;
  }, [amountInput]);

  const amountValid =
    Number.isFinite(parsedAmount) && parsedAmount > 0 && parsedAmount <= maxAmount;

  const launchCoinbase = async () => {
    if (!walletAddress) {
      setErrorMessage('No wallet connected. Please refresh and try again.');
      setStep('error');
      return;
    }
    if (!amountValid) {
      setErrorMessage('Please enter a valid amount.');
      return;
    }

    setStep('launching');
    setErrorMessage(null);

    // Pre-open the popup synchronously so iOS/mobile Safari doesn't block it.
    const popup =
      typeof window !== 'undefined'
        ? window.open('about:blank', 'coinbase-cashout', 'width=480,height=720')
        : null;

    try {
      const res = await fetch('/api/coinbase/sell-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          walletAddress,
          cryptoAmount: parsedAmount,
          ...(draftId ? { draftId } : {}),
          ...(userId ? { userId } : {}),
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string; requiresVerification?: 'basic' | 'kyc' }
          | null;
        if (data?.requiresVerification) {
          popup?.close();
          setShowVerification(data.requiresVerification);
          setStep('amount');
          return;
        }
        throw new Error(data?.error || `Failed to start cash out (${res.status})`);
      }

      const { url } = (await res.json()) as { url: string };

      if (popup && !popup.closed) {
        popup.location.href = url;
        popup.focus();
      } else {
        // Popup blocked — fall back to same-tab navigation.
        window.location.href = url;
        return;
      }

      try {
        localStorage.setItem(RETURNING_USER_KEY, '1');
      } catch {
        // ignore
      }

      setSessionUrl(url);
      setStep('opened');
      onSessionOpened?.(url);
    } catch (err) {
      popup?.close();
      const message = err instanceof Error ? err.message : 'Could not start cash out';
      setErrorMessage(message);
      setStep('error');
    }
  };

  // ---- Step: intro (first-time only) ----
  if (step === 'intro') {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Cash Out to Bank" size="md">
        <div className="space-y-5">
          <div className="rounded-xl bg-banana/10 border border-banana/30 p-4">
            <p className="text-banana font-semibold text-sm mb-1">First-time setup</p>
            <p className="text-text-secondary text-sm">
              Cashing out for the first time takes about 5 minutes. After that, future cash
              outs take ~30 seconds.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-text-primary mb-3">How it works</h3>
            <ol className="space-y-3">
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-bg-tertiary text-text-primary text-xs font-bold flex items-center justify-center">
                  1
                </span>
                <div className="text-sm text-text-secondary">
                  <span className="text-text-primary font-medium">Connect Coinbase.</span> If
                  you have a Coinbase account, sign in. If not, create one — it&apos;s free
                  and takes ~2 minutes.
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-bg-tertiary text-text-primary text-xs font-bold flex items-center justify-center">
                  2
                </span>
                <div className="text-sm text-text-secondary">
                  <span className="text-text-primary font-medium">Verify identity.</span>{' '}
                  Coinbase will ask for ID and basic info. This is required by US law for
                  any crypto-to-cash transaction.
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-bg-tertiary text-text-primary text-xs font-bold flex items-center justify-center">
                  3
                </span>
                <div className="text-sm text-text-secondary">
                  <span className="text-text-primary font-medium">Add your bank.</span>{' '}
                  Coinbase will link your bank account so they can deposit USD.
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-bg-tertiary text-text-primary text-xs font-bold flex items-center justify-center">
                  4
                </span>
                <div className="text-sm text-text-secondary">
                  <span className="text-text-primary font-medium">Confirm and sign.</span>{' '}
                  We&apos;ll show one transaction to approve. Coinbase converts your winnings
                  to dollars and deposits to your bank within 1–3 business days.
                </div>
              </li>
            </ol>
          </div>

          <div className="rounded-xl bg-bg-tertiary/60 border border-bg-tertiary p-3 space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">Available to cash out</span>
              <span className="text-text-primary font-semibold">
                {formatCurrency(maxAmount)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">Service</span>
              <span className="text-text-primary font-medium">Coinbase</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">Time to bank</span>
              <span className="text-text-primary font-medium">1–3 business days</span>
            </div>
          </div>

          <button
            onClick={() => setStep('amount')}
            className="w-full py-3.5 rounded-xl font-bold text-base bg-banana text-black hover:brightness-110 hover:scale-[1.01] transition-all"
          >
            Got it — Continue
          </button>
          <p className="text-text-muted text-xs text-center">
            Need help?{' '}
            <a
              href="https://help.coinbase.com/en/coinbase/getting-started/getting-started-with-coinbase/sign-up"
              target="_blank"
              rel="noopener noreferrer"
              className="text-banana hover:underline"
            >
              Coinbase signup guide
            </a>
          </p>
        </div>
      </Modal>
    );
  }

  // ---- Step: amount (returning users start here, first-timers come from intro) ----
  if (step === 'amount') {
    const setMax = () => setAmountInput(String(maxAmount));
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Cash Out to Bank" size="md">
        <div className="space-y-5">
          {isReturning && (
            <div className="rounded-xl bg-bg-tertiary/60 border border-bg-tertiary p-3 flex items-start gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-success mt-0.5 flex-shrink-0"
              >
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <p className="text-text-secondary text-sm">
                Welcome back. Coinbase will use your saved bank account.
              </p>
            </div>
          )}

          <div>
            <label className="text-sm font-semibold text-text-primary mb-2 block">
              {fixedAmount ? 'Cashing out' : 'How much do you want to cash out?'}
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted text-2xl font-semibold">
                $
              </span>
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
                  errorMessage
                    ? 'border-error/60'
                    : 'border-bg-elevated focus:border-banana/50'
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
              <span className="text-text-muted">
                Available: {formatCurrency(maxAmount)}
              </span>
              {amountInput && !amountValid && (
                <span className="text-error">
                  {parsedAmount > maxAmount
                    ? `Max is ${formatCurrency(maxAmount)}`
                    : 'Enter a valid amount'}
                </span>
              )}
            </div>
          </div>

          <div className="rounded-xl bg-bg-tertiary/60 border border-bg-tertiary p-3 space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">You send</span>
              <span className="text-text-primary font-medium">
                {amountValid ? `${parsedAmount} USDC` : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">You receive (approx.)</span>
              <span className="text-text-primary font-medium">
                {amountValid ? formatCurrency(parsedAmount) : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">Coinbase fee</span>
              <span className="text-text-muted">Shown next</span>
            </div>
          </div>

          {errorMessage && (
            <p className="text-error text-sm">{errorMessage}</p>
          )}

          <button
            onClick={launchCoinbase}
            disabled={!amountValid}
            className={`w-full py-4 rounded-xl font-bold text-base transition-all flex items-center justify-center gap-2 ${
              amountValid
                ? 'bg-banana text-black hover:brightness-110 hover:scale-[1.01]'
                : 'bg-bg-tertiary text-text-muted cursor-not-allowed'
            }`}
          >
            Continue to Coinbase
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>

          {!isReturning && (
            <button
              onClick={() => setStep('intro')}
              className="w-full text-text-muted text-xs hover:text-text-secondary transition-colors"
            >
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
              launchCoinbase();
            }}
          />
        )}
      </Modal>
    );
  }

  // ---- Step: launching ----
  if (step === 'launching') {
    return (
      <Modal isOpen={isOpen} onClose={() => undefined} title="Cash Out to Bank" size="md">
        <div className="flex flex-col items-center justify-center py-12 space-y-4">
          <svg className="animate-spin h-10 w-10 text-banana" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
              fill="none"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <p className="text-text-secondary text-base">Connecting to Coinbase…</p>
        </div>
      </Modal>
    );
  }

  // ---- Step: opened ----
  if (step === 'opened') {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Cash Out to Bank" size="md">
        <div className="space-y-5">
          <div className="flex flex-col items-center pt-2">
            <div className="w-16 h-16 rounded-full bg-banana/20 flex items-center justify-center mb-3">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-banana"
              >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-text-primary text-center">
              Coinbase opened in a new window
            </h3>
            <p className="text-text-secondary text-sm text-center mt-2">
              Complete the steps in the Coinbase window. We&apos;ll automatically detect when
              you&apos;re ready to sign the transaction.
            </p>
          </div>

          <div className="rounded-xl bg-bg-tertiary/60 border border-bg-tertiary p-3 space-y-2 text-sm">
            <p className="text-text-primary font-semibold">What happens next</p>
            <ul className="space-y-1.5 text-text-secondary text-xs">
              <li>• Sign in or create your Coinbase account</li>
              <li>• Verify your identity (first time only)</li>
              <li>• Connect your bank account</li>
              <li>• Coinbase will show you the deposit details</li>
              <li>• Come back here to approve the transaction in your wallet</li>
            </ul>
          </div>

          <div className="flex gap-3">
            {sessionUrl && (
              <button
                onClick={() => window.open(sessionUrl, 'coinbase-cashout')}
                className="flex-1 py-3 rounded-xl font-semibold text-sm bg-bg-tertiary text-text-primary hover:bg-bg-elevated transition-all"
              >
                Reopen Coinbase
              </button>
            )}
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-xl font-semibold text-sm bg-banana text-black hover:brightness-110 transition-all"
            >
              Done
            </button>
          </div>

          <p className="text-text-muted text-xs text-center">
            Having trouble?{' '}
            <a
              href="https://help.coinbase.com/en/coinbase/trading-and-funding/sending-or-receiving-cryptocurrency"
              target="_blank"
              rel="noopener noreferrer"
              className="text-banana hover:underline"
            >
              Coinbase support
            </a>
          </p>
        </div>
      </Modal>
    );
  }

  // ---- Step: error ----
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Cash Out to Bank" size="md">
      <div className="space-y-5">
        <div className="rounded-xl bg-error/10 border border-error/30 p-4">
          <p className="text-error font-semibold mb-1">Something went wrong</p>
          <p className="text-text-secondary text-sm">
            {errorMessage || 'Please try again in a moment.'}
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => {
              setErrorMessage(null);
              setStep(isReturning ? 'amount' : 'intro');
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
        </div>
      </div>
    </Modal>
  );
}
