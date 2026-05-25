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
} from '@/lib/exposureUtils';
import { getTeamPosition, getTeamPositionDepthChart } from '@/lib/teamPositions';
import { mockTeamPositions } from '@/lib/mock/teamPositions';
import { useExposure } from '@/hooks/useExposure';
import { useLeagues } from '@/hooks/useLeagues';
import { useAuth } from '@/hooks/useAuth';
import { Modal } from '@/components/ui/Modal';
import { MultiChipSearch } from '@/components/ui/MultiChipSearch';
import { LeagueDetailModal, type ModalTab } from '@/components/standings/LeagueDetailModal';
import type { League } from '@/types';
import { COLORS } from '@/utils/helpers';

// ─── Position colors ─────────────────────────────────────────────────────
// Match the draft room exactly — single source of truth in utils/helpers.ts
// (COLORS.qb/rb/wr/te/dst). Keep this map in lockstep with positionColor().

const POS_COLORS: Record<string, string> = {
  QB: COLORS.qb,
  RB: COLORS.rb,
  RB1: COLORS.rb,
  RB2: COLORS.rb,
  WR: COLORS.wr,
  WR1: COLORS.wr,
  WR2: COLORS.wr,
  TE: COLORS.te,
  DST: COLORS.dst,
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
  const [search, setSearch] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortField>('exposure');
  const [selectedExposure, setSelectedExposure] = useState<ExposureEntry | null>(null);
  const [modalLeague, setModalLeague] = useState<League | null>(null);
  const [modalTab, setModalTab] = useState<ModalTab>('roster');
  const [stackTeamFilter, setStackTeamFilter] = useState<string>('all');
  const [stackMinSize, setStackMinSize] = useState<2 | 3 | 4>(2);
  const [stackSearch, setStackSearch] = useState('');
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

  // Drafts that contain EVERY chip in the search bar. Matches any roster
  // entry whose teamPosition (e.g. "IND RB", "MIN WR") includes the chip
  // text — case + whitespace insensitive. Drives the "Matching Drafts"
  // panel that surfaces when a user combines two or more slots.
  const comboMatchingLeagues = useMemo(() => {
    if (search.length < 1) return [] as League[];
    const queries = search.map(c => c.trim().toUpperCase().replace(/\s+/g, '')).filter(Boolean);
    return leagues.filter(l =>
      queries.every(q =>
        l.roster.some(r => r.teamPosition.toUpperCase().replace(/\s+/g, '').includes(q)),
      ),
    );
  }, [leagues, search]);

  // Closed list of valid slot/team filters derived from the user's actual
  // roster data. Suggestions in the chip search are restricted to this
  // list — typing a non-existent slot is rejected.
  const slotOptions = useMemo(() => {
    const set = new Set<string>();
    leagues.forEach(l => {
      l.roster.forEach(r => {
        if (r.teamPosition) set.add(r.teamPosition);
        const team = r.teamPosition.split(' ')[0];
        if (team) set.add(team);
      });
    });
    return [...set].sort();
  }, [leagues]);

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

    if (search.length > 0) {
      // OR across chips: a row is one team-position, so multiple chips
      // restrict the row set to anything matching any chip.
      const queries = search.map(c => c.trim().toLowerCase()).filter(Boolean);
      if (queries.length > 0) {
        data = data.filter(e =>
          queries.some(q => e.teamPosition.toLowerCase().includes(q) || e.team.toLowerCase().includes(q)),
        );
      }
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

  // Real stacks = QB + at least one skill (WR / TE / RB). DST and other
  // permutations don't count because in best ball, "stacking" only has
  // positive correlation when your QB and his pass-catchers / backs
  // score together.
  const STACK_SKILL_GROUPS = ['WR', 'TE', 'RB'] as const;
  const stacks = useMemo(() => {
    const all = computeStacksFromLeagues(leagues);
    return all.filter(s =>
      s.positions.includes('QB') &&
      s.positions.some(p => (STACK_SKILL_GROUPS as readonly string[]).includes(p)) &&
      // Drop combos that contain anything OTHER than QB + WR/TE/RB
      // (e.g. drop QB+DST, QB+WR+DST). DST mixed in dilutes the signal.
      s.positions.every(p => p === 'QB' || (STACK_SKILL_GROUPS as readonly string[]).includes(p)),
    );
  }, [leagues]);

  // Teams that appear in any stack — used to populate the team filter
  // dropdown so we don't list NFL teams the user has never stacked.
  const stackedTeams = useMemo(() => {
    const set = new Set<string>();
    for (const s of stacks) set.add(s.team);
    return [...set].sort();
  }, [stacks]);

  const filteredStacks = useMemo(() => {
    const q = stackSearch.trim().toLowerCase();
    return stacks.filter(s => {
      if (stackTeamFilter !== 'all' && s.team !== stackTeamFilter) return false;
      if (s.size < stackMinSize) return false;
      if (!q) return true;
      // Search matches team code or any position group, with multi-term
      // AND logic ("kc qb wr" requires team=KC + has-QB + has-WR).
      const hay = `${s.team.toLowerCase()} ${s.positions.join(' ').toLowerCase()}`;
      const terms = q.split(/[\s+]+/).filter(Boolean);
      return terms.every(t => hay.includes(t));
    });
  }, [stacks, stackTeamFilter, stackMinSize, stackSearch]);

  // Leagues that contain the currently-selected stack — driven by the
  // pre-computed `leagueIds` array on RealStack so we don't re-walk
  // rosters per click.
  const selectedStackLeagues = useMemo(() => {
    if (!selectedStack) return [] as League[];
    const idSet = new Set(selectedStack.leagueIds);
    return leagues.filter(l => idSet.has(l.id));
  }, [leagues, selectedStack]);


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
                  {/* Strip the slot-index suffix (RB1/RB2/RB3 → RB) so the
                      most-exposed chip matches the position chips shown
                      everywhere else in the page. The slot number was
                      misleading — it's an internal "Nth player drafted
                      from this team's depth" index, not a lineup slot. */}
                  <span
                    className="text-xs font-bold px-1.5 py-0.5 rounded"
                    style={{
                      backgroundColor: posColor(summary.topExposure.position) + '30',
                      color: posColor(summary.topExposure.position),
                    }}
                  >
                    {summary.topExposure.team} {summary.topExposure.position.replace(/\d+$/, '')}
                  </span>
                  <span className="text-white font-bold text-lg">{summary.topExposure.exposure}%</span>
                </div>
              ) : (
                <p className="text-white/30 text-lg">—</p>
              )}
            </div>
            <div>
              {/* Renamed to "Stack Combos" to match the count shown in
                  the Team Stacks section below ("14 stack combos across
                  your portfolio"). Was using stackedTeams.length (unique
                  NFL team count) which never lined up with stacks.length
                  (combo count) — same metric, two different numbers
                  under one label. Now both surface the combo count. */}
              <p className="text-white/40 text-[11px] uppercase tracking-wider mb-1">Stack Combos</p>
              <p className="text-white font-bold text-2xl">{stacks.length > 0 ? stacks.length : '—'}</p>
              {stacks.length > 0 && stackedTeams.length !== stacks.length && (
                <p className="text-white/30 text-[11px] mt-0.5">across {stackedTeams.length} team{stackedTeams.length === 1 ? '' : 's'}</p>
              )}
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
            {positions.map(pos => {
              const color = posColor(pos);
              const active = posFilter === pos;
              return (
                <button
                  key={pos}
                  onClick={() => setPosFilter(pos)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap"
                  style={{
                    color,
                    backgroundColor: active ? `${color}26` : 'transparent',
                    opacity: active ? 1 : 0.75,
                  }}
                >
                  {pos}
                </button>
              );
            })}
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
            <MultiChipSearch
              chips={search}
              onChange={setSearch}
              options={slotOptions}
              placeholder="IND RB, MIN WR…"
              className="w-44 sm:w-64"
            />
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

      {/* ── Matching Drafts (any chip search) ───────────────────────────── */}
      {search.length > 0 && comboMatchingLeagues.length > 0 && (
        <div className="mb-10">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-lg font-semibold text-white">
                {search.length === 1 ? 'Drafts with this team position' : 'Drafts with these team positions'}
              </h2>
              <p className="text-white/40 text-xs mt-0.5">
                {comboMatchingLeagues.length} of {leagues.length} drafts contain {search.map(s => s.toUpperCase()).join(' + ')}
              </p>
            </div>
          </div>
          <div className="rounded-xl border border-white/[0.06] overflow-hidden">
            {comboMatchingLeagues.map(league => (
              <button
                key={league.id}
                onClick={() => openLeague(league, 'roster')}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/[0.04] border-b border-white/[0.04] last:border-b-0 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
                    style={{
                      color: league.type === 'jackpot' ? '#ef4444' : league.type === 'hof' ? '#D4AF37' : '#a855f7',
                      backgroundColor: (league.type === 'jackpot' ? '#ef4444' : league.type === 'hof' ? '#D4AF37' : '#a855f7') + '20',
                    }}
                  >
                    {league.type === 'jackpot' ? 'JP' : league.type.toUpperCase()}
                  </span>
                  <span className="text-white text-sm font-mono">{league.name}</span>
                  {league.leagueRank > 0 && (
                    <span className="text-white/30 text-xs">#{league.leagueRank}</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-white/60 text-sm font-mono">{league.seasonScore.toFixed(1)} pts</span>
                  <svg className="w-3.5 h-3.5 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
      {search.length > 0 && comboMatchingLeagues.length === 0 && (
        <div className="mb-10 rounded-xl border border-white/[0.06] bg-white/[0.02] px-6 py-8 text-center">
          <p className="text-white/50 text-sm">No drafts contain {search.map(s => s.toUpperCase()).join(' + ')}.</p>
          <button onClick={() => setSearch([])} className="text-banana text-xs mt-2 hover:underline">
            Clear filters
          </button>
        </div>
      )}

      {/* ── Section 3: Team Stacks ─────────────────────────────────────── */}
      {/* Real per-draft co-occurrence — every multi-position combo a
          user has actually drafted from a team is its own card. Sorted
          by draft count desc. Filterable by team and minimum size.
          Click a card to drill into the leagues containing the stack.
          Hidden once a chip search is active — drill into Matching
          Drafts above instead. */}
      {search.length === 0 && stacks.length > 0 && (
        <div className="mb-10">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <div>
              <h2 className="text-white font-bold text-lg">Team Stacks</h2>
              <p className="text-white/40 text-xs">
                {stacks.length} stack combo{stacks.length === 1 ? '' : 's'} across your portfolio. Click any for details.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Search */}
              <div className="relative">
                <svg className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
                </svg>
                <input
                  type="text"
                  value={stackSearch}
                  onChange={e => setStackSearch(e.target.value)}
                  placeholder="Search stacks..."
                  className="bg-white/[0.04] border border-white/[0.06] rounded-lg pl-7 pr-3 py-1.5 text-xs text-white placeholder:text-white/25 focus:outline-none focus:border-banana/40 w-36 sm:w-44"
                />
              </div>
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
                onClick={() => { setStackTeamFilter('all'); setStackMinSize(2); setStackSearch(''); }}
                className="text-banana text-xs mt-2 hover:underline"
              >
                Reset filters
              </button>
            </div>
          )}
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
