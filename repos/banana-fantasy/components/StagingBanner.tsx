'use client';

import { useEffect, useState } from 'react';
import { isStagingMode } from '@/lib/staging';

export function StagingBanner() {
  const [staging, setStaging] = useState(false);

  useEffect(() => {
    setStaging(isStagingMode());
  }, []);

  if (!staging) return null;

  // Removed the old "Exit Staging" button — it cleared a sessionStorage
  // key that isStagingMode() no longer reads (mode is env-driven now), so
  // clicking it did nothing. Staging vs prod is now controlled by Vercel
  // env vars on each project, not by a UI toggle.
  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] bg-orange-500 text-black text-center text-xs font-bold py-1">
      🧪 STAGING MODE
    </div>
  );
}
