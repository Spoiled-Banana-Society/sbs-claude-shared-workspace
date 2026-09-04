'use client';

/**
 * Banana Hype / X Mindshare — RETIRED 2026-09-03 (Boris: permanent; final
 * week paid out in full that night — ladder markers in `hype_payouts`).
 *
 * This route stays alive so old links, bells, and X posts land on a clean
 * farewell instead of a 404. It fetches NOTHING — the live board, feed, and
 * crons are gone (cost audit 9/3). The full previous implementation lives in
 * git history if it's ever needed for reference (it won't be — do not bring
 * Hype back).
 */

import Link from 'next/link';

export default function MindsharePage() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6">
      <div className="max-w-md text-center space-y-4">
        <div className="text-5xl">🍌</div>
        <h1 className="text-2xl font-bold text-white">Banana Hype has ended</h1>
        <p className="text-white/60">
          The final week wrapped on September 3 and every prize on the ladder
          has been paid out. Thanks for bringing the noise all season.
        </p>
        <Link
          href="/promos"
          className="inline-block rounded-xl bg-[#fbbf24] px-5 py-2.5 font-semibold text-black hover:opacity-90 transition"
        >
          See live promos
        </Link>
      </div>
    </div>
  );
}
