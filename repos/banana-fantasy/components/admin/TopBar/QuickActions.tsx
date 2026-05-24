'use client';

/**
 * Quick-actions menu in the admin top bar.
 *
 * A + icon that opens a dropdown of pinned admin shortcuts — the ones
 * Boris reaches for daily. Each item navigates to the right tab pre-set
 * to do the action, so it's always a single click away no matter what
 * tab he's currently on.
 *
 * Phase 3 addition. Lives next to Global Search + Health Pill in the
 * desktop sticky header.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Action {
  label: string;
  description: string;
  href: string;
  emoji: string;
}

const ACTIONS: Action[] = [
  {
    label: 'Find a user',
    description: 'Search by wallet, name, or email',
    href: '/admin?tab=user-lookup',
    emoji: '🔍',
  },
  {
    label: 'Grant draft passes',
    description: 'Mint free passes to a wallet',
    href: '/admin?tab=users',
    emoji: '🎟️',
  },
  {
    label: 'Grant prize',
    description: 'Synthetic prize for testing the withdraw flow',
    href: '/admin?tab=tools',
    emoji: '🏆',
  },
  {
    label: 'Pay withdrawals',
    description: 'Review pending + send USDC batch',
    href: '/admin?tab=money&sub=withdrawals',
    emoji: '💸',
  },
  {
    label: 'Live drafts',
    description: 'Spectate every active draft right now',
    href: '/admin?tab=drafts&sub=active',
    emoji: '🏟️',
  },
  {
    label: 'See logs',
    description: 'Critical / warning / low — last 24h',
    href: '/admin?tab=logs',
    emoji: '🚨',
  },
];

export function QuickActions() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const go = (href: string) => {
    router.push(href);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`shrink-0 w-9 h-9 rounded-md border transition-colors flex items-center justify-center text-base ${
          open
            ? 'border-banana/60 bg-banana/[0.06] text-banana'
            : 'border-white/[0.08] bg-white/[0.04] text-gray-300 hover:text-white hover:border-white/20'
        }`}
        aria-label="Quick actions"
        title="Quick actions"
      >
        +
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-72 rounded-lg border border-white/[0.08] bg-[#15151a]/95 backdrop-blur shadow-2xl shadow-black/60 overflow-hidden">
          <p className="px-4 py-2 text-[10px] uppercase tracking-widest text-gray-500 border-b border-white/[0.04]">
            Quick actions
          </p>
          <ul className="divide-y divide-white/[0.04]">
            {ACTIONS.map((a) => (
              <li key={a.href}>
                <button
                  type="button"
                  onClick={() => go(a.href)}
                  className="w-full text-left px-4 py-2.5 hover:bg-white/[0.04] transition-colors flex items-start gap-3"
                >
                  <span className="text-base shrink-0 mt-0.5">{a.emoji}</span>
                  <div className="min-w-0">
                    <p className="text-sm text-white font-medium leading-tight">{a.label}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">{a.description}</p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
