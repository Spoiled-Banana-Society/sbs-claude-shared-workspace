'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { SkeletonCard, Skeleton, SkeletonAvatar } from '@/components/ui/Skeleton';
import { ActivityHistory } from '@/components/profile/ActivityHistory';
import { AvatarWithBadge } from '@/components/badges/AvatarWithBadge';
import { BadgeCatalogGrid } from '@/components/badges/BadgeCatalogGrid';
import { KingLeaderboard } from '@/components/badges/KingLeaderboard';
import { NotificationSettings } from '@/components/notifications/NotificationSettings';
import { FREE_DRAFT_CREDIT_CENTS } from '@/lib/pricing';
import { useExportWallet } from '@privy-io/react-auth';

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Wallets allowed to export their embedded-wallet private key from the
 * profile page. Per-user support tool, NOT a general feature: Privy's
 * export modal runs on Privy's own domain, so the key never touches our
 * app — but we still gate it to specific support cases until we decide
 * to offer export to everyone.
 *
 * 2026-07-03: Rockin_Korotkin sent 341 APE on ApeChain to his embedded
 * wallet; export lets him recover it from MetaMask himself.
 *
 * 2026-08-02: the_tikman sent 26.537714 USDC to his embedded wallet on
 * ETHEREUM MAINNET instead of Base (tx 0x4d208760…b5f1, from his own
 * EIP-7702 smart account). Funds are safe at the same address on mainnet
 * but unreachable — the wallet holds 0 ETH there and our app is Base-only.
 * Export lets him move it himself once he has gas.
 */
const KEY_EXPORT_ALLOWLIST = new Set<string>([
  '0xfff36cb99d9d7432ba70d6a93c1a72d49a7fc98e',
  '0x59e8ca8bbaf42037d8da75e8ca96732efd29092c',
  // LamarJ — brother sent 0.0101 ETH on Base instead of USDC (ticket-3349, 8/24). Right chain, wrong asset; has gas.
  '0xf4a0b6c01f4db328c31bf0e1bb8d3fcdf3c2d086',
]);

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
  const [copiedWallet, setCopiedWallet] = useState(false);
  // Real X-link status from v2_twitter_links — user.xHandle is client-memory
  // only and showed linked users as "Not linked" (Richard 8/13). Stable-scalar
  // dep only (Rule #0).
  const [linkedX, setLinkedX] = useState<string | null>(null);
  const profileWallet = user?.walletAddress?.toLowerCase() ?? '';
  useEffect(() => {
    if (!profileWallet) { setLinkedX(null); return; }
    let alive = true;
    void fetch(`/api/auth/twitter-link?wallet=${encodeURIComponent(profileWallet)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d && typeof d.handle === 'string') setLinkedX(`@${d.handle}`); })
      .catch(() => { /* transient */ });
    return () => { alive = false; };
  }, [profileWallet]);
  const { exportWallet } = useExportWallet();
  const [exportArmed, setExportArmed] = useState(false);
  const [exportError, setExportError] = useState(false);
  const canExportKey =
    isEmbeddedWallet &&
    !!user?.walletAddress &&
    KEY_EXPORT_ALLOWLIST.has(user.walletAddress.toLowerCase());

  const handleExportKey = async () => {
    if (!exportArmed) {
      setExportArmed(true);
      return;
    }
    setExportArmed(false);
    try {
      await exportWallet({ address: user!.walletAddress! });
    } catch {
      // Export disabled in Privy dashboard or modal failed — show a hint.
      setExportError(true);
    }
  };
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
                ripeness={user.ripeness}
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

              {/* Network guard — this address exists on every EVM chain, but we
                  only read Base. Users have pasted it into Coinbase/MetaMask and
                  sent on Ethereum mainnet, stranding the funds (the_tikman,
                  2026-08-02). Say the network wherever the address is copyable. */}
              <p className="text-white/25 text-[11px] mt-1">
                Base network only — funds sent on another network won&apos;t show up here
              </p>

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
            <KingLeaderboard />
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
          </div>
        </motion.div>

        {/* ─── Card-fee credit → free draft — only after first card purchase ─── */}
        {(user.cardFeeCreditCents || 0) > 0 && (() => {
          const credit = Math.min(FREE_DRAFT_CREDIT_CENTS, user.cardFeeCreditCents || 0);
          const pct = Math.min(100, (credit / FREE_DRAFT_CREDIT_CENTS) * 100);
          const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
          return (
          <motion.div
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
                <p className="text-white/40 text-[11px] uppercase tracking-widest font-medium">Card Fee Credit</p>
                <p className="text-white/60 text-[12px] mt-0.5">{`${usd(credit)} of ${usd(FREE_DRAFT_CREDIT_CENTS)} toward a free draft`}</p>
              </div>
            </div>
            <div className="relative h-2 rounded-full bg-white/[0.06] overflow-hidden">
              <div className="absolute inset-y-0 left-0 bg-banana rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-white/25 text-[10px] mt-2">Your card fees are credited forward — every $25 in fees earns a free draft. Extra rolls over.</p>
          </motion.div>
          );
        })()}

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
              <div className="flex items-center gap-3">
                {canExportKey && (
                  <button
                    onClick={handleExportKey}
                    onBlur={() => setExportArmed(false)}
                    className={`text-xs font-bold px-3 py-1.5 rounded-full border transition-all duration-200 ${
                      exportArmed
                        ? 'border-red-400/60 text-red-300 bg-red-500/10'
                        : 'border-white/20 text-white/60 hover:border-banana/50 hover:text-banana'
                    }`}
                  >
                    {exportArmed ? 'Tap again to reveal key' : 'Export key'}
                  </button>
                )}
                <span className="text-green-400/60 text-xs font-bold">Connected</span>
              </div>
            </div>
            {canExportKey && (
              <p className="text-white/25 text-[11px] leading-snug">
                Export opens a secure Privy window showing your wallet&apos;s private key —
                SBS never sees it. Never share this key with anyone; anyone who has it
                controls your wallet.
              </p>
            )}
            {exportError && (
              <p className="text-red-400/70 text-[11px]">
                Export isn&apos;t available right now — contact support and we&apos;ll sort it out.
              </p>
            )}

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
                  <p className="text-white/30 text-xs">{user.xHandle || linkedX || 'Not linked'}</p>
                </div>
              </div>
              {(user.xHandle || linkedX) ? (
                <span className="text-green-400/60 text-xs font-bold">Verified</span>
              ) : (
                <span className="text-white/20 text-xs">—</span>
              )}
            </div>
          </div>
        </motion.div>

        {/* Promos & Referrals section REMOVED (Boris 2026-06-10) — the welcome
            gift lives in Buy Drafts and the referral link lives in /referrals
            + the Refer-a-Friend promo modal; duplicating them here confused
            more than it helped. */}

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
