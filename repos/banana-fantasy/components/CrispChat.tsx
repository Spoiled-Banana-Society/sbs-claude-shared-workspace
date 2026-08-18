'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';

declare global {
  interface Window {
    $crisp: unknown[];
    CRISP_WEBSITE_ID: string;
  }
}

export function CrispChat() {
  const { walletAddress, user } = useAuth();
  const initializedRef = useRef(false);

  // One-time Crisp script + container-hide setup. We don't try to
  // separate Crisp sessions per SBS wallet — real users stick to one
  // wallet per browser, and the cost of getting fancy (clearing
  // storage, calling session:reset) was nuking everyone's chat
  // history on every page refresh while Privy auth was still booting.
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    window.$crisp = [];
    window.CRISP_WEBSITE_ID = 'ed386428-a6f2-435a-a3e1-043f0a078093';

    const script = document.createElement('script');
    script.src = 'https://client.crisp.chat/l.js';
    script.async = true;
    document.head.appendChild(script);

    window.$crisp.push(['config', 'hide:on:initial:load', true]);

    const style = document.createElement('style');
    style.id = 'crisp-hide';
    // Hide the entire Crisp container by default — the yellow SBS
    // button is the only entry. Adding `crisp-open` to <html> reveals
    // the container so chat:open can render the chat window inside.
    // Class names inside the container vary by Crisp release; gating
    // at the container level is class-name-agnostic.
    style.textContent = `
      #crisp-chatbox,
      .crisp-client {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
      html.crisp-open #crisp-chatbox,
      html.crisp-open .crisp-client {
        display: block !important;
        visibility: visible !important;
        pointer-events: auto !important;
      }
    `;
    document.head.appendChild(style);

    // Mirror Crisp's open/close events into the <html> class so the
    // CSS gate above can swap the container in and out without
    // duplicating state.
    const waitForEvents = setInterval(() => {
      const w = window as Window & { $crisp?: { push: (cmd: unknown[]) => void } };
      if (w.$crisp && typeof w.$crisp.push === 'function') {
        try {
          w.$crisp.push(['on', 'chat:opened', () => {
            document.documentElement.classList.add('crisp-open');
          }]);
          w.$crisp.push(['on', 'chat:closed', () => {
            document.documentElement.classList.remove('crisp-open');
            // Crisp re-surfaces its own bubble launcher after close —
            // re-hide so the SBS button/profile entry stay the only doors.
            try { w.$crisp!.push(['do', 'chat:hide']); } catch {}
          }]);
        } catch {}
        clearInterval(waitForEvents);
      }
    }, 500);
    setTimeout(() => clearInterval(waitForEvents), 15000);

    // Belt-and-suspenders: once Crisp is wired up, push chat:hide too.
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
  }, []);

  // Admin support block (v2_users.supportBlocked): keep the whole Crisp
  // container hidden even when the html.crisp-open gate is set, close any
  // open window, and drop the session so nothing reaches the inbox.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const blocked = user?.supportBlocked === true;
    const id = 'crisp-blocked';
    const existing = document.getElementById(id);
    if (!blocked) { existing?.remove(); return; }
    document.documentElement.classList.remove('crisp-open');
    if (!existing) {
      const st = document.createElement('style');
      st.id = id;
      st.textContent = `#crisp-chatbox, .crisp-client { display:none !important; visibility:hidden !important; pointer-events:none !important; }`;
      document.head.appendChild(st);
    }
    try {
      const w = window as Window & { $crisp?: { push: (cmd: unknown[]) => void } };
      w.$crisp?.push(['do', 'chat:close']);
      w.$crisp?.push(['do', 'chat:hide']);
      w.$crisp?.push(['do', 'session:reset']);
    } catch {}
  }, [user?.supportBlocked]);

  // Open the chat from a bell noti ("SBS Team Replied" links /?support=open)
  // — both on a fresh page load carrying the query AND via the in-app event
  // NotificationCenter dispatches for SPA navigations.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const openChat = () => {
      const w = window as Window & { $crisp?: { push: (cmd: unknown[]) => void } };
      document.documentElement.classList.add('crisp-open');
      try {
        w.$crisp?.push(['do', 'chat:show']);
        w.$crisp?.push(['do', 'chat:open']);
      } catch {}
    };
    if (new URLSearchParams(window.location.search).get('support') === 'open') {
      // Crisp may still be booting — retry briefly.
      let tries = 0;
      const id = setInterval(() => {
        tries += 1;
        const w = window as Window & { $crisp?: { push: (cmd: unknown[]) => void } };
        if (w.$crisp && typeof w.$crisp.push === 'function') { openChat(); clearInterval(id); }
        else if (tries > 20) clearInterval(id);
      }, 500);
    }
    window.addEventListener('sbs:open-support', openChat);
    return () => window.removeEventListener('sbs:open-support', openChat);
  }, []);

  // Outside-click to close: when the chat is open (<html> has the
  // crisp-open class), clicks anywhere outside the chat container —
  // and outside the SBS launcher button — fire chat:close. Listener
  // runs always but short-circuits when chat is closed.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleClick = (e: MouseEvent) => {
      if (!document.documentElement.classList.contains('crisp-open')) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Click inside Crisp's container — let Crisp handle it.
      if (target.closest('#crisp-chatbox')) return;
      if (target.closest('.crisp-client')) return;
      // Click on the SBS launcher — its own onClick already toggles,
      // don't race it.
      if (target.closest('[aria-label="Open support chat"]')) return;
      // Click on the profile dropdown "Chat with us" entry.
      if (target.closest('[aria-label="Chat with us"]')) return;

      const w = window as Window & { $crisp?: { push: (cmd: unknown[]) => void } };
      if (w.$crisp) {
        try { w.$crisp.push(['do', 'chat:close']); } catch {}
      }
      // Mirror the close into the html class immediately so the CSS
      // gate hides the container without waiting for Crisp's event.
      document.documentElement.classList.remove('crisp-open');
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Whenever we have a logged-in user, tag the Crisp session with
  // their wallet + username so the operator inbox shows who's writing
  // instead of an opaque visitor ID. This is the bit that actually
  // helps support — the operator sees "0xab12..." or the username
  // instead of "visitor1934".
  useEffect(() => {
    if (!walletAddress) return;
    const w = window as Window & { $crisp?: { push: (cmd: unknown[]) => void } };
    if (!w.$crisp) return;
    const tryIdentify = () => {
      try {
        w.$crisp!.push(['set', 'user:nickname', [user?.username || walletAddress.slice(0, 10)]]);
        // 'addr-' prefix keeps the value a STRING — Crisp number-coerces
        // bare 0x-hex and destroys the address (seen live 2026-06-11).
        w.$crisp!.push(['set', 'session:data', [[
          ['wallet', `addr-${walletAddress}`],
          ...(user?.id ? [['userId', `addr-${user.id}`]] : []),
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
