'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

interface FeedDraft {
  draftId: string;
  draftNumber: number;
  level: 'Jackpot' | 'Hall of Fame' | 'Pro' | null;
  displayName: string;
  speed: 'fast' | 'slow';
  draw?: {
    winnerName: string | null;
    paidCount: number;
    reward: number;
    receiptTxHash: string | null;
    vrfPeriod: number | null;
  } | null;
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

const LEVEL_COLORS: Record<string, { color: string; label: string }> = {
  Jackpot: { color: '#ef4444', label: 'JACKPOT' },
  'Hall of Fame': { color: '#D4AF37', label: 'HOF' },
  Pro: { color: '#a855f7', label: 'PRO' },
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
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <Link href="/drafting" className="text-banana hover:underline text-sm">← Drafting</Link>
        <h1 className="text-[28px] font-semibold text-white tracking-tight mt-2">Public draft feed</h1>
        <p className="text-white/60 text-sm mt-1">
          Every draft on Banana Best Ball, publicly verifiable. Click any row to see the cryptographic proof.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-300 text-sm mb-6">{error}</div>
      )}

      {round && (
        <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.04] p-5 mb-6 space-y-3">
          <div className="flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
              On-chain commit · live
            </h2>
          </div>
          <p className="text-xs text-white/60 leading-relaxed">
            All draft types for the upcoming round were locked on Base mainnet before any draft happened. Click any tx to verify on BaseScan — no SBS server involved.
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
          <p className="text-[11px] text-white/40">
            {drafts.length.toLocaleString()} draft{drafts.length === 1 ? '' : 's'} verified against the root above.
          </p>
        </section>
      )}

      <div className="rounded-2xl border border-white/10 bg-bg-secondary/60 backdrop-blur-md overflow-hidden">
        {loading && drafts.length === 0 && (
          <div className="p-8 text-white/40 text-sm text-center">Loading…</div>
        )}
        {!loading && drafts.length === 0 && !error && (
          <div className="p-8 text-white/40 text-sm text-center">No drafts have filled yet.</div>
        )}
        {drafts.length > 0 && (
          <table className="w-full text-[12px]">
            <thead className="bg-white/5 text-white/40 uppercase tracking-wider text-[10px]">
              <tr>
                <th className="text-left px-4 py-2.5">League</th>
                <th className="text-left px-4 py-2.5">Type</th>
                <th className="text-right px-4 py-2.5">Proof</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((d) => {
                const level = d.level ?? 'Pro';
                const colors = LEVEL_COLORS[level];
                return (
                  <React.Fragment key={d.draftId}>
                    <tr className="border-t border-white/5 hover:bg-white/5">
                      <td className="px-4 py-2 text-white/80 font-mono">#{d.draftNumber}</td>
                      <td className="px-4 py-2 font-semibold" style={{ color: colors.color }}>{colors.label}</td>
                      <td className="px-4 py-2 text-right">
                        <Link href={`/proof/${d.draftId}`} className="text-banana hover:underline">Verify →</Link>
                      </td>
                    </tr>
                    {d.draw && (
                      <tr className="border-t border-white/5 bg-white/[0.02]">
                        <td colSpan={3} className="px-4 py-1.5 text-[11px] text-white/55">
                          <span style={{ color: '#ef4444' }} className="font-semibold">Spin Draw</span>
                          {' · '}{d.draw.reward}-Spin Draw among {d.draw.paidCount} paid {d.draw.paidCount === 1 ? 'entry' : 'entries'}
                          {d.draw.winnerName ? <> · won by <span className="text-white/80">{d.draw.winnerName}</span></> : null}
                          {d.draw.receiptTxHash && (
                            <>
                              {' · '}
                              <a
                                href={BASESCAN_TX(d.draw.receiptTxHash)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-banana hover:underline"
                              >
                                On-chain receipt →
                              </a>
                            </>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
