'use client';

// /preview/* is private admin tooling (Boris 2026-08-23). The pages under it
// only render public API payloads, but preview surfaces must never be
// routable by regular users — same gate + redirect as /admin.
//
// Exception list (Richard 2026-08-25): review pages that are PURE MOCK — no
// wallet data, no live reads, nothing claimable — can be opened by anyone
// so a link works for Boris without a wallet login. Add a path here only if
// the page truly renders nothing real.

import React, { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { isWalletAdmin } from '@/lib/adminAllowlist';

const PUBLIC_MOCK_PREVIEWS = new Set<string>([
  '/preview/zone-drop', // zone packs instant-mode review (mock data only)
  '/preview/banana-race', // Banana Race board + tile review (mockRaceBoard only, no reads, nothing claimable)
]);

export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  const { walletAddress, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isPublic = PUBLIC_MOCK_PREVIEWS.has((pathname ?? '').replace(/\/+$/, ''));
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    if (isPublic || isLoading) return;
    if (!walletAddress || !isWalletAdmin(walletAddress)) {
      router.replace('/');
      return;
    }
    setIsAuthorized(true);
  }, [isPublic, isLoading, router, walletAddress]);

  if (isPublic) return <>{children}</>;
  if (isLoading || !isAuthorized) return null;
  return <>{children}</>;
}
