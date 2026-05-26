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

  // Reset retry state when the underlying URL changes.
  useEffect(() => {
    setAttempt(0);
    setExhausted(false);
  }, [src]);

  const handleError = () => {
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

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={finalSrc}
      alt={alt}
      className={className}
      onError={handleError}
    />
  );
}
