'use client';

import React, { useState } from 'react';
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isAdminWallet = isWalletAdmin(walletAddress);

  // Nav items - primary links visible to all, auth-gated links for logged-in users
  const navItems = [
    { href: '/drafting', label: 'Drafting', tooltip: 'View active drafts', auth: false },
    { href: '/exposure', label: 'Exposure', tooltip: 'Player & team exposure', auth: true },
    { href: '/marketplace', label: 'Marketplace', tooltip: 'Buy & sell teams', auth: false },
    { href: '/leaderboard', label: 'Leaderboard', tooltip: 'Top players & teams', auth: false },
    { href: '/standings', label: 'Standings', tooltip: 'Check standings', auth: true },
    ...(isAdminWallet ? [{ href: '/admin', label: 'Admin', tooltip: 'Admin dashboard', auth: true }] : []),
  ].filter((item) => !item.auth || isLoading || isLoggedIn);

  const isActive = (href: string) => href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/');

  return (
    <header className="bg-bg-secondary/80 backdrop-blur-md border-b border-bg-tertiary sticky top-0 z-30">
      <div className="w-full pl-3 pr-2 sm:pl-8 sm:pr-4 lg:pl-12 lg:pr-6">
        <div className="flex items-center justify-between h-16">
          {/* Left side: Logo + Navigation grouped together */}
          <div className="flex items-center gap-2">
            <Logo />

            {/* Desktop Navigation */}
            <nav aria-label="Main navigation" className="hidden md:flex items-center">
              {navItems.map((item) => (
                <Tooltip key={item.href} content={item.tooltip}>
                  <Link
                    href={item.href}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F3E216] ${
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

          {/* Right side icons - tighter spacing */}
          <div className="flex items-center gap-1">
            {isLoading || (isLoggedIn && !isBalanceLoaded) ? (
              // Show placeholder while loading to prevent flash
              <div className="w-32" />
            ) : (
              <>
                {/* Batch Progress Indicator */}
                <BatchProgressIndicator />

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
                    <svg width="44" height="28" viewBox="0 0 88 56" className="transition-transform group-hover:scale-110 w-[36px] h-[22px] sm:w-[44px] sm:h-[28px]">
                      <defs>
                        <linearGradient id="goldGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                          <stop offset="0%" stopColor="#FBBF24"/>
                          <stop offset="100%" stopColor="#D97706"/>
                        </linearGradient>
                      </defs>
                      {/* Ticket shape - subtle gold gradient */}
                      <rect x="0" y="0" width="88" height="56" rx="6" fill="url(#goldGradient)"/>
                      {/* Left semicircle cutout */}
                      <circle cx="0" cy="28" r="6" fill="#1a1a2e"/>
                      {/* Right semicircle cutout */}
                      <circle cx="88" cy="28" r="6" fill="#1a1a2e"/>
                      {/* Large centered number */}
                      <text x="44" y="40" textAnchor="middle" fill="#1C1C1E" fontSize="32" fontWeight="bold" fontFamily="system-ui">{isLoggedIn && user ? user.draftPasses + user.freeDrafts : 0}</text>
                    </svg>
                  </Link>
                </Tooltip>

                {/* JP & HOF Stats */}
                {isLoggedIn && user && (
                  <Tooltip
                    content={
                      <div className="text-center space-y-2 py-1">
                        <p className="font-semibold text-text-primary">Draft {(user.draftPasses || 0) + (user.freeDrafts || 0)} of 400</p>
                        <p className="text-red-400 text-xs">Jackpot must hit in next {Math.max(0, 100 - (((user.draftPasses || 0) + (user.freeDrafts || 0)) % 100))} drafts!</p>
                        <p className="text-banana text-xs">{user.hofEntries || 0} HOF guaranteed in next {Math.max(0, 100 - (((user.draftPasses || 0) + (user.freeDrafts || 0)) % 100))} drafts!</p>
                        <div className="border-t border-bg-elevated pt-2 space-y-1">
                          <p className="text-xs"><span className="text-red-400 font-semibold">Jackpot</span> <span className="text-text-secondary">— Win your league &amp; skip to finals</span></p>
                          <p className="text-xs"><span className="text-banana font-semibold">HOF</span> <span className="text-text-secondary">— Compete for bonus prizes</span></p>
                          <p className="text-text-muted text-xs mt-1">1 Jackpot &amp; 5 HOF in every 100 drafts</p>
                        </div>
                      </div>
                    }
                  >
                    {(() => {
                      const totalDrafts = (user.draftPasses || 0) + (user.freeDrafts || 0);
                      const batchEnd = Math.ceil(totalDrafts / 100) * 100 || 100;
                      const jackpotHit = (user.jackpotEntries || 0) > 0;
                      const jackpotRemaining = jackpotHit ? 0 : 1;
                      const hofEarned = user.hofEntries || 0;
                      const allHofHit = hofEarned >= 5;
                      const hofRemaining = allHofHit ? 0 : 5 - hofEarned;
                      return (
                        <div className="hidden sm:flex flex-col items-center w-[72px] py-1 cursor-help">
                          <span className="text-[16px] font-semibold tabular-nums text-white/75 leading-tight">
                            {totalDrafts}<span className="text-white/40 font-normal">/{batchEnd}</span>
                          </span>
                          <div className="flex items-center justify-center gap-[6px] leading-tight">
                            <span className="inline-flex items-center gap-[2px]">
                              <span className={`text-[12px] font-bold tabular-nums ${jackpotHit ? 'text-green-400' : 'text-red-400'}`}>
                                {jackpotHit ? '✓' : jackpotRemaining}
                              </span>
                              <span className="text-[9px] font-semibold text-white/50">JP</span>
                            </span>
                            <span className="inline-flex items-center gap-[2px]">
                              <span className={`text-[12px] font-bold tabular-nums ${allHofHit ? 'text-green-400' : 'text-banana'}`}>
                                {allHofHit ? '✓' : hofRemaining}
                              </span>
                              <span className="text-[9px] font-semibold text-white/50">HOF</span>
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                  </Tooltip>
                )}

                {/* Banana Wheel */}
                <Tooltip
                  content={
                    <div className="text-center">
                      <p className="font-semibold">Banana Wheel</p>
                      {isLoggedIn && user ? (
                        <>
                          <p className="text-text-secondary text-xs mt-1">
                            {user.wheelSpins} spin{user.wheelSpins !== 1 ? 's' : ''} available
                          </p>
                          <p className="text-text-muted text-xs">
                            Win drafts, Jackpots, HOF entries
                          </p>
                        </>
                      ) : (
                        <p className="text-text-muted text-xs mt-1">
                          Win drafts, Jackpots, HOF entries
                        </p>
                      )}
                    </div>
                  }
                >
                  <Link
                    href="/banana-wheel"
                    aria-label={`Banana Wheel${isLoggedIn && user && user.wheelSpins > 0 ? `: ${user.wheelSpins} spins available` : ''}`}
                    className="relative flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-bg-tertiary transition-all group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F3E216]"
                  >
                    <svg width="36" height="36" viewBox="0 0 100 100" className="transition-transform group-hover:scale-110 w-[28px] h-[28px] sm:w-[36px] sm:h-[36px]">
                      {/* Outer dark ring */}
                      <circle cx="50" cy="50" r="48" fill="#2D3A6D" stroke="#1E2A5E" strokeWidth="2"/>

                      {/* Wheel segments - 8 vibrant colors */}
                      <path d="M50,50 L50,8 A42,42 0 0,1 79.7,20.3 Z" fill="#F59E0B"/>
                      <path d="M50,50 L79.7,20.3 A42,42 0 0,1 92,50 Z" fill="#EC4899"/>
                      <path d="M50,50 L92,50 A42,42 0 0,1 79.7,79.7 Z" fill="#8B5CF6"/>
                      <path d="M50,50 L79.7,79.7 A42,42 0 0,1 50,92 Z" fill="#F97316"/>
                      <path d="M50,50 L50,92 A42,42 0 0,1 20.3,79.7 Z" fill="#EF4444"/>
                      <path d="M50,50 L20.3,79.7 A42,42 0 0,1 8,50 Z" fill="#22C55E"/>
                      <path d="M50,50 L8,50 A42,42 0 0,1 20.3,20.3 Z" fill="#FBBF24"/>
                      <path d="M50,50 L20.3,20.3 A42,42 0 0,1 50,8 Z" fill="#06B6D4"/>

                      {/* Center dark circle */}
                      <circle cx="50" cy="50" r="14" fill="#1E2A5E"/>

                      {/* SBS Logo in center */}
                      <image href="/sbs-logo.png" x="40" y="40" width="20" height="20" />

                      {/* Top pointer */}
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

                {/* Profile Dropdown or Log In button */}
                {isLoggedIn && user ? (
                  <ProfileDropdown onEditProfile={onEditProfile} />
                ) : (
                  <Button onClick={() => login()}>Log In</Button>
                )}
              </>
            )}

            {/* Mobile menu button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-nav"
              className="md:hidden p-2 rounded-lg hover:bg-bg-tertiary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F3E216]"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-text-secondary"
              >
                {mobileMenuOpen ? (
                  <>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </>
                ) : (
                  <>
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="3" y1="18" x2="21" y2="18" />
                  </>
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <nav id="mobile-nav" aria-label="Mobile navigation" className="md:hidden py-4 border-t border-bg-tertiary animate-slide-up">
            <div className="flex flex-col gap-1">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                    isActive(item.href)
                      ? 'text-banana bg-banana/10'
                      : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
                  }`}
                >
                  {item.label}
                  <span className="text-text-muted text-xs ml-2">— {item.tooltip}</span>
                </Link>
              ))}
              {/* Additional mobile links */}
              <div className="border-t border-bg-tertiary mt-2 pt-2">
                <Link href="/banana-wheel" onClick={() => setMobileMenuOpen(false)} className="px-4 py-3 rounded-lg text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors flex items-center">
                  🎡 Banana Wheel
                  {isLoggedIn && user && <span className="text-banana ml-2">({user.wheelSpins} spins)</span>}
                </Link>
                <Link href="/jackpot-hof" onClick={() => setMobileMenuOpen(false)} className="px-4 py-3 rounded-lg text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors flex items-center">
                  🎰 Jackpot &amp; HOF
                </Link>
                <Link href="/referrals" onClick={() => setMobileMenuOpen(false)} className="px-4 py-3 rounded-lg text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors flex items-center">
                  🤝 Referrals
                </Link>
                <Link href="/prizes" onClick={() => setMobileMenuOpen(false)} className="px-4 py-3 rounded-lg text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors flex items-center">
                  🏆 Prizes
                </Link>
                {isLoggedIn && (
                  <>
                    <Link href="/exposure" onClick={() => setMobileMenuOpen(false)} className="px-4 py-3 rounded-lg text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors flex items-center">
                      📊 Exposure
                    </Link>
                    <Link href="/rankings" onClick={() => setMobileMenuOpen(false)} className="px-4 py-3 rounded-lg text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors flex items-center">
                      📋 Rankings
                    </Link>
                    <Link href="/history" onClick={() => setMobileMenuOpen(false)} className="px-4 py-3 rounded-lg text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors flex items-center">
                      📜 History
                    </Link>
                  </>
                )}
                <Link href="/faq" onClick={() => setMobileMenuOpen(false)} className="px-4 py-3 rounded-lg text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors flex items-center">
                  ❓ FAQ
                </Link>
              </div>
            </div>
          </nav>
        )}
      </div>
    </header>
  );
}
