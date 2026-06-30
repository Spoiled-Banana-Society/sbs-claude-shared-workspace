'use client';

import Link from 'next/link';
import { ProofFeedLive } from '@/components/drafting/ProofFeedLive';

/**
 * Public live feed of verified drafts. The live, real-time feed itself lives in
 * the shared <ProofFeedLive /> component (also embedded in the "Verified Fair"
 * info tab) so both surfaces stream identically. Newest league at the top.
 */
export default function ProofFeedPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <Link href="/drafting" className="text-banana hover:underline text-sm">← Drafting</Link>
        <h1 className="text-[28px] font-semibold text-white tracking-tight mt-2">Public draft feed</h1>
        <p className="text-white/60 text-sm mt-1">
          Every draft on Banana Best Ball, publicly verifiable. Click any row to see the proof.
        </p>
      </div>

      <ProofFeedLive />
    </div>
  );
}
