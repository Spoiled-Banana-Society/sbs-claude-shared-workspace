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

export function DraftComplete({ draftId, generatedCardUrl: initialCardUrl, walletAddress }: DraftCompleteProps) {
  const router = useRouter();
  const [cardUrl, setCardUrl] = useState<string | null>(initialCardUrl || null);
  const [cardLoading, setCardLoading] = useState(!initialCardUrl);
  const [cardError, setCardError] = useState(false);

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

  useEffect(() => {
    // Remove from active drafts so it doesn't show on the drafting page
    if (draftId) {
      draftStore.removeDraft(draftId);
    }

    const destination = draftId ? `/draft-results/${draftId}` : '/drafting';
    const timeout = setTimeout(() => {
      router.push(destination);
    }, 10000);
    return () => clearTimeout(timeout);
  }, [router, draftId]);

  return (
    <div className="mt-[340px] text-center">
      <h1 className="font-primary text-center font-bold italic uppercase text-lg mt-5">Draft is complete</h1>

      {/* Show generated card if available */}
      {cardUrl ? (
        <div className="mt-6 flex flex-col items-center gap-4">
          <p className="px-3 text-center text-white/60">Your card has been generated!</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cardUrl}
            alt="Generated Card"
            className="max-w-[300px] rounded-xl shadow-2xl border border-white/10"
          />
          <p className="text-white/40 text-xs mt-2">Redirecting in a few seconds...</p>
        </div>
      ) : cardLoading ? (
        <>
          <p className="px-3 text-center">Please wait while we are generating your card...</p>
          <div className="mx-auto text-center flex items-center justify-center">
            <div className="flex items-center gap-2 mt-4">
              <div className="w-4 h-4 rounded-full bg-white animate-bubble" style={{ animationDelay: '0s' }} />
              <div className="w-4 h-4 rounded-full bg-white animate-bubble" style={{ animationDelay: '0.2s' }} />
              <div className="w-4 h-4 rounded-full bg-white animate-bubble" style={{ animationDelay: '0.4s' }} />
            </div>
          </div>
        </>
      ) : cardError ? (
        <div className="mt-4">
          <p className="px-3 text-center text-white/60">Card generation in progress. It will appear on your profile shortly.</p>
          <p className="text-white/40 text-xs mt-2">Redirecting in a few seconds...</p>
        </div>
      ) : (
        <p className="px-3 text-center text-white/60 mt-4">Redirecting in a few seconds...</p>
      )}

      <style jsx>{`
        @keyframes bubble {
          0%, 80%, 100% { transform: scale(0); opacity: 0.3; }
          40% { transform: scale(1); opacity: 1; }
        }
        .animate-bubble { animation: bubble 1.4s infinite ease-in-out both; }
      `}</style>
    </div>
  );
}
