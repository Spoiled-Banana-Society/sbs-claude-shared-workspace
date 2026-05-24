'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { usePrivy } from '@privy-io/react-auth';
import { WalletLink } from '@/components/admin/WalletLink';

interface ActiveDraft {
  draftId: string;
  displayName: string;
  speed: 'fast' | 'slow';
  level: string | null;
  pickNumber: number;
  currentDrafter: string;
  filling: boolean;
}

interface QueueRound {
  roundId: number;
  members: { wallet: string; joinedAt: number }[];
  status: 'filling' | 'ready' | 'drafting' | 'completed';
  draftId: string | null;
}

interface QueueStatus {
  type: 'jackpot' | 'hof';
  rounds: QueueRound[];
  nextRoundId: number;
}

const REFRESH_INTERVAL_MS = 5000;

function levelPillStyle(level: string | null): { bg: string; color: string; label: string } {
  if (!level) return { bg: '#a855f7', color: '#fff', label: 'PRO' };
  const l = level.toLowerCase();
  if (l.includes('jackpot')) return { bg: '#ef4444', color: '#fff', label: 'JP' };
  if (l.includes('hall of fame') || l === 'hof') return { bg: '#D4AF37', color: '#000', label: 'HOF' };
  return { bg: '#a855f7', color: '#fff', label: 'PRO' };
}

export function SpectateBrowser({ enabled }: { enabled: boolean }) {
  const { walletAddress } = useAuth();
  const { getAccessToken } = usePrivy();
  const [drafts, setDrafts] = useState<ActiveDraft[] | null>(null);
  const [queues, setQueues] = useState<Record<string, QueueStatus> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'fast' | 'slow' | 'jackpot' | 'hof'>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copySpectateLink = (draftId: string) => {
    const url = `${window.location.origin}/spectate/${draftId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(draftId);
      setTimeout(() => setCopiedId(prev => (prev === draftId ? null : prev)), 1500);
    }).catch(() => { /* clipboard blocked — silently no-op */ });
  };

  useEffect(() => {
    if (!enabled || !walletAddress) return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        setLoading(true);
        const token = await getAccessToken();
        const [activeRes, queuesRes] = await Promise.all([
          fetch('/api/spectate/active-drafts', {
            headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          }),
          fetch('/api/queues', { cache: 'no-store' }),
        ]);
        if (!activeRes.ok) throw new Error(`${activeRes.status} ${activeRes.statusText}`);
        const activeData = (await activeRes.json()) as { drafts: ActiveDraft[] };
        const queueData = queuesRes.ok ? (await queuesRes.json()) as Record<string, QueueStatus> : null;
        if (!cancelled) {
          setDrafts(activeData.drafts ?? []);
          setQueues(queueData);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'unknown error');
      } finally {
        if (!cancelled) {
          setLoading(false);
          timeoutId = setTimeout(tick, REFRESH_INTERVAL_MS);
        }
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [enabled, walletAddress, getAccessToken]);

  const filtered = (drafts ?? []).filter(d => {
    if (filter === 'all') return true;
    if (filter === 'fast' || filter === 'slow') return d.speed === filter;
    if (filter === 'jackpot') return (d.level ?? '').toLowerCase().includes('jackpot');
    if (filter === 'hof') return (d.level ?? '').toLowerCase().includes('hall of fame') || d.level === 'HOF';
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-gray-400">
          {loading && drafts === null ? 'Loading active drafts…' : `${filtered.length} active draft${filtered.length === 1 ? '' : 's'}`}
          {error && <span className="ml-2 text-red-400">last poll: {error}</span>}
        </div>
        <div className="flex items-center gap-1">
          {(['all', 'fast', 'slow', 'jackpot', 'hof'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-1 rounded text-[11px] uppercase tracking-wider transition-colors ${
                filter === f ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.03]'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {queues && (() => {
        const specialRounds = (['jackpot', 'hof'] as const)
          .flatMap(type => (queues[type]?.rounds || [])
            .filter(r => r.status !== 'completed')
            .map(r => ({ type, round: r })))
          .sort((a, b) => b.round.roundId - a.round.roundId);
        if (specialRounds.length === 0) return null;
        return (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
            <div className="px-4 py-2 bg-white/[0.03] text-[11px] uppercase tracking-wider text-gray-500 font-medium border-b border-white/[0.04]">
              Special Drafts ({specialRounds.length})
            </div>
            <div className="overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[640px]">
              <thead className="bg-white/[0.02] text-[11px] uppercase text-gray-500 tracking-wider">
                <tr>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Round</th>
                  <th className="px-4 py-3 font-medium">Members</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Watch</th>
                </tr>
              </thead>
              <tbody>
                {specialRounds.map(({ type, round }) => {
                  const pill = type === 'jackpot'
                    ? { bg: '#ef4444', color: '#fff', label: 'JP' }
                    : { bg: '#D4AF37', color: '#000', label: 'HOF' };
                  const memberCount = round.members?.length || 0;
                  const fillPct = (memberCount / 10) * 100;
                  return (
                    <tr key={`${type}-${round.roundId}`} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                      <td className="px-4 py-3">
                        <span
                          className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full font-black"
                          style={{ background: pill.bg, color: pill.color }}
                        >
                          {pill.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-300">#{round.roundId}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{ width: `${fillPct}%`, backgroundColor: pill.bg }}
                            />
                          </div>
                          <span className="text-gray-300 text-xs">{memberCount}/10</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-300 capitalize">{round.status}</td>
                      <td className="px-4 py-3 text-right">
                        {round.draftId ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              onClick={() => copySpectateLink(round.draftId!)}
                              className="inline-flex items-center px-2.5 py-1 rounded-md border border-white/15 text-white/70 text-xs font-medium hover:bg-white/[0.06] hover:text-white transition"
                              title="Copy spectator URL"
                            >
                              {copiedId === round.draftId ? '✓ Copied' : 'Copy link'}
                            </button>
                            <a
                              href={`/spectate/${round.draftId}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center px-3 py-1 rounded-md bg-banana text-black text-xs font-bold hover:brightness-110 transition"
                            >
                              Spectate ↗
                            </a>
                          </div>
                        ) : (
                          <span className="text-gray-500 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>
        );
      })()}

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-left text-sm min-w-[720px]">
          <thead className="bg-white/[0.03] text-[11px] uppercase text-gray-500 tracking-wider">
            <tr>
              <th className="px-4 py-3 font-medium">Draft</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Speed</th>
              <th className="px-4 py-3 font-medium">Pick</th>
              <th className="px-4 py-3 font-medium">On the clock</th>
              <th className="px-4 py-3 font-medium text-right">Watch</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                  No active drafts.
                </td>
              </tr>
            )}
            {filtered.map(d => {
              const pill = levelPillStyle(d.level);
              return (
                <tr key={d.draftId} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                  <td className="px-4 py-3">
                    <div className="font-medium">{d.displayName || d.draftId}</div>
                    <div className="text-[10px] text-gray-500 font-mono">{d.draftId}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full font-black"
                      style={{ background: pill.bg, color: pill.color }}
                    >
                      {pill.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-300 capitalize">{d.speed}</td>
                  <td className="px-4 py-3 text-gray-300">
                    {d.filling ? (
                      <span className="text-yellow-400">Filling</span>
                    ) : (
                      <span>P{d.pickNumber}/150</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {d.currentDrafter ? <WalletLink wallet={d.currentDrafter} /> : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        onClick={() => copySpectateLink(d.draftId)}
                        className="inline-flex items-center px-2.5 py-1 rounded-md border border-white/15 text-white/70 text-xs font-medium hover:bg-white/[0.06] hover:text-white transition"
                        title="Copy spectator URL"
                      >
                        {copiedId === d.draftId ? '✓ Copied' : 'Copy link'}
                      </button>
                      <a
                        href={`/spectate/${d.draftId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center px-3 py-1 rounded-md bg-banana text-black text-xs font-bold hover:brightness-110 transition"
                      >
                        Spectate ↗
                      </a>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      <p className="text-[11px] text-gray-500">
        Anyone with the spectator URL can watch — share freely. Refreshes every {REFRESH_INTERVAL_MS / 1000}s.
      </p>
    </div>
  );
}
