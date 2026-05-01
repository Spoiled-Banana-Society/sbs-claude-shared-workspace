'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

type WCStatus = 'idle' | 'connecting' | 'approving' | 'signing' | 'success' | 'error';

const WALLET_DEEP_LINKS: Record<string, { scheme: string }> = {
  metamask: { scheme: 'metamask://wc' },
  coinbase: { scheme: 'cbwallet://wc' },
  walletconnect: { scheme: 'wc:' }, // Opens native iOS wallet picker
};

export function useWalletConnectLogin() {
  const [status, setStatus] = useState<WCStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const currentWalletRef = useRef<string>('');

  // Create hidden iframe for WC bridge (runs outside of Privy's context)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const iframe = document.createElement('iframe');
    iframe.src = '/wc-bridge.html';
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
    iframeRef.current = iframe;

    const handleMessage = (event: MessageEvent) => {
      // Bridge iframe is loaded same-origin (/wc-bridge.html). Reject any
      // messages from other origins — `*` would let any iframe (including
      // a malicious ad / 3rd-party script) push fake wc-uri / wc-connected
      // events to drive a phishing flow.
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'wc-uri') {
        // Got the URI from the bridge — deep link to wallet
        const { uri } = event.data;
        const walletId = currentWalletRef.current;
        const wallet = WALLET_DEEP_LINKS[walletId];
        if (wallet) {
          setStatus('approving');

          if (walletId === 'walletconnect') {
            // For WalletConnect catch-all, use the raw wc: URI
            window.location.href = uri;
          } else {
            // For specific wallets, use their native scheme
            const encodedUri = encodeURIComponent(uri);
            window.location.href = `${wallet.scheme}?uri=${encodedUri}`;
          }
        }
      } else if (event.data?.type === 'wc-connected') {
        setStatus('success');
        // TODO: Use the accounts for SIWE login
      } else if (event.data?.type === 'wc-error') {
        const msg = event.data.error || 'Connection failed';
        if (msg.includes('reset') || msg.includes('rejected')) {
          setStatus('idle');
        } else {
          setError(msg);
          setStatus('error');
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      iframe.remove();
    };
  }, []);

  const connectWithWallet = useCallback((walletId: string) => {
    setStatus('connecting');
    setError(null);
    currentWalletRef.current = walletId;

    // Send connect request to the iframe bridge
    if (iframeRef.current?.contentWindow) {
      // Target the same-origin bridge explicitly. `*` would broadcast to any
      // origin if the iframe were ever swapped to a cross-origin URL.
      iframeRef.current.contentWindow.postMessage(
        { type: 'wc-connect', walletId },
        window.location.origin,
      );
    } else {
      setError('Bridge not ready. Try again.');
      setStatus('error');
    }
  }, []);

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
  }, []);

  return { connectWithWallet, status, error, reset };
}
