'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  getTopExposures,
  getExposureByPosition,
  positions,
  nflTeams,
  type ExposureEntry,
  type RealStack,
  teamByeWeeks,
  computeStacksFromLeagues,
} from '@/lib/exposureUtils';
import { getTeamPosition, getTeamPositionDepthChart } from '@/lib/teamPositions';
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

type SortField = 'exposure' | 'adp';

// ─── Page ────────────────────────────────────────────────────────────────

export default function ExposurePage() {
  const exposureQuery = useExposure();
  const userExposure = exposureQuery.data ?? { username: '', totalDrafts: 0, exposures: [] };
  const exposures = userExposure.exposures;
  const totalDrafts = userExposure.totalDrafts;
  // The API sets `building` when it has no snapshot yet and the rebuild is
  // still failing/ambiguous (a transient hiccup, not a genuine zero). Show a
  // "building…" state instead of the false "no drafts" empty; it resolves live
  // on the next poll (which the hook speeds up while building).
  const isBuilding = userExposure.building === true && totalDrafts === 0;
  const { user } = useAuth();
  const leaguesQuery = useLeagues({ userId: user?.id, status: 'completed' });
  const leagues = leaguesQuery.data ?? [];

  // ADP is REAL and comes from the exposure doc (e.adp), aggregated
  // server-side from each draft's stats.adp — the same value the draft room
  // shows. We deliberately do NOT use /api/rankings here: its backend
  // (/league/rankings/global) 404s on staging and silently serves mock ADP,
  // which is what made PHI QB show a bogus ADP of 5. (getTeamPosition mock is
  // only used now for the detail modal's Season / depth-chart fields.)

  const [posFilter, setPosFilter] = useState('all');
  const [search, setSearch] = useState<string[]>([]);
  const [teamLookup, setTeamLookup] = useState('');
  const [sortBy, setSortBy] = useState<SortField>('exposure');
  const [selectedExposure, setSelectedExposure] = useState<ExposureEntry | null>(null);
  const [modalLeague, setModalLeague] = useState<League | null>(null);
  const [modalTab, setModalTab] = useState<ModalTab>('roster');
  const [stackTeamFilter, setStackTeamFilter] = useState<string>('all');
  const [stackMinSize, setStackMinSize] = useState<2 | 3 | 4 | 5>(2);
  const [stackSearch, setStackSearch] = useState('');
  const [selectedStack, setSelectedStack] = useState<RealStack | null>(null);
  // Which sub-view of the Exposure page is showing. Team Stacks used to live
  // at the very bottom (scroll-only); it's now its own tab up top.
  const [exposureTab, setExposureTab] = useState<'positions' | 'stacks'>('positions');
  // Include 0% rows — team-positions the user has NEVER drafted. The exposure
  // doc only contains slots with at least one draft, so these rows are
  // synthesized client-side from the full nflTeams × positions universe.
  // Off by default so the everyday view stays a portfolio, not a spreadsheet.
  const [showUndrafted, setShowUndrafted] = useState(false);

  // Leagues whose roster contains the EXACT team+slot you clicked. LAC WR1 and
  // LAC WR2 are different players (different picks), so clicking "LAC WR1" must
  // list only the teams that actually hold LAC WR1 — otherwise the header stat
  // ("3 drafts") and this list (11 teams) contradict each other on the same
  // screen, which is exactly what users reported (Boris 2026-07-25).
  //
  // This used to match by position GROUP because roster entries had lost their
  // slot number ("LAC WR" for everyone). mapRosterToUiRoster now derives the
  // real slot from playerId, so both sides speak "LAC WR1" and an exact match
  // works. Slot-1 is still normalized ("LAC WR" ≡ "LAC WR1") to stay correct
  // for any roster built before that fix / from legacy data.
  const matchingLeagues = useMemo(() => {
    if (!selectedExposure) return [] as League[];
    const team = selectedExposure.team;
    // "WR" → "WR1" so the two conventions compare equal.
    const canonical = (slot: string) => (/\d$/.test(slot) ? slot : `${slot}1`);
    const wantSlot = canonical(selectedExposure.position.toUpperCase());
    return leagues.filter(l =>
      l.roster.some(r => {
        const [rTeam, rSlot = ''] = r.teamPosition.split(' ');
        return rTeam === team && canonical(rSlot.toUpperCase()) === wantSlot;
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

  // Portfolio exposures, optionally padded with 0% rows for every
  // team-position the user has never drafted. ADP / avg pick stay undefined
  // on synthesized rows (they're aggregated from the user's own drafts, so
  // there's nothing to show) — those columns render as "—".
  const mergedExposures = useMemo(() => {
    if (!showUndrafted) return exposures;
    const have = new Set(exposures.map(e => e.teamPosition));
    const zeros: ExposureEntry[] = [];
    for (const team of nflTeams) {
      for (const pos of positions) {
        const tp = `${team} ${pos}`;
        if (!have.has(tp)) {
          zeros.push({ team, position: pos, teamPosition: tp, drafts: 0, totalDrafts, exposure: 0 });
        }
      }
    }
    return [...exposures, ...zeros];
  }, [exposures, showUndrafted, totalDrafts]);

  const filteredExposures = useMemo(() => {
    // Search chips override the position pill — searching "IND RB" with
    // the QB pill active should still surface IND RB1/RB2 rows. Without
    // this, the two filters AND together and the user sees the
    // confusing "no positions match" empty state on what they know is
    // in their portfolio.
    const hasSearch = search.length > 0 && search.some(c => c.trim());
    // With 0% rows included the full universe is 32 teams × 7 slots = 224 —
    // raise the "All" cap so nothing gets silently cut off.
    let data = hasSearch || posFilter === 'all'
      ? getTopExposures(mergedExposures, showUndrafted ? 300 : 100)
      : getExposureByPosition(mergedExposures, posFilter);

    if (hasSearch) {
      // OR across chips: a row is one team-position, so multiple chips
      // restrict the row set to anything matching any chip.
      const queries = search.map(c => c.trim().toLowerCase()).filter(Boolean);
      data = data.filter(e =>
        queries.some(q => e.teamPosition.toLowerCase().includes(q) || e.team.toLowerCase().includes(q)),
      );
    }


    // Enrich with real ADP for sorting + display. avgPick is the
    // actual average pick number we drafted this team-position at (computed
    // server-side in recomputeUserExposure). vsAdp = avgPick − adp:
    //   negative → we drafted EARLIER than ADP (a reach),
    //   positive → we drafted LATER than ADP (value).
    return data
      .map(e => {
        // Real ADP straight from the exposure doc (999 = none, render as —).
        const adp = typeof e.adp === 'number' && e.adp > 0 ? e.adp : 999;
        // undefined (not null) so the enriched row stays assignable to
        // ExposureEntry (avgPick?: number) when we open the detail modal.
        const avgPick = typeof e.avgPick === 'number' && e.avgPick > 0 ? e.avgPick : undefined;
        const vsAdp = avgPick !== undefined && adp < 999 ? Math.round((avgPick - adp) * 10) / 10 : undefined;
        return { ...e, adp, avgPick, vsAdp };
      })
      .sort((a, b) => {
        // Alphabetical tie-break so the 0% block reads as an ordered list
        // instead of landing in whatever order the universe was generated.
        if (sortBy === 'adp' && a.adp !== b.adp) return a.adp - b.adp;
        if (sortBy === 'exposure' && a.exposure !== b.exposure) return b.exposure - a.exposure;
        return a.teamPosition.localeCompare(b.teamPosition);
      });
  }, [mergedExposures, posFilter, search, sortBy, showUndrafted]);

  // "Team #" lookup — type your team/league number and open that team's card
  // (same idea as My Teams / Marketplace). Matches the league number shown on
  // your teams (League #N) and opens the card view in the detail modal.
  const openTeamByNumber = (raw: string) => {
    const q = raw.trim().replace(/^#/, '');
    if (!q) return;
    const hit =
      leagues.find(l => (l.name.match(/#\s*(\d+)/)?.[1] ?? '') === q) ||
      leagues.find(l => (l.name.match(/#\s*(\d+)/)?.[1] ?? '').includes(q));
    if (hit) openLeague(hit, 'team');
  };

  // Real stacks = QB + at least one skill (WR / TE / RB). DST and other
  // permutations don't count because in best ball, "stacking" only has
  // positive correlation when your QB and his pass-catchers / backs
  // score together. ONE exception: the full 5-stack (QB+RB+WR+TE+DST —
  // every position group from one team) shows, DST included. Partial
  // DST combos (QB+DST, QB+WR+DST, …) stay hidden so they don't dilute
  // the 2+/3+ views.
  const STACK_SKILL_GROUPS = ['WR', 'TE', 'RB'] as const;
  const stacks = useMemo(() => {
    const all = computeStacksFromLeagues(leagues);
    return all.filter(s =>
      s.size === 5 || (
        s.positions.includes('QB') &&
        s.positions.some(p => (STACK_SKILL_GROUPS as readonly string[]).includes(p)) &&
        s.positions.every(p => p === 'QB' || (STACK_SKILL_GROUPS as readonly string[]).includes(p))
      ),
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
  // Mock — used ONLY for the modal's Season / depth-chart fields.
  const selectedTP = selectedExposure
    ? getTeamPosition(selectedExposure.team, selectedExposure.position)
    : null;
  // Real ADP for the open detail tile (from the exposure doc), and the
  // actual-vs-ADP delta. Positive = value (drafted later than ADP), negative
  // = reach. null when either piece is missing → render as —.
  const selectedAdp =
    selectedExposure && typeof selectedExposure.adp === 'number' && selectedExposure.adp > 0
      ? selectedExposure.adp
      : null;
  const selectedAvgPick =
    selectedExposure && typeof selectedExposure.avgPick === 'number' && selectedExposure.avgPick > 0
      ? selectedExposure.avgPick
      : null;
  const selectedVsAdp =
    selectedAvgPick !== null && selectedAdp !== null
      ? Math.round((selectedAvgPick - selectedAdp) * 10) / 10
      : null;

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="w-full min-h-screen px-4 sm:px-8 lg:px-12 py-8 max-w-5xl mx-auto">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white mb-1">Exposure</h1>
          <p className="text-white/40 text-sm">
            {totalDrafts > 0
              ? `${totalDrafts} drafts · Portfolio breakdown across all your teams`
              : isBuilding
                ? 'Building your exposure…'
                : 'Draft to start tracking your portfolio exposure'}
          </p>
        </div>
        {/* Back to Teams + Marketplace — mirrors the Teams-page header so the
            two views feel like one section. */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link
            href="/teams"
            className="px-3 py-2 text-sm font-medium text-white/60 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition-all"
          >
            Teams
          </Link>
          <Link
            href="/marketplace"
            className="px-3 py-2 text-sm font-medium text-white/60 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition-all"
          >
            Marketplace
          </Link>
        </div>
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
                  {/* Keep the slot suffix (RB1 vs RB2, WR1 vs WR2) — Richard
                      wants the distinction visible so users can see whether
                      they're loading up on lead backs/receivers or skewing
                      to second options. The slot is the user's Nth pick
                      at that position for the draft. */}
                  <span
                    className="text-xs font-bold px-1.5 py-0.5 rounded"
                    style={{
                      backgroundColor: posColor(summary.topExposure.position) + '30',
                      color: posColor(summary.topExposure.position),
                    }}
                  >
                    {summary.topExposure.position} {summary.topExposure.team}
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

      {/* ── Sub-view tabs: Position Exposure / Team Stacks ─────────────── */}
      {totalDrafts > 0 && (
        <div className="flex gap-1 bg-white/[0.04] rounded-xl p-1 mb-6 w-fit">
          <button
            onClick={() => setExposureTab('positions')}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              exposureTab === 'positions' ? 'bg-white/15 text-white' : 'text-white/45 hover:text-white/70'
            }`}
          >
            Position Exposure
          </button>
          <button
            onClick={() => setExposureTab('stacks')}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              exposureTab === 'stacks' ? 'bg-white/15 text-white' : 'text-white/45 hover:text-white/70'
            }`}
          >
            Team Stacks
            {stacks.length > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-banana/20 text-banana">
                {stacks.length}
              </span>
            )}
          </button>
        </div>
      )}

      {/* ── Section 2: Position Exposure Table ─────────────────────────── */}
      <div className={exposureTab === 'positions' ? 'mb-10' : 'hidden'}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-6 mb-6">
          {/* Left: position pills. They WRAP on mobile so every position
              (including DST) is visible without horizontal scrolling; on desktop
              they stay a single scrollable row beside the sort toggle. */}
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <div className="flex flex-wrap sm:flex-nowrap gap-1.5 sm:overflow-x-auto pb-1">
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
            {/* Sort — desktop only, beside the pills. On mobile it drops to the
                second line below (with the searches) so the pills get the full
                width and never push DST off-screen. */}
            <div className="hidden sm:flex bg-white/[0.04] rounded-lg p-0.5 flex-shrink-0">
              {([['exposure', 'Exp%'], ['adp', 'ADP']] as [SortField, string][]).map(([key, label]) => (
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
          </div>

          {/* Right (second line on mobile): sort (mobile only) + "Team #" lookup
              + slot search. The Team # input opens that team's card via the detail
              modal — same "search your team" idea as My Teams / Marketplace. */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="flex sm:hidden bg-white/[0.04] rounded-lg p-0.5 flex-shrink-0">
              {([['exposure', 'Exp%'], ['adp', 'ADP']] as [SortField, string][]).map(([key, label]) => (
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
            {/* 0% toggle — pad the table with every team-position the user
                has never drafted, so they can spot teams they hold zero of.
                Pairs with the position pills: tap QB + 0%s = all 32 QBs. */}
            <button
              onClick={() => setShowUndrafted(v => !v)}
              title="Include team positions you haven't drafted (0% exposure)"
              className={`text-[11px] px-2.5 py-2 rounded-[10px] font-semibold transition-colors flex-shrink-0 whitespace-nowrap ${
                showUndrafted
                  ? 'bg-banana text-black'
                  : 'bg-white/[0.03] border border-white/[0.06] text-white/50 hover:text-white/70 hover:bg-white/[0.06]'
              }`}
            >
              0%s
            </button>
            <input
              type="number"
              inputMode="numeric"
              value={teamLookup}
              onChange={(e) => setTeamLookup(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') openTeamByNumber(teamLookup); }}
              placeholder="Team #"
              aria-label="Open one of your teams by number"
              className="w-[74px] sm:w-[88px] px-3 py-2 rounded-[10px] bg-white/[0.03] border border-white/[0.06] text-[13px] font-medium text-white placeholder:text-white/40 focus:border-banana/50 hover:bg-white/[0.06] outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <MultiChipSearch
              chips={search}
              onChange={setSearch}
              options={slotOptions}
              placeholder="IND RB…"
              className="w-28 sm:w-40"
            />
          </div>
        </div>

        {/* Table */}
        {filteredExposures.length > 0 ? (
          <div className="rounded-xl border border-white/[0.06] overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-[100px_1fr_48px] sm:grid-cols-[36px_120px_1fr_56px_48px_56px_72px_40px] gap-1 px-3 sm:px-4 py-2.5 bg-white/[0.03] border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-white/30 font-medium">
              <div className="hidden sm:block">#</div>
              <div>Position</div>
              <div>Exposure</div>
              <div className="hidden sm:block text-right">Drafts</div>
              <div className="text-right">%</div>
              <div className="hidden sm:block text-right" title="Consensus ADP — where this slot is typically drafted across all drafts (the market price)">ADP</div>
              <div className="hidden sm:block text-right" title="Where YOU drafted it on average. Green = value (you got it later than ADP), red = reach (earlier than ADP)">Your Pick</div>
              <div className="hidden sm:block text-right">Bye</div>
            </div>

            {/* Rows */}
            {filteredExposures.map((e, idx) => {
              const bye = teamByeWeeks[e.team] || '—';
              return (
                <div
                  key={e.teamPosition}
                  onClick={() => setSelectedExposure(e)}
                  className="grid grid-cols-[100px_1fr_48px] sm:grid-cols-[36px_120px_1fr_56px_48px_56px_72px_40px] gap-1 px-3 sm:px-4 py-2.5 items-center hover:bg-white/[0.04] cursor-pointer transition-colors border-b border-white/[0.03] last:border-0"
                >
                  <span className="hidden sm:block text-white/30 text-xs">{idx + 1}</span>
                  <div className="flex items-center">
                    <span
                      className="inline-flex items-center gap-1.5 text-xs font-bold px-2 py-0.5 rounded"
                      style={{ backgroundColor: posColor(e.position) + '25', color: posColor(e.position) }}
                    >
                      {e.position}
                      <span>{e.team}</span>
                    </span>
                  </div>
                  {/* Exposure bar */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-white/[0.06] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${Math.min(e.exposure, 100)}%`, backgroundColor: posColor(e.position) }}
                      />
                    </div>
                  </div>
                  <span className="hidden sm:block text-white/50 text-xs text-right">{e.drafts}/{e.totalDrafts}</span>
                  <span className="text-right text-sm font-semibold" style={{ color: exposureColor(e.exposure) }}>
                    {e.exposure}%
                  </span>
                  <span className="hidden sm:block text-white/50 text-xs text-right">{e.adp < 999 ? e.adp : '—'}</span>
                  {/* Actual avg pick + how it compares to ADP. green = value
                      (drafted later than ADP), red = reach (earlier), muted
                      "even" = right on ADP. Plain "—" = no pick data at all. */}
                  <span className="hidden sm:block text-xs text-right tabular-nums whitespace-nowrap">
                    {e.avgPick !== undefined ? (
                      <>
                        <span className="text-white/70">{e.avgPick.toFixed(1)}</span>
                        {e.vsAdp !== undefined && (
                          e.vsAdp === 0 ? (
                            <span className="ml-1 text-[10px] text-white/30" title="Drafted right at ADP">even</span>
                          ) : (
                            <span
                              className="ml-1 font-semibold"
                              style={{ color: e.vsAdp > 0 ? '#4ade80' : '#ff6b6b' }}
                              title={e.vsAdp > 0 ? 'Drafted later than ADP (value)' : 'Drafted earlier than ADP (reach)'}
                            >
                              {e.vsAdp > 0 ? '+' : ''}{e.vsAdp}
                            </span>
                          )
                        )}
                      </>
                    ) : (
                      <span className="text-white/30">—</span>
                    )}
                  </span>
                  <span className="hidden sm:block text-white/30 text-xs text-right">{bye}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-12 rounded-xl border border-white/[0.04] bg-white/[0.02]">
            <p className="text-white/40 text-sm">
              {totalDrafts === 0
                ? (isBuilding ? 'Building your exposure…' : 'No draft data yet')
                : 'No positions match your filters'}
            </p>
            {totalDrafts > 0 && !showUndrafted && (
              <button onClick={() => setShowUndrafted(true)} className="text-banana text-xs mt-2 hover:underline">
                Include 0% positions
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Matching Drafts (any chip search) ───────────────────────────── */}
      {exposureTab === 'positions' && search.length > 0 && comboMatchingLeagues.length > 0 && (
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
      {exposureTab === 'positions' && search.length > 0 && comboMatchingLeagues.length === 0 && (
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
      {exposureTab === 'stacks' && stacks.length > 0 && (
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
                {([2, 3, 4, 5] as const).map(size => (
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

      {/* Stacks tab, but no stacks built yet */}
      {exposureTab === 'stacks' && stacks.length === 0 && totalDrafts > 0 && (
        <div className="mb-10 text-center py-12 rounded-xl border border-white/[0.04] bg-white/[0.02]">
          <p className="text-white/50 text-sm">No team stacks yet.</p>
          <p className="text-white/30 text-xs mt-1">Draft a QB plus a pass-catcher from the same NFL team to build a stack.</p>
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────────────────── */}
      {/* Only a GENUINE zero shows the "start drafting" empty state. While the
          server is still (re)building a snapshot, `isBuilding` suppresses it so
          a drafter never sees a false "you have no teams". */}
      {totalDrafts === 0 && !exposureQuery.isValidating && !isBuilding && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-16 text-center">
          <div className="text-4xl mb-4">&#x1F4CA;</div>
          <p className="text-white/50 font-medium mb-2">No exposure data yet</p>
          <p className="text-white/30 text-sm mb-6">Your exposures from your drafted teams will show here.</p>
          <a
            href="/drafting"
            className="inline-block px-6 py-2.5 bg-banana text-black font-semibold rounded-xl hover:bg-banana-dark transition-colors"
          >
            Start Drafting
          </a>
        </div>
      )}

      {/* ── Loading / building ────────────────────────────────────────── */}
      {(exposureQuery.isValidating || isBuilding) && totalDrafts === 0 && (
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
              <h3 className="text-white font-bold text-lg">{selectedExposure.position} {selectedExposure.team}</h3>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 mb-5">
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
                <p className="text-white font-bold">{selectedAdp ?? '—'}</p>
              </div>
              <div className="bg-white/[0.04] rounded-lg px-3 py-2 text-center">
                <p className="text-white/40 text-[10px] uppercase tracking-wider">Your Pick</p>
                {selectedAvgPick !== null ? (
                  <p className="text-white font-bold">
                    {selectedAvgPick.toFixed(1)}
                    {selectedVsAdp !== null && (
                      selectedVsAdp === 0 ? (
                        <span className="ml-1 text-xs text-white/30" title="Drafted right at ADP">even</span>
                      ) : (
                        <span
                          className="ml-1 text-xs font-semibold"
                          style={{ color: selectedVsAdp > 0 ? '#4ade80' : '#ff6b6b' }}
                          title={selectedVsAdp > 0 ? 'Drafted later than ADP (value)' : 'Drafted earlier than ADP (reach)'}
                        >
                          {selectedVsAdp > 0 ? '+' : ''}{selectedVsAdp}
                        </span>
                      )
                    )}
                  </p>
                ) : (
                  <p className="text-white/30 font-bold">—</p>
                )}
              </div>
              <div className="bg-white/[0.04] rounded-lg px-3 py-2 text-center">
                <p className="text-white/40 text-[10px] uppercase tracking-wider">Bye</p>
                <p className="text-white font-bold">{teamByeWeeks[selectedExposure.team] ?? '—'}</p>
              </div>
            </div>

            {/* Season points */}
            {selectedTP && (
              <div className="mb-5 flex items-center gap-4">
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
                      : l.type === 'jackhof' ? '#ef6c37'
                      : '#a855f7';
                    const typeLabel = l.type === 'jackpot' ? 'JP' : l.type === 'hof' ? 'HOF' : l.type === 'jackhof' ? 'JACKHOF' : 'Pro';
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
                  : l.type === 'jackhof' ? '#ef6c37'
                  : '#a855f7';
                const typeLabel = l.type === 'jackpot' ? 'JP' : l.type === 'hof' ? 'HOF' : l.type === 'jackhof' ? 'JACKHOF' : 'Pro';
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
