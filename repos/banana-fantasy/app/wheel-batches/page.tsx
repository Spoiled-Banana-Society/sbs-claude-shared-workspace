'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

import { wheelSegments } from '@/lib/wheelConfig';

interface PeriodSummary {
  periodNumber: number;
  status: 'requested' | 'fulfilled' | 'active' | 'closed' | 'revealed';
  spinCount: number;
  maxSpins: number;
  merkleRoot: string | null;
}

interface FeedSpin {
  spinId: string;
  spinIndex: number;
  result: string;
  timestamp: string;
}

interface FeedResponse {
  periodNumber: number;
  count: number;
  nextCursor: number | null;
  spins: FeedSpin[];
}

const PAGE_SIZE = 50;

/**
 * Public live feed of wheel spins. Every spin is independently verifiable
 * via its Merkle proof against the on-chain root committed at round open.
 * Newest spins appear at the top; auto-refreshes every 15s; scroll to
 * load older spins.
 */
export default function WheelBatchesPage() {
  const [period, setPeriod] = useState<PeriodSummary | null>(null);
  const [spins, setSpins] = useState<FeedSpin[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load current period state for the header card.
  useEffect(() => {
    async function loadPeriod() {
      try {
        const res = await fetch('/api/wheel/period', { cache: 'no-store' });
        const body = (await res.json()) as { period: PeriodSummary | null };
        setPeriod(body.period);
      } catch (err) {
        setError((err as Error).message);
      }
    }
    loadPeriod();
    const id = setInterval(loadPeriod, 30_000);
    return () => clearInterval(id);
  }, []);

  // Live spin feed via SSE — server pushes the moment a spin completes
  // (wheel_periods/{N}.spinCount increments). Pagination still uses the
  // REST endpoint for "load older spins" since SSE only streams the head.
  // The stream auto-closes after ~55s; we transparently reconnect.
  useEffect(() => {
    if (!period) return;
    let cancelled = false;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const applyPayload = (raw: string) => {
      try {
        const body = JSON.parse(raw) as { spins: FeedSpin[] };
        setSpins(body.spins);
        // SSE only delivers the head — pagination cursor needs PAGE_SIZE-level
        // resolution. Use null when we have less than PAGE_SIZE; otherwise
        // last index lets users keep paginating back via the REST endpoint.
        setNextCursor(body.spins.length === PAGE_SIZE ? body.spins[body.spins.length - 1].spinIndex : null);
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    };

    const connect = () => {
      if (cancelled) return;
      es = new EventSource(`/api/wheel/feed/stream?period=${period.periodNumber}`);
      es.addEventListener('snapshot', (ev) => applyPayload((ev as MessageEvent).data));
      es.addEventListener('update', (ev) => applyPayload((ev as MessageEvent).data));
      es.onerror = () => {
        try { es?.close(); } catch { /* ignore */ }
        if (cancelled) return;
        reconnectTimer = setTimeout(connect, 1500);
      };
    };

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try { es?.close(); } catch { /* ignore */ }
    };
  }, [period]);

  const loadMore = useCallback(async () => {
    if (!period || nextCursor === null || loading) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/wheel/feed?period=${period.periodNumber}&limit=${PAGE_SIZE}&before=${nextCursor}`,
        { cache: 'no-store' },
      );
      const body = (await res.json()) as FeedResponse & { error?: string };
      if (!res.ok) {
        setError(body.error || `Request failed (${res.status})`);
        return;
      }
      setSpins((current) => [...current, ...body.spins]);
      setNextCursor(body.nextCursor);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [period, nextCursor, loading]);

  const segmentById = new Map(wheelSegments.map((s) => [s.id, s]));

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-8">
        <Link href="/banana-wheel" className="text-banana hover:underline text-sm">← Banana Wheel</Link>
        <h1 className="text-[28px] font-semibold text-white tracking-tight mt-2">Public spin feed</h1>
        <p className="text-white/60 text-sm mt-1">
          Every spin on the Banana Wheel, publicly verifiable. Click any row to see the cryptographic proof.
        </p>
      </div>

      {!period && !error && <div className="text-white/40 text-sm">Loading…</div>}
      {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-300 text-sm">{error}</div>}

      {period && (
        <>
          <div className="rounded-2xl border border-white/10 bg-bg-secondary/80 backdrop-blur-md p-5 mb-6">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <div className="text-white/40 text-[11px] uppercase tracking-wider">Verification active</div>
                <div className="text-white text-xl font-semibold mt-1">{period.spinCount.toLocaleString()} spins committed</div>
                <div className="text-white/50 text-[12px] mt-1">
                  Chainlink VRF + on-chain Merkle root · all outcomes locked before any spin
                </div>
              </div>
              <div className="text-[11px] text-white/40 font-mono break-all max-w-[300px] text-right">
                <div className="text-white/30 uppercase tracking-wider mb-1">Merkle root</div>
                {period.merkleRoot ? `${period.merkleRoot.slice(0, 14)}…${period.merkleRoot.slice(-8)}` : 'pending'}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-bg-secondary/60 backdrop-blur-md overflow-hidden">
            {spins.length === 0 && !loading && (
              <div className="p-8 text-white/40 text-sm text-center">No spins yet.</div>
            )}
            {spins.length > 0 && (
              <table className="w-full text-[12px]">
                <thead className="bg-white/5 text-white/40 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="text-left px-4 py-2.5">Spin</th>
                    <th className="text-left px-4 py-2.5">Result</th>
                    <th className="text-left px-4 py-2.5">Time</th>
                    <th className="text-right px-4 py-2.5">Proof</th>
                  </tr>
                </thead>
                <tbody>
                  {spins.map((s) => {
                    const seg = segmentById.get(s.result);
                    return (
                      <tr key={s.spinId} className="border-t border-white/5 hover:bg-white/5">
                        <td className="px-4 py-2 text-white/60 font-mono">#{s.spinIndex}</td>
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
            {nextCursor !== null && (
              <div className="border-t border-white/5 p-3 text-center">
                <button
                  onClick={loadMore}
                  disabled={loading}
                  className="text-banana hover:underline text-[12px] font-semibold disabled:opacity-50"
                >
                  {loading ? 'Loading…' : 'Load older spins'}
                </button>
              </div>
            )}
          </div>

          <p className="text-white/35 text-[11px] mt-4 text-center">
            Live — new spins appear the moment they happen. Verify any spin independently — no SBS trust required.
          </p>
        </>
      )}
    </div>
  );
}
