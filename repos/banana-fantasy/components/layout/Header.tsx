'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from './Logo';
import { ProfileDropdown } from './ProfileDropdown';
import { Tooltip } from '../ui/Tooltip';
import { Button } from '../ui/Button';
import { useAuth } from '@/hooks/useAuth';
import { BatchProgressIndicator } from './BatchProgressIndicator';
import { NotificationWidget } from '../NotificationCenter';
import { isWalletAdmin } from '@/lib/adminAllowlist';

interface HeaderProps {
  onEditProfile: () => void;
  onShowTutorial?: () => void;
}

export function Header({ onEditProfile, onShowTutorial: _onShowTutorial }: HeaderProps) {
  const { user, walletAddress, isLoggedIn, isLoading, isBalanceLoaded, login } = useAuth();
  const pathname = usePathname();
  const isAdminWallet = isWalletAdmin(walletAddress);

  // Nav items — desktop only
  const navItems = [
    { href: '/drafting', label: 'Drafting', tooltip: 'View active drafts', auth: false },
    { href: '/rankings', label: 'Rankings', tooltip: 'Custom rankings & auto-draft limits', auth: false },
    { href: '/exposure', label: 'Exposure', tooltip: 'Player & team exposure', auth: true },
    { href: '/marketplace', label: 'Marketplace', tooltip: 'Buy & sell teams', auth: false },
    { href: '/leaderboard', label: 'Leaderboard', tooltip: 'Top players & teams', auth: false },
    { href: '/faq', label: 'FAQ', tooltip: 'Frequently asked questions', auth: false },
    { href: '/standings', label: 'Standings', tooltip: 'Check standings', auth: true },
    ...(isAdminWallet ? [{ href: '/admin', label: 'Admin', tooltip: 'Admin dashboard', auth: true }] : []),
  ].filter((item) => !item.auth || isLoading || isLoggedIn);

  const isActive = (href: string) => href === '/' ? pathname === '/' : pathname === href || (pathname ?? '').startsWith(href + '/');

  return (
    <header className="bg-bg-secondary/80 backdrop-blur-md border-b border-bg-tertiary sticky top-0 z-30">
      <div className="w-full pl-3 pr-2 sm:pl-8 sm:pr-4 lg:pl-12 lg:pr-6">
        <div className="flex items-center justify-between h-14 md:h-16">
          {/* Left side: Logo + Desktop Navigation */}
          <div className="flex items-center gap-2">
            <Logo size="lg" />

            {/* Desktop Navigation — hidden on mobile */}
            <nav aria-label="Main navigation" className="hidden md:flex items-center flex-shrink min-w-0">
              {navItems.map((item) => (
                <Tooltip key={item.href} content={item.tooltip}>
                  <Link
                    href={item.href}
                    className={`px-1.5 lg:px-3 py-2 rounded-lg text-xs lg:text-sm font-medium transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F3E216] ${
                      isActive(item.href)
                        ? 'text-white'
                        : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
                    }`}
                  >
                    {item.label}
                  </Link>
                </Tooltip>
              ))}
            </nav>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-0.5 sm:gap-1">
            {isLoading || (isLoggedIn && !isBalanceLoaded) ? (
              // Skeleton
              <>
                <div className="flex items-center px-1 py-1.5 animate-pulse">
                  <div className="w-[48px] h-[28px] rounded bg-white/10" />
                </div>
                <div className="w-8 h-8 md:w-9 md:h-9 rounded-full bg-white/10 animate-pulse" />
              </>
            ) : (
              <>
                {/* Batch Progress — visible on all sizes */}
                <BatchProgressIndicator />

                {/* ── Desktop-only icons ── */}
                <div className="hidden md:contents">
                  {/* Draft Passes */}
                  <Tooltip
                    content={
                      <div className="text-center">
                        <p className="font-semibold">Draft Passes</p>
                        {isLoggedIn && user && (
                          <p className="text-text-secondary text-xs mt-1">
                            Paid: {user.draftPasses} | Free: {user.freeDrafts}
                          </p>
                        )}
                      </div>
                    }
                  >
                    <Link
                      href="/buy-drafts"
                      aria-label={`Draft passes: ${isLoggedIn && user ? user.draftPasses + user.freeDrafts : 0} available`}
                      className="flex items-center px-2 py-1.5 rounded-lg hover:bg-bg-tertiary transition-all group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F3E216]"
                    >
                      <svg width="44" height="28" viewBox="0 0 88 56" className="transition-transform group-hover:scale-110 w-[44px] h-[28px]">
                        <defs>
                          <linearGradient id="goldGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#FBBF24"/>
                            <stop offset="100%" stopColor="#D97706"/>
                          </linearGradient>
                        </defs>
                        <rect x="0" y="0" width="88" height="56" rx="6" fill="url(#goldGradient)"/>
                        <circle cx="0" cy="28" r="6" fill="#1a1a2e"/>
                        <circle cx="88" cy="28" r="6" fill="#1a1a2e"/>
                        <text x="44" y="40" textAnchor="middle" fill="#1C1C1E" fontSize="32" fontWeight="bold" fontFamily="system-ui">{isLoggedIn && user ? user.draftPasses + user.freeDrafts : 0}</text>
                      </svg>
                    </Link>
                  </Tooltip>

                  {/* Banana Wheel */}
                  <Tooltip
                    content={
                      <div className="text-center">
                        <p className="font-semibold">Banana Wheel</p>
                        {isLoggedIn && user ? (
                          <p className="text-text-secondary text-xs mt-1">
                            {user.wheelSpins} spin{user.wheelSpins !== 1 ? 's' : ''} available
                          </p>
                        ) : (
                          <p className="text-text-muted text-xs mt-1">Win drafts, Jackpots, HOF entries</p>
                        )}
                      </div>
                    }
                  >
                    <Link
                      href="/banana-wheel"
                      aria-label={`Banana Wheel${isLoggedIn && user && user.wheelSpins > 0 ? `: ${user.wheelSpins} spins available` : ''}`}
                      className="relative flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-bg-tertiary transition-all group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F3E216]"
                    >
                      <svg width="36" height="36" viewBox="0 0 100 100" className="transition-transform group-hover:scale-110 w-[36px] h-[36px]">
                        <circle cx="50" cy="50" r="48" fill="#2D3A6D" stroke="#1E2A5E" strokeWidth="2"/>
                        <path d="M50,50 L50,8 A42,42 0 0,1 79.7,20.3 Z" fill="#F59E0B"/>
                        <path d="M50,50 L79.7,20.3 A42,42 0 0,1 92,50 Z" fill="#EC4899"/>
                        <path d="M50,50 L92,50 A42,42 0 0,1 79.7,79.7 Z" fill="#8B5CF6"/>
                        <path d="M50,50 L79.7,79.7 A42,42 0 0,1 50,92 Z" fill="#F97316"/>
                        <path d="M50,50 L50,92 A42,42 0 0,1 20.3,79.7 Z" fill="#EF4444"/>
                        <path d="M50,50 L20.3,79.7 A42,42 0 0,1 8,50 Z" fill="#22C55E"/>
                        <path d="M50,50 L8,50 A42,42 0 0,1 20.3,20.3 Z" fill="#FBBF24"/>
                        <path d="M50,50 L20.3,20.3 A42,42 0 0,1 50,8 Z" fill="#06B6D4"/>
                        <circle cx="50" cy="50" r="14" fill="#1E2A5E"/>
                        <image href="/sbs-logo.png" x="40" y="40" width="20" height="20" />
                        <path d="M50,0 L44,14 L56,14 Z" fill="#F59E0B"/>
                      </svg>
                      {isLoggedIn && user && user.wheelSpins > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-banana text-black text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                          {user.wheelSpins}
                        </span>
                      )}
                    </Link>
                  </Tooltip>

                  {/* Prizes */}
                  <Tooltip content="Prizes">
                    <Link
                      href="/prizes"
                      aria-label="Prizes"
                      className="flex items-center px-3 py-2 rounded-lg hover:bg-bg-tertiary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F3E216]"
                    >
                      <span className="text-2xl" aria-hidden="true">🏆</span>
                    </Link>
                  </Tooltip>

                  {/* Notifications */}
                  {isLoggedIn && <NotificationWidget />}
                </div>

                {/* Profile Dropdown or Log In — always visible */}
                {isLoggedIn && user ? (
                  <ProfileDropdown onEditProfile={onEditProfile} />
                ) : (
                  <Button onClick={() => login()}>Log In</Button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
