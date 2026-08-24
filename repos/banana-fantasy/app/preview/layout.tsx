'use client';

// /preview/* is private admin tooling (Boris 2026-08-23). The pages under it
// only render public API payloads, but preview surfaces must never be
// routable by regular users — same gate + redirect as /admin.

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { isWalletAdmin } from '@/lib/adminAllowlist';

export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  const { walletAddress, isLoading } = useAuth();
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    if (isLoading) return;
    if (!walletAddress || !isWalletAdmin(walletAddress)) {
      router.replace('/');
      return;
    }
    setIsAuthorized(true);
  }, [isLoading, router, walletAddress]);

  if (isLoading || !isAuthorized) return null;
  return <>{children}</>;
}
