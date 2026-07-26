'use client';

import { useCallback, useState } from 'react';
import { saveImageToDevice } from '@/lib/saveImage';
import { shareToX } from '@/lib/shareUtils';

/**
 * The one share control, dropped at every moment worth posting — a finished
 * draft, a Jackpot reveal, a badge unlock, an exposure page, a listing.
 *
 * Two plain buttons, no hidden state. An earlier design copied the PNG to the
 * clipboard and told the user to paste; Boris killed it (2026-07-26) because
 * invisible state you have to trust is bad UX. What's left does exactly what
 * the labels say.
 *
 *   Post on X   mobile → native share sheet hands the PNG + text + link
 *                        straight into the X app, image ATTACHED (full 4:5,
 *                        uncropped — X shows attached photos far larger than
 *                        link cards).
 *               desktop → opens the composer with text + link; the card
 *                        arrives via the link unfurl, which is why the OG
 *                        route needs its 1200x628 `wide` variant (X crops
 *                        link cards to 1.91:1 and would slice a 4:5 in half).
 *
 *   Download    saves the full-resolution 4:5 PNG. Always available, so
 *               there is always a manual path if a share sheet misbehaves.
 *
 * Verification-free by design: nothing here reports back or earns anything.
 * You can only share a moment you actually had, so there's nothing to farm —
 * which is why this needs no X-connect, no API quota and no anti-abuse work.
 */

export interface ShareCardProps {
  /** Absolute or same-origin URL of the 4:5 PNG (an /api/og/* route). */
  imageUrl: string;
  /** Public page the tweet links to; its OG tags drive the desktop unfurl. */
  pageUrl: string;
  /** Tweet body. Keep it short — the link eats 23 chars. */
  tweetText: string;
  /** Download filename, without extension. */
  fileName: string;
  /** Optional label override, e.g. "Share your team". */
  label?: string;
  /** 'row' (default) or 'stack' for narrow columns. */
  layout?: 'row' | 'stack';
  className?: string;
}

const XGlyph = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M18.244 2H21.5l-7.53 8.607L22.5 22h-6.77l-5.3-6.92L4.48 22H1.22l8.06-9.21L1.5 2h6.93l4.79 6.33L18.244 2Zm-1.187 18h1.873L7.01 3.9H5.01L17.057 20Z" />
  </svg>
);

const isMobile = () =>
  typeof navigator !== 'undefined' && /iphone|ipad|ipod|android/i.test(navigator.userAgent);

export function ShareCard({
  imageUrl,
  pageUrl,
  tweetText,
  fileName,
  label = 'Post on X',
  layout = 'row',
  className = '',
}: ShareCardProps) {
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const handlePost = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      // MOBILE: try to hand the actual file to the X app. canShare({files}) is
      // the only reliable capability check — plenty of browsers expose
      // navigator.share but reject files.
      if (isMobile() && typeof navigator.share === 'function') {
        try {
          const res = await fetch(imageUrl);
          if (res.ok) {
            const blob = await res.blob();
            const file = new File([blob], `${fileName}.png`, { type: 'image/png' });
            if (navigator.canShare?.({ files: [file] })) {
              await navigator.share({ files: [file], text: tweetText, url: pageUrl });
              return;
            }
          }
        } catch (err) {
          // AbortError = user dismissed the sheet. That's a completed
          // interaction, not a failure — don't fall through and yank a second
          // window open under them.
          if ((err as Error)?.name === 'AbortError') return;
        }
      }
      // DESKTOP (and any mobile fallback): composer + link unfurl.
      shareToX(tweetText, pageUrl);
    } finally {
      setBusy(false);
    }
  }, [busy, imageUrl, pageUrl, tweetText, fileName]);

  const handleDownload = useCallback(async () => {
    const ok = await saveImageToDevice(imageUrl, fileName);
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }, [imageUrl, fileName]);

  const base =
    'inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors disabled:opacity-60';

  return (
    <div
      className={`flex ${layout === 'stack' ? 'flex-col' : 'flex-row'} items-stretch gap-2 ${className}`}
    >
      <button
        type="button"
        onClick={handlePost}
        disabled={busy}
        className={`${base} flex-1 bg-white text-black hover:bg-white/90 active:scale-[0.98]`}
      >
        <XGlyph />
        {label}
      </button>
      <button
        type="button"
        onClick={handleDownload}
        className={`${base} flex-1 border border-white/20 bg-white/5 text-text-primary hover:bg-white/10 active:scale-[0.98]`}
      >
        {saved ? 'Saved' : 'Download'}
      </button>
    </div>
  );
}
