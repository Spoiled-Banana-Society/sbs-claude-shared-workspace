'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

/**
 * ProofFeedLive — the real-time public draft feed (round on-chain commit +
 * the verified-draft table). Streams via SSE (`/api/drafts/proof-feed/stream`)
 * and reconnects transparently, exactly as the /proof-feed page always did.
 *
 * Extracted from app/proof-feed/page.tsx so the SAME live feed renders both on
 * the standalone page AND inside the "Verified Fair" info tab — one source of
 * truth, identical real-time behavior in both places.
 */

interface FeedDraft {
  draftId: string;
  draftNumber: number;
  level: 'Jackpot' | 'Hall of Fame' | 'JackHOF' | 'Pro' | null;
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

interface LaneEraSummary {
  era: number;
  merkleRoot: string | null;
  commitTxHash: string | null;
  rootCommitTxHash: string | null;
  status: string | null;
}

interface FeedResponse {
  drafts: FeedDraft[];
  round: RoundSummary | null;
  /** Rolling era (drafts 201+): each lane's current sealed-era commitment. */
  lanes?: { jp: LaneEraSummary | null; hof: LaneEraSummary | null } | null;
}

const BASESCAN_TX = (h: string) => `https://basescan.org/tx/${h.startsWith('0x') ? h : '0x' + h}`;

const LEVEL_COLORS: Record<string, { color: string; label: string }> = {
  Jackpot: { color: '#ef4444', label: 'JACKPOT' },
  'Hall of Fame': { color: '#D4AF37', label: 'HOF' },
  JackHOF: { color: '#ef6c37', label: 'JACKHOF' },
  Pro: { color: '#a855f7', label: 'PRO' },
};

export function ProofFeedLive() {
  const [drafts, setDrafts] = useState<FeedDraft[]>([]);
  const [round, setRound] = useState<RoundSummary | null>(null);
  const [lanes, setLanes] = useState<FeedResponse['lanes']>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Live feed via SSE — server pushes whenever drafts/draftTracker updates
  // (i.e. the moment a slot machine reveals a draft type). The stream
  // auto-closes after ~55s; we transparently reconnect.
  useEffect(() => {
    let cancelled = false;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const applyPayload = (raw: string) => {
      try {
        const body = JSON.parse(raw) as FeedResponse;
        setDrafts(body.drafts);
        setRound(body.round);
        setLanes(body.lanes ?? null);
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
    <>
      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-300 text-sm mb-6">{error}</div>
      )}

      {(lanes?.jp || lanes?.hof) && (
        <section className="rounded-2xl border border-banana/30 bg-banana/[0.04] p-5 mb-6 space-y-3">
          <div className="flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-banana animate-pulse" />
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-banana">
              Rolling windows sealed · live
            </h2>
          </div>
          <p className="text-xs text-white/60 leading-relaxed">
            Every future Jackpot and Hall of Fame hit is already locked in by Chainlink VRF —
            ~150 windows (≈10,000+ drafts) per lane, sealed under one on-chain Merkle root each.
            The Jackpot window resets the draft after each hit; HOF resets after its 5th. Each
            completed window publishes its positions with a Merkle proof you can check yourself.
          </p>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-xs">
            {(['jp', 'hof'] as const).map((k) => {
              const l = lanes?.[k];
              if (!l) return null;
              return (
                <React.Fragment key={k}>
                  <dt className="text-white/50">{k === 'jp' ? 'Jackpot lane root' : 'HOF lane root'}</dt>
                  <dd className="font-mono break-all">
                    {l.rootCommitTxHash ? (
                      <a href={BASESCAN_TX(l.rootCommitTxHash)} target="_blank" rel="noreferrer" className="text-blue-300 hover:text-blue-200 underline">
                        {l.merkleRoot ?? l.rootCommitTxHash}
                      </a>
                    ) : (
                      <span className="text-white">{l.merkleRoot ?? '(sealing…)'}</span>
                    )}
                  </dd>
                </React.Fragment>
              );
            })}
          </dl>
        </section>
      )}

      {round && (
        <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.04] p-5 mb-6 space-y-3">
          <div className="flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
              Round locked · live
            </h2>
          </div>
          <p className="text-xs text-white/60 leading-relaxed">
            All draft types for the upcoming round were locked in by Chainlink VRF before any draft happened. Click any tx to verify it yourself — no SBS server involved.
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
                                Receipt →
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
    </>
  );
}
