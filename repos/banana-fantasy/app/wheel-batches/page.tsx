'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';

import { allKnownSegmentsById } from '@/lib/wheelConfig';

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
  /** In-round spin index — null for spins from before the VRF rounds. */
  spinIndex: number | null;
  result: string;
  timestamp: string;
}

interface FeedResponse {
  periodNumber: number | null;
  count: number;
  nextCursor: number | null;
  nextCursorTs: string | null;
  /** All-time spin count — powers the global row numbering that keeps
   *  counting up across VRF round rolls (#845, #846, …). */
  totalSpins?: number | null;
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
  // Timestamp cursor for the ALL-TIME feed (every spin since the contest
  // started — rolling to a new VRF round never hides history).
  const [nextCursorTs, setNextCursorTs] = useState<string | null>(null);
  // All-time spin total — row numbering continues across round rolls (the
  // newest spin is #totalSpins, the one below #totalSpins-1, …).
  const [totalSpins, setTotalSpins] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Every spinId ever seen in this session — dedupe source for the SSE
  // total-count increments (state updaters must stay side-effect-free).
  const seenSpinIdsRef = useRef<Set<string>>(new Set());

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

  // Initial load: the ALL-TIME feed (all rounds + pre-round spins). The SSE
  // stream below only carries the current round's head — merging the two keeps
  // the full history visible while new spins still appear instantly.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/wheel/feed?limit=${PAGE_SIZE}`, { cache: 'no-store' });
        const body = (await res.json()) as FeedResponse;
        if (cancelled || !res.ok) return;
        for (const s of body.spins) seenSpinIdsRef.current.add(s.spinId);
        setSpins((current) => {
          const seen = new Set(current.map((s) => s.spinId));
          return [...current, ...body.spins.filter((s) => !seen.has(s.spinId))];
        });
        setNextCursorTs(body.nextCursorTs);
        if (typeof body.totalSpins === 'number') setTotalSpins(body.totalSpins);
      } catch { /* SSE still populates the head; Load-older just won't appear */ }
    })();
    return () => { cancelled = true; };
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
        // SSE delivers only the CURRENT round's head — merge it on top of the
        // all-time history already loaded instead of replacing the list (the
        // replace was what made past rounds' spins vanish on a round roll).
        // Ref (not the updater) counts the never-seen spins so the global
        // numbering advances exactly once per new spin (StrictMode-safe).
        const fresh = body.spins.filter((s) => !seenSpinIdsRef.current.has(s.spinId)).length;
        for (const s of body.spins) seenSpinIdsRef.current.add(s.spinId);
        if (fresh > 0) setTotalSpins((t) => (t === null ? t : t + fresh));
        setSpins((current) => {
          const seen = new Set(body.spins.map((s) => s.spinId));
          return [...body.spins, ...current.filter((s) => !seen.has(s.spinId))];
        });
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
    if (nextCursorTs === null || loading) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/wheel/feed?limit=${PAGE_SIZE}&beforeTs=${encodeURIComponent(nextCursorTs)}`,
        { cache: 'no-store' },
      );
      const body = (await res.json()) as FeedResponse & { error?: string };
      if (!res.ok) {
        setError(body.error || `Request failed (${res.status})`);
        return;
      }
      for (const s of body.spins) seenSpinIdsRef.current.add(s.spinId);
      setSpins((current) => {
        const seen = new Set(current.map((s) => s.spinId));
        return [...current, ...body.spins.filter((s) => !seen.has(s.spinId))];
      });
      setNextCursorTs(body.nextCursorTs);
      if (typeof body.totalSpins === 'number') setTotalSpins(body.totalSpins);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [nextCursorTs, loading]);

  // Union across every wedge generation — the all-time feed spans periods
  // with different wedge sets (classic + JackHOF era).
  const segmentById = allKnownSegmentsById;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <Link href="/banana-wheel" className="text-banana hover:underline text-sm">← Banana Wheel</Link>
        <h1 className="text-[28px] font-semibold text-white tracking-tight mt-2">Public spin feed</h1>
        <p className="text-white/60 text-sm mt-1">
          Every spin on the Banana Wheel, publicly verifiable. Click any row to see the proof.
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
              All outcomes for this round were locked in by Chainlink VRF before any spin happened. Click any tx to verify it yourself — no SBS server involved.
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

          {/* Spin feed — bounded to exactly 5 rows visible at once with
              an inner scrollbar matching the Spin History sidebar (same
              dark thumb, transparent track). Header height ≈ 33px, each
              row ≈ 32px → 5 × 32 + 33 ≈ 193px. Most recent is on top
              (SSE prepends). */}
          <div className="rounded-2xl border border-white/10 bg-bg-secondary/60 backdrop-blur-md overflow-hidden">
            {spins.length === 0 && !loading && (
              <div className="p-8 text-white/40 text-sm text-center">No spins yet.</div>
            )}
            {spins.length > 0 && (
              <div className="max-h-[193px] overflow-y-auto [&::-webkit-scrollbar]:w-[10px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#3a3a3a] [&::-webkit-scrollbar-thumb]:rounded-full">
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0 z-10 bg-bg-secondary/95 backdrop-blur text-white/40 uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="text-left px-4 py-2.5">Spin</th>
                      <th className="text-left px-4 py-2.5">Result</th>
                      <th className="text-right px-4 py-2.5">Proof</th>
                    </tr>
                  </thead>
                  <tbody>
                    {spins.map((s, i) => {
                      const seg = segmentById.get(s.result);
                      // Global all-time number: newest row = #totalSpins,
                      // counting down — never resets across round rolls.
                      const globalNo = totalSpins !== null ? totalSpins - i : null;
                      return (
                        <tr key={s.spinId} className="border-t border-white/5 hover:bg-white/5">
                          <td className="px-4 py-2 text-white/60 font-mono">{globalNo !== null ? `#${globalNo}` : s.spinIndex !== null ? `#${s.spinIndex}` : '—'}</td>
                          <td className="px-4 py-2 font-semibold" style={{ color: seg?.color ?? '#fff' }}>{seg?.label ?? s.result}</td>
                          <td className="px-4 py-2 text-right">
                            {s.spinIndex !== null ? (
                              <Link href={`/spin-proof/${s.spinId}`} className="text-banana hover:underline">Verify →</Link>
                            ) : (
                              <span className="text-white/25">pre-VRF</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {nextCursorTs !== null && (
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

          {/* Assignment-batch commits — every 100 spins the wallet→
              spinIndex assignments get bundled and committed.
              Sits BELOW the live spin feed because it's a deeper-layer
              audit detail, not the primary feed. */}
          <AssignmentBatchesPanel periodNumber={period.periodNumber} />

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
    <section className="rounded-2xl border border-banana/30 bg-banana/[0.04] p-5 mt-6 mb-6 space-y-3">
      <div className="flex items-center gap-2">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-banana animate-pulse" />
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-banana">
          Wallet assignments
        </h2>
      </div>
      <p className="text-xs text-white/60 leading-relaxed">
        Every {batchSize} spins, the wallet→spinIndex assignments are bundled into a
        Merkle root and committed. This creates a permanent, public
        record of which wallet received which outcome — anyone can independently verify
        the order is honest, with no swapping or skipping possible after the fact.
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
        <div>
          <p className="mb-1.5 text-[10px] uppercase tracking-wider text-white/40">
            Recent batch commits ({batches.length} total)
          </p>
          <div className="space-y-1.5">
            {batches.slice(0, 5).map((b) => (
              <BatchRow key={b.batchIndex} batch={b} />
            ))}
          </div>
        </div>
      )}

      {/* Sample row — shown ABOVE the 0/100 progress while no real
          batches exist yet, so users can see what one will look like
          when it lands. Hidden once real batches accumulate. */}
      {batches.length === 0 && (
        <div>
          <p className="mb-1.5 text-[10px] uppercase tracking-wider text-white/40">
            Example of what each batch commit will look like ↓
          </p>
          <BatchRow
            batch={{
              batchIndex: 0,
              fromIndex: 0,
              toIndex: 99,
              count: 100,
              root: '0xexamplerootexamplerootexamplerootexamplerootexamplerootexamplero',
              txHash: '0xexampletxhashexampletxhashexampletxhashexampletxhashexampletxha',
              committedAt: Date.now(),
            }}
            isExample
          />
        </div>
      )}

      {!contractAddress && (
        <p className="text-[11px] text-white/40">
          (Assignment-journal contract not yet deployed — journal entries are being
          written; commits will appear here once the contract is live.)
        </p>
      )}
    </section>
  );
}

/**
 * One assignment-batch row. Renders the batch index + spin range, the
 * timestamp in user-local time, and a prominent "Verify on BaseScan"
 * button — same visual weight as the spin feed's "Verify →" link so
 * users see this is the audit hook for each batch.
 *
 * When `isExample` is true, the row dims itself + labels the button as
 * a sample so users understand they're looking at a preview, not a
 * real on-chain commit.
 */
function BatchRow({
  batch,
  isExample,
}: {
  batch: AssignmentBatch;
  isExample?: boolean;
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md px-3 py-2 text-[11px] ${
        isExample ? 'bg-white/[0.02] border border-dashed border-white/10' : 'bg-white/[0.03]'
      }`}
    >
      <span className={isExample ? 'text-white/45 font-semibold' : 'text-white/85 font-semibold'}>
        Batch #{batch.batchIndex}
      </span>
      <span className="text-white/45">
        spins #{batch.fromIndex.toLocaleString()}–{batch.toIndex.toLocaleString()} ({batch.count})
      </span>
      <span className="text-white/35 text-[10px]" title={new Date(batch.committedAt).toLocaleString()}>
        {isExample ? 'just now' : formatBatchTime(batch.committedAt)}
      </span>
      {isExample ? (
        <span className="ml-auto inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-0.5 text-[10px] text-white/40 italic">
          example — no real tx
        </span>
      ) : (
        <a
          href={BASESCAN_TX(batch.txHash)}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-banana/30 bg-banana/[0.06] px-2 py-0.5 text-[10px] font-semibold text-banana hover:bg-banana/[0.12] hover:border-banana/60 transition-colors"
          title={`Verify batch ${batch.batchIndex}`}
        >
          Verify ↗
        </a>
      )}
    </div>
  );
}

function formatBatchTime(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return `${Math.max(1, Math.round(diff / 1000))}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
