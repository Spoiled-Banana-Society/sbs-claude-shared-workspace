'use client';

import React, { useEffect, useState } from 'react';

interface CardImageProps {
  src: string;
  alt?: string;
  className?: string;
  /** Number of retry attempts before showing the fallback. Default 10 (~30s with 3s spacing). */
  maxAttempts?: number;
  /** ms between retries. Default 3000. */
  retryMs?: number;
}

/**
 * Renders a card thumbnail with auto-retry. Card art is generated server-side
 * after a draft completes — for a few seconds the GCS thumbnail URL 404s, the
 * browser caches the failure, and the standard <img> never recovers. This
 * component appends a changing cache-bust query param on each retry so the
 * browser hits the network again, and gives up gracefully after maxAttempts.
 */
export function CardImage({ src, alt = 'Banana Best Ball Card', className, maxAttempts = 10, retryMs = 3000 }: CardImageProps) {
  const [attempt, setAttempt] = useState(0);
  const [exhausted, setExhausted] = useState(false);
  // Whether the <img> has actually decoded. Until it has, we keep it invisible
  // and show a placeholder — so the browser's broken-image glyph never appears
  // during the 404 retry window while the card PNG is still being uploaded.
  const [loaded, setLoaded] = useState(false);

  // Reset retry state when the underlying URL changes.
  useEffect(() => {
    setAttempt(0);
    setExhausted(false);
    setLoaded(false);
  }, [src]);

  const handleError = () => {
    setLoaded(false);
    if (attempt + 1 >= maxAttempts) {
      setExhausted(true);
      return;
    }
    setTimeout(() => setAttempt((a) => a + 1), retryMs);
  };

  if (exhausted) {
    return (
      <div className={`${className ?? ''} flex items-center justify-center bg-white/[0.03] border border-white/10 rounded-xl text-center px-4 py-8`}>
        <div>
          <p className="text-white/60 text-sm font-medium">Card art still generating</p>
          <p className="text-white/40 text-xs mt-1">Refresh the page in a moment.</p>
        </div>
      </div>
    );
  }

  // Cache-buster only added on retries — the first attempt uses the raw URL
  // so a normally-loading image isn't penalised with an extra param.
  const finalSrc = attempt === 0 ? src : `${src}${src.includes('?') ? '&' : '?'}r=${attempt}`;

  // The caller's className (sizing / aspect / centering / rounding) goes on a
  // self-contained wrapper so this works regardless of the caller's own
  // positioning. The <img> fills the wrapper absolutely and stays opacity-0
  // until it actually decodes; a shimmer + banana-bubble placeholder overlays
  // the same box until then (and on every error). The browser's broken-image
  // glyph is therefore never visible during the upload/404 retry window.
  return (
    <div className={`relative overflow-hidden ${className ?? ''}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={finalSrc}
        alt={alt}
        onLoad={() => setLoaded(true)}
        onError={handleError}
        className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      />
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-white/[0.03]">
          <div className="absolute inset-0 bg-gradient-to-br from-banana/[0.06] via-transparent to-banana/[0.04] animate-shimmer" />
          <div className="w-3 h-3 rounded-full bg-banana animate-bubble" style={{ animationDelay: '0s' }} />
          <div className="w-3 h-3 rounded-full bg-banana animate-bubble" style={{ animationDelay: '0.2s' }} />
          <div className="w-3 h-3 rounded-full bg-banana animate-bubble" style={{ animationDelay: '0.4s' }} />
        </div>
      )}
    </div>
  );
}
