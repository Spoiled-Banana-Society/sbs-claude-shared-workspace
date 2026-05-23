'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useExportWallet } from '@privy-io/react-auth';
import { SkeletonCard, Skeleton, SkeletonAvatar } from '@/components/ui/Skeleton';
import { ActivityHistory } from '@/components/profile/ActivityHistory';
import { AvatarWithBadge } from '@/components/badges/AvatarWithBadge';
import { BadgeCatalogGrid } from '@/components/badges/BadgeCatalogGrid';
import { NotificationSettings } from '@/components/notifications/NotificationSettings';

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
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<
    'overview' | 'activity' | 'badges' | 'notifications'
  >('overview');

  // Honor ?tab= deep links (profile dropdown shortcuts, Discord link return).
  useEffect(() => {
    const tab = searchParams?.get('tab');
    if (
      tab === 'activity' ||
      tab === 'overview' ||
      tab === 'badges' ||
      tab === 'notifications'
    ) {
      setActiveTab(tab);
    }
  }, [searchParams]);

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
            {/* Avatar with equipped badge overlay */}
            <div className="flex-shrink-0">
              <AvatarWithBadge
                imageUrl={user.profilePicture}
                alt="Avatar"
                size={80}
                equippedBadge={user.equippedBadge}
              />
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

        {/* ─── Tabs ─── */}
        <div className="flex items-center gap-1 mb-5 border-b border-white/[0.06]">
          <TabButton active={activeTab === 'overview'} onClick={() => setActiveTab('overview')}>
            Overview
          </TabButton>
          <TabButton active={activeTab === 'badges'} onClick={() => setActiveTab('badges')}>
            Badges
          </TabButton>
          <TabButton active={activeTab === 'activity'} onClick={() => setActiveTab('activity')}>
            Activity
          </TabButton>
          <TabButton
            active={activeTab === 'notifications'}
            onClick={() => setActiveTab('notifications')}
          >
            Draft Alerts
          </TabButton>
        </div>

        {activeTab === 'activity' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <ActivityHistory userId={user.walletAddress ?? user.id} />
          </motion.div>
        )}

        {activeTab === 'notifications' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <NotificationSettings />
          </motion.div>
        )}

        {activeTab === 'badges' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <BadgeCatalogGrid />
          </motion.div>
        )}

        {activeTab === 'overview' && <>

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

        {/* ─── Card Purchase Rewards — only after first card purchase ─── */}
        {(user.cardPurchaseCount || 0) > 0 && <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 mb-6"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-banana/20 flex items-center justify-center">
              <span className="text-banana text-sm">🎁</span>
            </div>
            <div>
              <p className="text-white/40 text-[11px] uppercase tracking-widest font-medium">Card Purchase Rewards</p>
              <p className="text-white/60 text-[12px] mt-0.5">
                {(user.cardPurchaseCount || 0) === 0
                  ? 'Pay with card to start earning'
                  : `${user.cardPurchaseCount || 0} of 6 toward a free draft`
                }
              </p>
            </div>
          </div>
          <div className="flex gap-1.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className={`h-2 flex-1 rounded-full transition-all ${
                  i < (user.cardPurchaseCount || 0)
                    ? 'bg-banana'
                    : 'bg-white/[0.06]'
                }`}
              />
            ))}
          </div>
          <p className="text-white/25 text-[10px] mt-2">Every 6 card purchases earns a free draft pass — our way of covering your transaction fee.</p>
        </motion.div>}

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

        </>}

      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
        active ? 'text-white' : 'text-white/40 hover:text-white/70'
      }`}
    >
      {children}
      {active && <span className="absolute bottom-[-1px] left-0 right-0 h-[2px] bg-banana" />}
    </button>
  );
}
