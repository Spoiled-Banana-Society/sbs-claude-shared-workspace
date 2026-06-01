'use client';

/**
 * Admin "View as" toggle — preview the New vs Returning experience from your
 * own admin wallet. Writes sessionStorage 'sbs-view-as' which hooks/useAuth.tsx
 * reads to override isBB3Holder (admin wallets only), then reloads so every
 * surface (promo carousel, banner, popup) re-evaluates.
 *
 * 'auto' clears the override and falls back to the real on-chain BBB3 check.
 */

import { useEffect, useState } from 'react';

type ViewAs = 'auto' | 'new' | 'returning';

export function ViewAsToggle() {
  const [value, setValue] = useState<ViewAs>('auto');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const v = window.sessionStorage.getItem('sbs-view-as');
    if (v === 'new' || v === 'returning') setValue(v);
  }, []);

  const apply = (next: ViewAs) => {
    if (typeof window === 'undefined') return;
    if (next === 'auto') window.sessionStorage.removeItem('sbs-view-as');
    else window.sessionStorage.setItem('sbs-view-as', next);
    setValue(next);
    window.location.reload();
  };

  const opts: { key: ViewAs; label: string }[] = [
    { key: 'auto', label: 'Auto (on-chain)' },
    { key: 'new', label: 'New user' },
    { key: 'returning', label: 'Returning' },
  ];

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-900/40 px-4 py-3 flex items-center justify-between gap-3">
      <div className="text-xs text-gray-400 leading-snug">
        <span className="font-semibold text-gray-200">View as</span> — preview the promo flow as a
        new or returning user from your admin wallet. Reloads on change.
      </div>
      <div className="flex gap-1 shrink-0">
        {opts.map((o) => (
          <button
            key={o.key}
            onClick={() => apply(o.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              value === o.key
                ? 'bg-[#F3E216] text-black border-[#F3E216]'
                : 'bg-gray-800 text-gray-300 border-gray-700 hover:border-gray-600'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Force-show BOTH top banners (First Purchase + Get the App) on the home page
 * for layout/QA — without touching account data or pressing Reset. Admin-only,
 * session-scoped (sessionStorage 'sbs-preview-banners'); read by TopBanners.
 */
export function PreviewBannersToggle() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setOn(window.sessionStorage.getItem('sbs-preview-banners') === '1');
  }, []);

  const apply = (next: boolean) => {
    if (typeof window === 'undefined') return;
    if (next) window.sessionStorage.setItem('sbs-preview-banners', '1');
    else window.sessionStorage.removeItem('sbs-preview-banners');
    setOn(next);
    window.location.assign('/'); // jump home so you immediately see them
  };

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-900/40 px-4 py-3 flex items-center justify-between gap-3">
      <div className="text-xs text-gray-400 leading-snug">
        <span className="font-semibold text-gray-200">Preview top banners</span> — force First Purchase
        + Get-the-App to show on the home page (no data change). Jumps you home on toggle.
      </div>
      <div className="flex gap-1 shrink-0">
        {[{ k: false, l: 'Off' }, { k: true, l: 'On' }].map((o) => (
          <button
            key={o.l}
            onClick={() => apply(o.k)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              on === o.k
                ? 'bg-[#F3E216] text-black border-[#F3E216]'
                : 'bg-gray-800 text-gray-300 border-gray-700 hover:border-gray-600'
            }`}
          >
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}
