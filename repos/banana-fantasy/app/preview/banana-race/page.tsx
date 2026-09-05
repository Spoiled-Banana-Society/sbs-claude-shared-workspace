'use client';

// /preview/banana-race — every Banana Race visual with MOCK data, regardless
// of the switch. Names and points are made up; seat counts are the real
// open seats on 2026-09-04. Share this before the flip.

import React from 'react';
import { BananaRaceBoard } from '@/components/race/BananaRaceBoard';
import { BananaRaceCard } from '@/components/race/BananaRaceCard';
import { mockRaceBoard } from '@/lib/bananaRace';

export default function BananaRacePreviewPage() {
  const board = mockRaceBoard();
  return (
    <div>
      <div className="mx-auto max-w-[900px] px-4 pt-4">
        <div className="rounded border border-dashed border-banana bg-banana/10 px-3.5 py-2.5 text-[13px] text-banana">
          <b className="text-white">PREVIEW, not live.</b> Names and points are made up. Seat counts are real as of Fri Sep 4.
        </div>
        <div className="mt-4"><BananaRaceCard preview={board} /></div>
      </div>
      <BananaRaceBoard board={board} loggedIn={true} />
    </div>
  );
}
