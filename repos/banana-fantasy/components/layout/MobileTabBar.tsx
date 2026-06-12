'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
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

  const tabs = [
    {
      href: '/drafting',
      label: 'Draft',
      matchPaths: ['/drafting', '/draft-room', '/buy-drafts'],
      badge: 0,
      icon: (active: boolean) => (
        <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? '#fbbf24' : 'none'} stroke={active ? '#fbbf24' : 'currentColor'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09z" />
          <path d="M12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z" />
          <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
          <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
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
      href: '/my-teams',
      label: 'Teams',
      matchPaths: ['/my-teams', '/exposure'],
      badge: 0,
      icon: (active: boolean) => (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? '#fbbf24' : 'currentColor'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 20V10" />
          <path d="M12 20V4" />
          <path d="M6 20v-6" />
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
      style={{ paddingBottom: 'max(calc(env(safe-area-inset-bottom, 0px) - 20px), 10px)' }}
    >
      <div className="flex items-center justify-around h-14">
        {tabs.map(tab => {
          const active = isActive(tab);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`relative flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors ${
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
            </Link>
          );
        })}
      </div>
    </nav>
  );
});
