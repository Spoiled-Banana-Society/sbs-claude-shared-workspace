'use client';

import React from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Tooltip } from '../ui/Tooltip';
import { Contest } from '@/types';

interface ContestCardProps {
  contest: Contest;
  draftCount?: number;
  onEnter: () => void;
  onDetails: () => void;
}

export function ContestCard({ contest, onEnter, onDetails }: ContestCardProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="relative flex items-center justify-center py-10">
      {/* Main Content - glossy 3D panel */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="panel-3d rounded-3xl p-10 max-w-3xl w-full"
      >
        {/* Top Left - Info button */}
        <div className="absolute left-6 top-6 z-10">
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
        <div className="relative z-[1] text-center space-y-4 mt-4">
          <h3 className="text-3xl font-bold text-white">{contest.name}</h3>
          {/* Prize Pool */}
          <div className="flex items-center justify-center gap-2">
            <span className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-banana drop-shadow-[0_2px_12px_rgba(251,191,36,0.35)]">
              {formatCurrency(contest.prizePool)}
            </span>
            <span className="text-sm text-white/50 font-medium leading-tight text-left">
              Guaranteed<br />Prize Pool
            </span>
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

        {/* Action Buttons */}
        <div className="relative z-[1] flex flex-col sm:flex-row justify-center items-center gap-4 mt-10">
          <motion.button
            onClick={onEnter}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.985 }}
            transition={{ type: 'spring', stiffness: 400, damping: 22 }}
            className="btn-3d btn-obsidian rim-chromatic w-full sm:w-[200px] py-4 text-xl font-bold tracking-wide"
          >
            <span>Enter</span>
          </motion.button>
          <motion.div
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.985 }}
            transition={{ type: 'spring', stiffness: 400, damping: 22 }}
            className="w-full sm:w-[200px]"
          >
            <Link
              href="/buy-drafts?buy=1"
              className="btn-3d btn-muted flex items-center justify-center w-full py-4 text-xl font-bold tracking-wide text-center"
            >
              <span>Buy</span>
            </Link>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
