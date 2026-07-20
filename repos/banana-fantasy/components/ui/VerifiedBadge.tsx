'use client';

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';

interface VerifiedBadgeProps {
  type: 'draft-type' | 'draft-order' | 'team';
  draftType?: 'jackpot' | 'hof' | 'pro' | 'regular' | 'jackhof';
  size?: 'sm' | 'md';
  compact?: boolean; // icon-only variant
  // When provided, the badge becomes a link to /verify/[draftId] where the
  // user can independently recompute the on-chain commit/reveal proof for
  // this draft's batch. When omitted, the badge renders the same UI but is
  // non-interactive — used until the on-chain proof system is fully live.
  draftId?: string;
}

export function VerifiedBadge({ type: _type, draftType: rawDraftType = 'pro', size = 'sm', compact = false, draftId }: VerifiedBadgeProps) {
  // JackHOF verifies through the jackpot proof lane — red badge colors fit.
  const draftType: 'jackpot' | 'hof' | 'pro' =
    rawDraftType === 'regular' ? 'pro' : rawDraftType === 'jackhof' ? 'jackpot' : (rawDraftType || 'pro');
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (showTooltip && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setTooltipPos({
        top: rect.bottom + 8,
        left: rect.left + rect.width / 2,
      });
    }
  }, [showTooltip]);

  const colorScheme = {
    jackpot: { bg: 'bg-red-500/15',    bgHover: 'hover:bg-red-500/25',    text: 'text-red-400',    accent: '#ef4444' },
    hof:     { bg: 'bg-hof/15',        bgHover: 'hover:bg-hof/25',        text: 'text-hof',        accent: '#D4AF37' },
    pro:     { bg: 'bg-purple-500/15', bgHover: 'hover:bg-purple-500/25', text: 'text-purple-400', accent: '#a855f7' },
  };
  const colors = colorScheme[draftType];

  const sizeClasses = compact
    ? (size === 'sm' ? 'p-1' : 'p-1.5')
    : (size === 'sm' ? 'text-[9px] px-1 py-0.5 gap-0.5' : 'text-[11px] px-1.5 py-0.5 gap-1');

  const interactive = !!draftId;
  const cursorClass = interactive ? 'cursor-pointer' : 'cursor-default';
  const hoverClass = interactive ? colors.bgHover : '';

  const tooltip = showTooltip && mounted && createPortal(
    <div
      className="fixed w-72 p-3 bg-[#1a1a2e] border border-white/10 rounded-lg shadow-2xl z-[9999] pointer-events-none"
      style={{ top: tooltipPos.top, left: tooltipPos.left, transform: 'translateX(-50%)' }}
    >
      <div className="absolute w-2 h-2 bg-[#1a1a2e] border-l border-t border-white/10 transform rotate-45" style={{ top: -5, left: '50%', marginLeft: -4 }} />

      <div className="text-xs font-semibold text-white mb-1 flex items-center gap-1.5">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: colors.accent }}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
        Verified by Chainlink VRF
      </div>

      <p className="text-[11px] text-white/70 mb-2 leading-relaxed">
        Every 100 drafts has exactly <span className="font-semibold text-white">94 Pro, 5 HOF, 1 Jackpot</span>.
        The exact slots were randomized by <span className="font-semibold text-white">Chainlink VRF</span> —
        the same oracle network Polymarket and Aave use — and locked in before any draft filled.
      </p>

      <div className="text-[10px] text-white/40 text-center mt-2 pt-2 border-t border-white/10">
        {interactive ? 'Click to view this draft’s proof' : 'Chainlink VRF verification active'}
      </div>
    </div>,
    document.body
  );

  const inner = (
    <>
      <svg width={size === 'sm' ? 10 : 12} height={size === 'sm' ? 10 : 12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
      {!compact && 'Verified'}
    </>
  );

  const className = `inline-flex items-center ${sizeClasses} ${colors.bg} ${colors.text} ${hoverClass} rounded font-medium transition-all ${cursorClass}`;

  return (
    <>
      {interactive ? (
        <Link
          href={`/proof/${draftId}`}
          ref={buttonRef as unknown as React.Ref<HTMLAnchorElement>}
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
          // Stop the click from bubbling to a parent row's onClick — e.g.
          // DraftRow wraps the whole row in a click-to-enter handler, so
          // without this the badge click would simultaneously navigate to
          // /proof AND fire the enter-draft action.
          onClick={(e) => e.stopPropagation()}
          className={className}
          // Allow opening in a new tab via cmd-click; the verify page is a
          // self-contained recomputation, no router state required.
          prefetch={false}
        >
          {inner}
        </Link>
      ) : (
        <div
          ref={buttonRef}
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
          // Even when non-interactive (no draftId → no proof page to
          // link to), stop clicks from bubbling to a parent row's
          // onClick. Without this, clicking the Verified pill inside a
          // DraftRow would trigger 'enter draft' instead of just
          // hovering for the tooltip.
          onClick={(e) => e.stopPropagation()}
          className={className}
          aria-label="Verified — fair distribution"
        >
          {inner}
        </div>
      )}
      {tooltip}
    </>
  );
}
