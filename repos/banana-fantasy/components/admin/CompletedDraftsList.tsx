'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { usePrivy } from '@privy-io/react-auth';

// Shows recently completed drafts in /admin → Drafts tab. Pulls from
// the same /api/spectate/active-drafts endpoint that powers the Spectate
// tab, just reading the `completed` slice instead of `active`.

interface CompletedDraft {
  draftId: string;
  displayName: string;
  speed: 'fast' | 'slow';
  level: string | null;
  pickNumber: number;
  currentDrafter: string;
  filling: boolean;
  /** When the draft started (Unix seconds). 0 if unknown. */
  draftStartTime?: number;
}

const REFRESH_INTERVAL_MS = 10000;

// "Jun 27, 2026 · 8:34 PM" — or em-dash when no start time is recorded.
function formatDrafted(unixSeconds?: number): string {
  if (!unixSeconds) return '—';
  const d = new Date(unixSeconds * 1000);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function levelPillStyle(level: string | null): { bg: string; color: string; label: string } {
  if (!level) return { bg: '#a855f7', color: '#fff', label: 'PRO' };
  const l = level.toLowerCase();
  if (l.includes('jackpot')) return { bg: '#ef4444', color: '#fff', label: 'JP' };
  if (l.includes('hall of fame') || l === 'hof') return { bg: '#D4AF37', color: '#000', label: 'HOF' };
  return { bg: '#a855f7', color: '#fff', label: 'PRO' };
}

export function CompletedDraftsList({ enabled }: { enabled: boolean }) {
  const { walletAddress } = useAuth();
  const { getAccessToken } = usePrivy();
  const [drafts, setDrafts] = useState<CompletedDraft[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'fast' | 'slow' | 'jackpot' | 'hof'>('all');

  // Ref getAccessToken so the polling effect deps stay scalar-only.
  // See [[render-loop-self-ddos]].
  const getAccessTokenRef = useRef(getAccessToken);
  useEffect(() => { getAccessTokenRef.current = getAccessToken; }, [getAccessToken]);

  useEffect(() => {
    if (!enabled || !walletAddress) return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        setLoading(true);
        const token = await getAccessTokenRef.current();
        const res = await fetch('/api/spectate/active-drafts', {
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = (await res.json()) as { completed?: CompletedDraft[] };
        if (!cancelled) {
          setDrafts(data.completed ?? []);
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
  }, [enabled, walletAddress]);

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
          {loading && drafts === null ? 'Loading completed drafts…' : `${filtered.length} completed draft${filtered.length === 1 ? '' : 's'}`}
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

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-left text-sm min-w-[760px]">
          <thead className="bg-white/[0.03] text-[11px] uppercase text-gray-500 tracking-wider">
            <tr>
              <th className="px-4 py-3 font-medium">Draft</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Speed</th>
              <th className="px-4 py-3 font-medium">Drafted</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">View</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                  No completed drafts.
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
                  <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{formatDrafted(d.draftStartTime)}</td>
                  <td className="px-4 py-3 text-green-400">Completed</td>
                  <td className="px-4 py-3 text-right">
                    <a
                      href={`/spectate/${d.draftId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center px-3 py-1 rounded-md bg-white/5 hover:bg-white/10 text-xs font-medium transition"
                    >
                      View ↗
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      <p className="text-[11px] text-gray-500">
        Refreshes every {REFRESH_INTERVAL_MS / 1000}s. Drafts move here automatically once all 150 picks land.
      </p>
    </div>
  );
}
