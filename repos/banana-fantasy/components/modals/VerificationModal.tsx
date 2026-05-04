'use client';

import React, { useState, useCallback } from 'react';
import { Modal } from '../ui/Modal';
import { usePrivy } from '@privy-io/react-auth';

interface VerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  onComplete: () => void;
}

type Step = 'loading' | 'verifying' | 'success' | 'error';

export function VerificationModal({ isOpen, onClose, userId: _userId, onComplete }: VerificationModalProps) {
  const { getAccessToken } = usePrivy();
  const [step, setStep] = useState<Step>('loading');
  const [error, setError] = useState('');

  const startVerification = useCallback(async () => {
    setStep('loading');
    setError('');

    try {
      const token = await getAccessToken();

      // Create session via our API
      const res = await fetch('/api/verify/session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ callback: window.location.href }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to start verification');
      }

      const data = await res.json();

      if (data.sessionUrl) {
        setStep('verifying');
        // Launch Didit SDK
        const { DiditSdk } = await import('@didit-protocol/sdk-web');
        const sdk = DiditSdk.shared;
        sdk.onComplete = (result) => {
          if (result.type === 'completed' && result.session?.status === 'Approved') {
            setStep('success');
            onComplete();
          } else if (result.type === 'cancelled') {
            setStep('error');
            setError('Verification was cancelled.');
          } else {
            setError('Verification was not approved. Please try again.');
            setStep('error');
          }
        };
        await sdk.startVerification({ url: data.sessionUrl });
      }
    } catch (err) {
      console.error('[Verification] Error:', err);
      setError(err instanceof Error ? err.message : 'Verification failed');
      setStep('error');
    }
  }, [getAccessToken, onComplete]);

  // Start verification when modal opens
  React.useEffect(() => {
    if (isOpen) {
      startVerification();
    }
  }, [isOpen, startVerification]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Identity Verification" size="md">
      {/* Loading / Verifying */}
      {(step === 'loading' || step === 'verifying') && (
        <div className="flex flex-col items-center py-12 space-y-3">
          <div className="w-10 h-10 border-2 border-banana border-t-transparent rounded-full animate-spin" />
          <p className="text-text-secondary text-sm">
            {step === 'loading' ? 'Starting verification...' : 'Complete the verification in the popup'}
          </p>
        </div>
      )}

      {/* Success */}
      {step === 'success' && (
        <div className="flex flex-col items-center py-8 space-y-4">
          <div className="w-16 h-16 rounded-full bg-success/20 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-success">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <h3 className="text-xl font-bold text-text-primary">Verified!</h3>
          <p className="text-text-secondary text-center text-sm">You&apos;re all set. You can now withdraw your winnings.</p>
          <button onClick={onClose} className="w-full py-3 rounded-xl font-bold bg-banana text-black hover:brightness-110">Continue</button>
        </div>
      )}

      {/* Error */}
      {step === 'error' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-error/10 border border-error/30">
            <p className="text-error font-semibold">Verification failed</p>
            <p className="text-text-secondary text-sm mt-1">{error || 'Please try again.'}</p>
          </div>
          <div className="flex gap-3">
            <button onClick={startVerification} className="flex-1 py-3 rounded-xl font-bold bg-bg-tertiary text-text-primary">Try Again</button>
            <button onClick={onClose} className="flex-1 py-3 rounded-xl font-bold bg-banana text-black">Close</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
