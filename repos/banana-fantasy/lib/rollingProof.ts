/**
 * Rolling-era proof helpers — SERVER-side lane/era lookups for the public
 * verification surfaces (per-draft proof route, proof feed + its SSE stream).
 *
 * From draft `RollingStartDraft` (201) on, draft types come from the two
 * rolling lanes, each sealed by an ERA ceremony (~150 windows per lane under
 * ONE on-chain Merkle root — see Go batchproof/lane_eras.go). These helpers
 * only READ what the Go engine wrote (lane_proofs / lane_eras / the tracker
 * hit arrays), so the display can never disagree with crediting.
 *
 * SECRET HYGIENE (the whole point of this module living server-side):
 *  - lane_proofs.{positions,globalDraftIds} are HIDDEN until the cycle
 *    completes ("revealed") — brute-forcible otherwise.
 *  - lane_eras.serverSalt is hidden until the era's LAST cycle completes.
 * `toPublicLaneProof` strips accordingly; NEVER ship a raw doc to a client.
 */
import { getAdminFirestore } from '@/lib/firebaseAdmin';

export const LANE_WINDOW = 100;
export const HOF_SLOTS_PER_WINDOW = 5;

export interface TrackerLike {
  FilledLeaguesCount?: number;
  RollingStartDraft?: number;
  JackpotLeagueIds?: number[];
  HofLeagueIds?: number[];
}

export type RollingLevel = 'Jackpot' | 'Hall of Fame' | 'JackHOF' | 'Pro';

/** Rolling hits for a lane: tracker ids at/after the cutover, ascending. */
export function rollingHits(td: TrackerLike, lane: 'jp' | 'hof'): number[] {
  const src = lane === 'jp' ? td.JackpotLeagueIds : td.HofLeagueIds;
  const start = Number(td.RollingStartDraft ?? 0);
  return (src ?? [])
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= start)
    .sort((a, b) => a - b);
}

/**
 * Replays a lane's hit history to find the cycle covering `draftNumber`.
 * jp: a window ends at its (single) hit; hof: at its 5th in-window hit.
 * Returns the GLOBAL cycle number + that window's start draft. For a draft
 * beyond the still-open current window (rare display edge), `future: true`.
 */
export function findLaneCycleFor(
  lane: 'jp' | 'hof',
  draftNumber: number,
  rollingStart: number,
  hits: number[],
): { cycle: number; windowStart: number; future: boolean } {
  let windowStart = rollingStart;
  let cycle = 1;
  let i = 0;
  for (;;) {
    const windowEnd = windowStart + LANE_WINDOW - 1;
    const inWindow = [] as number[];
    while (i < hits.length && hits[i] <= windowEnd) {
      if (hits[i] >= windowStart) inWindow.push(hits[i]);
      i++;
    }
    const needed = lane === 'jp' ? 1 : HOF_SLOTS_PER_WINDOW;
    const closesAt = inWindow.length >= needed ? inWindow[needed - 1] : null;
    if (closesAt !== null && draftNumber > closesAt) {
      windowStart = closesAt + 1;
      cycle++;
      // rewind: hits after closesAt belong to later windows
      i = hits.findIndex((h) => h > closesAt);
      if (i === -1) i = hits.length;
      continue;
    }
    return { cycle, windowStart, future: draftNumber > windowEnd };
  }
}

/** Raw lane cycle doc (server-side only — contains hidden positions). */
export interface LaneCycleDocRaw {
  lane?: string;
  cycle?: number;
  laneKey?: number;
  startDraft?: number;
  status?: string;
  variant?: string;
  saltHash?: string;
  commitTxHash?: string;
  vrfRandomness?: string;
  positions?: number[];
  globalDraftIds?: number[];
  completedAtDraft?: number;
  era?: number;
  leafIndex?: number;
  leaf?: string;
  merkleProof?: string[];
}

export async function loadLaneCycleDoc(lane: 'jp' | 'hof', cycle: number): Promise<LaneCycleDocRaw | null> {
  const db = getAdminFirestore();
  const snap = await db.collection('lane_proofs').doc(`${lane}-${cycle}`).get();
  return snap.exists ? (snap.data() as LaneCycleDocRaw) : null;
}

export interface LaneEraPublic {
  lane: 'jp' | 'hof';
  era: number;
  eraKey: number | null;
  cycleStart: number | null;
  cycleEnd: number | null;
  status: string | null;
  merkleRoot: string | null;
  commitTxHash: string | null;
  rootCommitTxHash: string | null;
  saltHash: string | null;
  /** Published ONLY once the era is fully revealed (last cycle done). */
  serverSalt: string | null;
  revealTxHash: string | null;
}

export async function loadLaneEraPublic(lane: 'jp' | 'hof', era: number): Promise<LaneEraPublic | null> {
  const db = getAdminFirestore();
  const snap = await db.collection('lane_eras').doc(`${lane}-era-${era}`).get();
  if (!snap.exists) return null;
  const d = snap.data() as Record<string, unknown>;
  const revealed = d.status === 'revealed';
  return {
    lane,
    era,
    eraKey: typeof d.eraKey === 'number' ? d.eraKey : null,
    cycleStart: typeof d.cycleStart === 'number' ? d.cycleStart : null,
    cycleEnd: typeof d.cycleEnd === 'number' ? d.cycleEnd : null,
    status: typeof d.status === 'string' ? d.status : null,
    merkleRoot: typeof d.merkleRoot === 'string' ? d.merkleRoot : null,
    commitTxHash: typeof d.commitTxHash === 'string' ? d.commitTxHash : null,
    rootCommitTxHash: typeof d.rootCommitTxHash === 'string' ? d.rootCommitTxHash : null,
    saltHash: typeof d.saltHash === 'string' ? d.saltHash : null,
    serverSalt: revealed && typeof d.serverSalt === 'string' ? d.serverSalt : null,
    revealTxHash: typeof d.revealTxHash === 'string' ? d.revealTxHash : null,
  };
}

/** Public (client-safe) view of one lane's window covering a draft. */
export interface PublicLaneProof {
  lane: 'jp' | 'hof';
  cycle: number;
  era: number;
  window: [number, number];
  /** 'revealed' = window complete, positions public. 'sealed' = live window,
   *  positions locked on-chain but hidden. 'future' = beyond the live window. */
  status: 'revealed' | 'sealed' | 'future';
  /** Revealed only: positions (derivation order) + their global draft numbers. */
  positions: number[] | null;
  globalDraftIds: number[] | null;
  leaf: string | null;
  merkleProof: string[] | null;
  completedAtDraft: number | null;
  eraInfo: LaneEraPublic | null;
}

export async function buildPublicLaneProof(
  lane: 'jp' | 'hof',
  draftNumber: number,
  td: TrackerLike,
): Promise<PublicLaneProof> {
  const rollingStart = Number(td.RollingStartDraft ?? 0);
  const hits = rollingHits(td, lane);
  const loc = findLaneCycleFor(lane, draftNumber, rollingStart, hits);
  const doc = loc.future ? null : await loadLaneCycleDoc(lane, loc.cycle);
  const era = doc?.era ?? Math.floor((loc.cycle - 1) / 150) + 1;
  const eraInfo = await loadLaneEraPublic(lane, era);
  const revealed = doc?.status === 'revealed';
  return {
    lane,
    cycle: loc.cycle,
    era,
    window: [doc?.startDraft ?? loc.windowStart, (doc?.startDraft ?? loc.windowStart) + LANE_WINDOW - 1],
    status: loc.future ? 'future' : revealed ? 'revealed' : 'sealed',
    positions: revealed ? doc?.positions ?? null : null,
    globalDraftIds: revealed ? doc?.globalDraftIds ?? null : null,
    leaf: revealed ? doc?.leaf ?? null : null,
    merkleProof: revealed ? doc?.merkleProof ?? null : null,
    completedAtDraft: doc?.completedAtDraft ?? null,
    eraInfo,
  };
}

/**
 * SERVER-side committed type for a rolling-era draft — reads the covering
 * cycle docs (positions are readable server-side even while sealed) so the
 * proof feed can gate display exactly like the batch era did. Returns null
 * when lane docs aren't available (feed then shows the written Level as-is).
 */
export async function rollingCommittedLevel(
  draftNumber: number,
  td: TrackerLike,
  cache?: Map<string, LaneCycleDocRaw | null>,
): Promise<RollingLevel | null> {
  const rollingStart = Number(td.RollingStartDraft ?? 0);
  const get = async (lane: 'jp' | 'hof'): Promise<LaneCycleDocRaw | null> => {
    const loc = findLaneCycleFor(lane, draftNumber, rollingStart, rollingHits(td, lane));
    if (loc.future) return null;
    const key = `${lane}-${loc.cycle}`;
    if (cache?.has(key)) return cache.get(key) ?? null;
    const doc = await loadLaneCycleDoc(lane, loc.cycle);
    cache?.set(key, doc);
    return doc;
  };
  const [jpDoc, hofDoc] = await Promise.all([get('jp'), get('hof')]);
  if (!jpDoc && !hofDoc) return null;
  const jp = (jpDoc?.globalDraftIds ?? []).includes(draftNumber);
  const hof = (hofDoc?.globalDraftIds ?? []).includes(draftNumber);
  if (jp && hof) return 'JackHOF';
  if (jp) return 'Jackpot';
  if (hof) return 'Hall of Fame';
  return 'Pro';
}

/** Era summaries for the feed header (current era of each lane). */
export interface LaneEraHeaderInfo {
  jp: LaneEraPublic | null;
  hof: LaneEraPublic | null;
}

export async function loadCurrentLaneEras(td: TrackerLike): Promise<LaneEraHeaderInfo | null> {
  const rollingStart = Number(td.RollingStartDraft ?? 0);
  if (!rollingStart) return null;
  const filled = Number(td.FilledLeaguesCount ?? 0);
  const at = Math.max(rollingStart, filled + 1);
  const [jpLoc, hofLoc] = [
    findLaneCycleFor('jp', at, rollingStart, rollingHits(td, 'jp')),
    findLaneCycleFor('hof', at, rollingStart, rollingHits(td, 'hof')),
  ];
  const [jp, hof] = await Promise.all([
    loadLaneEraPublic('jp', Math.floor((jpLoc.cycle - 1) / 150) + 1),
    loadLaneEraPublic('hof', Math.floor((hofLoc.cycle - 1) / 150) + 1),
  ]);
  return { jp, hof };
}
