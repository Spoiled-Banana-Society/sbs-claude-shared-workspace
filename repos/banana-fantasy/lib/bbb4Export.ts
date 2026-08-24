/**
 * Public BBB4 team dataset — every drafted Banana Best Ball 4 team, built from
 * draftTokenMetadata (the same source OpenSea reads). Served by
 * /api/data/bbb4 and summarised on /data/bbb4.
 *
 * Rosters are normalised to "TEAM POS" (older tokens stored "SF QB", newer
 * ones "SF-QB" — both are handled). Wheel / promo seats live in "special-*"
 * docs that get mirrored onto a numbered token once the seat is linked to an
 * NFT, so the set is deduped by league + roster with the numbered token
 * winning; unlinked seats keep their special id. Tokens without a roster
 * (undrafted / voided) are skipped.
 *
 * Result is cached in-module for an hour — the scan is ~10k doc reads, so it
 * must never run per request.
 */

import { getAdminFirestore } from './firebaseAdmin';

export type Bbb4Team = {
  /** BBB pass number, or the special seat id for a wheel / promo team not yet linked to a pass. */
  token: string;
  league: string;
  level: string;
  qbCount: number;
  rbCount: number;
  wrCount: number;
  teCount: number;
  dstCount: number;
  /** QBs that share an NFL team with at least one WR or TE on the roster. */
  qbsStacked: number;
  /** Position-sorted roster, e.g. "DET QB" — as stored on the token. */
  roster: string[];
};

export type Bbb4Dataset = {
  generatedAt: string;
  teamCount: number;
  stats: {
    byQbCount: Record<string, { teams: number; allStacked: number }>;
    fourPlusQb: number;
    fourPlusQbAllStacked: number;
  };
  teams: Bbb4Team[];
};

const ROSTER_TRAIT = /^(QB|RB|WR|TE|DST)\d+$/i;
const PLAYER = /^([A-Z]{2,3})[\s-]+(QB|RB|WR|TE|DST)(\d*)/;
const CACHE_MS = 60 * 60 * 1000;

let cache: { at: number; data: Bbb4Dataset } | null = null;
let inflight: Promise<Bbb4Dataset> | null = null;

function parseRoster(values: string[]): { team: string; pos: string; label: string }[] | null {
  const out: { team: string; pos: string; label: string }[] = [];
  for (const raw of values) {
    const m = String(raw).trim().match(PLAYER);
    if (!m) return null;
    out.push({ team: m[1], pos: m[2], label: `${m[1]} ${m[2]}${m[3] ?? ''}` });
  }
  return out;
}

async function build(): Promise<Bbb4Dataset> {
  const db = getAdminFirestore();
  const snap = await db.collection('draftTokenMetadata').get();
  const byKey = new Map<string, Bbb4Team>();
  const byQb: Record<string, { teams: number; allStacked: number }> = {};

  for (const doc of snap.docs) {
    const attrs = (doc.get('Attributes') ?? []) as { Trait_Type?: string; Value?: unknown; value?: unknown }[];
    const trait = (t: string) => {
      const a = attrs.find((x) => x.Trait_Type === t);
      return a ? String(a.Value ?? a.value ?? '') : '';
    };
    const rosterRaw = attrs
      .filter((a) => ROSTER_TRAIT.test(String(a.Trait_Type ?? '')))
      .map((a) => String(a.Value ?? a.value ?? ''));
    if (rosterRaw.length === 0) continue;
    const players = parseRoster(rosterRaw);
    if (!players) continue;

    const count = (pos: string) => players.filter((p) => p.pos === pos).length;
    const qbs = players.filter((p) => p.pos === 'QB');
    const wrTeTeams = new Set(players.filter((p) => p.pos === 'WR' || p.pos === 'TE').map((p) => p.team));
    const qbsStacked = qbs.filter((q) => wrTeTeams.has(q.team)).length;

    const team: Bbb4Team = {
      token: doc.id,
      league: trait('LEAGUE-NAME'),
      level: trait('LEVEL'),
      qbCount: qbs.length,
      rbCount: count('RB'),
      wrCount: count('WR'),
      teCount: count('TE'),
      dstCount: count('DST'),
      qbsStacked,
      roster: players.map((p) => p.label),
    };
    const key = `${team.league}::${[...team.roster].sort().join('|')}`;
    const prev = byKey.get(key);
    if (prev && (/^\d+$/.test(prev.token) || !/^\d+$/.test(team.token))) continue;
    byKey.set(key, team);
  }

  const teams = [...byKey.values()];
  for (const team of teams) {
    const k = String(team.qbCount);
    byQb[k] ??= { teams: 0, allStacked: 0 };
    byQb[k].teams++;
    if (team.qbCount > 0 && team.qbsStacked === team.qbCount) byQb[k].allStacked++;
  }

  const isNum = (t: string) => /^\d+$/.test(t);
  teams.sort((a, b) => {
    if (isNum(a.token) && isNum(b.token)) return Number(a.token) - Number(b.token);
    if (isNum(a.token)) return -1;
    if (isNum(b.token)) return 1;
    return a.token.localeCompare(b.token);
  });
  const fourPlus = teams.filter((t) => t.qbCount >= 4);
  return {
    generatedAt: new Date().toISOString(),
    teamCount: teams.length,
    stats: {
      byQbCount: byQb,
      fourPlusQb: fourPlus.length,
      fourPlusQbAllStacked: fourPlus.filter((t) => t.qbsStacked === t.qbCount).length,
    },
    teams,
  };
}

export async function getBbb4Dataset(): Promise<Bbb4Dataset> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  if (!inflight) {
    inflight = build()
      .then((data) => {
        cache = { at: Date.now(), data };
        return data;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One row per team; roster split into per-position slot columns. */
export function bbb4ToCsv(data: Bbb4Dataset): string {
  const max: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0, DST: 0 };
  for (const t of data.teams) {
    max.QB = Math.max(max.QB, t.qbCount);
    max.RB = Math.max(max.RB, t.rbCount);
    max.WR = Math.max(max.WR, t.wrCount);
    max.TE = Math.max(max.TE, t.teCount);
    max.DST = Math.max(max.DST, t.dstCount);
  }
  const order = ['QB', 'RB', 'WR', 'TE', 'DST'] as const;
  const slotCols: string[] = [];
  for (const pos of order) for (let i = 1; i <= max[pos]; i++) slotCols.push(`${pos}${i}`);

  const header = ['token', 'league', 'level', 'qb_count', 'rb_count', 'wr_count', 'te_count', 'dst_count', 'qbs_stacked', ...slotCols, 'roster'];
  const lines = [header.join(',')];
  for (const t of data.teams) {
    const slots: Record<string, string> = {};
    const seen: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0, DST: 0 };
    for (const label of t.roster) {
      const pos = label.split(' ')[1].replace(/\d+$/, '');
      seen[pos] = (seen[pos] ?? 0) + 1;
      slots[`${pos}${seen[pos]}`] = label;
    }
    const row = [
      t.token, t.league, t.level, t.qbCount, t.rbCount, t.wrCount, t.teCount, t.dstCount, t.qbsStacked,
      ...slotCols.map((c) => slots[c] ?? ''),
      t.roster.join(' | '),
    ];
    lines.push(row.map(csvCell).join(','));
  }
  return lines.join('\n') + '\n';
}
