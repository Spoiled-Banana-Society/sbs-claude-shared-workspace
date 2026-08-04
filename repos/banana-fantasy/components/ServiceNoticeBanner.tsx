'use client';

import { useState } from 'react';

// Flip to false (and deploy) to remove the notice when the incident resolves.
const SHOW_NOTICE = true;

export function ServiceNoticeBanner() {
  const [dismissed, setDismissed] = useState(false);

  if (!SHOW_NOTICE || dismissed) return null;

  return (
    <div
      role="status"
      className="w-full bg-[#fbbf24] text-black text-center text-xs sm:text-sm font-semibold px-3 py-2"
    >
      ⚠️ Some users are having trouble logging in or making purchases right now
      due to an outage at Privy, our third-party login provider. Your funds,
      passes, and teams are safe — if you&apos;re already logged in, everything
      works normally.
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss notice"
        className="ml-3 underline font-bold"
      >
        Dismiss
      </button>
    </div>
  );
}
