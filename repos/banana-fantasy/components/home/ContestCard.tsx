'use client';

import React from 'react';
import Link from 'next/link';
import { Tooltip } from '../ui/Tooltip';
import { Contest } from '@/types';
import { DEPOSITS_ENABLED } from '@/lib/deposits';

interface ContestCardProps {
  contest: Contest;
  draftCount?: number;
  onEnter: () => void;
  onDetails: () => void;
}

import { useAuth } from '@/hooks/useAuth';

export function ContestCard({ contest, onEnter, onDetails }: ContestCardProps) {
  // Admin drafting block: no Enter/Buy CTA at all for this account.
  const { user } = useAuth();
  const draftBlocked = user?.draftBlocked === true;
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="relative flex items-center justify-center py-4 sm:py-10">
      {/* Main Content - Centered card */}
      <div
        className="relative glass-card rounded-3xl p-6 sm:p-10 max-w-3xl w-full ring-1 ring-banana/40 glow-banana"
      >

        {/* Top Left - Info button */}
        <div className="absolute left-6 top-6">
          <Tooltip content="Contest Details">
            <button
              onClick={onDetails}
              className="text-text-muted hover:text-text-primary transition-colors"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </button>
          </Tooltip>
        </div>

        {/* Contest Info */}
        <div className="text-center space-y-4 mt-4">
          <h3 className="text-3xl font-bold text-white">{contest.name}</h3>
          {/* Prize Pool */}
          <div className="flex items-center justify-center gap-2">
            <span className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-banana drop-shadow-lg">{formatCurrency(contest.prizePool)}</span>
            <span className="text-sm text-white/50 font-medium leading-tight text-left">Guaranteed<br/>Prize Pool</span>
          </div>

          {/* 1st Place & Entry */}
          <div className="flex items-center justify-center gap-10 pt-2">
            <div className="text-center">
              <p className="text-2xl font-semibold text-white">{formatCurrency(contest.topPrize)}</p>
              <p className="text-xs text-white/50 uppercase tracking-wide">1st Place</p>
            </div>
            <div className="w-px h-10 bg-white/10"></div>
            <div className="text-center">
              <p className="text-2xl font-semibold text-white">{formatCurrency(contest.entryFee)}</p>
              <p className="text-xs text-white/50 uppercase tracking-wide">Entry</p>
            </div>
          </div>
        </div>

        {/* Action Buttons — with the deposit bankroll live, Enter is the ONLY
            CTA (Richard 2026-07-21): it consumes a pass, one-taps $25 from
            balance, or prompts Add Funds at $0. The Buy button only exists in
            the pre-deposit world (flag off). */}
        {draftBlocked ? (
          <p className="mt-6 sm:mt-10 text-center text-sm text-white/45">Drafting is disabled on this account.</p>
        ) : (
        <div className="flex flex-col sm:flex-row justify-center items-center gap-3 mt-6 sm:mt-10">
          {/* Sizing (Boris 2026-07-26): mobile was `w-full py-4 text-xl` — a
              full-bleed slab that dominated the card. Now an auto-width pill
              with a min-width so it still reads as the primary CTA. Desktop
              goes the other way: 200px → 240px, slightly bigger. */}
          <button
            onClick={onEnter}
            className="min-w-[176px] px-10 py-3 text-lg sm:min-w-0 sm:w-[240px] sm:px-0 sm:py-4 sm:text-xl font-bold rounded-full border-2 border-banana bg-banana text-black transition-all duration-200 hover:brightness-110 hover:scale-105"
          >
            Enter
          </button>
          {!DEPOSITS_ENABLED && (
            <Link
              href="/buy-drafts?buy=1"
              className="min-w-[176px] px-10 py-3 text-lg sm:min-w-0 sm:w-[240px] sm:px-0 sm:py-4 sm:text-xl font-bold rounded-full border-2 border-banana text-banana transition-all duration-200 hover:bg-banana hover:text-black hover:scale-105 text-center"
            >
              Buy
            </Link>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
