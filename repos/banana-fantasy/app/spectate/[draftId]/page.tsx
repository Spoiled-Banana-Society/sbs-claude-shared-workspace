'use client';

import React, { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

// Spectator entry. Redirects to the live /draft-room with mode=live + a
// placeholder wallet + spectate=true. The draft-room renders normally
// (slot reveal, banner countdown, drafting page, board, all of it) while
// spectate=true gates out user actions (no pick submit, no leave, no
// queue mutations) and shows a SPECTATOR badge.
//
// Public URL — anyone with the link can watch. The placeholder wallet
// 0x000…000 never matches a real drafter so the live engine treats the
// viewer as not-in-the-draft (isUserTurn always false).
const PLACEHOLDER_WALLET = '0x0000000000000000000000000000000000000000';

export default function SpectatePage() {
  const params = useParams();
  const router = useRouter();
  const draftId = (params?.draftId as string) || '';

  useEffect(() => {
    if (!draftId) return;
    const search = new URLSearchParams({
      id: draftId,
      mode: 'live',
      wallet: PLACEHOLDER_WALLET,
      spectate: 'true',
    });
    router.replace(`/draft-room?${search.toString()}`);
  }, [draftId, router]);

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary flex items-center justify-center p-6">
      <div className="text-center">
        <p className="text-lg">Loading spectator view…</p>
        <p className="text-xs text-text-muted mt-2 font-mono">{draftId}</p>
      </div>
    </div>
  );
}
