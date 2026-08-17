'use client';

import React, { useState, useRef, useLayoutEffect, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
  /** Extra classes on the trigger wrapper (e.g. `min-w-0` so a flex parent
   *  can shrink/truncate the wrapped label instead of overflowing the row). */
  className?: string;
}

export function Tooltip({ content, children, position = 'bottom', delay = 200, className = '' }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  // null until measured — the tooltip renders invisibly for one frame so we
  // can read its real size, then snaps to place. Prevents the old "flash at
  // the top-left corner" on first hover.
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const autoHideRef = useRef<NodeJS.Timeout | null>(null);

  const showTooltip = () => {
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
    }, delay);
  };

  const hideTooltip = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (autoHideRef.current) clearTimeout(autoHideRef.current);
    setIsVisible(false);
    setCoords(null);
  };

  // Mobile/touch: there's no mouseleave, so a tap used to leave the tooltip
  // stuck on screen while you scrolled. Show it instantly on touch, then
  // auto-dismiss after ~2s so it behaves like a quick peek (Boris 2026-06-15).
  const showOnTouch = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (autoHideRef.current) clearTimeout(autoHideRef.current);
    setIsVisible(true);
    // Auto-dismiss fallback (scroll / tapping elsewhere also dismisses). 4.5s so
    // the copy lingers long enough to read on mobile, then clears (Boris 2026-06-29,
    // bumped from 2s).
    autoHideRef.current = setTimeout(() => hideTooltip(), 4500);
  };

  // Any scroll dismisses an open tooltip (covers the mobile "stuck while
  // scrolling" case, and is harmless on desktop).
  useEffect(() => {
    if (!isVisible) return;
    const onScroll = () => hideTooltip();
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    return () => window.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
  }, [isVisible]);

  useLayoutEffect(() => {
    if (isVisible && triggerRef.current && tooltipRef.current) {
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const tooltipRect = tooltipRef.current.getBoundingClientRect();

      let top = 0;
      let left = 0;

      switch (position) {
        case 'top':
          top = triggerRect.top - tooltipRect.height - 8;
          left = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2;
          break;
        case 'bottom':
          top = triggerRect.bottom + 8;
          left = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2;
          break;
        case 'left':
          top = triggerRect.top + (triggerRect.height - tooltipRect.height) / 2;
          left = triggerRect.left - tooltipRect.width - 8;
          break;
        case 'right':
          top = triggerRect.top + (triggerRect.height - tooltipRect.height) / 2;
          left = triggerRect.right + 8;
          break;
      }

      // Ensure tooltip stays within viewport
      const padding = 8;
      if (left < padding) left = padding;
      if (left + tooltipRect.width > window.innerWidth - padding) {
        left = window.innerWidth - tooltipRect.width - padding;
      }
      if (top < padding) top = padding;
      if (top + tooltipRect.height > window.innerHeight - padding) {
        top = window.innerHeight - tooltipRect.height - padding;
      }

      setCoords({ top, left });
    }
  }, [isVisible, position]);

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onTouchStart={showOnTouch}
        className={`inline-block ${className}`.trim()}
      >
        {children}
      </div>
      {isVisible && typeof document !== 'undefined' && createPortal(
        // Rendered into <body> via a portal so the fixed-position tooltip can't
        // be clipped or mis-anchored by an ancestor with overflow:hidden / a
        // transform / a scroll container (e.g. the dense draft-strip cards —
        // where an inline-rendered tooltip silently never painted, so the
        // King-of-Drafts crown showed no hover copy). Coords are already
        // viewport-based (getBoundingClientRect), so body is the correct anchor;
        // appearance and positioning math are unchanged.
        <div
          ref={tooltipRef}
          // No whitespace-nowrap: content decides its own wrapping/max-width
          // (nowrap used to force long badge copy off-screen / clipped).
          className={`fixed z-[70] px-3 py-2 text-xs bg-[#15161c]/95 backdrop-blur-sm text-text-primary border border-white/10 rounded-xl shadow-xl shadow-black/40 ${coords ? 'animate-fade-in' : 'invisible'}`}
          style={coords ? { top: coords.top, left: coords.left } : { top: 0, left: 0 }}
        >
          {content}
        </div>,
        document.body,
      )}
    </>
  );
}
