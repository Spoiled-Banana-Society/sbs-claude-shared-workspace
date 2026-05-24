'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

import { wheelSegments } from '@/lib/wheelConfig';

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

interface PeriodResponse {
  active: boolean;
  period: PeriodSummary | null;
  contractAddress: string | null;
}

const BASESCAN_TX = (h: string) => `https://basescan.org/tx/${h.startsWith('0x') ? h : '0x' + h}`;
const BASESCAN_ADDRESS = (a: string) => `https://basescan.org/address/${a}`;

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
  const [contractAddress, setContractAddress] = useState<string | null>(null);
  const [spins, setSpins] = useState<FeedSpin[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load current period state for the header card.
  useEffect(() => {
    async function loadPeriod() {
      try {
        const res = await fetch('/api/wheel/period', { cache: 'no-store' });
        const body = (await res.json()) as PeriodResponse;
        setPeriod(body.period);
        setContractAddress(body.contractAddress);
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
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
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
          <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.04] p-5 mb-6 space-y-3">
            <div className="flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
                On-chain commit · live
              </h2>
            </div>
            <p className="text-xs text-white/60 leading-relaxed">
              All outcomes for this round were locked on Base mainnet before any spin happened. Click any tx to verify on BaseScan — no SBS server involved.
            </p>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-xs">
              {period.merkleRoot && (
                <>
                  <dt className="text-white/50">Merkle root</dt>
                  <dd className="font-mono text-white break-all">{period.merkleRoot}</dd>
                </>
              )}
              {period.rootCommitTxHash && (
                <>
                  <dt className="text-white/50">Root commit tx</dt>
                  <dd className="font-mono break-all">
                    <a href={BASESCAN_TX(period.rootCommitTxHash)} target="_blank" rel="noreferrer" className="text-blue-300 hover:text-blue-200 underline">
                      {period.rootCommitTxHash}
                    </a>
                  </dd>
                </>
              )}
              {period.commitTxHash && (
                <>
                  <dt className="text-white/50">Chainlink VRF request tx</dt>
                  <dd className="font-mono break-all">
                    <a href={BASESCAN_TX(period.commitTxHash)} target="_blank" rel="noreferrer" className="text-blue-300 hover:text-blue-200 underline">
                      {period.commitTxHash}
                    </a>
                  </dd>
                </>
              )}
              {period.saltHash && (
                <>
                  <dt className="text-white/50">Salt hash {period.salt ? '' : '(sealed)'}</dt>
                  <dd className="font-mono text-white break-all">{period.saltHash}</dd>
                </>
              )}
              {period.vrfRandomness && (
                <>
                  <dt className="text-white/50">VRF randomness</dt>
                  <dd className="font-mono text-white break-all">{period.vrfRandomness}</dd>
                </>
              )}
              {period.revealTxHash && (
                <>
                  <dt className="text-white/50">Salt reveal tx</dt>
                  <dd className="font-mono break-all">
                    <a href={BASESCAN_TX(period.revealTxHash)} target="_blank" rel="noreferrer" className="text-blue-300 hover:text-blue-200 underline">
                      {period.revealTxHash}
                    </a>
                  </dd>
                </>
              )}
              {contractAddress && (
                <>
                  <dt className="text-white/50">Contract</dt>
                  <dd className="font-mono break-all">
                    <a href={BASESCAN_ADDRESS(contractAddress)} target="_blank" rel="noreferrer" className="text-blue-300 hover:text-blue-200 underline">
                      {contractAddress}
                    </a>
                  </dd>
                </>
              )}
            </dl>
            <p className="text-[11px] text-white/40">
              {period.spinCount.toLocaleString()} spin{period.spinCount === 1 ? '' : 's'} confirmed against the root above.
            </p>
          </section>

          {/* NEW: assignment-batch commits for this period — every 100
              spins, the wallet→spinIndex assignments get bundled and
              committed on-chain so the ORDER can't be quietly rewritten. */}
          <AssignmentBatchesPanel periodNumber={period.periodNumber} />

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

        </>
      )}
    </div>
  );
}

/* ───────────────────────────────────────── Assignment batches panel */

interface AssignmentBatch {
  batchIndex: number;
  fromIndex: number;
  toIndex: number;
  count: number;
  root: string;
  txHash: string;
  committedAt: number;
}

interface AssignmentsResponse {
  ok: true;
  periodNumber: number;
  batchSize: number;
  contractAddress: string | null;
  status: {
    totalBatchesCommitted: number;
    highestEntryIndex: number;
    unbatchedEntryCount: number;
  };
  batches: AssignmentBatch[];
}

function AssignmentBatchesPanel({ periodNumber }: { periodNumber: number }) {
  const [data, setData] = useState<AssignmentsResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/wheel/assignments/${periodNumber}?limit=1`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const body = (await res.json()) as AssignmentsResponse;
        if (!cancelled) setData(body);
      } catch {
        // silent — section is informational; main feed below still works
      }
    }
    load();
    const id = setInterval(load, 20_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [periodNumber]);

  if (!data) return null;
  const { batches, status, batchSize, contractAddress } = data;
  const nextBatchProgress = status.unbatchedEntryCount;

  return (
    <section className="rounded-2xl border border-banana/30 bg-banana/[0.04] p-5 mb-6 space-y-3">
      <div className="flex items-center gap-2">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-banana animate-pulse" />
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-banana">
          Wallet assignments · on-chain
        </h2>
      </div>
      <p className="text-xs text-white/60 leading-relaxed">
        Even though SBS knows the outcomes after Chainlink rolls, we can&apos;t quietly hand
        wins to specific wallets. Every {batchSize} spins, the on-chain log records which
        wallet got which spinIndex — skipping or reordering would be cryptographically
        visible to anyone watching.
      </p>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md bg-white/[0.04] py-2 px-1">
          <p className="text-[10px] uppercase tracking-wider text-white/40">Batches</p>
          <p className="mt-0.5 font-semibold text-white">{status.totalBatchesCommitted}</p>
        </div>
        <div className="rounded-md bg-white/[0.04] py-2 px-1">
          <p className="text-[10px] uppercase tracking-wider text-white/40">Spins locked</p>
          <p className="mt-0.5 font-semibold text-white">
            {(status.totalBatchesCommitted * batchSize).toLocaleString()}
          </p>
        </div>
        <div className="rounded-md bg-white/[0.04] py-2 px-1">
          <p className="text-[10px] uppercase tracking-wider text-white/40">Next batch</p>
          <p className="mt-0.5 font-semibold text-white">
            {nextBatchProgress}/{batchSize}
          </p>
        </div>
      </div>

      {batches.length > 0 && (
        <div className="space-y-1.5">
          {batches.slice(0, 5).map((b) => (
            <div
              key={b.batchIndex}
              className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md bg-white/[0.03] px-3 py-1.5 text-[11px]"
            >
              <span className="text-white/85 font-semibold">Batch #{b.batchIndex}</span>
              <span className="text-white/45">
                spins #{b.fromIndex.toLocaleString()}–{b.toIndex.toLocaleString()} ({b.count})
              </span>
              <a
                href={BASESCAN_TX(b.txHash)}
                target="_blank"
                rel="noreferrer"
                className="ml-auto text-blue-300 hover:text-blue-200 underline font-mono"
              >
                {b.txHash.slice(0, 8)}…{b.txHash.slice(-4)}
              </a>
            </div>
          ))}
        </div>
      )}

      {!contractAddress && (
        <p className="text-[11px] text-white/40">
          (Assignment-journal contract not yet deployed — journal entries are being
          written; on-chain commits will backfill once Boris flips the contract address.)
        </p>
      )}
    </section>
  );
}
