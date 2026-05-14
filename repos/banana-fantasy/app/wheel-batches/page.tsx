'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { wheelSegments } from '@/lib/wheelConfig';

interface PeriodSummary {
  periodNumber: number;
  status: 'requested' | 'fulfilled' | 'active' | 'closed' | 'revealed';
  spinCount: number;
  maxSpins: number;
  merkleRoot: string | null;
}

interface BatchSpin {
  spinId: string;
  spinIndex: number;
  result: string;
  timestamp: string;
}

interface BatchData {
  periodNumber: number;
  batchIndex: number;
  startIndex: number;
  endIndex: number;
  count: number;
  complete: boolean;
  spins: BatchSpin[];
}

/**
 * Public receipt feed: every 100 spins forms a "batch receipt" page that
 * anyone (auditors, journalists, suspicious users) can scroll through to
 * verify all spins match the on-chain Merkle root committed at period
 * open. The data is the same data the per-user /spin-proof page shows
 * — this just groups it for public consumption.
 */
export default function WheelBatchesPage() {
  const [period, setPeriod] = useState<PeriodSummary | null>(null);
  const [batchIndex, setBatchIndex] = useState(0);
  const [batch, setBatch] = useState<BatchData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadPeriod() {
      try {
        const res = await fetch('/api/wheel/period', { cache: 'no-store' });
        const body = (await res.json()) as { period: PeriodSummary | null };
        setPeriod(body.period);
        // Default to the most recent complete batch (or batch 0 if none).
        if (body.period) {
          const latestCompleteBatch = Math.max(0, Math.floor(body.period.spinCount / 100) - (body.period.spinCount % 100 === 0 ? 1 : 0));
          setBatchIndex(latestCompleteBatch);
        }
      } catch (err) {
        setError((err as Error).message);
      }
    }
    loadPeriod();
  }, []);

  useEffect(() => {
    if (!period) return;
    const periodNumber = period.periodNumber;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/wheel/batches?period=${periodNumber}&batchIndex=${batchIndex}`, { cache: 'no-store' });
        const body = (await res.json()) as BatchData & { error?: string };
        if (!res.ok) {
          setError(body.error || `Request failed (${res.status})`);
          return;
        }
        if (!cancelled) setBatch(body);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [period, batchIndex]);

  const segmentById = new Map(wheelSegments.map((s) => [s.id, s]));
  const totalBatches = period ? Math.ceil(period.spinCount / 100) : 0;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-8">
        <Link href="/banana-wheel" className="text-banana hover:underline text-sm">← Banana Wheel</Link>
        <h1 className="text-[28px] font-semibold text-white tracking-tight mt-2">Public spin receipts</h1>
        <p className="text-white/60 text-sm mt-1">Every 100 spins, a public receipt batch goes up. Anyone can verify any spin against the on-chain Merkle root committed when the period opened.</p>
      </div>

      {!period && !error && <div className="text-white/40 text-sm">Loading…</div>}
      {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-300 text-sm">{error}</div>}

      {period && (
        <>
          <div className="rounded-2xl border border-white/10 bg-bg-secondary/80 backdrop-blur-md p-5 mb-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-white/40 text-[11px] uppercase tracking-wider">Current period</div>
                <div className="text-white text-xl font-semibold mt-1">Period #{period.periodNumber}</div>
                <div className="text-white/50 text-[12px] mt-1">{period.spinCount.toLocaleString()} / {period.maxSpins.toLocaleString()} spins · {totalBatches} {totalBatches === 1 ? 'receipt' : 'receipts'} so far</div>
              </div>
              <div className="text-[11px] text-white/40 font-mono break-all max-w-[300px] text-right">
                <div className="text-white/30 uppercase tracking-wider mb-1">Merkle root</div>
                {period.merkleRoot ? `${period.merkleRoot.slice(0, 14)}…${period.merkleRoot.slice(-8)}` : 'pending'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <button
              disabled={batchIndex === 0}
              onClick={() => setBatchIndex((i) => Math.max(0, i - 1))}
              className="px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 disabled:opacity-30 text-white/80 text-[12px] font-semibold"
            >
              ← Older
            </button>
            <span className="text-white/60 text-[12px]">
              Batch #{batchIndex + 1} · spins {batchIndex * 100} – {batchIndex * 100 + 99}
            </span>
            <button
              disabled={batchIndex >= totalBatches - 1}
              onClick={() => setBatchIndex((i) => Math.min(totalBatches - 1, i + 1))}
              className="px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 disabled:opacity-30 text-white/80 text-[12px] font-semibold"
            >
              Newer →
            </button>
          </div>

          <div className="rounded-2xl border border-white/10 bg-bg-secondary/60 backdrop-blur-md overflow-hidden">
            {loading && <div className="p-6 text-white/40 text-sm">Loading batch…</div>}
            {!loading && batch && batch.spins.length === 0 && (
              <div className="p-6 text-white/40 text-sm">No spins yet in this batch.</div>
            )}
            {!loading && batch && batch.spins.length > 0 && (
              <table className="w-full text-[12px]">
                <thead className="bg-white/5 text-white/40 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="text-left px-4 py-2.5">#</th>
                    <th className="text-left px-4 py-2.5">Result</th>
                    <th className="text-left px-4 py-2.5">Time</th>
                    <th className="text-right px-4 py-2.5">Proof</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.spins.map((s) => {
                    const seg = segmentById.get(s.result);
                    return (
                      <tr key={s.spinId} className="border-t border-white/5 hover:bg-white/5">
                        <td className="px-4 py-2 text-white/60 font-mono">{s.spinIndex}</td>
                        <td className="px-4 py-2 font-semibold" style={{ color: seg?.color ?? '#fff' }}>{seg?.label ?? s.result}</td>
                        <td className="px-4 py-2 text-white/50">{new Date(s.timestamp).toLocaleString()}</td>
                        <td className="px-4 py-2 text-right">
                          <Link href={`/spin-proof/${s.spinId}`} className="text-banana hover:underline">Verify →</Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
