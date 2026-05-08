'use client';

import React, { useState, useMemo } from 'react';
import {
  getTopExposures,
  getExposureByPosition,
  positions,
  type ExposureEntry,
  type RealStack,
  teamByeWeeks,
  computeStacksFromLeagues,
  computeByeWeekRisk,
  computeADPValue,
} from '@/lib/exposureUtils';
import { getTeamPosition, getTeamPositionDepthChart } from '@/lib/teamPositions';
import { mockTeamPositions } from '@/lib/mock/teamPositions';
import { useExposure } from '@/hooks/useExposure';
import { useLeagues } from '@/hooks/useLeagues';
import { useAuth } from '@/hooks/useAuth';
import { Modal } from '@/components/ui/Modal';
import { LeagueDetailModal, type ModalTab } from '@/components/standings/LeagueDetailModal';
import type { League } from '@/types';

// ─── Position colors ─────────────────────────────────────────────────────

const POS_COLORS: Record<string, string> = {
  QB: '#FF474C',
  RB: '#22c55e',
  RB1: '#22c55e',
  RB2: '#22c55e',
  WR: '#a855f7',
  WR1: '#a855f7',
  WR2: '#a855f7',
  TE: '#3b82f6',
  DST: '#f97316',
};

function posColor(pos: string): string {
  return POS_COLORS[pos] || POS_COLORS[pos.replace(/\d/g, '')] || '#94a3b8';
}

function exposureColor(pct: number): string {
  if (pct >= 35) return '#ff6b6b';
  if (pct >= 25) return '#fbbf24';
  if (pct >= 15) return '#4ade80';
  return '#64748b';
}

type SortField = 'exposure' | 'adp' | 'projected';

// ─── Page ────────────────────────────────────────────────────────────────

export default function ExposurePage() {
  const exposureQuery = useExposure();
  const userExposure = exposureQuery.data ?? { username: '', totalDrafts: 0, exposures: [] };
  const exposures = userExposure.exposures;
  const totalDrafts = userExposure.totalDrafts;
  const { user } = useAuth();
  const leaguesQuery = useLeagues({ userId: user?.id, status: 'completed' });
  const leagues = leaguesQuery.data ?? [];

  const [posFilter, setPosFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortField>('exposure');
  const [selectedExposure, setSelectedExposure] = useState<ExposureEntry | null>(null);
  const [modalLeague, setModalLeague] = useState<League | null>(null);
  const [modalTab, setModalTab] = useState<ModalTab>('roster');
  const [stackTeamFilter, setStackTeamFilter] = useState<string>('all');
  const [stackMinSize, setStackMinSize] = useState<2 | 3 | 4>(2);
  const [selectedStack, setSelectedStack] = useState<RealStack | null>(null);

  // Leagues whose roster contains the selected team+position. Match by
  // team + base position group (RB / WR / QB / TE / DST), since roster
  // entries use "IND RB" / "IND RB2" while exposure aggregation uses
  // "IND RB1" / "IND RB2" — different first-slot conventions. Matching
  // by group is also more useful (clicking IND RB1 surfaces every league
  // where you drafted any IND RB).
  const matchingLeagues = useMemo(() => {
    if (!selectedExposure) return [] as League[];
    const team = selectedExposure.team;
    const baseGroup = selectedExposure.position.replace(/\d+$/, '');
    return leagues.filter(l =>
      l.roster.some(r => {
        const [rTeam, rSlot = ''] = r.teamPosition.split(' ');
        const rGroup = rSlot.replace(/\d+$/, '');
        return rTeam === team && rGroup === baseGroup;
      }),
    );
  }, [leagues, selectedExposure]);

  const openLeague = (league: League, tab: ModalTab = 'roster') => {
    setModalLeague(league);
    setModalTab(tab);
    setSelectedExposure(null);
    setSelectedStack(null);
  };

  // ── Computed data ─────────────────────────────────────────────────────

  const filteredExposures = useMemo(() => {
    let data = posFilter === 'all'
      ? getTopExposures(exposures, 100)
      : getExposureByPosition(exposures, posFilter);

    if (search.trim()) {
      const q = search.toLowerCase();
      data = data.filter(e =>
        e.teamPosition.toLowerCase().includes(q) || e.team.toLowerCase().includes(q),
      );
    }

    // Enrich with ADP/projected for sorting
    return data
      .map(e => {
        const tp = mockTeamPositions.find(t => t.team === e.team && t.position === e.position);
        return { ...e, adp: tp?.adp ?? 999, projected: tp?.projectedPoints ?? 0 };
      })
      .sort((a, b) => {
        if (sortBy === 'adp') return a.adp - b.adp;
        if (sortBy === 'projected') return b.projected - a.projected;
        return b.exposure - a.exposure;
      });
  }, [exposures, posFilter, search, sortBy]);

  const stacks = useMemo(() => computeStacksFromLeagues(leagues), [leagues]);

  // Teams that appear in any stack — used to populate the team filter
  // dropdown so we don't list NFL teams the user has never stacked.
  const stackedTeams = useMemo(() => {
    const set = new Set<string>();
    for (const s of stacks) set.add(s.team);
    return [...set].sort();
  }, [stacks]);

  const filteredStacks = useMemo(() => {
    return stacks.filter(s =>
      (stackTeamFilter === 'all' || s.team === stackTeamFilter) &&
      s.size >= stackMinSize,
    );
  }, [stacks, stackTeamFilter, stackMinSize]);

  // Leagues that contain the currently-selected stack — driven by the
  // pre-computed `leagueIds` array on RealStack so we don't re-walk
  // rosters per click.
  const selectedStackLeagues = useMemo(() => {
    if (!selectedStack) return [] as League[];
    const idSet = new Set(selectedStack.leagueIds);
    return leagues.filter(l => idSet.has(l.id));
  }, [leagues, selectedStack]);

  const byeWeekRisk = useMemo(() => computeByeWeekRisk(exposures), [exposures]);
  const adpValues = useMemo(() => computeADPValue(exposures, mockTeamPositions), [exposures]);

  // ── Portfolio summary stats ───────────────────────────────────────────

  const summary = useMemo(() => {
    const uniquePositions = new Set(exposures.map(e => e.teamPosition)).size;
    const topExposure = exposures.length > 0
      ? exposures.reduce((max, e) => e.exposure > max.exposure ? e : max, exposures[0])
      : null;
    return { uniquePositions, topExposure };
  }, [exposures]);

  // ── Depth chart modal ─────────────────────────────────────────────────

  const selectedDepthChart = selectedExposure
    ? getTeamPositionDepthChart(selectedExposure.team, selectedExposure.position)
    : [];
  const selectedTP = selectedExposure
    ? getTeamPosition(selectedExposure.team, selectedExposure.position)
    : null;

  const maxByeExposure = byeWeekRisk.length > 0 ? byeWeekRisk[0].totalExposure : 1;

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="w-full min-h-screen px-4 sm:px-8 lg:px-12 py-8 max-w-5xl mx-auto">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white mb-1">Exposure</h1>
        <p className="text-white/40 text-sm">
          {totalDrafts > 0
            ? `${totalDrafts} drafts · Portfolio breakdown across all your teams`
            : 'Draft to start tracking your portfolio exposure'}
        </p>
      </div>

      {/* ── Section 1: Portfolio Summary ────────────────────────────────── */}
      {totalDrafts > 0 && (
        <div className="glass-card px-5 py-5 mb-8">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-white/40 text-[11px] uppercase tracking-wider mb-1">Drafts</p>
              <p className="text-white font-bold text-2xl">{totalDrafts}</p>
            </div>
            <div>
              <p className="text-white/40 text-[11px] uppercase tracking-wider mb-1">Positions</p>
              <p className="text-white font-bold text-2xl">{summary.uniquePositions}</p>
            </div>
            <div>
              <p className="text-white/40 text-[11px] uppercase tracking-wider mb-1">Most Exposed</p>
              {summary.topExposure ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: posColor(summary.topExposure.position) + '30', color: posColor(summary.topExposure.position) }}>
                    {summary.topExposure.teamPosition}
                  </span>
                  <span className="text-white font-bold text-lg">{summary.topExposure.exposure}%</span>
                </div>
              ) : (
                <p className="text-white/30 text-lg">—</p>
              )}
            </div>
            <div>
              <p className="text-white/40 text-[11px] uppercase tracking-wider mb-1">Stacked Teams</p>
              <p className="text-white font-bold text-2xl">{stackedTeams.length > 0 ? stackedTeams.length : '—'}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Section 2: Position Exposure Table ─────────────────────────── */}
      <div className="mb-10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          {/* Position filter pills */}
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            <button
              onClick={() => setPosFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
                posFilter === 'all' ? 'bg-white/15 text-white' : 'text-white/40 hover:text-white/60'
              }`}
            >
              All
            </button>
            {positions.map(pos => (
              <button
                key={pos}
                onClick={() => setPosFilter(pos)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
                  posFilter === pos ? 'bg-white/15 text-white' : 'text-white/40 hover:text-white/60'
                }`}
              >
                {pos}
              </button>
            ))}
          </div>

          {/* Sort + Search */}
          <div className="flex items-center gap-2">
            <div className="flex bg-white/[0.04] rounded-lg p-0.5">
              {([['exposure', 'Exp%'], ['adp', 'ADP'], ['projected', 'Proj']] as [SortField, string][]).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setSortBy(key)}
                  className={`text-[11px] px-2.5 py-1 rounded-md transition-colors ${
                    sortBy === key ? 'bg-banana text-black font-semibold' : 'text-white/50 hover:text-white/70'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="relative">
              <svg className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search..."
                className="bg-white/[0.04] border border-white/[0.06] rounded-lg pl-7 pr-3 py-1.5 text-xs text-white placeholder:text-white/25 focus:outline-none focus:border-banana/40 w-32 sm:w-40"
              />
            </div>
          </div>
        </div>

        {/* Table */}
        {filteredExposures.length > 0 ? (
          <div className="rounded-xl border border-white/[0.06] overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-[100px_1fr_48px] sm:grid-cols-[36px_120px_1fr_56px_48px_56px_56px_40px] gap-1 px-3 sm:px-4 py-2.5 bg-white/[0.03] border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-white/30 font-medium">
              <div className="hidden sm:block">#</div>
              <div>Position</div>
              <div>Exposure</div>
              <div className="hidden sm:block text-right">Drafts</div>
              <div className="text-right">%</div>
              <div className="hidden sm:block text-right">ADP</div>
              <div className="hidden sm:block text-right">Proj</div>
              <div className="hidden sm:block text-right">Bye</div>
            </div>

            {/* Rows */}
            {filteredExposures.map((e, idx) => {
              const bye = teamByeWeeks[e.team] || '—';
              return (
                <div
                  key={e.teamPosition}
                  onClick={() => setSelectedExposure(e)}
                  className="grid grid-cols-[100px_1fr_48px] sm:grid-cols-[36px_120px_1fr_56px_48px_56px_56px_40px] gap-1 px-3 sm:px-4 py-2.5 items-center hover:bg-white/[0.04] cursor-pointer transition-colors border-b border-white/[0.03] last:border-0"
                >
                  <span className="hidden sm:block text-white/30 text-xs">{idx + 1}</span>
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[11px] font-bold px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: posColor(e.position) + '25', color: posColor(e.position) }}
                    >
                      {e.position.replace(/\d/g, '')}
                    </span>
                    <span className="text-white text-sm font-medium">{e.team}</span>
                  </div>
                  {/* Exposure bar */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-white/[0.06] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${Math.min(e.exposure, 100)}%`, backgroundColor: exposureColor(e.exposure) }}
                      />
                    </div>
                  </div>
                  <span className="hidden sm:block text-white/50 text-xs text-right">{e.drafts}/{e.totalDrafts}</span>
                  <span className="text-right text-sm font-semibold" style={{ color: exposureColor(e.exposure) }}>
                    {e.exposure}%
                  </span>
                  <span className="hidden sm:block text-white/50 text-xs text-right">{e.adp < 999 ? e.adp : '—'}</span>
                  <span className="hidden sm:block text-white/50 text-xs text-right">{e.projected > 0 ? e.projected.toFixed(1) : '—'}</span>
                  <span className="hidden sm:block text-white/30 text-xs text-right">{bye}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-12 rounded-xl border border-white/[0.04] bg-white/[0.02]">
            <p className="text-white/40 text-sm">
              {totalDrafts === 0 ? 'No draft data yet' : 'No positions match your filters'}
            </p>
          </div>
        )}
      </div>

      {/* ── Section 3: Team Stacks ─────────────────────────────────────── */}
      {/* Real per-draft co-occurrence — every multi-position combo a
          user has actually drafted from a team is its own card. Sorted
          by draft count desc. Filterable by team and minimum size.
          Click a card to drill into the leagues containing the stack. */}
      {stacks.length > 0 && (
        <div className="mb-10">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <div>
              <h2 className="text-white font-bold text-lg">Team Stacks</h2>
              <p className="text-white/40 text-xs">
                {stacks.length} combo{stacks.length === 1 ? '' : 's'} you&apos;ve drafted in 2+ leagues. Click for details.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* Team filter */}
              <select
                value={stackTeamFilter}
                onChange={e => setStackTeamFilter(e.target.value)}
                className="bg-white/[0.04] border border-white/[0.06] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-banana/40"
              >
                <option value="all">All teams</option>
                {stackedTeams.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              {/* Min-size pills */}
              <div className="flex bg-white/[0.04] rounded-lg p-0.5">
                {([2, 3, 4] as const).map(size => (
                  <button
                    key={size}
                    onClick={() => setStackMinSize(size)}
                    className={`text-[11px] px-2.5 py-1 rounded-md transition-colors ${
                      stackMinSize === size ? 'bg-banana text-black font-semibold' : 'text-white/50 hover:text-white/70'
                    }`}
                  >
                    {size}+
                  </button>
                ))}
              </div>
            </div>
          </div>

          {filteredStacks.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredStacks.map((stack, i) => {
                const key = `${stack.team}|${stack.positions.join('+')}`;
                const isTop = i === 0 && stackTeamFilter === 'all' && stackMinSize === 2;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedStack(stack)}
                    className="glass-card px-4 py-3 text-left hover:border-banana/40 hover:bg-white/[0.04] transition-colors group"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-white font-bold text-sm">{stack.team}</span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/[0.06] text-white/50">
                        {stack.size}-stack
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 mb-2">
                      {stack.positions.map(pos => (
                        <span
                          key={pos}
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                          style={{ backgroundColor: posColor(pos) + '25', color: posColor(pos) }}
                        >
                          {pos}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-white/50">
                        {isTop && <span className="mr-1">🏆</span>}
                        {stack.drafts}/{stack.totalDrafts} drafts
                      </span>
                      <span className="font-semibold" style={{ color: exposureColor(stack.exposure) }}>
                        {stack.exposure}%
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 rounded-xl border border-white/[0.04] bg-white/[0.02]">
              <p className="text-white/40 text-sm">No stacks match these filters.</p>
              <button
                onClick={() => { setStackTeamFilter('all'); setStackMinSize(2); }}
                className="text-banana text-xs mt-2 hover:underline"
              >
                Reset filters
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Section 4: Bye Week Risk ──────────────────────────────────── */}
      {byeWeekRisk.length > 0 && (
        <div className="mb-10">
          <h2 className="text-white font-bold text-lg mb-4">Bye Week Risk</h2>
          <div className="glass-card px-4 py-4">
            <div className="space-y-2">
              {byeWeekRisk.map(bw => (
                <div key={bw.week} className="flex items-center gap-3">
                  <span className="text-white/50 text-xs font-mono w-14 flex-shrink-0">Week {bw.week}</span>
                  <div className="flex-1 h-3 bg-white/[0.06] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min((bw.totalExposure / maxByeExposure) * 100, 100)}%`,
                        backgroundColor: bw.totalExposure > 200 ? '#ff6b6b' : bw.totalExposure > 100 ? '#fbbf24' : '#4ade80',
                      }}
                    />
                  </div>
                  <span className="text-white/50 text-[10px] w-10 text-right flex-shrink-0">{bw.totalExposure}%</span>
                  <span className="text-white/25 text-[10px] truncate max-w-[120px] flex-shrink-0">{bw.teams.join(', ')}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Section 5: Projections Preview ─────────────────────────────── */}
      {adpValues.length > 0 && (
        <div className="mb-10">
          <h2 className="text-white font-bold text-lg mb-4">Top Exposures — Projections</h2>
          <div className="rounded-xl border border-white/[0.06] overflow-hidden">
            <div className="grid grid-cols-[1fr_64px_64px_80px] gap-2 px-4 py-2.5 bg-white/[0.03] border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-white/30 font-medium">
              <div>Position</div>
              <div className="text-right">Exp%</div>
              <div className="text-right">ADP</div>
              <div className="text-right">Proj Pts</div>
            </div>
            {adpValues.slice(0, 10).map(v => {
              return (
                <div key={v.teamPosition} className="grid grid-cols-[1fr_64px_64px_80px] gap-2 px-4 py-2.5 items-center border-b border-white/[0.03] last:border-0 hover:bg-white/[0.03] transition-colors">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: posColor(v.position) + '25', color: posColor(v.position) }}
                    >
                      {v.position.replace(/\d/g, '')}
                    </span>
                    <span className="text-white text-sm font-medium">{v.team} {v.position}</span>
                  </div>
                  <span className="text-right text-sm font-semibold" style={{ color: exposureColor(v.exposure) }}>{v.exposure}%</span>
                  <span className="text-white/50 text-xs text-right">{v.adp}</span>
                  <span className="text-banana font-semibold text-sm text-right">{v.projectedPts.toFixed(1)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────────────────── */}
      {totalDrafts === 0 && !exposureQuery.isValidating && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-16 text-center">
          <div className="text-4xl mb-4">&#x1F4CA;</div>
          <p className="text-white/50 font-medium mb-2">No exposure data yet</p>
          <p className="text-white/30 text-sm mb-6">Complete a draft to start tracking your portfolio.</p>
          <a
            href="/drafting"
            className="inline-block px-6 py-2.5 bg-banana text-black font-semibold rounded-xl hover:bg-banana-dark transition-colors"
          >
            Start Drafting
          </a>
        </div>
      )}

      {/* ── Loading ───────────────────────────────────────────────────── */}
      {exposureQuery.isValidating && totalDrafts === 0 && (
        <div className="space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-12 rounded-xl bg-white/[0.03] animate-pulse" />
          ))}
        </div>
      )}

      {/* ── Depth Chart Modal ─────────────────────────────────────────── */}
      {selectedExposure && (
        <Modal isOpen={!!selectedExposure} onClose={() => setSelectedExposure(null)}>
          <div className="p-5">
            {/* Header */}
            <div className="flex items-center gap-3 mb-5">
              <span
                className="text-sm font-bold px-2 py-1 rounded"
                style={{ backgroundColor: posColor(selectedExposure.position) + '25', color: posColor(selectedExposure.position) }}
              >
                {selectedExposure.position}
              </span>
              <h3 className="text-white font-bold text-lg">{selectedExposure.team} {selectedExposure.position}</h3>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-4 gap-3 mb-5">
              <div className="bg-white/[0.04] rounded-lg px-3 py-2 text-center">
                <p className="text-white/40 text-[10px] uppercase tracking-wider">Exposure</p>
                <p className="text-white font-bold" style={{ color: exposureColor(selectedExposure.exposure) }}>{selectedExposure.exposure}%</p>
              </div>
              <div className="bg-white/[0.04] rounded-lg px-3 py-2 text-center">
                <p className="text-white/40 text-[10px] uppercase tracking-wider">Drafts</p>
                <p className="text-white font-bold">{selectedExposure.drafts}/{selectedExposure.totalDrafts}</p>
              </div>
              <div className="bg-white/[0.04] rounded-lg px-3 py-2 text-center">
                <p className="text-white/40 text-[10px] uppercase tracking-wider">ADP</p>
                <p className="text-white font-bold">{selectedTP?.adp ?? '—'}</p>
              </div>
              <div className="bg-white/[0.04] rounded-lg px-3 py-2 text-center">
                <p className="text-white/40 text-[10px] uppercase tracking-wider">Bye</p>
                <p className="text-white font-bold">{teamByeWeeks[selectedExposure.team] ?? '—'}</p>
              </div>
            </div>

            {/* Projected points */}
            {selectedTP && (
              <div className="mb-5 flex items-center gap-4">
                <div>
                  <p className="text-white/40 text-[10px] uppercase tracking-wider">Projected</p>
                  <p className="text-banana font-bold text-xl">{selectedTP.projectedPoints.toFixed(1)} <span className="text-xs text-white/30 font-normal">pts/wk</span></p>
                </div>
                <div>
                  <p className="text-white/40 text-[10px] uppercase tracking-wider">Season</p>
                  <p className="text-white font-bold text-xl">{selectedTP.seasonPoints.toFixed(1)}</p>
                </div>
              </div>
            )}

            {/* Depth chart */}
            {selectedDepthChart.length > 0 && (
              <div>
                <p className="text-white/40 text-[10px] uppercase tracking-wider mb-2">Depth Chart</p>
                <div className="space-y-1.5">
                  {selectedDepthChart.map((p, i) => (
                    <div
                      key={p.name}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg ${
                        i === 0 ? 'bg-white/[0.06]' : 'bg-white/[0.02]'
                      } ${p.status === 'injured' ? 'opacity-40' : ''}`}
                    >
                      <div className="flex items-center gap-2">
                        {i === 0 && <span className="text-banana text-[10px] font-bold">STARTER</span>}
                        {p.status === 'injured' && <span className="text-red-400 text-[10px] font-bold">OUT</span>}
                        <span className="text-white text-sm font-medium">{p.name}</span>
                      </div>
                      <span className="text-white/50 text-xs">{p.projectedPoints.toFixed(1)} pts</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Your teams with this player — click to open the full
                draft view (roster / board / standings / scores). */}
            {matchingLeagues.length > 0 && (
              <div className="mt-5">
                <p className="text-white/40 text-[10px] uppercase tracking-wider mb-2">
                  Your Teams ({matchingLeagues.length})
                </p>
                <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1">
                  {matchingLeagues.map(l => {
                    const typeColor = l.type === 'jackpot' ? '#ef4444'
                      : l.type === 'hof' ? '#D4AF37'
                      : '#a855f7';
                    const typeLabel = l.type === 'jackpot' ? 'JP' : l.type === 'hof' ? 'HOF' : 'Pro';
                    return (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => openLeague(l, 'roster')}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] transition-colors text-left"
                      >
                        <span
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0"
                          style={{ color: typeColor, backgroundColor: `${typeColor}20` }}
                        >
                          {typeLabel}
                        </span>
                        <span className="text-white text-sm font-medium truncate flex-1">
                          {l.name}
                        </span>
                        {l.leagueRank > 0 && (
                          <span className="text-white/50 text-xs shrink-0">
                            #{l.leagueRank}
                          </span>
                        )}
                        <span className="text-white/70 text-xs font-semibold shrink-0">
                          {l.seasonScore.toFixed(1)} pts
                        </span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/30 shrink-0">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Stack drill modal — leagues containing the selected stack. */}
      {selectedStack && (
        <Modal isOpen={!!selectedStack} onClose={() => setSelectedStack(null)}>
          <div className="p-5">
            <div className="flex items-center gap-3 mb-1">
              <span className="text-white font-bold text-lg">{selectedStack.team}</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {selectedStack.positions.map(pos => (
                  <span
                    key={pos}
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: posColor(pos) + '25', color: posColor(pos) }}
                  >
                    {pos}
                  </span>
                ))}
              </div>
            </div>
            <p className="text-white/40 text-xs mb-4">
              {selectedStack.drafts} of {selectedStack.totalDrafts} drafts ({selectedStack.exposure}%) — drafts that contain at least these positions from {selectedStack.team}.
            </p>
            <div className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
              {selectedStackLeagues.map(l => {
                const typeColor = l.type === 'jackpot' ? '#ef4444'
                  : l.type === 'hof' ? '#D4AF37'
                  : '#a855f7';
                const typeLabel = l.type === 'jackpot' ? 'JP' : l.type === 'hof' ? 'HOF' : 'Pro';
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => openLeague(l, 'roster')}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] transition-colors text-left"
                  >
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0"
                      style={{ color: typeColor, backgroundColor: `${typeColor}20` }}
                    >
                      {typeLabel}
                    </span>
                    <span className="text-white text-sm font-medium truncate flex-1">
                      {l.name}
                    </span>
                    {l.leagueRank > 0 && (
                      <span className="text-white/50 text-xs shrink-0">
                        #{l.leagueRank}
                      </span>
                    )}
                    <span className="text-white/70 text-xs font-semibold shrink-0">
                      {l.seasonScore.toFixed(1)} pts
                    </span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/30 shrink-0">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                );
              })}
            </div>
          </div>
        </Modal>
      )}

      {/* Full draft view (roster / board / standings / team) */}
      {modalLeague && (
        <LeagueDetailModal
          league={modalLeague}
          initialTab={modalTab}
          walletAddress={user?.walletAddress ?? ''}
          onClose={() => setModalLeague(null)}
        />
      )}
    </div>
  );
}
