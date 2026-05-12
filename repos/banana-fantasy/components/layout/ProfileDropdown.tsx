'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { useExportWallet } from '@privy-io/react-auth';
import { isWalletAdmin } from '@/lib/adminAllowlist';
import { InstallAppButton } from '@/components/home/AddToHomeScreenCard';
import { AvatarWithBadge } from '@/components/badges/AvatarWithBadge';

interface ProfileDropdownProps {
  onEditProfile: () => void;
}

export function ProfileDropdown({ onEditProfile }: ProfileDropdownProps) {
  const { user, logout, switchWallet, isEmbeddedWallet } = useAuth();
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
            <p className="text-sm text-text-muted">{user.walletAddress.slice(0, 6)}...{user.walletAddress.slice(-4)}</p>
          </div>

          {/* Wallet Balance */}
          <div className="px-3 py-2.5 border-b border-bg-tertiary">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-[#2775CA] flex items-center justify-center">
                  <span className="text-white text-[10px] font-bold">$</span>
                </div>
                <span className="text-text-muted text-xs uppercase tracking-wider">Balance</span>
              </div>
              <span className="text-text-primary font-bold text-sm tabular-nums">
                ${user.usdcBalance !== undefined ? user.usdcBalance.toFixed(2) : '0.00'}
              </span>
            </div>
          </div>

          {/* Pass counts + Activity shortcut */}
          <div className="px-3 py-2.5 border-b border-bg-tertiary">
            <div className="flex items-center justify-between mb-2">
              <span className="text-text-muted text-xs uppercase tracking-wider">Your Passes</span>
              <Link
                href="/profile?tab=activity"
                onClick={() => setIsOpen(false)}
                className="text-[11px] text-banana hover:underline underline-offset-2 flex items-center gap-0.5"
              >
                Activity →
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-2">
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

          {/* Card Purchase Rewards — only show after first card purchase */}
          {(user.cardPurchaseCount || 0) > 0 && <div className="px-3 py-2.5 border-b border-bg-tertiary">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-text-muted text-[10px] uppercase tracking-wider">Card Rewards</span>
              <span className="text-text-secondary text-[11px]">{user.cardPurchaseCount || 0}/6</span>
            </div>
            <div className="flex gap-1">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className={`h-1.5 flex-1 rounded-full ${
                    i < (user.cardPurchaseCount || 0) ? 'bg-banana' : 'bg-white/[0.06]'
                  }`}
                />
              ))}
            </div>
            <p className="text-text-muted text-[10px] mt-1">
              {`${6 - (user.cardPurchaseCount || 0)} more card purchase${6 - (user.cardPurchaseCount || 0) !== 1 ? 's' : ''} for a free draft`}
            </p>
          </div>}

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

            <Link
              href="/prizes"
              onClick={() => setIsOpen(false)}
              className="w-full px-4 py-2 text-left text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-colors flex items-center gap-3 text-sm"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
                <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
                <path d="M4 22h16" />
                <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
                <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
                <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
              </svg>
              Prizes
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

            <button
              onClick={copyWallet}
              className="w-full px-4 py-2 text-left text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-colors flex items-center gap-3 text-sm"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              {walletCopied ? 'Copied!' : 'Copy Wallet Address'}
            </button>

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

            {!isEmbeddedWallet && (
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
          </div>

          {/* Install App — mobile only, hidden when already installed */}
          <InstallAppButton />

          {/* Chat with us — opens Crisp chat */}
          <div className="border-t border-bg-tertiary py-1">
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
