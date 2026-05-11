'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';

declare global {
  interface Window {
    $crisp: unknown[];
    CRISP_WEBSITE_ID: string;
  }
}

const STORAGE_KEY = 'sbs.crisp.lastWallet';

// localStorage key Crisp itself uses internally — clearing them on
// wallet change forces a fresh visitor session so two wallets in the
// same browser don't share a chat history. Keys are versioned by Crisp
// but always start with these prefixes.
function clearCrispStorage(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith('crisp-client/') || key.startsWith('crisp_client/')) {
        localStorage.removeItem(key);
      }
    }
    // Also nuke any crisp cookies on this domain
    document.cookie.split(';').forEach((c) => {
      const name = c.split('=')[0]?.trim();
      if (name && name.startsWith('crisp-client/')) {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
      }
    });
  } catch {}
}

export function CrispChat() {
  const { walletAddress, user } = useAuth();
  const initializedRef = useRef(false);

  // First mount: decide if we need to nuke Crisp storage BEFORE the
  // script loads. If the previously-stored wallet doesn't match the
  // current one, the prior visitor's chat history would carry over
  // unless we wipe Crisp's local state first.
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    try {
      const lastWallet = localStorage.getItem(STORAGE_KEY);
      const currentWallet = walletAddress?.toLowerCase() ?? null;
      // If the wallet changed (or one side is null while the other isn't),
      // clear the prior Crisp session so this browser starts fresh.
      if (lastWallet !== currentWallet) {
        clearCrispStorage();
        if (currentWallet) localStorage.setItem(STORAGE_KEY, currentWallet);
        else localStorage.removeItem(STORAGE_KEY);
      }
    } catch {}

    window.$crisp = [];
    window.CRISP_WEBSITE_ID = 'ed386428-a6f2-435a-a3e1-043f0a078093';

    const script = document.createElement('script');
    script.src = 'https://client.crisp.chat/l.js';
    script.async = true;
    document.head.appendChild(script);

    // Hide Crisp floating bubble entirely — chat opens via profile dropdown "Support" button
    // The chat window itself still shows when opened programmatically
    window.$crisp.push(['config', 'hide:on:initial:load', true]);

    const style = document.createElement('style');
    style.id = 'crisp-hide';
    style.textContent = `
      .crisp-client .cc-1brb6 { display: none !important; visibility: hidden !important; }
    `;
    document.head.appendChild(style);

    // Once Crisp loads, hide the bubble via API too
    const waitForCrisp = setInterval(() => {
      if (window.$crisp && typeof (window.$crisp as unknown[]).push === 'function') {
        try { (window.$crisp as unknown[]).push(['do', 'chat:hide']); } catch {}
        clearInterval(waitForCrisp);
      }
    }, 500);
    setTimeout(() => clearInterval(waitForCrisp), 10000);

    return () => {
      const crispScript = document.querySelector('script[src="https://client.crisp.chat/l.js"]');
      if (crispScript) crispScript.remove();
      style.remove();
    };
  // Intentionally only runs once — wallet changes after mount are
  // handled by the effect below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to wallet/user changes AFTER initial mount. If the wallet
  // address changes (different login, logout), reset Crisp's session
  // so the prior chat history doesn't leak into the new identity.
  useEffect(() => {
    if (!initializedRef.current) return;
    try {
      const lastWallet = localStorage.getItem(STORAGE_KEY);
      const currentWallet = walletAddress?.toLowerCase() ?? null;
      if (lastWallet === currentWallet) return;

      // Wallet changed — reset the Crisp session and re-identify.
      const w = window as Window & { $crisp?: { push: (cmd: unknown[]) => void } };
      if (w.$crisp) {
        try { w.$crisp.push(['do', 'session:reset']); } catch {}
      }
      if (currentWallet) localStorage.setItem(STORAGE_KEY, currentWallet);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, [walletAddress]);

  // Whenever we have a logged-in user, tag the Crisp session with
  // their wallet + username so the operator inbox knows who's writing
  // and conversations are properly attributed per identity.
  useEffect(() => {
    if (!walletAddress) return;
    const w = window as Window & { $crisp?: { push: (cmd: unknown[]) => void } };
    if (!w.$crisp) return;
    const tryIdentify = () => {
      try {
        w.$crisp!.push(['set', 'user:nickname', [user?.username || walletAddress.slice(0, 10)]]);
        w.$crisp!.push(['set', 'session:data', [[
          ['wallet', walletAddress],
          ...(user?.id ? [['userId', user.id]] : []),
        ]]]);
      } catch {}
    };
    // Crisp's script may still be loading; retry briefly until $crisp
    // is fully wired up.
    let attempts = 0;
    const id = setInterval(() => {
      attempts += 1;
      tryIdentify();
      if (attempts > 20) clearInterval(id);
    }, 500);
    return () => clearInterval(id);
  }, [walletAddress, user?.username, user?.id]);

  return null;
}
