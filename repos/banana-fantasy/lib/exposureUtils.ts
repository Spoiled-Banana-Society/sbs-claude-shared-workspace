export interface ExposureEntry {
  team: string;
  position: string;
  teamPosition: string;
  drafts: number;
  totalDrafts: number;
  exposure: number; // percentage
  displayName?: string;
  bye?: number;
  adp?: number;
  projectedPoints?: number;
  // Average overall pick number we actually drafted this team-position at,
  // across all our drafts (computed server-side in recomputeUserExposure
  // from each draft's /playerState/{wallet} pickNum). Undefined when the
  // pick data wasn't available. Pairs with `adp` to show actual-vs-ADP.
  avgPick?: number;
}

export interface UserExposure {
  username: string;
  totalDrafts: number;
  exposures: ExposureEntry[];
}

export interface DepthChartPlayer {
  name: string;
  depthPosition: string; // e.g., "QB1", "WR1", "WR2"
  projectedPoints: number;
  adp: number;
}

export interface TeamDepthChart {
  [position: string]: DepthChartPlayer[];
}

export interface ByeWeekExposure {
  week: number;
  drafts: number;
  totalDrafts: number;
  exposure: number;
  teams: string[];
}

export interface TeamStack {
  team: string;
  positions: string[];
  stackType: string; // e.g., "QB + WR", "QB + TE", "Full Stack"
  drafts: number;
  totalDrafts: number;
  exposure: number;
}

export type DraftPeriod = 'early' | 'mid' | 'late';

export interface DraftTiming {
  period: DraftPeriod;
  label: string;
  dateRange: string;
  drafts: number;
  totalDrafts: number;
  exposure: number;
}

export interface DraftHistory {
  id: string;
  date: string;
  period: DraftPeriod;
  contestName: string;
  entryFee: number;
}

// NFL Teams
export const nflTeams = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE',
  'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
  'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
  'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS',
];

export const positions = ['QB', 'WR1', 'WR2', 'RB1', 'RB2', 'TE', 'DST'];

// Depth Chart Data
export const depthCharts: { [team: string]: TeamDepthChart } = {
  KC: {
    QB: [
      { name: 'Patrick Mahomes', depthPosition: 'QB1', projectedPoints: 24.5, adp: 3.2 },
      { name: 'Carson Wentz', depthPosition: 'QB2', projectedPoints: 12.1, adp: 15.8 },
    ],
    RB1: [
      { name: 'Isiah Pacheco', depthPosition: 'RB1', projectedPoints: 14.2, adp: 4.5 },
      { name: 'Clyde Edwards-Helaire', depthPosition: 'RB2', projectedPoints: 8.5, adp: 9.2 },
    ],
    RB2: [
      { name: 'Clyde Edwards-Helaire', depthPosition: 'RB1', projectedPoints: 8.5, adp: 9.2 },
      { name: 'Jerick McKinnon', depthPosition: 'RB2', projectedPoints: 5.2, adp: 14.1 },
    ],
    TE: [
      { name: 'Travis Kelce', depthPosition: 'TE1', projectedPoints: 16.8, adp: 1.8 },
      { name: 'Noah Gray', depthPosition: 'TE2', projectedPoints: 4.2, adp: 18.5 },
    ],
  },
  PHI: {
    QB: [
      { name: 'Jalen Hurts', depthPosition: 'QB1', projectedPoints: 23.8, adp: 2.9 },
      { name: 'Kenny Pickett', depthPosition: 'QB2', projectedPoints: 10.5, adp: 16.2 },
    ],
    WR1: [
      { name: "A.J. Brown", depthPosition: 'WR1', projectedPoints: 18.5, adp: 2.1 },
      { name: 'DeVonta Smith', depthPosition: 'WR2', projectedPoints: 15.2, adp: 3.8 },
    ],
  },
  BUF: {
    QB: [
      { name: 'Josh Allen', depthPosition: 'QB1', projectedPoints: 25.2, adp: 1.5 },
      { name: 'Mitchell Trubisky', depthPosition: 'QB2', projectedPoints: 9.8, adp: 17.5 },
    ],
  },
  MIA: {
    QB: [
      { name: 'Tua Tagovailoa', depthPosition: 'QB1', projectedPoints: 21.5, adp: 4.8 },
      { name: 'Mike White', depthPosition: 'QB2', projectedPoints: 8.2, adp: 18.1 },
    ],
    WR1: [
      { name: 'Tyreek Hill', depthPosition: 'WR1', projectedPoints: 20.5, adp: 1.2 },
      { name: 'Jaylen Waddle', depthPosition: 'WR2', projectedPoints: 17.8, adp: 2.5 },
    ],
    RB1: [
      { name: "De'Von Achane", depthPosition: 'RB1', projectedPoints: 15.8, adp: 3.2 },
      { name: 'Raheem Mostert', depthPosition: 'RB2', projectedPoints: 10.2, adp: 7.5 },
    ],
    TE: [
      { name: 'Jonnu Smith', depthPosition: 'TE1', projectedPoints: 9.5, adp: 10.2 },
      { name: 'Durham Smythe', depthPosition: 'TE2', projectedPoints: 3.8, adp: 19.5 },
    ],
  },
  CIN: {
    QB: [
      { name: 'Joe Burrow', depthPosition: 'QB1', projectedPoints: 22.8, adp: 3.5 },
      { name: 'Jake Browning', depthPosition: 'QB2', projectedPoints: 11.2, adp: 15.2 },
    ],
    WR1: [
      { name: "Ja'Marr Chase", depthPosition: 'WR1', projectedPoints: 19.8, adp: 1.5 },
      { name: 'Tee Higgins', depthPosition: 'WR2', projectedPoints: 16.5, adp: 3.2 },
    ],
  },
  SF: {
    WR1: [
      { name: 'Deebo Samuel', depthPosition: 'WR1', projectedPoints: 16.2, adp: 4.2 },
      { name: 'Brandon Aiyuk', depthPosition: 'WR2', projectedPoints: 15.8, adp: 4.8 },
    ],
    RB1: [
      { name: 'Christian McCaffrey', depthPosition: 'RB1', projectedPoints: 22.5, adp: 1.1 },
      { name: 'Jordan Mason', depthPosition: 'RB2', projectedPoints: 8.5, adp: 10.5 },
    ],
    TE: [
      { name: 'George Kittle', depthPosition: 'TE1', projectedPoints: 14.2, adp: 3.5 },
      { name: 'Cameron Latu', depthPosition: 'TE2', projectedPoints: 3.5, adp: 19.8 },
    ],
    DST: [
      { name: '49ers Defense', depthPosition: 'DST', projectedPoints: 8.5, adp: 5.2 },
    ],
  },
  MIN: {
    WR1: [
      { name: 'Justin Jefferson', depthPosition: 'WR1', projectedPoints: 21.5, adp: 1.0 },
      { name: 'Jordan Addison', depthPosition: 'WR2', projectedPoints: 14.2, adp: 5.5 },
    ],
  },
  DAL: {
    WR2: [
      { name: 'CeeDee Lamb', depthPosition: 'WR1', projectedPoints: 19.5, adp: 1.8 },
      { name: 'Brandin Cooks', depthPosition: 'WR2', projectedPoints: 12.5, adp: 6.8 },
    ],
    RB1: [
      { name: 'Rico Dowdle', depthPosition: 'RB1', projectedPoints: 12.8, adp: 5.8 },
      { name: 'Ezekiel Elliott', depthPosition: 'RB2', projectedPoints: 7.5, adp: 11.2 },
    ],
    TE: [
      { name: 'Jake Ferguson', depthPosition: 'TE1', projectedPoints: 11.5, adp: 6.2 },
      { name: 'Luke Schoonmaker', depthPosition: 'TE2', projectedPoints: 4.8, adp: 17.5 },
    ],
    DST: [
      { name: 'Cowboys Defense', depthPosition: 'DST', projectedPoints: 7.8, adp: 6.5 },
    ],
  },
  DET: {
    WR2: [
      { name: 'Amon-Ra St. Brown', depthPosition: 'WR1', projectedPoints: 18.5, adp: 2.2 },
      { name: 'Jameson Williams', depthPosition: 'WR2', projectedPoints: 13.8, adp: 5.8 },
    ],
    RB1: [
      { name: 'Jahmyr Gibbs', depthPosition: 'RB1', projectedPoints: 16.5, adp: 2.5 },
      { name: 'David Montgomery', depthPosition: 'RB2', projectedPoints: 12.2, adp: 5.2 },
    ],
    TE: [
      { name: 'Sam LaPorta', depthPosition: 'TE1', projectedPoints: 13.5, adp: 4.2 },
      { name: 'Brock Wright', depthPosition: 'TE2', projectedPoints: 3.2, adp: 19.2 },
    ],
  },
  SEA: {
    WR2: [
      { name: 'DK Metcalf', depthPosition: 'WR1', projectedPoints: 16.8, adp: 3.5 },
      { name: 'Tyler Lockett', depthPosition: 'WR2', projectedPoints: 13.2, adp: 6.2 },
    ],
  },
  LAR: {
    WR2: [
      { name: 'Puka Nacua', depthPosition: 'WR1', projectedPoints: 17.5, adp: 2.8 },
      { name: 'Cooper Kupp', depthPosition: 'WR2', projectedPoints: 15.8, adp: 4.2 },
    ],
    RB2: [
      { name: 'Kyren Williams', depthPosition: 'RB1', projectedPoints: 14.5, adp: 3.8 },
      { name: 'Blake Corum', depthPosition: 'RB2', projectedPoints: 6.8, adp: 12.5 },
    ],
  },
  TB: {
    WR2: [
      { name: 'Mike Evans', depthPosition: 'WR1', projectedPoints: 15.8, adp: 4.5 },
      { name: 'Chris Godwin', depthPosition: 'WR2', projectedPoints: 14.2, adp: 5.2 },
    ],
  },
  BAL: {
    RB1: [
      { name: 'Derrick Henry', depthPosition: 'RB1', projectedPoints: 17.5, adp: 2.2 },
      { name: 'Justice Hill', depthPosition: 'RB2', projectedPoints: 6.5, adp: 13.5 },
    ],
    DST: [
      { name: 'Ravens Defense', depthPosition: 'DST', projectedPoints: 8.2, adp: 5.8 },
    ],
  },
  GB: {
    RB2: [
      { name: 'Josh Jacobs', depthPosition: 'RB1', projectedPoints: 15.2, adp: 3.5 },
      { name: 'MarShawn Lloyd', depthPosition: 'RB2', projectedPoints: 7.2, adp: 11.8 },
    ],
  },
  CLE: {
    RB2: [
      { name: 'Jerome Ford', depthPosition: 'RB1', projectedPoints: 11.5, adp: 7.2 },
      { name: "D'Onta Foreman", depthPosition: 'RB2', projectedPoints: 6.8, adp: 13.2 },
    ],
    DST: [
      { name: 'Browns Defense', depthPosition: 'DST', projectedPoints: 7.5, adp: 7.2 },
    ],
  },
  CHI: {
    RB2: [
      { name: "D'Andre Swift", depthPosition: 'RB1', projectedPoints: 13.8, adp: 4.8 },
      { name: 'Khalil Herbert', depthPosition: 'RB2', projectedPoints: 8.2, adp: 10.8 },
    ],
  },
  NYJ: {
    DST: [
      { name: 'Jets Defense', depthPosition: 'DST', projectedPoints: 7.8, adp: 6.8 },
    ],
  },
};

// Bye week mapping for all NFL teams
export const teamByeWeeks: { [team: string]: number } = {
  ARI: 11, ATL: 12, BAL: 14, BUF: 7, CAR: 11, CHI: 7, CIN: 12, CLE: 10,
  DAL: 7, DEN: 14, DET: 5, GB: 10, HOU: 14, IND: 14, JAX: 12, KC: 6,
  LAC: 5, LAR: 6, LV: 10, MIA: 6, MIN: 6, NE: 14, NO: 12, NYG: 11,
  NYJ: 12, PHI: 5, PIT: 9, SEA: 10, SF: 9, TB: 11, TEN: 5, WAS: 14,
};

// Get exposure by position
export function getExposureByPosition(
  exposures: ExposureEntry[],
  position: string,
): ExposureEntry[] {
  return exposures
    .filter((e) => e.position === position)
    .sort((a, b) => b.exposure - a.exposure);
}

// Get top exposures across all positions
export function getTopExposures(
  exposures: ExposureEntry[],
  limit: number = 10,
): ExposureEntry[] {
  return [...exposures]
    .sort((a, b) => b.exposure - a.exposure)
    .slice(0, limit);
}

// Get team exposure (total exposure to a team across all positions)
export function getTeamExposure(
  exposures: ExposureEntry[],
): { team: string; totalExposure: number; positions: string[] }[] {
  const teamMap = new Map<string, { totalExposure: number; positions: string[] }>();

  exposures.forEach((e) => {
    const existing = teamMap.get(e.team);
    if (existing) {
      existing.totalExposure += e.exposure;
      existing.positions.push(e.position);
    } else {
      teamMap.set(e.team, { totalExposure: e.exposure, positions: [e.position] });
    }
  });

  return Array.from(teamMap.entries())
    .map(([team, data]) => ({ team, ...data }))
    .sort((a, b) => b.totalExposure - a.totalExposure);
}

// Get depth chart for a team position
export function getDepthChart(team: string, position: string): DepthChartPlayer[] {
  const teamChart = depthCharts[team];
  if (!teamChart) return [];
  return teamChart[position] || [];
}

// Get bye week exposure - how many drafts are exposed to each bye week
export function getByeWeekExposure(exposure: UserExposure): ByeWeekExposure[] {
  if (!exposure || exposure.totalDrafts <= 0) return [];

  const byeWeekMap = new Map<number, { drafts: Set<string>; teams: Set<string> }>();

  // Initialize all bye weeks
  for (let week = 5; week <= 14; week++) {
    byeWeekMap.set(week, { drafts: new Set(), teams: new Set() });
  }

  // For each exposure, add to the bye week
  exposure.exposures.forEach((e) => {
    const byeWeek = teamByeWeeks[e.team];
    if (byeWeek) {
      const weekData = byeWeekMap.get(byeWeek);
      if (!weekData) return;
      // Simulate draft IDs based on exposure
      for (let i = 0; i < e.drafts; i++) {
        weekData.drafts.add(`${e.team}-${e.position}-${i}`);
      }
      weekData.teams.add(e.team);
    }
  });

  return Array.from(byeWeekMap.entries())
    .map(([week, data]) => {
      // Exposure entries can overlap the same draft, so never let simulated affected drafts
      // exceed the real number of drafts in the user's portfolio.
      const draftsAffected = Math.min(data.drafts.size, exposure.totalDrafts);

      return {
        week,
        drafts: draftsAffected,
        totalDrafts: exposure.totalDrafts,
        exposure: Math.round((draftsAffected / exposure.totalDrafts) * 100),
        teams: Array.from(data.teams),
      };
    })
    .filter((b) => b.drafts > 0)
    .sort((a, b) => b.exposure - a.exposure);
}

export function getTeamStacks(stacks: TeamStack[]): TeamStack[] {
  return stacks
    .filter((s) => s.positions.length > 1) // Only show actual stacks
    .sort((a, b) => b.exposure - a.exposure);
}

/** Auto-detect team stacks from exposure data (teams with 2+ positions drafted). */
export function computeStacks(exposures: ExposureEntry[]): TeamStack[] {
  const teamMap = new Map<string, ExposureEntry[]>();
  for (const e of exposures) {
    if (!teamMap.has(e.team)) teamMap.set(e.team, []);
    teamMap.get(e.team)!.push(e);
  }

  const stacks: TeamStack[] = [];
  for (const [team, entries] of teamMap) {
    if (entries.length < 2) continue;
    const positions = entries.map(e => e.position).sort();
    const hasQB = positions.some(p => p === 'QB');
    // A stack can only exist in drafts where every player overlaps, so use the
    // minimum individual exposure as the best estimate of shared draft overlap.
    const combinedExposure = Math.min(...entries.map(e => e.exposure));
    const avgDrafts = Math.round(entries.reduce((s, e) => s + e.drafts, 0) / entries.length);

    let stackType = 'Multi-Position';
    if (entries.length >= 3) stackType = 'Full Stack';
    else if (hasQB && positions.some(p => p.startsWith('WR'))) stackType = 'QB + WR';
    else if (hasQB && positions.some(p => p === 'TE')) stackType = 'QB + TE';
    else if (hasQB) stackType = 'QB + Skill';

    stacks.push({
      team,
      positions,
      stackType,
      drafts: avgDrafts,
      totalDrafts: entries[0].totalDrafts,
      exposure: combinedExposure,
    });
  }

  return stacks.sort((a, b) => b.positions.length - a.positions.length || b.exposure - a.exposure);
}

// ─── Real per-draft stack computation ─────────────────────────────────
// `computeStacks` above operates on the aggregated portfolio summary
// and reports averages — it does NOT measure actual co-occurrence in
// any specific draft. The functions below walk individual rosters and
// return real combo counts (e.g., the exact number of drafts that
// contain both KC QB and KC WR). Used by the Exposure page's redesigned
// Team Stacks section.

export interface RealStack {
  /** NFL team code, e.g. "KC". */
  team: string;
  /** Position groups present in this stack, sorted alphabetically. e.g. ["QB", "TE", "WR"]. */
  positions: string[];
  /** Number of position groups in this combo (positions.length). */
  size: number;
  /** Drafts (leagues) whose roster contains every listed position group from this team. */
  drafts: number;
  /** Total number of completed drafts the user has — denominator for `exposure`. */
  totalDrafts: number;
  /** Rounded percentage = drafts / totalDrafts × 100. */
  exposure: number;
  /** League ids that contain this stack — used to drill into the LeagueDetailModal. */
  leagueIds: string[];
}

interface MinimalLeague {
  id: string;
  roster: { teamPosition: string }[];
}

/**
 * Walk each league's actual roster and emit one entry per unique
 * (team, sorted-positions) combo, with the real count of drafts that
 * contain it.
 *
 * For a draft where the user has KC QB + KC WR + KC TE, the algorithm
 * emits all 2+ subsets — `QB+TE`, `QB+WR`, `TE+WR`, and `QB+TE+WR` —
 * each incrementing its own counter. Subset semantics: a card for
 * `QB+WR` answers "drafts containing AT LEAST KC QB and KC WR" (the
 * draft above is counted in both `QB+WR` and `QB+TE+WR`).
 *
 * Singletons (combos that appear in exactly one draft) are kept — for
 * users who draft widely, most stacks appear once and dropping them
 * makes the dashboard feel empty. Callers that want a frequency
 * threshold can post-filter on `drafts`.
 */
export function computeStacksFromLeagues(leagues: MinimalLeague[]): RealStack[] {
  const totalDrafts = leagues.length;
  if (totalDrafts === 0) return [];

  const counts = new Map<string, { team: string; positions: string[]; leagueIds: string[] }>();

  for (const league of leagues) {
    // For this league: team -> set of position groups present.
    const teamGroups = new Map<string, Set<string>>();
    for (const r of league.roster ?? []) {
      const [team, slot = ''] = r.teamPosition.split(' ');
      if (!team || !slot) continue;
      const group = slot.replace(/\d+$/, '');
      if (!group) continue;
      let set = teamGroups.get(team);
      if (!set) { set = new Set(); teamGroups.set(team, set); }
      set.add(group);
    }

    for (const [team, groups] of teamGroups) {
      if (groups.size < 2) continue;
      const sorted = [...groups].sort();
      // Enumerate all subsets of size >= 2 via bitmask.
      const n = sorted.length;
      for (let mask = 1; mask < (1 << n); mask++) {
        // Count bits in mask
        let bits = 0;
        for (let i = 0; i < n; i++) if (mask & (1 << i)) bits++;
        if (bits < 2) continue;
        const subset: string[] = [];
        for (let i = 0; i < n; i++) if (mask & (1 << i)) subset.push(sorted[i]);
        const key = `${team}|${subset.join('+')}`;
        let entry = counts.get(key);
        if (!entry) {
          entry = { team, positions: subset, leagueIds: [] };
          counts.set(key, entry);
        }
        entry.leagueIds.push(league.id);
      }
    }
  }

  const out: RealStack[] = [];
  for (const { team, positions, leagueIds } of counts.values()) {
    out.push({
      team,
      positions,
      size: positions.length,
      drafts: leagueIds.length,
      totalDrafts,
      exposure: Math.round((leagueIds.length / totalDrafts) * 100),
      leagueIds,
    });
  }

  return out.sort((a, b) => b.drafts - a.drafts || b.size - a.size);
}

/** Compute bye week risk: total exposure concentration per bye week. */
export function computeByeWeekRisk(exposures: ExposureEntry[]): {
  week: number;
  totalExposure: number;
  teams: string[];
  positions: ExposureEntry[];
}[] {
  const weekMap = new Map<number, { teams: Set<string>; positions: ExposureEntry[]; totalExposure: number }>();

  for (const e of exposures) {
    const bye = teamByeWeeks[e.team];
    if (!bye) continue;
    if (!weekMap.has(bye)) weekMap.set(bye, { teams: new Set(), positions: [], totalExposure: 0 });
    const w = weekMap.get(bye)!;
    w.teams.add(e.team);
    w.positions.push(e);
    w.totalExposure += e.exposure;
  }

  return Array.from(weekMap.entries())
    .map(([week, data]) => ({
      week,
      totalExposure: Math.round(data.totalExposure),
      teams: Array.from(data.teams),
      positions: data.positions,
    }))
    .sort((a, b) => b.totalExposure - a.totalExposure);
}

/** Compute ADP value: compare exposure positions against their ADP. */
export interface ADPValueEntry {
  teamPosition: string;
  team: string;
  position: string;
  adp: number;
  exposure: number;
  projectedPts: number;
}

export function computeADPValue(
  exposures: ExposureEntry[],
  teamPositions: { team: string; position: string; adp: number; projectedPoints: number }[],
): ADPValueEntry[] {
  return exposures
    .map(e => {
      const tp = teamPositions.find(t => t.team === e.team && t.position === e.position);
      if (!tp) return null;
      return {
        teamPosition: e.teamPosition,
        team: e.team,
        position: e.position,
        adp: tp.adp,
        exposure: e.exposure,
        projectedPts: tp.projectedPoints,
      };
    })
    .filter((e): e is ADPValueEntry => e !== null)
    .sort((a, b) => a.adp - b.adp);
}
