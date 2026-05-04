'use client';
import { logger } from '@/lib/logger';

import React, { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { useLoginWithOAuth, useLoginWithEmail, useLoginWithSiwe } from '@privy-io/react-auth';

interface MobileLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MobileLoginModal({ isOpen, onClose }: MobileLoginModalProps) {
  const { initOAuth } = useLoginWithOAuth();
  const { sendCode, loginWithCode, state: emailState } = useLoginWithEmail();
  const { generateSiweMessage, loginWithSiwe } = useLoginWithSiwe();

  const [email, setEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [emailError, setEmailError] = useState('');
  const [view, setView] = useState<'main' | 'email-input' | 'otp'>('main');
  const [walletStatus, setWalletStatus] = useState<'idle' | 'connecting' | 'signing' | 'error'>('idle');
  const [walletError, setWalletError] = useState('');
  const [connectingWallet, setConnectingWallet] = useState<'metamask' | 'coinbase' | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mmSdkRef = useRef<Record<string, any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseProviderRef = useRef<any>(null);

  // Pre-load Base Account SDK when modal opens so it's ready on click
  useEffect(() => {
    if (!isOpen) return;
    import('@base-org/account').then(({ createBaseAccountSDK }) => {
      const sdk = createBaseAccountSDK({
        appName: 'Banana Fantasy',
        appLogoUrl: `${window.location.origin}/sbs-logo.png`,
        appChainIds: [8453],
      });
      baseProviderRef.current = sdk.getProvider();
      logger.debug('[CB] Base Account SDK pre-loaded');
    }).catch(err => console.error('[CB] Failed to pre-load Base SDK:', err));
  }, [isOpen]);

  if (!isOpen) return null;

  const isEmailSending = emailState.status === 'sending-code';
  const isOtpSubmitting = emailState.status === 'submitting-code';

  const handleClose = () => {
    setView('main');
    setEmail('');
    setOtpCode('');
    setEmailError('');
    setWalletStatus('idle');
    setWalletError('');
    setConnectingWallet(null);
    onClose();
  };

  const handleSendCode = async () => {
    if (!email.trim()) return;
    setEmailError('');
    try {
      await sendCode({ email: email.trim() });
      setView('otp');
    } catch {
      setEmailError('Failed to send code. Check your email and try again.');
    }
  };

  const handleVerifyCode = async () => {
    if (!otpCode.trim()) return;
    setEmailError('');
    try {
      await loginWithCode({ code: otpCode.trim() });
      handleClose();
    } catch {
      setEmailError('Invalid code. Please try again.');
    }
  };

  const handleMetaMaskLogin = async () => {
    setWalletStatus('connecting');
    setConnectingWallet('metamask');
    setWalletError('');

    try {
      logger.debug('[MM Login] Step 1: Loading MetaMask SDK...');
      const { default: MetaMaskSDK } = await import('@metamask/sdk');

      if (!mmSdkRef.current) {
        logger.debug('[MM Login] Step 2: Initializing SDK...');
        const sdk = new MetaMaskSDK({
          dappMetadata: {
            name: 'Banana Fantasy',
            url: typeof window !== 'undefined' ? window.location.origin : 'https://banana-fantasy-sbs.vercel.app',
          },
          useDeeplink: true,
          preferDesktop: false,
          logging: { developerMode: true },
        });
        await sdk.init();
        mmSdkRef.current = sdk;
        logger.debug('[MM Login] SDK initialized successfully');
      }

      const sdk = mmSdkRef.current;

      logger.debug('[MM Login] Step 3: Calling sdk.connect()...');
      const accounts = await sdk.connect() as string[];
      logger.debug('[MM Login] Step 3 complete. Accounts:', accounts);

      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts returned from MetaMask');
      }

      const { getAddress } = await import('ethers');
      const address = getAddress(accounts[0]);
      logger.debug('[MM Login] Step 4: Connected. Address:', address);
      setWalletStatus('signing');

      const provider = sdk.getProvider();
      if (!provider) {
        throw new Error('MetaMask provider not available after connect');
      }

      const chainIdHex = await provider.request({ method: 'eth_chainId' }) as string;
      const chainIdNum = parseInt(chainIdHex, 16);
      const siweChainId = `eip155:${chainIdNum}` as `eip155:${number}`;
      logger.debug('[MM Login] Step 5: Provider acquired. Chain:', siweChainId);

      const message = await generateSiweMessage({ address, chainId: siweChainId });
      logger.debug('[MM Login] Step 6: SIWE message generated. Requesting signature...');

      const signature = await provider.request({
        method: 'personal_sign',
        params: [message, address],
      }) as string;
      logger.debug('[MM Login] Step 7: Signature received. Logging in with Privy...');

      await loginWithSiwe({
        signature,
        message,
        walletClientType: 'metamask',
        connectorType: 'wallet_connect_v2',
      });
      logger.debug('[MM Login] Step 8: Privy login complete!');

      handleClose();
    } catch (err: unknown) {
      const msg = (err instanceof Error ? err.message : null) || 'Connection failed';
      if (msg.includes('rejected') || msg.includes('denied') || msg.includes('User rejected')) {
        setWalletStatus('idle');
      } else {
        setWalletError(msg);
        setWalletStatus('error');
      }
    } finally {
      setConnectingWallet(null);
    }
  };

  // Coinbase Wallet / Base Account — use SDK directly (bypass Privy's connectWallet modal)
  // Same pattern as MetaMask: SDK handles connection, then SIWE via Privy
  const handleCoinbaseLogin = () => {
    const provider = baseProviderRef.current;
    if (!provider) {
      // SDK not pre-loaded yet — tell user to try again
      setWalletError('Loading... please try again.');
      setWalletStatus('error');
      return;
    }

    setWalletStatus('connecting');
    setConnectingWallet('coinbase');
    setWalletError('');

    // Pre-open the popup SYNCHRONOUSLY from click handler.
    // Safari allows window.open from direct clicks but blocks it from async callbacks.
    // The Base Account SDK calls window.open from deep inside async code, which Safari blocks,
    // showing the "wants to continue in Base Account" dialog. By pre-opening here and
    // monkey-patching window.open, the SDK reuses our popup and skips the dialog.
    const originalOpen = window.open.bind(window);
    const popup = originalOpen(
      'https://keys.coinbase.com/connect',
      `wallet_${crypto.randomUUID()}`,
      `width=420, height=700, left=${(window.innerWidth - 420) / 2 + window.screenX}, top=${(window.innerHeight - 700) / 2 + window.screenY}`
    );

    if (popup) {
      // Intercept SDK's window.open call — return our pre-opened popup
      let intercepted = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).open = (...args: any[]) => {
        if (!intercepted) {
          intercepted = true;
          logger.debug('[CB] Intercepted SDK window.open, reusing pre-opened popup');
          // Navigate to the SDK's full URL (with query params)
          if (args[0] && typeof args[0] === 'string') {
            try { popup.location.href = args[0]; } catch { /* cross-origin */ }
          }
          return popup;
        }
        return originalOpen(...args);
      };

      // Restore after 30s
      setTimeout(() => { window.open = originalOpen; }, 30000);
    }

    // Trigger SDK flow — it will use our pre-opened popup
    (async () => {
      try {
        logger.debug('[CB] Step 1: Requesting accounts...');
        const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[];
        logger.debug('[CB] Step 2: Got accounts:', accounts);

        if (!accounts || accounts.length === 0) {
          throw new Error('No accounts returned from Coinbase Wallet');
        }

        const { getAddress } = await import('ethers');
        const address = getAddress(accounts[0]);
        logger.debug('[CB] Step 3: Address:', address);
        setWalletStatus('signing');

        const chainIdHex = await provider.request({ method: 'eth_chainId' }) as string;
        const chainIdNum = parseInt(chainIdHex as string, 16);
        const siweChainId = `eip155:${chainIdNum}` as `eip155:${number}`;
        logger.debug('[CB] Step 4: Chain:', siweChainId);

        const message = await generateSiweMessage({ address, chainId: siweChainId });
        logger.debug('[CB] Step 5: SIWE message generated, requesting signature...');

        const signature = await provider.request({
          method: 'personal_sign',
          params: [message, address],
        }) as string;
        logger.debug('[CB] Step 6: Signature received, logging in with Privy...');

        await loginWithSiwe({
          signature,
          message,
          walletClientType: 'coinbase_wallet',
          connectorType: 'wallet_connect_v2',
        });
        logger.debug('[CB] Step 7: Privy login complete!');

        handleClose();
      } catch (err: unknown) {
        console.error('[CB] Error:', err);
        const msg = (err instanceof Error ? err.message : null) || 'Connection failed';
        if (msg.includes('rejected') || msg.includes('denied') || msg.includes('User rejected')) {
          setWalletStatus('idle');
        } else {
          setWalletError(msg);
          setWalletStatus('error');
        }
        setConnectingWallet(null);
      }
    })();
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center px-4" onClick={handleClose}>
      <div className="absolute inset-0 bg-black/60" />

      <div
        className="relative w-full max-w-[400px] rounded-2xl overflow-hidden shadow-2xl bg-[#020713] border border-white/[0.08]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-end px-5 pt-5 pb-2">
          {view !== 'main' && (
            <button
              onClick={() => { setView('main'); setEmail(''); setOtpCode(''); setEmailError(''); }}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/[0.06] mr-auto"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ba2ae" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <button onClick={handleClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/[0.06]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ba2ae" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Logo + Title */}
        <div className="text-center px-5 pb-4">
          <div className="mb-3">
            <Image src="/sbs-logo.png" alt="SBS" width={56} height={56} className="rounded-xl mx-auto" />
          </div>
          <h2 className="text-white font-semibold text-[17px]">
            {view === 'email-input' ? 'Enter your email' : view === 'otp' ? 'Check your email' : 'Log in or sign up'}
          </h2>
          {view === 'otp' && (
            <p className="text-[#7b8491] text-[13px] mt-1">We sent a code to {email}</p>
          )}
        </div>

        {/* Content */}
        <div className="px-5 pb-3">
          {/* Main view */}
          {view === 'main' && walletStatus === 'idle' && (
            <div className="space-y-2">
              {/* Email */}
              <button
                onClick={() => setView('email-input')}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06] active:bg-white/[0.08] transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7b8491" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="M22 7l-10 7L2 7" />
                </svg>
                <span className="text-[#7b8491] text-[14px]">your@email.com</span>
              </button>

              {/* Google */}
              <button
                onClick={() => initOAuth({ provider: 'google' })}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06] active:bg-white/[0.08] transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                <span className="text-white text-[14px] font-medium">Google</span>
              </button>

              {/* Twitter */}
              <button
                onClick={() => initOAuth({ provider: 'twitter' })}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06] active:bg-white/[0.08] transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="#f8f8f8">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                <span className="text-white text-[14px] font-medium">X (Twitter)</span>
              </button>

              {/* Coinbase Wallet — direct Base Account SDK (no Privy modal) */}
              <button
                onClick={handleCoinbaseLogin}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06] active:bg-white/[0.08] transition-colors"
              >
                <Image src="/coinbase-wallet.png" alt="Coinbase Wallet" width={32} height={32} className="rounded-lg" />
                <span className="text-white text-[14px] font-medium">Coinbase Wallet</span>
              </button>

              {/* MetaMask — uses MetaMask SDK for direct mobile deep-link */}
              <button
                onClick={handleMetaMaskLogin}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06] active:bg-white/[0.08] transition-colors"
              >
                <Image src="/metamask.png" alt="MetaMask" width={32} height={32} className="rounded-lg" />
                <span className="text-white text-[14px] font-medium">MetaMask</span>
              </button>
            </div>
          )}

          {/* Wallet connecting/signing state */}
          {(walletStatus === 'connecting' || walletStatus === 'signing') && (
            <div className="py-10 text-center">
              <div className="w-12 h-12 mx-auto mb-4 border-2 border-[#f59e0b] border-t-transparent rounded-full animate-spin" />
              <p className="text-white font-medium text-[15px] mb-1">
                {walletStatus === 'connecting'
                  ? `Connecting to ${connectingWallet === 'coinbase' ? 'Coinbase Wallet' : 'MetaMask'}...`
                  : 'Signing in...'}
              </p>
              <p className="text-[#7b8491] text-[13px]">
                {connectingWallet === 'coinbase'
                  ? 'Complete sign-in in the Coinbase window'
                  : walletStatus === 'connecting'
                    ? 'Approve the connection in MetaMask'
                    : 'Confirm the signature in MetaMask'}
              </p>
            </div>
          )}

          {/* Wallet error */}
          {walletStatus === 'error' && (
            <div className="py-8 text-center">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full flex items-center justify-center bg-red-500/10">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </div>
              <p className="text-white font-medium text-[15px] mb-1">Connection failed</p>
              <p className="text-[#7b8491] text-[13px] mb-4">{walletError}</p>
              <button
                onClick={() => { setWalletStatus('idle'); setWalletError(''); setConnectingWallet(null); }}
                className="px-6 py-2 rounded-lg text-[13px] font-medium bg-[#f59e0b] text-black"
              >
                Try again
              </button>
            </div>
          )}

          {/* Email input view */}
          {view === 'email-input' && (
            <div className="space-y-3">
              <input
                type="email"
                autoFocus
                placeholder="your@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSendCode()}
                className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06] text-white text-[14px] placeholder-[#7b8491] outline-none focus:border-[#f59e0b]/50 transition-colors"
              />
              {emailError && <p className="text-red-400 text-[12px]">{emailError}</p>}
              <button
                onClick={handleSendCode}
                disabled={!email.trim() || isEmailSending}
                className="w-full py-3 rounded-xl bg-[#f59e0b] text-black font-semibold text-[14px] disabled:opacity-50 transition-opacity"
              >
                {isEmailSending ? 'Sending...' : 'Continue'}
              </button>
            </div>
          )}

          {/* OTP code view */}
          {view === 'otp' && (
            <div className="space-y-3">
              <input
                type="text"
                autoFocus
                inputMode="numeric"
                placeholder="Enter code"
                value={otpCode}
                onChange={e => setOtpCode(e.target.value.replace(/\D/g, ''))}
                onKeyDown={e => e.key === 'Enter' && handleVerifyCode()}
                maxLength={6}
                className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06] text-white text-[14px] text-center tracking-[0.3em] placeholder-[#7b8491] outline-none focus:border-[#f59e0b]/50 transition-colors"
              />
              {emailError && <p className="text-red-400 text-[12px]">{emailError}</p>}
              <button
                onClick={handleVerifyCode}
                disabled={!otpCode.trim() || isOtpSubmitting}
                className="w-full py-3 rounded-xl bg-[#f59e0b] text-black font-semibold text-[14px] disabled:opacity-50 transition-opacity"
              >
                {isOtpSubmitting ? 'Verifying...' : 'Log in'}
              </button>
              <button
                onClick={() => { setOtpCode(''); setEmailError(''); sendCode({ email: email.trim() }); }}
                className="w-full py-2 text-[#7b8491] text-[13px]"
              >
                Resend code
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 text-center">
          <span className="text-white/[0.15] text-[11px]">Protected by <span className="font-medium">privy</span></span>
        </div>
      </div>
    </div>
  );
}
