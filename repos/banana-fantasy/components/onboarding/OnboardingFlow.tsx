'use client';

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/hooks/useAuth';
import { useOnboarding } from '@/hooks/useOnboarding';

// Extended steps: profile setup → draft tutorial → first-draft promo → done
const steps = ['welcome', 'display', 'avatar', 'howItWorks', 'promo', 'done'] as const;
type _Step = typeof steps[number];

const PROMO_KEY = 'sbs-first-draft-promo-claimed';

// --- How It Works carousel slides ---
const draftSlides = [
  {
    emoji: '🎟️',
    title: 'Buy a Draft Pass',
    description: 'Each pass enters you into a live draft against other players. Choose from different tiers with bigger prize pools.',
  },
  {
    emoji: '🏈',
    title: 'Draft Your Team',
    description: 'Pick NFL players in a live snake draft. Best-ball format means your best scorers count automatically — no lineup management needed.',
  },
  {
    emoji: '📊',
    title: 'Watch Your Team Score',
    description: 'Your team scores points every NFL week based on real player stats. Top the leaderboard to win prizes.',
  },
  {
    emoji: '🎰',
    title: 'Spin & Win More',
    description: 'After each draft, spin the Banana Wheel for bonus prizes. Every draft is also a shot at the Jackpot and Hall of Fame.',
  },
  {
    emoji: '💰',
    title: 'Collect Your Prizes',
    description: 'Win USDC prizes directly to your wallet. Trade your draft passes on the marketplace anytime.',
  },
];

// --- Animation variants ---
const pageVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 80 : -80,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -80 : 80,
    opacity: 0,
  }),
};

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.4, ease: 'easeOut' as const },
  }),
};

export function OnboardingFlow() {
  const router = useRouter();
  const { user, walletAddress } = useAuth();
  const { isNewUser, isSubmitting, error, createProfile, updateProfile, completeOnboarding } = useOnboarding();
  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [displayName, setDisplayName] = useState('');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [profileCreated, setProfileCreated] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);
  const [promoClaimed, setPromoClaimed] = useState(false);
  const [promoLoading, setPromoLoading] = useState(false);
  const step = steps[stepIndex] ?? 'welcome';

  useEffect(() => {
    if (user?.username) setDisplayName(user.username);
    if (user?.profilePicture) setAvatarPreview(user.profilePicture);
  }, [user]);

  // Check if promo was already claimed
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setPromoClaimed(localStorage.getItem(PROMO_KEY) === 'true');
    }
  }, []);

  const canGoBack = stepIndex > 0 && step !== 'done';
  const trimmedName = displayName.trim();

  const stepLabel = useMemo(() => {
    switch (step) {
      case 'welcome': return 'Welcome';
      case 'display': return 'Display Name';
      case 'avatar': return 'Avatar';
      case 'howItWorks': return 'How It Works';
      case 'promo': return 'Welcome Gift';
      case 'done': return 'Ready to Draft';
      default: return 'Onboarding';
    }
  }, [step]);

  const goForward = useCallback(() => {
    setDirection(1);
    setStepIndex((prev) => Math.min(prev + 1, steps.length - 1));
    setLocalError(null);
  }, []);

  const handleNext = async () => {
    setLocalError(null);

    try {
      if (step === 'welcome') {
        goForward();
        return;
      }

      if (step === 'display') {
        if (!trimmedName) {
          setLocalError('Please enter a display name.');
          return;
        }
        if (isNewUser && !profileCreated) {
          await createProfile(trimmedName, avatarPreview);
          setProfileCreated(true);
        } else {
          await updateProfile(trimmedName, avatarPreview);
        }
        goForward();
        return;
      }

      if (step === 'avatar') {
        if (!trimmedName) {
          setLocalError('Please add a display name before continuing.');
          return;
        }
        await updateProfile(trimmedName, avatarPreview);
        goForward();
        return;
      }

      if (step === 'howItWorks') {
        // If not on last slide, advance slide
        if (slideIndex < draftSlides.length - 1) {
          setSlideIndex((prev) => prev + 1);
          return;
        }
        goForward();
        return;
      }

      if (step === 'promo') {
        goForward();
        return;
      }

      if (step === 'done') {
        await completeOnboarding({ displayName: trimmedName, avatar: avatarPreview });
        router.push('/buy-drafts');
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    }
  };

  const handleBack = () => {
    if (!canGoBack || isSubmitting) return;
    setLocalError(null);
    setDirection(-1);
    if (step === 'howItWorks' && slideIndex > 0) {
      setSlideIndex((prev) => prev - 1);
      return;
    }
    setStepIndex((prev) => Math.max(0, prev - 1));
    setSlideIndex(0);
  };

  const handleClaimPromo = async () => {
    if (promoClaimed || promoLoading) return;
    setPromoLoading(true);
    try {
      const res = await fetch('/api/promos/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress,
          promoCode: 'WELCOME_FIRST_DRAFT',
          type: 'first_draft_discount',
        }),
      });
      if (res.ok) {
        setPromoClaimed(true);
        localStorage.setItem(PROMO_KEY, 'true');
      }
    } catch {
      // Promo claim is best-effort — don't block onboarding
    } finally {
      setPromoLoading(false);
    }
  };

  const statusMessage = localError || error;
  const currentSlide = draftSlides[slideIndex];

  // Progress bar
  const progress = ((stepIndex + 1) / steps.length) * 100;

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center px-4 py-6 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="w-full max-w-lg bg-bg-secondary border border-bg-tertiary rounded-3xl shadow-2xl overflow-hidden"
      >
        {/* Progress bar */}
        <div className="h-1 bg-bg-tertiary">
          <motion.div
            className="h-full bg-banana"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          />
        </div>

        <div className="p-6 sm:p-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <motion.div
                className="w-10 h-10 rounded-xl bg-banana/20 flex items-center justify-center"
                whileHover={{ scale: 1.05 }}
              >
                <Image src="/sbs-logo.png" alt="SBS" width={24} height={24} />
              </motion.div>
              <div>
                <p className="text-text-muted text-[10px] uppercase tracking-widest font-medium">BBB4</p>
                <h2 className="text-lg font-bold text-text-primary">{stepLabel}</h2>
              </div>
            </div>
            <span className="text-xs text-text-muted tabular-nums">
              {stepIndex + 1}/{steps.length}
            </span>
          </div>

          {/* Step content with animation */}
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step + (step === 'howItWorks' ? `-${slideIndex}` : '')}
              custom={direction}
              variants={pageVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              className="min-h-[280px] sm:min-h-[300px] flex flex-col"
            >
              {/* --- WELCOME --- */}
              {step === 'welcome' && (
                <div className="space-y-5 flex-1">
                  <div className="text-center">
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.2 }}
                      className="text-5xl mb-3"
                    >
                      🍌
                    </motion.div>
                    <h3 className="text-2xl sm:text-3xl font-bold text-text-primary">
                      Welcome to <span className="text-banana">BBB4</span>
                    </h3>
                    <p className="text-text-secondary mt-2 text-sm sm:text-base">
                      Best Ball Banana — fantasy football with real prizes. Let&apos;s get you set up in 60 seconds.
                    </p>
                  </div>
                  <div className="space-y-2.5">
                    {[
                      { icon: '✏️', text: 'Choose your display name' },
                      { icon: '🏈', text: 'Learn how drafts work' },
                      { icon: '🎁', text: 'Claim your welcome gift' },
                    ].map((item, i) => (
                      <motion.div
                        key={item.text}
                        custom={i}
                        variants={fadeUp}
                        initial="hidden"
                        animate="visible"
                        className="flex items-center gap-3 bg-bg-tertiary/50 rounded-xl px-4 py-3"
                      >
                        <span className="text-lg">{item.icon}</span>
                        <span className="text-text-primary text-sm font-medium">{item.text}</span>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}

              {/* --- DISPLAY NAME --- */}
              {step === 'display' && (
                <div className="space-y-4 flex-1">
                  <p className="text-text-secondary text-sm">
                    This is how you&apos;ll appear on leaderboards, in drafts, and on the marketplace.
                  </p>
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your display name"
                    maxLength={24}
                    autoFocus
                    className="w-full px-4 py-3 rounded-xl bg-bg-primary border border-bg-tertiary text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-banana/60 focus:border-banana transition-all"
                  />
                  <p className="text-[11px] text-text-muted">You can change this later in settings.</p>

                  {/* Preview card */}
                  {trimmedName && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-bg-tertiary/40 rounded-xl p-4 flex items-center gap-3"
                    >
                      <div className="w-10 h-10 rounded-full bg-banana/20 flex items-center justify-center text-banana font-bold text-sm">
                        {trimmedName.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-text-primary font-semibold text-sm">{trimmedName}</p>
                        <p className="text-text-muted text-[11px]">Ready to draft</p>
                      </div>
                    </motion.div>
                  )}
                </div>
              )}

              {/* --- AVATAR --- */}
              {step === 'avatar' && (
                <div className="space-y-4 flex-1">
                  <p className="text-text-secondary text-sm">Add a profile image (optional — you can skip this).</p>
                  <div className="flex items-center gap-4">
                    <div className="w-20 h-20 rounded-2xl bg-bg-tertiary flex items-center justify-center overflow-hidden border-2 border-bg-tertiary">
                      {avatarPreview ? (
                        <Image src={avatarPreview} alt="Avatar" width={80} height={80} className="object-cover" />
                      ) : (
                        <div className="text-center">
                          <span className="text-3xl">🍌</span>
                          <p className="text-[10px] text-text-muted mt-1">Default</p>
                        </div>
                      )}
                    </div>
                    {avatarPreview && (
                      <button
                        type="button"
                        onClick={() => setAvatarPreview(null)}
                        className="text-xs text-text-muted hover:text-text-primary transition-colors"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* --- HOW IT WORKS --- */}
              {step === 'howItWorks' && currentSlide && (
                <div className="flex-1 flex flex-col">
                  <div className="text-center flex-1 flex flex-col items-center justify-center">
                    <motion.div
                      key={slideIndex}
                      initial={{ scale: 0, rotate: -20 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{ type: 'spring', stiffness: 250, damping: 20 }}
                      className="text-6xl mb-4"
                    >
                      {currentSlide.emoji}
                    </motion.div>
                    <h3 className="text-xl font-bold text-text-primary mb-2">{currentSlide.title}</h3>
                    <p className="text-text-secondary text-sm max-w-xs mx-auto leading-relaxed">
                      {currentSlide.description}
                    </p>
                  </div>

                  {/* Slide dots */}
                  <div className="flex items-center justify-center gap-2 mt-6">
                    {draftSlides.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setSlideIndex(i)}
                        className={`h-1.5 rounded-full transition-all duration-300 ${
                          i === slideIndex ? 'w-6 bg-banana' : 'w-1.5 bg-bg-tertiary hover:bg-text-muted/30'
                        }`}
                        aria-label={`Slide ${i + 1}`}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* --- PROMO --- */}
              {step === 'promo' && (
                <div className="flex-1 flex flex-col items-center justify-center text-center space-y-4">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 200, damping: 12 }}
                    className="relative"
                  >
                    <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-banana/30 to-banana/10 flex items-center justify-center border border-banana/30">
                      <span className="text-4xl">🎁</span>
                    </div>
                    {!promoClaimed && (
                      <motion.div
                        animate={{ scale: [1, 1.2, 1] }}
                        transition={{ repeat: Infinity, duration: 2 }}
                        className="absolute -top-1 -right-1 w-4 h-4 bg-banana rounded-full"
                      />
                    )}
                  </motion.div>

                  <div>
                    <h3 className="text-xl font-bold text-text-primary">Your Welcome Gift</h3>
                    <p className="text-text-secondary text-sm mt-1 max-w-xs mx-auto">
                      Get <span className="text-banana font-bold">50% off</span> your first draft pass. Jump in and experience the thrill of a live draft.
                    </p>
                  </div>

                  <div className="bg-bg-tertiary/60 rounded-xl p-4 w-full max-w-xs space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-text-muted">Standard Draft Pass</span>
                      <span className="text-text-muted line-through">$5.00</span>
                    </div>
                    <div className="flex items-center justify-between text-sm font-bold">
                      <span className="text-text-primary">Your Price</span>
                      <span className="text-banana text-lg">$2.50</span>
                    </div>
                    <div className="border-t border-bg-tertiary pt-3">
                      {promoClaimed ? (
                        <div className="flex items-center justify-center gap-2 text-green-400 text-sm font-medium">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                            <polyline points="22 4 12 14.01 9 11.01" />
                          </svg>
                          Promo claimed!
                        </div>
                      ) : (
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={handleClaimPromo}
                          disabled={promoLoading}
                          className="w-full py-2.5 rounded-xl bg-banana text-black font-bold text-sm hover:bg-banana/90 transition-colors disabled:opacity-60"
                        >
                          {promoLoading ? 'Claiming...' : 'Claim 50% Off'}
                        </motion.button>
                      )}
                    </div>
                  </div>

                  <p className="text-[11px] text-text-muted">
                    Applied automatically at checkout. One per account.
                  </p>
                </div>
              )}

              {/* --- DONE --- */}
              {step === 'done' && (
                <div className="flex-1 flex flex-col items-center justify-center text-center space-y-4">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 200, damping: 15 }}
                    className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center"
                  >
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-green-400">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                  </motion.div>
                  <h3 className="text-2xl font-bold text-text-primary">You&apos;re Ready!</h3>
                  <p className="text-text-secondary text-sm max-w-xs">
                    {promoClaimed
                      ? 'Your 50% discount is waiting. Let\'s buy your first draft pass!'
                      : 'Time to buy your first draft pass and get into a live draft.'}
                  </p>

                  <div className="grid grid-cols-3 gap-3 w-full max-w-xs mt-2">
                    {[
                      { emoji: '🎟️', label: 'Buy Pass' },
                      { emoji: '🏈', label: 'Draft' },
                      { emoji: '💰', label: 'Win' },
                    ].map((item, i) => (
                      <motion.div
                        key={item.label}
                        custom={i}
                        variants={fadeUp}
                        initial="hidden"
                        animate="visible"
                        className="bg-bg-tertiary/40 rounded-xl p-3 text-center"
                      >
                        <span className="text-2xl">{item.emoji}</span>
                        <p className="text-[11px] text-text-muted mt-1 font-medium">{item.label}</p>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Error */}
          <AnimatePresence>
            {statusMessage && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30"
              >
                <p className="text-red-400 text-sm">{statusMessage}</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Navigation */}
          <div className="mt-6 flex items-center justify-between">
            <button
              type="button"
              onClick={handleBack}
              disabled={!canGoBack || isSubmitting}
              className="text-text-muted hover:text-text-primary text-sm disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              ← Back
            </button>
            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
              <Button onClick={handleNext} isLoading={isSubmitting} disabled={isSubmitting}>
                {step === 'done'
                  ? '🎟️ Buy First Draft Pass'
                  : step === 'howItWorks' && slideIndex < draftSlides.length - 1
                    ? 'Next →'
                    : step === 'promo' && !promoClaimed
                      ? 'Skip for Now'
                      : 'Continue →'}
              </Button>
            </motion.div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
