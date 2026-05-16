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

function shortHex(h: string | null | undefined, chars = 4): string {
  if (!h) return '—';
  return `${h.slice(0, 2 + chars)}…${h.slice(-chars)}`;
}

/**
 * Compact verification card. Lives in the right column of /banana-wheel
 * (above Spin History). Communicates "this wheel is provably fair" in
 * a few words; expand for the full chain-of-custody detail. Hidden when
 * no period exists.
 */
export function WheelProofBanner() {
  const [data, setData] = useState<ResponseData | null>(null);
  const [open, setOpen] = useState(false);
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
    ? 'Every spin verified by Chainlink VRF on Base.'
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

      <div className="flex items-center justify-between text-[11px]">
        <a href="/wheel-batches" className="text-banana hover:underline font-medium">
          Live feed →
        </a>
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-white/55 hover:text-white"
        >
          {open ? 'Hide' : 'Details'}
        </button>
      </div>

      {open && (
        <div className="mt-3 pt-3 border-t border-white/10 space-y-1.5 text-[11px]">
          <Row label="Status" value={p.status} />
          <Row label="Progress" value={`${p.spinCount.toLocaleString()} / ${p.maxSpins.toLocaleString()} spins`} />
          <Row label="Salt hash" value={shortHex(p.saltHash)} />
          <Row label="Merkle root" value={shortHex(p.merkleRoot)} />
          <Row label="VRF" value={shortHex(p.vrfRandomness)} />
          <Row label="Salt" value={p.salt ? shortHex(p.salt) : 'sealed'} />
          {data.contractAddress && (
            <Row
              label="Contract"
              value={(
                <a
                  href={`https://basescan.org/address/${data.contractAddress}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-banana hover:underline"
                >
                  {shortHex(data.contractAddress, 3)}
                </a>
              )}
            />
          )}
          {p.commitTxHash && (
            <Row
              label="Commit"
              value={(
                <a
                  href={`https://basescan.org/tx/${p.commitTxHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-banana hover:underline"
                >
                  {shortHex(p.commitTxHash, 3)}
                </a>
              )}
            />
          )}
          {p.rootCommitTxHash && (
            <Row
              label="Root"
              value={(
                <a
                  href={`https://basescan.org/tx/${p.rootCommitTxHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-banana hover:underline"
                >
                  {shortHex(p.rootCommitTxHash, 3)}
                </a>
              )}
            />
          )}
        </div>
      )}
      <WheelProofExplainerModal
        open={explainerOpen}
        onClose={() => setExplainerOpen(false)}
        contractAddress={data.contractAddress}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center gap-2">
      <span className="text-white/40">{label}</span>
      <span className="text-white/80 font-mono">{value}</span>
    </div>
  );
}
