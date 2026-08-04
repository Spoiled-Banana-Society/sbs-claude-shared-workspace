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
    let cancelled = false;

    const go = (specialType: string | null) => {
      if (cancelled) return;
      const search = new URLSearchParams({
        id: draftId,
        mode: 'live',
        wallet: PLACEHOLDER_WALLET,
        spectate: 'true',
      });
      if (specialType) search.set('specialType', specialType);
      router.replace(`/draft-room?${search.toString()}`);
    };

    // Special drafts (Jackpot / HOF / JackHOF queue rounds) only show their
    // branding when the room URL carries specialType — participants get it
    // from their queue links, but spectators came in bare, so a JackHOF
    // draft looked like a plain Pro room (Boris 2026-08-03). Look the id up
    // in the queues before redirecting; on any failure fall through plain.
    (async () => {
      try {
        const res = await fetch('/api/queues', { cache: 'no-store' });
        if (res.ok) {
          const queues = await res.json() as Record<string, { rounds?: Array<{ draftId?: string }> }>;
          for (const type of ['jackpot', 'hof', 'jackhof'] as const) {
            if (queues[type]?.rounds?.some((r) => r.draftId === draftId)) return go(type);
          }
        }
      } catch { /* lookup is best-effort — plain spectate beats no spectate */ }
      go(null);
    })();

    return () => { cancelled = true; };
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
