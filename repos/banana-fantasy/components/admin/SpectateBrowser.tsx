'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { usePrivy } from '@privy-io/react-auth';
import { WalletLink } from '@/components/admin/WalletLink';
import { useDraftRoomUsers } from '@/hooks/useDraftRoomUsers';
import { useAdminAuthHeaders } from '@/hooks/admin/useAdminApi';
import { bananaDefaultName } from '@/utils/helpers';

interface ActiveDraft {
  draftId: string;
  displayName: string;
  speed: 'fast' | 'slow';
  level: string | null;
  pickNumber: number;
  currentDrafter: string;
  filling: boolean;
  numPlayers?: number;
  maxPlayers?: number;
  members?: string[];
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

interface UserFlags {
  isNew: boolean;
  isReturning: boolean;
}

/** NEW (first-season account) / OLD (past-season player) chip. Returning wins
 *  if a wallet somehow carries both (the API already enforces that). */
function FlagChip({ flags }: { flags?: UserFlags }) {
  if (!flags) return null;
  if (flags.isReturning) {
    return (
      <span
        title="Returning player — matched a past-season identity"
        className="text-[9px] font-black uppercase tracking-widest px-1.5 py-px rounded-full bg-sky-400/10 text-sky-300 border border-sky-400/20"
      >
        Old
      </span>
    );
  }
  if (flags.isNew) {
    return (
      <span
        title="New user — account created in the last 7 days"
        className="text-[9px] font-black uppercase tracking-widest px-1.5 py-px rounded-full bg-emerald-400/10 text-emerald-300 border border-emerald-400/20"
      >
        New
      </span>
    );
  }
  return null;
}

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

  // One-click "+ Bot" on a filling draft. Joins one house bot (server mints a
  // fresh one behind the scenes when the pool is empty — the 409 retry). The
  // 5s poll below picks up the new member on its own.
  const getAdminHeaders = useAdminAuthHeaders();
  const [addingBotId, setAddingBotId] = useState<string | null>(null);
  const [botNote, setBotNote] = useState<string | null>(null);
  const addBot = async (d: ActiveDraft) => {
    setAddingBotId(d.draftId);
    setBotNote(null);
    try {
      const headers = { ...(await getAdminHeaders()), 'Content-Type': 'application/json' };
      const fill = () =>
        fetch('/api/admin/bots/fill', {
          method: 'POST',
          headers,
          body: JSON.stringify({ leagueId: d.draftId, count: 1, speed: d.speed }),
        });
      let res = await fill();
      if (res.status === 409) {
        const mintRes = await fetch('/api/admin/bots/mint', {
          method: 'POST',
          headers,
          body: JSON.stringify({ count: 1 }),
        });
        const mintBody = await mintRes.json().catch(() => ({}));
        if (!mintRes.ok || !mintBody.poolAdded) throw new Error(mintBody?.error || `bot mint failed (${mintRes.status})`);
        res = await fill();
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setBotNote(`Bot added to ${d.displayName || d.draftId}.`);
    } catch (e) {
      setBotNote(`Bot add failed for ${d.displayName || d.draftId}: ${(e as Error).message}`);
    } finally {
      setAddingBotId(null);
    }
  };

  // Mirror action: pull the most recently added house bot back out of a
  // filling draft (its pass returns to the pool for reuse). Server refuses
  // once the draft has filled/started, and 404s if no bots are in it.
  const [removingBotId, setRemovingBotId] = useState<string | null>(null);
  const removeBot = async (d: ActiveDraft) => {
    setRemovingBotId(d.draftId);
    setBotNote(null);
    try {
      const headers = { ...(await getAdminHeaders()), 'Content-Type': 'application/json' };
      const res = await fetch('/api/admin/bots/remove', {
        method: 'POST',
        headers,
        body: JSON.stringify({ leagueId: d.draftId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setBotNote(`Bot removed from ${d.displayName || d.draftId}.`);
    } catch (e) {
      setBotNote(`Bot remove failed for ${d.displayName || d.draftId}: ${(e as Error).message}`);
    } finally {
      setRemovingBotId(null);
    }
  };

  const copySpectateLink = (draftId: string) => {
    const url = `${window.location.origin}/spectate/${draftId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(draftId);
      setTimeout(() => setCopiedId(prev => (prev === draftId ? null : prev)), 1500);
    }).catch(() => { /* clipboard blocked — silently no-op */ });
  };

  // Ref getAccessToken so the 5s polling effect doesn't refire on every
  // Privy re-render. See [[render-loop-self-ddos]].
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
  }, [enabled, walletAddress]);

  const filtered = (drafts ?? []).filter(d => {
    if (filter === 'all') return true;
    if (filter === 'fast' || filter === 'slow') return d.speed === filter;
    if (filter === 'jackpot') return (d.level ?? '').toLowerCase().includes('jackpot');
    if (filter === 'hof') return (d.level ?? '').toLowerCase().includes('hall of fame') || d.level === 'HOF';
    return true;
  });

  // Resolve banana names for everyone in a filling lobby (+ the current drafter)
  // so the "who's in" band shows real identities, not raw hex. useDraftRoomUsers
  // dedupes + builds a stable cache key, so re-deriving this list each render is
  // free (no extra fetches unless the wallet set actually changes).
  const memberWallets = useMemo(
    () => filtered.flatMap(d => [...(d.members ?? []), d.currentDrafter]).filter(Boolean),
    [filtered],
  );
  const users = useDraftRoomUsers(memberWallets);

  // Never render raw hex in the band: if a wallet's batch entry is missing
  // (transient fetch failure), fall back to the SAME wallet-derived default
  // the API floors to — identical string, so it can't disagree with what the
  // user sees elsewhere. Non-0x ids (bot seats) keep WalletLink's own label.
  const nameFor = (w: string): string | undefined =>
    users[w.toLowerCase()]?.displayName
      ?? (/^0x[0-9a-fA-F]{40}$/.test(w) ? bananaDefaultName(w.toLowerCase()) : undefined);

  // NEW / RET account flags (admin-only endpoint). Keyed on the sorted
  // deduped wallet set so the 5s poll doesn't refetch unless the set actually
  // changes; token via ref (see render-loop rule above). Merged into prev so
  // known flags never flicker out between polls.
  const [flags, setFlags] = useState<Record<string, UserFlags>>({});
  const flagsWalletKey = useMemo(
    () => [...new Set(memberWallets.map(w => w.toLowerCase()))].sort().join(','),
    [memberWallets],
  );
  useEffect(() => {
    if (!enabled || !flagsWalletKey) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessTokenRef.current();
        const res = await fetch('/api/admin/user-flags', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ wallets: flagsWalletKey.split(',') }),
        });
        if (!res.ok) return;
        const body = (await res.json()) as { flags?: Record<string, UserFlags> };
        if (!cancelled && body.flags) setFlags(prev => ({ ...prev, ...body.flags }));
      } catch { /* cosmetic — names still render without flags */ }
    })();
    return () => { cancelled = true; };
  }, [enabled, flagsWalletKey]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-gray-400">
          {loading && drafts === null ? 'Loading active drafts…' : `${filtered.length} active draft${filtered.length === 1 ? '' : 's'}`}
          {error && <span className="ml-2 text-red-400">last poll: {error}</span>}
          {botNote && <span className={`ml-2 ${botNote.includes('failed') ? 'text-red-400' : 'text-banana'}`}>{botNote}</span>}
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
              <th className="px-4 py-3 font-medium">Pick / Filling</th>
              <th className="px-4 py-3 font-medium">On the clock / In lobby</th>
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
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-yellow-400 transition-all duration-500"
                            style={{ width: `${Math.min(100, ((d.numPlayers ?? 0) / (d.maxPlayers || 10)) * 100)}%` }}
                          />
                        </div>
                        <span className="text-yellow-400 text-xs whitespace-nowrap">{d.numPlayers ?? 0}/{d.maxPlayers || 10}</span>
                      </div>
                    ) : (
                      <span>P{d.pickNumber}/150</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {d.filling ? (
                      d.members && d.members.length > 0 ? (
                        <div className="flex flex-wrap gap-x-2.5 gap-y-1 max-w-[280px]">
                          {d.members.map(w => (
                            <span key={w} className="inline-flex items-center gap-1">
                              <WalletLink wallet={w} displayName={nameFor(w)} hideAddress />
                              <FlagChip flags={flags[w.toLowerCase()]} />
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-gray-600">waiting for players…</span>
                      )
                    ) : (
                      d.currentDrafter
                        ? (
                          <span className="inline-flex items-center gap-1">
                            <WalletLink wallet={d.currentDrafter} displayName={nameFor(d.currentDrafter)} hideAddress />
                            <FlagChip flags={flags[d.currentDrafter.toLowerCase()]} />
                          </span>
                        )
                        : '—'
                    )}
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
                      {d.filling ? (
                        <>
                          <button
                            onClick={() => addBot(d)}
                            disabled={addingBotId === d.draftId}
                            title="Join one house bot to this draft"
                            className="inline-flex items-center px-2.5 py-1 rounded-md border border-banana/40 bg-banana/10 text-banana text-xs font-semibold hover:bg-banana/20 transition disabled:opacity-50"
                          >
                            {addingBotId === d.draftId ? 'Adding…' : '+ Bot'}
                          </button>
                          <button
                            onClick={() => removeBot(d)}
                            disabled={removingBotId === d.draftId}
                            title="Remove the most recently added house bot from this draft"
                            className="inline-flex items-center px-2.5 py-1 rounded-md border border-white/15 text-white/60 text-xs font-semibold hover:bg-white/[0.06] hover:text-white transition disabled:opacity-50"
                          >
                            {removingBotId === d.draftId ? 'Removing…' : '– Bot'}
                          </button>
                          <span
                            className="inline-flex items-center px-3 py-1 rounded-md border border-white/10 text-gray-500 text-xs font-medium cursor-default"
                            title="The live board opens once this draft fills to 10 and starts"
                          >
                            Starts at 10
                          </span>
                        </>
                      ) : (
                        <a
                          href={`/spectate/${d.draftId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center px-3 py-1 rounded-md bg-banana text-black text-xs font-bold hover:brightness-110 transition"
                        >
                          Spectate ↗
                        </a>
                      )}
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
