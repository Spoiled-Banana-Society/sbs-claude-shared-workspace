'use client';

import { useEffect, useState } from 'react';
import { isStagingMode } from '@/lib/staging';

export function StagingBanner() {
  const [staging, setStaging] = useState(false);

  useEffect(() => {
    setStaging(isStagingMode());
  }, []);

  if (!staging) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] bg-orange-500 text-black text-center text-xs font-bold py-1">
      🧪 STAGING MODE — API: EC2 staging servers | <button onClick={() => { sessionStorage.removeItem('sbs-staging-mode'); window.location.reload(); }} className="underline">Exit Staging</button>
    </div>
  );
}
