'use client';

import { useEffect, useState } from 'react';
import { WheelProofExplainerModal } from '@/components/wheel/WheelProofExplainerModal';

interface PeriodSummary {
  periodNumber: number;
  status: 'requested' | 'fulfilled' | 'active' | 'closed' | 'revealed';
  spinCount: number;
  maxSpins: number;
  saltHash: string;
  merkleRoot: string | null;
  vrfRandomness: string | null;
  salt: string | null;
  commitTxHash: string | null;
  rootCommitTxHash: string | null;
  revealTxHash: string | null;
}

interface ResponseData {
  active: boolean;
  period: PeriodSummary | null;
  contractAddress: string | null;
}

/**
 * Compact verification card. Lives in the right column of /banana-wheel
 * (above Spin History). Communicates "this wheel is provably fair" in
 * a few words; expand for the full chain-of-custody detail. Hidden when
 * no period exists.
 */
export function WheelProofBanner() {
  const [data, setData] = useState<ResponseData | null>(null);
  const [explainerOpen, setExplainerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/wheel/period', { cache: 'no-store' });
        if (!res.ok) return;
        const body = (await res.json()) as ResponseData;
        if (!cancelled) setData(body);
      } catch {
        // silent
      }
    }
    load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!data || !data.period) return null;
  const p = data.period;

  const isActive = p.status === 'active' || p.status === 'revealed';
  const isPreparing = p.status === 'requested' || p.status === 'fulfilled';

  // Every spin is independently verifiable the moment it happens — the
  // live feed at /wheel-batches surfaces them all. Round close (full salt
  // reveal) lives in the Details section since most users will never
  // experience it directly.

  const headline = isActive
    ? 'Verified Fair'
    : isPreparing
      ? 'Preparing round…'
      : 'Reveal pending';
  const sub = isActive
    ? 'Outcomes + who gets them are both locked in.'
    : isPreparing
      ? 'Chainlink VRF randomizing the next round.'
      : 'Salt reveal coming.';

  return (
    <div
      className="rounded-2xl p-5 backdrop-blur-md"
      style={{
        background: 'rgba(20, 20, 20, 0.7)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
      }}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-400' : 'bg-amber-400'} animate-pulse`} />
          <h3 className="text-[15px] font-semibold text-white tracking-tight truncate">{headline}</h3>
        </div>
        <button
          onClick={() => setExplainerOpen(true)}
          aria-label="How verification works"
          className="shrink-0 w-5 h-5 rounded-full border border-white/20 text-white/55 hover:text-white hover:border-white/40 transition-colors flex items-center justify-center text-[11px] font-semibold italic"
          title="How does this verification work?"
        >
          i
        </button>
      </div>
      <p className="text-white/55 text-[12px] mb-3 leading-snug">{sub}</p>

      <a href="/wheel-batches" className="text-banana hover:underline font-medium text-[11px]">
        Live feed →
      </a>

      <WheelProofExplainerModal
        open={explainerOpen}
        onClose={() => setExplainerOpen(false)}
        contractAddress={data.contractAddress}
      />
    </div>
  );
}
