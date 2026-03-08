'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';
import { useExportWallet } from '@privy-io/react-auth';
import { SkeletonCard, Skeleton, SkeletonAvatar } from '@/components/ui/Skeleton';

// ─── Helpers ─────────────────────────────────────────────────────────────

function truncateAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function memberSince(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// ─── Page ────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const { user, login, isLoading: authLoading, isEmbeddedWallet } = useAuth();
  const { exportWallet } = useExportWallet();
  const [copiedWallet, setCopiedWallet] = useState(false);

  const PROMO_KEY = 'sbs-first-draft-promo-claimed';
  const promoClaimed = typeof window !== 'undefined' && localStorage.getItem(PROMO_KEY) === 'true';

  // Not logged in
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] px-4 sm:px-8 py-10">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex items-center gap-4">
            <SkeletonAvatar size={64} />
            <div className="space-y-2 flex-1">
              <Skeleton width="40%" height={24} />
              <Skeleton width="25%" height={14} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-sm"
        >
          <div className="text-5xl mb-4">🍌</div>
          <h1 className="text-white text-2xl font-bold mb-2">Your Profile</h1>
          <p className="text-white/40 text-sm mb-6">Log in to view your profile and manage your wallet.</p>
          <button
            onClick={() => login()}
            className="px-6 py-3 bg-banana text-black font-bold rounded-xl hover:brightness-110 transition-all"
          >
            Connect Wallet
          </button>
        </motion.div>
      </div>
    );
  }

  const handleCopyWallet = () => {
    if (user.walletAddress) {
      navigator.clipboard.writeText(user.walletAddress).catch(() => {});
      setCopiedWallet(true);
      setTimeout(() => setCopiedWallet(false), 1500);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] px-4 sm:px-8 py-6 sm:py-8">
      <div className="max-w-2xl mx-auto">

        {/* ─── User Header ─── */}
        <motion.div
          initial={{ opacity: 0, y: -15 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-br from-banana/10 to-transparent border border-banana/15 rounded-2xl p-5 sm:p-6 mb-6"
        >
          <div className="flex items-center gap-4">
            {/* Avatar */}
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-banana/20 border-2 border-banana/30 flex items-center justify-center overflow-hidden flex-shrink-0">
              {user.profilePicture ? (
                <Image src={user.profilePicture} alt="Avatar" width={80} height={80} className="object-cover w-full h-full" />
              ) : (
                <span className="text-3xl sm:text-4xl">🍌</span>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-white text-xl sm:text-2xl font-bold truncate">
                  {user.username || 'Anonymous'}
                </h1>
                {user.isVerified && (
                  <span className="text-banana text-sm" title="Verified">✓</span>
                )}
              </div>

              <button
                onClick={handleCopyWallet}
                className="text-white/30 hover:text-white/60 text-xs font-mono transition-colors mt-0.5"
                title="Copy wallet address"
              >
                {copiedWallet ? '✅ Copied!' : truncateAddress(user.walletAddress)}
              </button>

              <p className="text-white/20 text-[11px] mt-1">
                Member since {memberSince(user.createdAt || new Date().toISOString())}
              </p>
            </div>
          </div>
        </motion.div>

        {/* ─── Wallet Balance ─── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.05 }}
          className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 mb-6"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-[#2775CA] flex items-center justify-center">
                <span className="text-white text-sm font-bold">$</span>
              </div>
              <div>
                <p className="text-white/40 text-[11px] uppercase tracking-widest font-medium">Wallet Balance</p>
                <p className="text-white font-bold text-2xl tabular-nums">
                  ${user.usdcBalance !== undefined ? user.usdcBalance.toFixed(2) : '0.00'}
                </p>
              </div>
            </div>
            {isEmbeddedWallet && (
              <button
                onClick={() => exportWallet()}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-white/60 hover:text-white text-xs font-bold transition-all"
              >
                Export Wallet
              </button>
            )}
          </div>
        </motion.div>

        {/* ─── Linked Accounts ─── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15 }}
          className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4 mb-6"
        >
          <h3 className="text-white/40 text-[11px] font-semibold uppercase tracking-widest mb-3">Linked Accounts</h3>
          <div className="space-y-3">
            {/* Wallet type */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">🔗</span>
                <div>
                  <p className="text-white text-sm font-medium">Wallet</p>
                  <p className="text-white/30 text-xs">{isEmbeddedWallet ? 'Embedded (Privy)' : 'External (MetaMask / WalletConnect)'}</p>
                </div>
              </div>
              <span className="text-green-400/60 text-xs font-bold">Connected</span>
            </div>

            {/* X/Twitter */}
            <div className="flex items-center justify-between border-t border-white/[0.06] pt-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-white/50">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                  </svg>
                </span>
                <div>
                  <p className="text-white text-sm font-medium">X / Twitter</p>
                  <p className="text-white/30 text-xs">{user.xHandle || 'Not linked'}</p>
                </div>
              </div>
              {user.xHandle ? (
                <span className="text-green-400/60 text-xs font-bold">Verified</span>
              ) : (
                <span className="text-white/20 text-xs">—</span>
              )}
            </div>
          </div>
        </motion.div>

        {/* ─── Promo Status ─── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4 mb-6"
        >
          <h3 className="text-white/40 text-[11px] font-semibold uppercase tracking-widest mb-3">Promos & Referrals</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">{promoClaimed ? '✅' : '🎁'}</span>
                <div>
                  <p className="text-white text-sm font-medium">Welcome Gift — 50% Off</p>
                  <p className="text-white/30 text-xs">{promoClaimed ? 'Claimed' : 'Available — claim in Buy Drafts'}</p>
                </div>
              </div>
              {!promoClaimed && (
                <Link href="/buy-drafts" className="text-banana text-xs font-bold hover:underline">
                  Claim →
                </Link>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-white/[0.06] pt-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">🔗</span>
                <div>
                  <p className="text-white text-sm font-medium">Referral Code</p>
                  <p className="text-white/30 text-xs font-mono">{truncateAddress(user.walletAddress)}</p>
                </div>
              </div>
              <button
                onClick={handleCopyWallet}
                className="text-banana text-xs font-bold hover:underline"
              >
                {copiedWallet ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        </motion.div>

      </div>
    </div>
  );
}
