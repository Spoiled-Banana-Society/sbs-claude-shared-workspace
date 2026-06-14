'use client';

import React, { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useNotifications } from '@/components/NotificationCenter';

export function MobileTabBar() {
  const pathname = usePathname();
  const { user, isLoggedIn } = useAuth();
  const { unreadCount } = useNotifications();

  // Don't show in draft room — it has its own UI
  if (pathname?.startsWith('/draft-room')) return null;

  const wheelSpins = isLoggedIn && user ? user.wheelSpins : 0;
  // Scalars only — the memoized inner bar re-renders ONLY when something
  // visible changed. The auth user object churns identity every few seconds;
  // re-rendering the nav mid-touch is what ate first taps (Boris 2026-06-11).
  return <MobileTabBarInner pathname={pathname ?? ''} wheelSpins={wheelSpins} unreadCount={unreadCount} />;
}

const MobileTabBarInner = React.memo(function MobileTabBarInner({
  pathname,
  wheelSpins,
  unreadCount,
}: {
  pathname: string;
  wheelSpins: number;
  unreadCount: number;
}) {
  const router = useRouter();
  // Navigate on pointerdown — the moment the finger lands — instead of
  // waiting for iOS to bless a full click (its gesture heuristics near the
  // home indicator were eating first taps, Boris 2026-06-11). The click
  // handler stays as a fallback for non-pointer environments; the ref
  // dedupes so a tap never fires twice.
  const lastNavRef = useRef(0);
  const go = (href: string) => {
    const now = Date.now();
    if (now - lastNavRef.current < 500) return;
    lastNavRef.current = now;
    router.push(href);
  };
  useEffect(() => {
    // Keep targets warm so the page swap is instant.
    ['/drafting', '/my-teams', '/promos', '/banana-wheel', '/notifications'].forEach((h) => {
      try { router.prefetch(h); } catch { /* best-effort */ }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tabs = [
    {
      href: '/drafting',
      label: 'Draft',
      matchPaths: ['/drafting', '/draft-room', '/buy-drafts'],
      badge: 0,
      icon: (active: boolean) => (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? '#fbbf24' : 'currentColor'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 4 Q4 4 4 20 Q20 20 20 4 Z" />
          <path d="M8 16 L16 8" />
          <path d="M9.5 13.5 L11 15 M11.5 11.5 L13 13 M13.5 9.5 L15 11" />
        </svg>
      ),
    },
    {
      href: '/my-teams',
      label: 'Teams',
      matchPaths: ['/my-teams', '/exposure'],
      badge: 0,
      icon: (active: boolean) => (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? '#fbbf24' : 'currentColor'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
    },
    {
      href: '/promos',
      label: 'Promos',
      matchPaths: ['/promos'],
      badge: 0,
      icon: (active: boolean) => (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? '#fbbf24' : 'currentColor'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 12 20 22 4 22 4 12" />
          <rect x="2" y="7" width="20" height="5" />
          <line x1="12" y1="22" x2="12" y2="7" />
          <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
          <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
        </svg>
      ),
    },
    {
      href: '/banana-wheel',
      label: 'Spin',
      matchPaths: ['/banana-wheel'],
      badge: wheelSpins,
      icon: (active: boolean) => (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? '#fbbf24' : 'currentColor'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="2" />
          <path d="M12 2v4" />
          <path d="M12 18v4" />
          <path d="M2 12h4" />
          <path d="M18 12h4" />
          <path d="M4.93 4.93l2.83 2.83" />
          <path d="M16.24 16.24l2.83 2.83" />
          <path d="M4.93 19.07l2.83-2.83" />
          <path d="M16.24 7.76l2.83-2.83" />
        </svg>
      ),
    },
    {
      href: '/notifications',
      label: 'Alerts',
      matchPaths: ['/notifications'],
      badge: unreadCount,
      icon: (active: boolean) => (
        <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? '#fbbf24' : 'none'} stroke={active ? '#fbbf24' : 'currentColor'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 01-3.46 0" />
        </svg>
      ),
    },
  ];

  const isActive = (tab: typeof tabs[0]) =>
    tab.matchPaths.some(p => pathname === p || pathname.startsWith(p + '/'));

  return (
    <nav
      aria-label="Mobile navigation"
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#0a0a0f]/95 backdrop-blur-xl border-t border-white/[0.06]"
      // Tiny lift only: most of the safe-area inset is subtracted so the bar
      // sits just a hair above its original spot (Boris: full inset pushed
      // the icons way too high). Floor of 10px keeps clearance everywhere.
      style={{ paddingBottom: 'max(calc(env(safe-area-inset-bottom, 0px) - 12px), 10px)', touchAction: 'manipulation' }}
    >
      <div className="flex items-center justify-around h-14">
        {tabs.map(tab => {
          const active = isActive(tab);
          return (
            <button
              key={tab.href}
              type="button"
              onPointerDown={() => go(tab.href)}
              onClick={() => go(tab.href)}
              className={`relative flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-all touch-manipulation select-none active:scale-90 active:opacity-70 ${
                active ? 'text-banana' : 'text-white/35'
              }`}
            >
              <div className="relative">
                {tab.icon(active)}
                {tab.badge > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-[16px] h-[16px] bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5">
                    {tab.badge > 9 ? '9+' : tab.badge}
                  </span>
                )}
              </div>
              <span className={`text-[10px] font-medium ${active ? 'text-banana' : 'text-white/35'}`}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
});
