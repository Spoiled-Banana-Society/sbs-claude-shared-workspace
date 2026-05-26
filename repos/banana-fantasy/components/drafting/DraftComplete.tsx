'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as draftStore from '@/lib/draftStore';
import { logger } from '@/lib/logger';

interface DraftCompleteProps {
  draftId?: string;
  /** URL of the generated card image — fetched when isDraftClosed transitions to true */
  generatedCardUrl?: string | null;
  /** Wallet address of the user (needed for card fetch) */
  walletAddress?: string;
}

const REDIRECT_SECONDS = 10;

export function DraftComplete({ draftId, generatedCardUrl: initialCardUrl, walletAddress }: DraftCompleteProps) {
  const router = useRouter();
  const [cardUrl, setCardUrl] = useState<string | null>(initialCardUrl || null);
  const [cardLoading, setCardLoading] = useState(!initialCardUrl);
  const [cardError, setCardError] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(REDIRECT_SECONDS);

  // Sync prop changes
  useEffect(() => {
    if (initialCardUrl) {
      setCardUrl(initialCardUrl);
      setCardLoading(false);
    }
  }, [initialCardUrl]);

  // Attempt to fetch the generated card if we don't have it yet
  useEffect(() => {
    if (cardUrl || !draftId || !walletAddress) return;
    let cancelled = false;

    async function fetchCard() {
      const { getDraftsApiUrl } = await import('@/lib/staging');
      const FALLBACK_URL = process.env.NEXT_PUBLIC_DRAFTS_API_URL || 'https://sbs-drafts-api-w5wydprnbq-uc.a.run.app';
      const baseUrl = getDraftsApiUrl() || FALLBACK_URL;

      // Retry up to 10 times over ~30 seconds (card generation takes a few seconds)
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          const res = await fetch(`${baseUrl}/owner/${walletAddress}/drafts/${draftId}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          if (cancelled) return;

          // Check for the card image URL in the response
          const imageUrl = data?.card?._imageUrl || data?.card?.imageUrl || data?.imageUrl;
          if (imageUrl) {
            logger.debug('[DraftComplete] Generated card fetched:', imageUrl);
            setCardUrl(imageUrl);
            setCardLoading(false);
            return;
          }
        } catch (err) {
          console.warn(`[DraftComplete] Card fetch attempt ${attempt + 1} failed:`, err);
        }

        if (cancelled) return;
        // Wait 3 seconds between retries
        await new Promise(r => setTimeout(r, 3000));
      }

      // Exhausted retries
      if (!cancelled) {
        setCardLoading(false);
        setCardError(true);
      }
    }

    fetchCard();
    return () => { cancelled = true; };
  }, [draftId, walletAddress, cardUrl]);

  // Once we have the card (or hit the error fallback), start a visible
  // countdown to the roster page. User can also click the button to skip
  // the wait. Countdown does NOT start until the card lands so the reveal
  // moment is never cut short by a background timer.
  const destination = draftId ? `/draft-results/${draftId}` : '/drafting';
  const readyToRedirect = !cardLoading; // covers both success + error paths

  useEffect(() => {
    if (draftId) draftStore.removeDraft(draftId);
  }, [draftId]);

  useEffect(() => {
    if (!readyToRedirect) return;
    setSecondsLeft(REDIRECT_SECONDS);
    const interval = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          router.push(destination);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [readyToRedirect, router, destination]);

  // Step indicator: which step is the active one right now?
  // - Compiling roster: instant, always done by the time we render here
  // - Generating art: active while cardLoading
  // - Ready: active once cardUrl is set
  const stepState: 'generating' | 'ready' | 'error' = cardError
    ? 'error'
    : cardUrl
      ? 'ready'
      : 'generating';

  return (
    <div className="mt-20 sm:mt-28 px-4 flex flex-col items-center text-center">
      {/* Headline shifts based on state. Both use banana yellow + bold so the
          transition feels like the same celebration, just resolved. */}
      <h1 className="font-primary uppercase italic font-black tracking-wide text-4xl sm:text-5xl bg-gradient-to-b from-banana to-banana/60 bg-clip-text text-transparent animate-fade-in-up">
        {stepState === 'ready' ? 'Your Team Is Ready' : 'Draft Complete'}
      </h1>
      <p className="mt-3 text-white/70 text-sm sm:text-base max-w-sm animate-fade-in-up" style={{ animationDelay: '120ms' }}>
        {stepState === 'ready'
          ? 'Card minted. Tap below to see your roster.'
          : stepState === 'error'
            ? 'Your card is still being generated — it will appear on your profile shortly.'
            : 'Hang tight — we’re minting your draft card right now.'}
      </p>

      {/* Three-step indicator. Step 1 is always complete by the time the user
          sees this screen. Step 2 reflects card generation. Step 3 lights up
          when the image URL lands. */}
      <ol className="mt-8 flex items-center gap-3 sm:gap-5 text-[11px] sm:text-xs uppercase tracking-wider font-semibold">
        <Step label="Roster" state="done" />
        <Connector active={stepState !== 'generating'} />
        <Step
          label="Card Art"
          state={stepState === 'generating' ? 'active' : stepState === 'error' ? 'error' : 'done'}
        />
        <Connector active={stepState === 'ready'} />
        <Step label="Ready" state={stepState === 'ready' ? 'done' : 'pending'} />
      </ol>

      {/* Card slot — reserves space so the layout doesn't jump when the image
          finally lands. While loading, render a subtle pulsing placeholder.
          When the image arrives, fade + scale in with a soft banana glow. */}
      <div className="mt-10 relative w-[220px] sm:w-[260px] aspect-[5/7]">
        {cardUrl ? (
          <>
            <div className="absolute inset-0 rounded-xl blur-2xl opacity-50 bg-banana/40 animate-card-glow" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={cardUrl}
              alt="Generated Card"
              className="relative w-full h-full object-contain rounded-xl shadow-2xl border border-white/10 animate-card-in"
            />
          </>
        ) : (
          <div className="absolute inset-0 rounded-xl border border-white/10 bg-white/[0.03] flex items-center justify-center overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-banana/[0.06] via-transparent to-banana/[0.04] animate-shimmer" />
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-banana animate-bubble" style={{ animationDelay: '0s' }} />
              <div className="w-3 h-3 rounded-full bg-banana animate-bubble" style={{ animationDelay: '0.2s' }} />
              <div className="w-3 h-3 rounded-full bg-banana animate-bubble" style={{ animationDelay: '0.4s' }} />
            </div>
          </div>
        )}
      </div>

      {/* Continue button + visible countdown. Button is active the moment the
          card lands (or the error fallback resolves). User clicks to leave
          immediately; otherwise the auto-redirect fires when seconds hit 0. */}
      <button
        type="button"
        disabled={!readyToRedirect}
        onClick={() => router.push(destination)}
        className={`mt-10 px-6 py-3 rounded-full text-sm sm:text-base font-bold transition-all ${
          readyToRedirect
            ? 'bg-banana text-black hover:bg-banana-light hover:scale-105 shadow-lg shadow-banana/30'
            : 'bg-white/[0.06] text-white/30 cursor-not-allowed'
        }`}
      >
        {readyToRedirect ? (
          <span className="flex items-center gap-2">
            View Team
            <span className="text-black/60 font-medium tabular-nums">({secondsLeft}s)</span>
            <span aria-hidden>→</span>
          </span>
        ) : (
          'Preparing your team…'
        )}
      </button>

      <style jsx>{`
        @keyframes bubble {
          0%, 80%, 100% { transform: scale(0); opacity: 0.3; }
          40% { transform: scale(1); opacity: 1; }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes cardIn {
          0% { opacity: 0; transform: scale(0.92); }
          60% { opacity: 1; transform: scale(1.02); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes cardGlow {
          0%, 100% { opacity: 0.35; }
          50% { opacity: 0.6; }
        }
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .animate-bubble { animation: bubble 1.4s infinite ease-in-out both; }
        .animate-fade-in-up { animation: fadeInUp 0.5s ease-out both; }
        .animate-card-in { animation: cardIn 0.7s cubic-bezier(0.16, 1, 0.3, 1) both; }
        .animate-card-glow { animation: cardGlow 2.4s ease-in-out infinite; }
        .animate-shimmer { animation: shimmer 2.2s ease-in-out infinite; }
      `}</style>
    </div>
  );
}

// ─── Step indicator pieces ─────────────────────────────────────────────────

type StepStatus = 'pending' | 'active' | 'done' | 'error';

function Step({ label, state }: { label: string; state: StepStatus }) {
  const dotClass =
    state === 'done'
      ? 'bg-banana border-banana text-black'
      : state === 'active'
        ? 'border-banana text-banana animate-pulse'
        : state === 'error'
          ? 'border-red-500 text-red-400'
          : 'border-white/15 text-white/30';
  const labelClass =
    state === 'pending'
      ? 'text-white/30'
      : state === 'error'
        ? 'text-red-400'
        : 'text-white/80';

  return (
    <li className="flex items-center gap-2">
      <span
        className={`w-5 h-5 sm:w-6 sm:h-6 rounded-full border-2 flex items-center justify-center text-[10px] font-black ${dotClass}`}
        aria-hidden
      >
        {state === 'done' ? '✓' : state === 'error' ? '!' : ''}
      </span>
      <span className={labelClass}>{label}</span>
    </li>
  );
}

function Connector({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden
      className={`h-px w-6 sm:w-10 transition-colors duration-500 ${active ? 'bg-banana' : 'bg-white/10'}`}
    />
  );
}
