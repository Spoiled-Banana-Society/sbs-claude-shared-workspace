'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.5, ease: 'easeOut' as const },
  }),
};

const pulse = {
  animate: {
    scale: [1, 1.02, 1],
    transition: { duration: 2, repeat: Infinity, ease: 'easeInOut' as const },
  },
};

function CountUpNumber({ target, prefix = '' }: { target: number; prefix?: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let frame: number;
    const duration = 1500;
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * target));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return <span>{prefix}{count.toLocaleString()}</span>;
}

export default function JackpotHofPage() {
  const { user, isLoggedIn } = useAuth();
  const totalDrafts = (user?.draftPasses || 0) + (user?.freeDrafts || 0);
  const batchEnd = Math.ceil(totalDrafts / 100) * 100 || 100;
  const jpHit = (user?.jackpotEntries || 0) > 0;
  const hofEarned = user?.hofEntries || 0;

  return (
    <div className="min-h-screen bg-bg-primary pb-20">
      {/* Hero Section */}
      <section className="relative overflow-hidden pt-8 pb-16 px-4">
        {/* Animated background glow */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <motion.div
            className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(243,226,22,0.12) 0%, transparent 70%)' }}
            animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>

        <div className="relative max-w-4xl mx-auto text-center">
          <motion.div initial="hidden" animate="visible" custom={0} variants={fadeUp}>
            <span className="inline-block text-sm font-bold uppercase tracking-widest text-[#F3E216] mb-4">
              BBB4 Prize System
            </span>
          </motion.div>

          <motion.h1
            initial="hidden" animate="visible" custom={1} variants={fadeUp}
            className="text-4xl sm:text-5xl md:text-6xl font-black font-primary text-white leading-tight"
          >
            Every 100 Drafts.<br />
            <span className="text-red-500">1 Jackpot</span> +{' '}
            <span className="text-[#F3E216]">5 HOF</span>.
          </motion.h1>

          <motion.p
            initial="hidden" animate="visible" custom={2} variants={fadeUp}
            className="mt-6 text-lg sm:text-xl text-text-secondary max-w-2xl mx-auto leading-relaxed"
          >
            Guaranteed. In every batch of 100 drafts, one league becomes a <strong className="text-red-400">Jackpot</strong> and
            five become <strong className="text-[#F3E216]">Hall of Fame</strong>. The odds are locked — the more you draft, the closer you get.
          </motion.p>

          {/* User progress */}
          {isLoggedIn && user && (
            <motion.div
              initial="hidden" animate="visible" custom={3} variants={fadeUp}
              className="mt-8 inline-flex items-center gap-4 bg-white/5 border border-white/10 rounded-2xl px-6 py-4"
            >
              <div className="text-center">
                <div className="text-2xl font-bold text-white">{totalDrafts}/{batchEnd}</div>
                <div className="text-xs text-text-muted uppercase tracking-wide">Your Drafts</div>
              </div>
              <div className="w-px h-10 bg-white/10" />
              <div className="text-center">
                <div className={`text-2xl font-bold ${jpHit ? 'text-green-400' : 'text-red-400'}`}>
                  {jpHit ? '✓' : Math.max(0, 100 - (totalDrafts % 100))}
                </div>
                <div className="text-xs text-text-muted uppercase tracking-wide">{jpHit ? 'JP Hit!' : 'Until JP'}</div>
              </div>
              <div className="w-px h-10 bg-white/10" />
              <div className="text-center">
                <div className={`text-2xl font-bold ${hofEarned >= 5 ? 'text-green-400' : 'text-[#F3E216]'}`}>
                  {hofEarned >= 5 ? '✓' : `${hofEarned}/5`}
                </div>
                <div className="text-xs text-text-muted uppercase tracking-wide">HOF Earned</div>
              </div>
            </motion.div>
          )}
        </div>
      </section>

      {/* Jackpot Section */}
      <section className="px-4 py-12">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true }} custom={0} variants={fadeUp}
            className="text-center mb-10"
          >
            <span className="text-5xl">🎰</span>
            <h2 className="text-3xl sm:text-4xl font-black font-primary text-red-500 mt-3">
              Jackpot League
            </h2>
            <p className="text-text-secondary mt-2 text-lg">1 in every 100 drafts</p>
          </motion.div>

          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true }} custom={1} variants={fadeUp}
            {...pulse}
            className="bg-gradient-to-br from-red-500/10 to-red-900/10 border border-red-500/30 rounded-2xl p-8 sm:p-10"
          >
            <div className="grid sm:grid-cols-2 gap-8">
              <div>
                <h3 className="text-xl font-bold text-red-400 mb-4">🏆 What You Win</h3>
                <ul className="space-y-3">
                  <li className="flex items-start gap-3">
                    <span className="text-red-400 text-lg">→</span>
                    <div>
                      <div className="font-bold text-white">Skip to Finals</div>
                      <div className="text-sm text-text-secondary">Win your Jackpot league and advance directly to the championship round — bypassing weeks 1 & 2 of playoffs.</div>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="text-red-400 text-lg">→</span>
                    <div>
                      <div className="font-bold text-white">Championship Prize Pool</div>
                      <div className="text-sm text-text-secondary">Compete head-to-head with other Jackpot winners for the grand prize.</div>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="text-red-400 text-lg">→</span>
                    <div>
                      <div className="font-bold text-white">Exclusive Jackpot NFT Badge</div>
                      <div className="text-sm text-text-secondary">Your draft token gets a rare Jackpot border — visible on marketplace and leaderboard.</div>
                    </div>
                  </li>
                </ul>
              </div>
              <div className="flex flex-col items-center justify-center bg-black/30 rounded-xl p-6">
                <div className="text-6xl font-black text-red-500 font-primary">
                  <CountUpNumber target={1} />%
                </div>
                <div className="text-text-secondary mt-2 text-center">
                  of all drafts become Jackpot
                </div>
                <div className="mt-4 text-sm text-text-muted text-center">
                  Guaranteed 1 per 100 drafts — not random chance
                </div>
                <div className="mt-2 text-xs text-text-muted/80 text-center">
                  You can also win a Jackpot entry on the{' '}
                  <Link href="/banana-wheel" className="text-banana hover:underline">Banana Wheel</Link>.
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* HOF Section */}
      <section className="px-4 py-12">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true }} custom={0} variants={fadeUp}
            className="text-center mb-10"
          >
            <span className="text-5xl">🏛️</span>
            <h2 className="text-3xl sm:text-4xl font-black font-primary text-[#F3E216] mt-3">
              Hall of Fame League
            </h2>
            <p className="text-text-secondary mt-2 text-lg">5 in every 100 drafts</p>
          </motion.div>

          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true }} custom={1} variants={fadeUp}
            className="bg-gradient-to-br from-[#F3E216]/10 to-yellow-900/10 border border-[#F3E216]/30 rounded-2xl p-8 sm:p-10"
          >
            <div className="grid sm:grid-cols-2 gap-8">
              <div>
                <h3 className="text-xl font-bold text-[#F3E216] mb-4">🍌 What You Win</h3>
                <ul className="space-y-3">
                  <li className="flex items-start gap-3">
                    <span className="text-[#F3E216] text-lg">→</span>
                    <div>
                      <div className="font-bold text-white">Bonus Prize Pool</div>
                      <div className="text-sm text-text-secondary">HOF leagues compete for additional prizes on top of the standard weekly and seasonal rewards.</div>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="text-[#F3E216] text-lg">→</span>
                    <div>
                      <div className="font-bold text-white">Higher Stakes, Higher Glory</div>
                      <div className="text-sm text-text-secondary">Face tougher competition with bigger payouts. Every HOF league is a showcase match.</div>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="text-[#F3E216] text-lg">→</span>
                    <div>
                      <div className="font-bold text-white">Gold HOF Badge</div>
                      <div className="text-sm text-text-secondary">Your draft token gets a gold Hall of Fame border — flex on the leaderboard.</div>
                    </div>
                  </li>
                </ul>
              </div>
              <div className="flex flex-col items-center justify-center bg-black/30 rounded-xl p-6">
                <div className="text-6xl font-black text-[#F3E216] font-primary">
                  <CountUpNumber target={5} />%
                </div>
                <div className="text-text-secondary mt-2 text-center">
                  of all drafts become Hall of Fame
                </div>
                <div className="mt-4 text-sm text-text-muted text-center">
                  Guaranteed 5 per 100 drafts — the more you draft, the more you earn
                </div>
                <div className="mt-2 text-xs text-text-muted/80 text-center">
                  You can also win an HOF entry on the{' '}
                  <Link href="/banana-wheel" className="text-banana hover:underline">Banana Wheel</Link>.
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* How It Works */}
      <section className="px-4 py-12">
        <div className="max-w-4xl mx-auto">
          <motion.h2
            initial="hidden" whileInView="visible" viewport={{ once: true }} custom={0} variants={fadeUp}
            className="text-2xl sm:text-3xl font-black font-primary text-white text-center mb-10"
          >
            How It Works
          </motion.h2>

          <div className="grid sm:grid-cols-3 gap-6">
            {[
              { step: '01', title: 'Draft', desc: 'Buy draft passes and enter best ball drafts. Every draft counts toward your batch of 100.', icon: '🎯' },
              { step: '02', title: 'Reveal', desc: 'After the draft lobby fills, a slot machine reveals if your league is Pro, HOF, or Jackpot.', icon: '🎰' },
              { step: '03', title: 'Win', desc: 'Jackpot winners skip to finals. HOF winners compete for bonus prizes. Everyone has a shot.', icon: '💰' },
            ].map((item, i) => (
              <motion.div
                key={item.step}
                initial="hidden" whileInView="visible" viewport={{ once: true }} custom={i} variants={fadeUp}
                className="bg-bg-secondary border border-bg-tertiary rounded-xl p-6 text-center hover:border-[#F3E216]/30 transition-colors"
              >
                <span className="text-3xl">{item.icon}</span>
                <div className="text-[#F3E216] font-bold text-sm mt-3 tracking-widest">{item.step}</div>
                <h3 className="text-lg font-bold text-white mt-1">{item.title}</h3>
                <p className="text-text-secondary text-sm mt-2 leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Prize Pool Stats */}
      <section className="px-4 py-12">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true }} custom={0} variants={fadeUp}
            className="bg-gradient-to-r from-bg-secondary to-bg-tertiary border border-bg-elevated rounded-2xl p-8 sm:p-10"
          >
            <h2 className="text-2xl font-black font-primary text-white text-center mb-8">
              BBB4 Prize Pool
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
              {[
                { label: 'Total Pool', value: '$250K+', color: 'text-white' },
                { label: 'Jackpot Leagues', value: '1%', color: 'text-red-400' },
                { label: 'HOF Leagues', value: '5%', color: 'text-[#F3E216]' },
                { label: 'Drafts Per Batch', value: '100', color: 'text-white' },
              ].map((stat, i) => (
                <motion.div
                  key={stat.label}
                  initial="hidden" whileInView="visible" viewport={{ once: true }} custom={i} variants={fadeUp}
                >
                  <div className={`text-3xl sm:text-4xl font-black font-primary ${stat.color}`}>
                    {stat.value}
                  </div>
                  <div className="text-text-muted text-sm mt-1 uppercase tracking-wide">{stat.label}</div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 py-12 text-center">
        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} custom={0} variants={fadeUp}>
          <h2 className="text-2xl sm:text-3xl font-black font-primary text-white mb-4">
            Ready to Chase the Jackpot?
          </h2>
          <p className="text-text-secondary mb-8 max-w-lg mx-auto">
            Every draft gets you closer. Buy passes, enter drafts, and let the slot machine decide your fate.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-center">
            <Link href="/buy-drafts">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="bg-[#F3E216] text-black font-bold font-primary py-3 px-8 rounded-xl text-lg min-h-[48px] hover:bg-[#F3E216]/90 transition-colors"
              >
                Buy Draft Passes
              </motion.button>
            </Link>
            <Link href="/drafting">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="border border-white/20 text-white font-bold font-primary py-3 px-8 rounded-xl text-lg min-h-[48px] hover:bg-white/5 transition-colors"
              >
                View My Drafts
              </motion.button>
            </Link>
          </div>
        </motion.div>
      </section>
    </div>
  );
}
