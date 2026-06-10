'use client';

import { reportClientError } from '@/lib/clientErrors';
import { LOG_SOURCES } from '@/lib/logSources';

/**
 * Save an image URL to the user's device — desktop AND mobile.
 *
 * fetch → blob → object-URL (the marketplace BuyTab pattern). The old
 * /api/save-card proxy only accepted storage.googleapis.com URLs, so the
 * same-origin /api/og/team-card URLs were REJECTED and the browser saved a
 * JSON error body named ".png" that wouldn't open — the "download works but
 * saving errors" bug on the roster page.
 *
 * Mobile: prefers the native share sheet (saves straight to Photos/Files on
 * iOS); falls back to a direct blob download. Returns true when the image
 * was saved/shared, false when it failed (caller can show state).
 */
export async function saveImageToDevice(url: string, fileNameBase: string): Promise<boolean> {
  if (!url || typeof window === 'undefined') return false;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`image fetch failed: ${res.status}`);
    const blob = await res.blob();
    const fileName = `${fileNameBase.replace(/[^\w\- #]/g, '').trim() || 'SBS-Team'}.png`;

    const isMobile = /iphone|ipad|ipod|android/i.test(navigator.userAgent);
    if (isMobile && typeof navigator.share === 'function' && typeof navigator.canShare === 'function') {
      const file = new File([blob], fileName, { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: fileNameBase });
          return true;
        } catch (shareErr) {
          // User closed the sheet — that's a completed interaction, not a failure.
          if ((shareErr as Error).name === 'AbortError') return true;
          // Share genuinely unsupported/failed → fall through to download.
        }
      }
    }

    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 10_000);
    return true;
  } catch (err) {
    reportClientError({
      source: LOG_SOURCES.marketplace.CARD_SAVE_FAILED,
      message: err instanceof Error ? err.message : String(err),
      route: typeof window !== 'undefined' ? window.location.pathname : 'unknown',
      context: { url },
    });
    return false;
  }
}
