'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { usePrizes } from '@/hooks/usePrizes';
import { useExportWallet } from '@privy-io/react-auth';
import { isWalletAdmin } from '@/lib/adminAllowlist';
import { canSwitchWallet } from '@/lib/switchWalletAllowlist';
import { InstallAppButton } from '@/components/home/AddToHomeScreenCard';
import { AvatarWithBadge } from '@/components/badges/AvatarWithBadge';
import { FREE_DRAFT_CREDIT_CENTS } from '@/lib/pricing';

// Where the social icons under "Chat with us" point.
const SBS_X_URL = 'https://x.com/SBSFantasy';
const SBS_DISCORD_URL = 'https://discord.gg/4q4ZgXuMN4';
const SBS_EMAIL = 'team@sbsfantasy.com';

interface ProfileDropdownProps {
  onEditProfile: () => void;
}

export function ProfileDropdown({ onEditProfile }: ProfileDropdownProps) {
  const { user, logout, switchWallet, isEmbeddedWallet } = useAuth();
  const { availableBalance } = usePrizes();
  const { exportWallet } = useExportWallet();
  const [isOpen, setIsOpen] = useState(false);
  const [walletCopied, setWalletCopied] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Reset states when dropdown closes
  useEffect(() => {
    if (!isOpen) {
      setWalletCopied(false);
    }
  }, [isOpen]);

  if (!user) return null;

  const copyWallet = () => {
    navigator.clipboard.writeText(user.walletAddress);
    setWalletCopied(true);
    setTimeout(() => setWalletCopied(false), 2000);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Profile Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 p-1 rounded-lg hover:bg-bg-tertiary transition-colors group"
      >
        {/* Avatar with equipped badge */}
        <AvatarWithBadge
          imageUrl={user.profilePicture}
          alt={user.username}
          size={36}
          equippedBadge={user.equippedBadge}
        />
        {/* Dropdown arrow */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-text-muted transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-72 max-h-[calc(100vh-80px)] bg-bg-secondary border border-bg-tertiary rounded-xl shadow-2xl overflow-y-auto animate-slide-up z-50">
          {/* User Info */}
          <div className="px-4 py-3 border-b border-bg-tertiary">
            <p className="font-semibold text-text-primary">{user.username}</p>
            {user.xHandle && (
              <a
                href={`https://x.com/${user.xHandle.replace('@', '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-pro hover:text-pro/80 transition-colors flex items-center gap-1"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
                {user.xHandle}
              </a>
            )}
            <button
              onClick={copyWallet}
              title="Copy wallet address"
              className="group/wallet mt-0.5 flex items-center gap-1.5 text-sm text-text-muted hover:text-text-secondary transition-colors"
            >
              <span className="tabular-nums">{user.walletAddress.slice(0, 6)}...{user.walletAddress.slice(-4)}</span>
              {walletCopied ? (
                <span className="flex items-center gap-0.5 text-[11px] text-banana">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Copied
                </span>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="opacity-0 group-hover/wallet:opacity-100 transition-opacity"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </button>
          </div>

          {/* Withdrawable winnings — same number shown atop /prizes
              ("Available to withdraw"). Replaces the old idle-wallet-USDC
              balance, which read $0.00 for card/Privy users since funds are
              spent on mint immediately and payouts never sit in the wallet.
              Tapping the row jumps to /prizes to cash out. */}
          <Link
            href="/prizes"
            onClick={() => setIsOpen(false)}
            className="block px-3 py-2.5 border-b border-bg-tertiary hover:bg-bg-tertiary/60 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-[#2775CA] flex items-center justify-center">
                  <span className="text-white text-[10px] font-bold">$</span>
                </div>
                <span className="text-text-muted text-xs uppercase tracking-wider">Winnings</span>
              </div>
              <span className={`font-bold text-sm tabular-nums ${availableBalance > 0 ? 'text-banana' : 'text-text-primary'}`}>
                ${availableBalance.toFixed(2)}
              </span>
            </div>
          </Link>

          {/* Pass counts (Activity now lives in the menu below as its own line) */}
          <div className="px-3 py-2.5 border-b border-bg-tertiary">
            <div className="mb-2">
              <span className="text-text-muted text-xs uppercase tracking-wider">Your Passes</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-white/[0.03] px-2.5 py-1.5">
                <p className="text-[10px] uppercase text-text-muted tracking-wider">Total</p>
                <p className="text-text-primary font-bold text-sm tabular-nums">{(user.draftPasses ?? 0) + (user.freeDrafts ?? 0)}</p>
              </div>
              <div className="rounded-lg bg-white/[0.03] px-2.5 py-1.5">
                <p className="text-[10px] uppercase text-text-muted tracking-wider">Paid</p>
                <p className="text-text-primary font-bold text-sm tabular-nums">{user.draftPasses ?? 0}</p>
              </div>
              <div className="rounded-lg bg-white/[0.03] px-2.5 py-1.5">
                <p className="text-[10px] uppercase text-text-muted tracking-wider">Free</p>
                <p className="text-text-primary font-bold text-sm tabular-nums">{user.freeDrafts ?? 0}</p>
              </div>
            </div>
          </div>

          {/* Card-fee credit → free draft — only show after first card purchase */}
          {(user.cardFeeCreditCents || 0) > 0 && (() => {
            const credit = Math.min(FREE_DRAFT_CREDIT_CENTS, user.cardFeeCreditCents || 0);
            const pct = Math.min(100, (credit / FREE_DRAFT_CREDIT_CENTS) * 100);
            const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
            const remaining = Math.max(0, FREE_DRAFT_CREDIT_CENTS - credit);
            return (
            <div className="px-3 py-2.5 border-b border-bg-tertiary">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-text-muted text-[10px] uppercase tracking-wider">Card Fee Credit</span>
                <span className="text-text-secondary text-[11px]">{`${usd(credit)} / ${usd(FREE_DRAFT_CREDIT_CENTS)}`}</span>
              </div>
              <div className="relative h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                <div className="absolute inset-y-0 left-0 bg-banana rounded-full" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-text-muted text-[10px] mt-1">
                {`${usd(remaining)} in card fees until a free draft`}
              </p>
            </div>
            );
          })()}

          {/* Menu Items */}
          <div className="py-1">
            <Link
              href="/profile"
              onClick={() => setIsOpen(false)}
              className="w-full px-4 py-2 text-left text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-colors flex items-center gap-3 text-sm"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              My Profile
            </Link>

            <button
              onClick={() => {
                onEditProfile();
                setIsOpen(false);
              }}
              className="w-full px-4 py-2 text-left text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-colors flex items-center gap-3 text-sm"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              Edit Profile
            </button>

            <Link
              href="/messages"
              onClick={() => setIsOpen(false)}
              className="w-full px-4 py-2 text-left text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-colors flex items-center gap-3 text-sm"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              Messages
            </Link>

            <Link
              href="/profile?tab=notifications"
              onClick={() => setIsOpen(false)}
              className="w-full px-4 py-2 text-left text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-colors flex items-center gap-3 text-sm"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
              </svg>
              Draft Alerts
            </Link>

            {isEmbeddedWallet && (
              <button
                onClick={() => {
                  exportWallet();
                  setIsOpen(false);
                }}
                className="w-full px-4 py-2 text-left text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-colors flex items-center gap-3 text-sm"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                Export Wallet
              </button>
            )}

            {!isEmbeddedWallet && canSwitchWallet(user.walletAddress) && (
              <button
                onClick={() => {
                  switchWallet();
                  setIsOpen(false);
                }}
                className="w-full px-4 py-2 text-left text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-colors flex items-center gap-3 text-sm"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="17 1 21 5 17 9" />
                  <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                  <polyline points="7 23 3 19 7 15" />
                  <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                </svg>
                Switch Wallet
              </button>
            )}

            {isWalletAdmin(user.walletAddress) && (
              <Link
                href="/admin"
                onClick={() => setIsOpen(false)}
                className="w-full px-4 py-2 text-left text-banana hover:bg-bg-tertiary hover:text-banana transition-colors flex items-center gap-3 text-sm"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2l3 7h7l-5.5 4.5 2 7L12 16l-6.5 4.5 2-7L2 9h7z" />
                </svg>
                Admin
              </Link>
            )}

            {/* Admin QA: force the Get-the-App banner to show once on home —
                works even inside the installed app (no standalone gate). After
                it shows, normal rules apply: ×-ing it re-dismisses for good. */}
            {isWalletAdmin(user.walletAddress) && (
              <button
                onClick={() => {
                  try { sessionStorage.setItem('sbs-force-install-banner', '1'); } catch {}
                  setIsOpen(false);
                  window.location.assign('/');
                }}
                className="w-full px-4 py-2 text-left text-banana/80 hover:bg-bg-tertiary hover:text-banana transition-colors flex items-center gap-3 text-sm"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="6" y="2" width="12" height="20" rx="3" />
                  <line x1="12" y1="18" x2="12" y2="18" />
                </svg>
                Show install banner (QA)
              </button>
            )}
          </div>

          {/* Install App — mobile only, hidden when already installed */}
          <InstallAppButton />

          {/* Chat with us — opens Crisp chat */}
          <div className="py-1">
            <button
              onClick={() => {
                try {
                  if (window.$crisp) {
                    // CrispChat hides the container until <html> has
                    // `crisp-open` — add it before asking Crisp to open.
                    document.documentElement.classList.add('crisp-open');
                    (window.$crisp as unknown[]).push(['do', 'chat:show']);
                    (window.$crisp as unknown[]).push(['do', 'chat:open']);
                  }
                } catch {}
                setIsOpen(false);
              }}
              className="w-full px-4 py-2 text-left text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-colors flex items-center gap-3 text-sm"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              Chat with us
            </button>

            {/* Social / contact — X, Discord, email. Left-aligned, tight row.
                Email address is intentionally NOT shown; the mail icon opens a
                compose window to SBS_EMAIL so the address stays unscraped. */}
            <div className="px-2 pb-1.5 flex items-center gap-0.5">
              <a
                href={SBS_X_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Follow SBS on X"
                title="@SBSFantasy on X"
                className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:bg-bg-tertiary hover:text-text-primary transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
              <a
                href={SBS_DISCORD_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Join the SBS Discord"
                title="Join our Discord"
                className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:bg-bg-tertiary hover:text-[#5865F2] transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
                </svg>
              </a>
              <a
                href={`mailto:${SBS_EMAIL}`}
                aria-label="Email the SBS team"
                title="Email us"
                className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:bg-bg-tertiary hover:text-text-primary transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                </svg>
              </a>
            </div>
          </div>

          {/* Logout */}
          <div className="border-t border-bg-tertiary py-1">
            <button
              onClick={() => {
                logout();
                setIsOpen(false);
              }}
              className="w-full px-4 py-2 text-left text-error hover:bg-error/10 transition-colors flex items-center gap-3 text-sm"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Log Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
