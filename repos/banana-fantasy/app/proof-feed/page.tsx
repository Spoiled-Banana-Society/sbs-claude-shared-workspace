'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatLeagueName } from '@/lib/formatters';

interface FeedDraft {
  draftId: string;
  draftNumber: number;
  level: 'Jackpot' | 'Hall of Fame' | 'Pro' | null;
  displayName: string;
  speed: 'fast' | 'slow';
}

interface RoundSummary {
  roundNumber: number;
  status: string;
  merkleRoot: string | null;
  merkleRootTxHash: string | null;
  commitTxHashVrf: string | null;
}

interface FeedResponse {
  drafts: FeedDraft[];
  round: RoundSummary | null;
}

const BASESCAN_TX = (h: string) => `https://basescan.org/tx/${h.startsWith('0x') ? h : '0x' + h}`;

const LEVEL_COLORS: Record<string, { text: string; dot: string }> = {
  Jackpot: { text: 'text-red-400', dot: 'bg-red-400' },
  'Hall of Fame': { text: 'text-hof', dot: 'bg-[#D4AF37]' },
  Pro: { text: 'text-purple-400', dot: 'bg-purple-400' },
};

/**
 * Public live feed of verified drafts. Mirrors /wheel-batches.
 * Newest league at the top; auto-refresh every 15s.
 */
export default function ProofFeedPage() {
  const [drafts, setDrafts] = useState<FeedDraft[]>([]);
  const [round, setRound] = useState<RoundSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Live feed via SSE — server pushes whenever drafts/draftTracker
  // updates (i.e. the moment a slot machine reveals a draft type). The
  // stream auto-closes after ~55s; we transparently reconnect with a
  // bumping `epoch` so EventSource cleans up its old connection.
  useEffect(() => {
    let cancelled = false;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const applyPayload = (raw: string) => {
      try {
        const body = JSON.parse(raw) as FeedResponse;
        setDrafts(body.drafts);
        setRound(body.round);
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    };

    const connect = () => {
      if (cancelled) return;
      es = new EventSource('/api/drafts/proof-feed/stream');
      es.addEventListener('snapshot', (ev) => applyPayload((ev as MessageEvent).data));
      es.addEventListener('update', (ev) => applyPayload((ev as MessageEvent).data));
      es.onerror = () => {
        // SSE errors on intended close + on disconnects. Either way, the
        // stream is done — reconnect after a short backoff.
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
  }, []);

  return (
    <div className="w-full px-4 sm:px-8 lg:px-12 py-8 max-w-3xl mx-auto space-y-6">
      <div>
        <Link href="/drafting" className="text-xs text-white/50 hover:text-white/80">← Back</Link>
        <h1 className="text-2xl font-semibold text-white mt-2">Verified drafts · live feed</h1>
        <p className="text-sm text-white/60 mt-1">
          Every draft below was assigned its type by Chainlink VRF before any draft filled.
          Click <span className="text-emerald-300 font-medium">Verified ✓</span> on any row to see its proof.
        </p>
      </div>

      {round && (
        <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.04] p-5 space-y-3">
          <div className="flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
              On-chain commit · live
            </h2>
          </div>
          <p className="text-xs text-white/55 leading-relaxed">
            The randomization for all upcoming drafts is committed on Base. Anyone can read it directly from the contract — no SBS server involved.
          </p>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-xs">
            {round.merkleRoot && (
              <>
                <dt className="text-white/50">Merkle root</dt>
                <dd className="font-mono text-white break-all">{round.merkleRoot}</dd>
              </>
            )}
            {round.merkleRootTxHash && (
              <>
                <dt className="text-white/50">Root commit tx</dt>
                <dd className="font-mono break-all">
                  <a href={BASESCAN_TX(round.merkleRootTxHash)} target="_blank" rel="noreferrer" className="text-blue-300 hover:text-blue-200 underline">
                    {round.merkleRootTxHash}
                  </a>
                </dd>
              </>
            )}
            {round.commitTxHashVrf && (
              <>
                <dt className="text-white/50">Chainlink VRF request tx</dt>
                <dd className="font-mono break-all">
                  <a href={BASESCAN_TX(round.commitTxHashVrf)} target="_blank" rel="noreferrer" className="text-blue-300 hover:text-blue-200 underline">
                    {round.commitTxHashVrf}
                  </a>
                </dd>
              </>
            )}
          </dl>
        </section>
      )}

      <section>
        {error && (
          <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 mb-3">{error}</p>
        )}
        {loading && drafts.length === 0 && (
          <p className="text-xs text-white/50">Loading…</p>
        )}
        {!loading && drafts.length === 0 && !error && (
          <p className="text-xs text-white/50">No drafts have filled yet.</p>
        )}
        {drafts.length > 0 && (
          <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
            {drafts.map((d) => {
              const level = d.level ?? 'Pro';
              const colors = LEVEL_COLORS[level];
              return (
                <li key={d.draftId} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors">
                  <div className="min-w-0 flex items-center gap-3">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${colors.dot}`} />
                    <span className="text-white font-medium text-sm tabular-nums shrink-0">
                      {formatLeagueName(d.draftNumber)}
                    </span>
                    <span className={`${colors.text} text-[12px] font-semibold uppercase tracking-wider`}>
                      {level}
                    </span>
                  </div>
                  <Link
                    href={`/proof/${d.draftId}`}
                    className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200 text-[11px] font-medium shrink-0"
                  >
                    Verified ✓
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
