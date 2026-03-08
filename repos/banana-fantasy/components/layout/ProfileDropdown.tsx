'use client';

import React, { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { useAuth } from '@/hooks/useAuth';
import { useExportWallet } from '@privy-io/react-auth';
import { getNflTeamLogo } from '@/lib/nflTeams';

interface ProfileDropdownProps {
  onEditProfile: () => void;
}

export function ProfileDropdown({ onEditProfile }: ProfileDropdownProps) {
  const { user, logout, isEmbeddedWallet } = useAuth();
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
        {/* Avatar */}
        <div className="w-9 h-9 rounded-full flex items-center justify-center overflow-hidden bg-[#1a1a2e] border border-white/20">
          {user.profilePicture ? (
            <Image
              src={user.profilePicture}
              alt={user.username}
              width={36}
              height={36}
              className="w-full h-full object-cover"
              unoptimized
            />
          ) : (
            <span className="text-lg">🍌</span>
          )}
        </div>
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
        <div className="absolute right-0 top-full mt-2 w-72 bg-bg-secondary border border-bg-tertiary rounded-xl shadow-2xl overflow-hidden animate-slide-up z-50">
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
            {user.nflTeam && getNflTeamLogo(user.nflTeam) && (
              <div className="mt-1.5">
                <Image
                  src={getNflTeamLogo(user.nflTeam)!}
                  alt={user.nflTeam}
                  width={24}
                  height={24}
                  className="w-6 h-6 object-contain"
                />
              </div>
            )}
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

          {/* Inventory Row */}
          <div className="px-3 py-2.5 border-b border-bg-tertiary">
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { label: 'Draft Passes', value: user.draftPasses + user.freeDrafts },
                { label: 'Wheel Spins', value: user.wheelSpins },
                { label: 'Special', value: user.jackpotEntries + user.hofEntries },
              ].map((s) => (
                <div key={s.label} className="text-center py-1">
                  <p className="text-banana font-bold text-sm tabular-nums leading-tight">{s.value}</p>
                  <p className="text-text-muted text-[9px] uppercase tracking-wider">{s.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Menu Items */}
          <div className="py-1">
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
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                Copy Private Key
              </button>
            )}
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
