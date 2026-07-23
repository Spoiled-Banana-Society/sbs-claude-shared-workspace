'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Logo } from './Logo';
import { ProfileDropdown } from './ProfileDropdown';
import { Tooltip } from '../ui/Tooltip';
import { Button } from '../ui/Button';
import { useAuth } from '@/hooks/useAuth';
import { BatchProgressIndicator } from './BatchProgressIndicator';
import { NotificationWidget } from '../NotificationCenter';
import { isWalletAdmin } from '@/lib/adminAllowlist';
import { useAdminAuthHeaders } from '@/hooks/admin/useAdminApi';
import { useAdminNotifications } from '@/hooks/admin/useAdminNotifications';
import { DEPOSITS_ENABLED } from '@/lib/deposits';
import { AddFundsModal } from '../modals/AddFundsModal';

// ── Clean "Option C" header glyphs — bare, monochrome, gold accent only ──
const HEADER_SPOKES: [number, number][] = [
  [50, 4], [82.5, 17.5], [96, 50], [82.5, 82.5], [50, 96], [17.5, 82.5], [4, 50], [17.5, 17.5],
];
// The logo wheel drawn purely in lines (no shading), monochrome.
function HeaderWheel({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className="transition-transform group-hover:scale-110">
      <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,0.62)" strokeWidth="3" />
      <g stroke="rgba(255,255,255,0.55)" strokeWidth="2.4" strokeLinecap="round">
        {HEADER_SPOKES.map(([x, y], i) => <line key={i} x1="50" y1="50" x2={x} y2={y} />)}
      </g>
      <circle cx="50" cy="50" r="11.5" fill="#0c0d11" stroke="rgba(255,255,255,0.62)" strokeWidth="2.6" />
    </svg>
  );
}
// Draft pass: a gold ticket with the count INSIDE it (no floating badge).
function PassTicket({ count, w = 40, h = 25 }: { count: number; w?: number; h?: number }) {
  return (
    <span className="relative inline-flex items-center justify-center transition-transform group-hover:scale-110" style={{ width: w, height: h }}>
      <svg viewBox="0 0 48 30" width={w} height={h} fill="none" stroke="rgba(255,255,255,0.48)" strokeWidth="1.8" strokeLinejoin="round">
        <path d="M4 9A3 3 0 0 1 7 6h34a3 3 0 0 1 3 3v2.5a3.5 3.5 0 0 0 0 7V21a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-2.5a3.5 3.5 0 0 0 0-7z" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-bold text-banana tabular-nums" style={{ fontSize: h >= 24 ? 12 : 11 }}>{count}</span>
    </span>
  );
}

interface HeaderProps {
  onEditProfile: () => void;
  onShowTutorial?: () => void;
}

export function Header({ onEditProfile, onShowTutorial: _onShowTutorial }: HeaderProps) {
  const { user, walletAddress, isLoggedIn, isLoading, isBalanceLoaded, login } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isAdminWallet = isWalletAdmin(walletAddress);

  // Anti-stuck safety net for the header controls. The right side shows a
  // loading skeleton while auth/balance resolve. On mobile Safari, Privy's
  // embedded-wallet creation can hang (iOS partitions the cross-site iframe
  // storage), so `isLoading`/`isBalanceLoaded` may NEVER settle — leaving the
  // header frozen on the skeleton with no way to log in or out. After a
  // timeout we stop waiting and fall through to the real controls (which show
  // the "Log In" button when no user resolved), so the header is never bricked.
  // Normal fast loads never hit this (the timer clears the moment loading ends).
  const stillResolving = isLoading || (isLoggedIn && !isBalanceLoaded);
  const [resolveTimedOut, setResolveTimedOut] = useState(false);
  // Deposit bankroll balance chip (flag-gated). Pure read of the
  // useAuth-polled wallet USDC — NO fetching of its own (Rule #0).
  const [showAddFunds, setShowAddFunds] = useState(false);
  useEffect(() => {
    if (!stillResolving) { setResolveTimedOut(false); return; }
    const t = setTimeout(() => setResolveTimedOut(true), 8000);
    return () => clearTimeout(t);
  }, [stillResolving]);
  const showAuthSkeleton = stillResolving && !resolveTimedOut;

  // Yellow badge next to the Admin link. Only polls when this wallet
  // is on the admin allowlist; non-admin sessions never hit the API.
  const { total: adminNotifTotal } = useAdminNotifications({
    enabled: isAdminWallet,
    useAuthHeaders: useAdminAuthHeaders,
  });

  // FAQ shows in the nav for a visitor's FIRST WEEK, then drops out (Richard
  // 2026-07-08) — new users get pointed at the rules, veterans keep a clean
  // nav (FAQ stays reachable in the profile menu). Anchored to a first-visit
  // stamp in localStorage because no real signup date reaches the client
  // (user.createdAt is stamped at load time, not at signup). If storage is
  // unavailable (private mode) we just show it — erring toward helping a new
  // user beats hiding it.
  // Nav items — desktop only
  const navItems = [
    { href: '/draft', label: 'Draft', tooltip: 'View active drafts', auth: false },
    { href: '/teams', label: 'Teams', tooltip: 'Your drafted teams', auth: true },
    { href: '/promos', label: 'Promos', tooltip: 'Claim free spins & rewards', auth: false },
    // FAQ shown for ALL users on desktop (Boris 2026-07-23), right after Promos
    // — links to the same /faq page as the profile-dropdown FAQ.
    { href: '/faq', label: 'FAQ', tooltip: 'How SBS works', auth: false },
    // Rankings, Exposure, Marketplace, FAQ moved to where they're used —
    // Rankings on the draft page; Exposure & Marketplace under Teams; FAQ in
    // the profile menu — so they no longer clutter the top nav.
    // Leaderboard intentionally hidden until the season starts (no scores yet).
    ...(isAdminWallet ? [{ href: '/admin', label: 'Admin', tooltip: 'Admin dashboard', auth: true }] : []),
  ].filter((item) => !item.auth || isLoading || isLoggedIn);

  const isActive = (href: string) => href === '/' ? pathname === '/' : pathname === href || (pathname ?? '').startsWith(href + '/');

  return (
    <header
      className="bg-bg-secondary/80 backdrop-blur-md border-b border-bg-tertiary sticky top-0 z-30"
      // viewportFit:'cover' (added 2026-06-11 for the bottom tab bar) makes the
      // viewport extend under the notch/status bar. Without this top inset the
      // logo + pfp render jammed up behind the notch on iOS (Boris 2026-06-13).
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="w-full pl-3 pr-2 sm:pl-8 sm:pr-4 lg:pl-12 lg:pr-6">
        <div className="flex items-center justify-between h-14 md:h-16">
          {/* Left side: Logo + Desktop Navigation */}
          <div className="flex items-center gap-2">
            {/* shrink-0 so the header pills can never squeeze the logo smaller
                on mobile (Boris 2026-07-23). */}
            <span className="shrink-0">
              <Logo size="lg" compactMobile />
            </span>

            {/* Desktop Navigation — hidden on mobile */}
            <nav aria-label="Main navigation" className="hidden md:flex items-center flex-shrink min-w-0">
              {navItems.map((item) => {
                const showAdminBadge = item.href === '/admin' && adminNotifTotal > 0;
                return (
                  <Tooltip key={item.href} content={item.tooltip}>
                    <Link
                      href={item.href}
                      className={`relative inline-flex items-center gap-1.5 px-1.5 lg:px-3 py-2 rounded-lg text-xs lg:text-sm font-medium transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F3E216] ${
                        isActive(item.href)
                          ? 'text-white'
                          : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
                      }`}
                    >
                      {item.label}
                      {showAdminBadge && (
                        <span
                          role="link"
                          tabIndex={0}
                          aria-label={`${adminNotifTotal} items need attention — open Logs`}
                          title="Open Logs"
                          onClick={(e) => {
                            // Badge jumps straight to the Logs tab; the rest of
                            // the Admin link still goes to the dashboard.
                            e.preventDefault();
                            e.stopPropagation();
                            router.push('/admin?tab=logs');
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              e.stopPropagation();
                              router.push('/admin?tab=logs');
                            }
                          }}
                          className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-banana text-black text-[10px] font-bold cursor-pointer hover:brightness-110"
                        >
                          {adminNotifTotal > 99 ? '99+' : adminNotifTotal}
                        </span>
                      )}
                    </Link>
                  </Tooltip>
                );
              })}
            </nav>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-0.5 sm:gap-1">
            {showAuthSkeleton ? (
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

                {/* Draft passes — mobile only (desktop shows the gold ticket
                    in the icon row below). Sits next to the JP/HOF batch
                    counter so the user's "ammo" is always one glance away.
                    Total only; the paid/free split lives in the profile menu. */}
                {/* Mobile pass total — no tooltip: a tap navigates to Buy, so a
                    hover-card just flashes for a beat before the modal. Tapping
                    goes straight to Buy; the paid/free split lives in the
                    profile menu's "Your Passes" card. */}
                {/* Hidden entirely at zero passes (Richard 2026-07-21) — a "0"
                    ticket only advertises that you have nothing. */}
                {isLoggedIn && user && user.draftPasses + user.freeDrafts > 0 && (
                  <Link
                    href="/buy-drafts"
                    aria-label={`Draft passes: ${user.draftPasses + user.freeDrafts} available`}
                    className="group md:hidden flex items-center mr-1 px-1.5 py-1 rounded-lg hover:bg-bg-tertiary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F3E216]"
                  >
                    <PassTicket count={user.draftPasses + user.freeDrafts} w={34} h={22} />
                  </Link>
                )}

                {/* Deposit chip — MOBILE. Rightmost money action (Boris
                    2026-07-22): sits after the passes, next to the avatar, in
                    a banana pill so adding funds is the one thing that pops.
                    Whole dollars only (Richard 7/21 — cents pushed the avatar
                    off-screen on iPhone). */}
                {DEPOSITS_ENABLED && isLoggedIn && user && (
                  <button
                    onClick={() => setShowAddFunds(true)}
                    aria-label={`Balance: $${(user.usdcBalance ?? 0).toFixed(2)} — add funds`}
                    className="group md:hidden flex items-center gap-1 mr-1 px-1.5 py-[5px] rounded-full border border-banana/50 bg-banana/10 hover:bg-banana/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F3E216]"
                  >
                    <span className="text-[13px] font-bold text-white tabular-nums leading-none">${Math.floor(user.usdcBalance ?? 0)}</span>
                    <span className="flex items-center justify-center w-[16px] h-[16px] rounded-full border-[1.5px] border-white/80 text-white text-[12px] font-bold leading-none">+</span>
                  </button>
                )}

                {/* ── Desktop-only icons ── */}
                <div className="hidden md:contents">
                  {/* Draft Passes — hidden entirely at zero (Richard 2026-07-21) */}
                  {isLoggedIn && user && user.draftPasses + user.freeDrafts > 0 && (
                    <Tooltip
                      content={
                        <div className="text-center">
                          <p className="font-semibold">Draft Passes</p>
                          <p className="text-text-secondary text-xs mt-1">
                            Paid: {user.draftPasses} | Free: {user.freeDrafts}
                          </p>
                        </div>
                      }
                    >
                      <Link
                        href="/buy-drafts"
                        aria-label={`Draft passes: ${user.draftPasses + user.freeDrafts} available`}
                        className="flex items-center px-2 py-1.5 rounded-lg hover:bg-bg-tertiary transition-all group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F3E216]"
                      >
                        <PassTicket count={user.draftPasses + user.freeDrafts} w={40} h={25} />
                      </Link>
                    </Tooltip>
                  )}

                  {/* Deposit chip — DESKTOP. Right of the passes (Boris
                      2026-07-22), banana pill treatment so it reads as THE
                      money action on a busy header. */}
                  {DEPOSITS_ENABLED && isLoggedIn && user && (
                    <Tooltip
                      content={
                        <div className="text-center">
                          <p className="font-semibold">Deposit Funds to Draft</p>
                          <p className="text-text-secondary text-xs mt-1">Add money here — every draft is $25</p>
                        </div>
                      }
                    >
                      <button
                        onClick={() => setShowAddFunds(true)}
                        aria-label={`Balance: $${(user.usdcBalance ?? 0).toFixed(2)} — add funds`}
                        className="group flex items-center gap-1 mx-1 px-2.5 py-[6px] rounded-full border border-banana/50 bg-banana/10 hover:bg-banana/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F3E216]"
                      >
                        <span className="text-sm font-bold text-white tabular-nums leading-none">${(user.usdcBalance ?? 0) >= 100 ? Math.floor(user.usdcBalance ?? 0) : (user.usdcBalance ?? 0).toFixed(2)}</span>
                        <span className="flex items-center justify-center w-[17px] h-[17px] rounded-full border-[1.5px] border-white/80 text-white text-[12px] font-bold leading-none">+</span>
                      </button>
                    </Tooltip>
                  )}

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
                      <HeaderWheel size={28} />
                      {isLoggedIn && user && user.wheelSpins > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-banana text-black text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                          {user.wheelSpins}
                        </span>
                      )}
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

      {/* Mount only while open — useFundWallet crashes when mounted at page
          level (see CLAUDE.md troubleshooting / BuyPassesModal precedent). */}
      {showAddFunds && (
        <AddFundsModal isOpen={true} onClose={() => setShowAddFunds(false)} />
      )}
    </header>
  );
}
