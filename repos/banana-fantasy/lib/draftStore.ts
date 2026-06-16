/**
 * Centralized read/write for `banana-active-drafts` localStorage key
 * with pub/sub notifications so React hooks can stay in sync.
 */

const STORAGE_KEY = 'banana-active-drafts';

export interface DraftState {
  id: string;
  contestName: string;
  status: 'filling' | 'drafting' | 'completed';
  type: 'pro' | 'hof' | 'jackpot' | null; // null = unrevealed
  draftSpeed: 'fast' | 'slow';
  players: number;
  maxPlayers: number;
  currentPick?: number;
  totalPicks?: number;
  isYourTurn?: boolean;
  timeRemaining?: number;
  yourPosition?: number;
  joinedAt?: number;
  lastUpdated: number;

  // Phase & timing for resuming draft room state
  phase?: 'filling' | 'pre-spin' | 'spinning' | 'result' | 'countdown' | 'drafting';
  preSpinStartedAt?: number;
  randomizingStartedAt?: number;  // Timestamp when "Randomizing Draft Order" began (10/10 reached)
  // Server's authoritative draft-start time (epoch MS). Set from the live
  // realTimeDraftInfo.draftStartTime so the reveal animation runs off ONE clock
  // on every device (no per-device "saw it fill" drift). When set + the draft
  // is full, getLiveState derives filling→reveal→drafting purely from this.
  draftStartTimeMs?: number;
  // The user's 0-based seat in the draft order (static once drafting). Cached
  // from the poll so the realtime RTDB push can compute "N picks away" instantly
  // (snake math from the live pickNumber) without re-fetching the draft order.
  userSeat?: number;
  draftType?: 'pro' | 'hof' | 'jackpot' | null;
  draftOrder?: Array<{ id: string; name: string; displayName: string; isYou: boolean; avatar: string }>;
  userDraftPosition?: number;

  // Live sync metadata (for REST polling on drafting page)
  liveWalletAddress?: string;    // Wallet address for API calls
  pickEndTimestamp?: number;     // Absolute Unix seconds — when current pick expires

  // Airplane mode (auto-pick enabled)
  airplaneMode?: boolean;
  // Slot machine was dismissed (don't re-show on re-entry)
  slotDismissed?: boolean;

  // Pass type used to enter this draft
  passType?: 'paid' | 'free';

  // Special draft type (Jackpot/HOF from wheel) — forces slot machine result
  specialType?: 'jackpot' | 'hof';
  // Card/token ID from the join response (needed for leave)
  cardId?: string;
  // Real Go API draftId for queue drafts (id field uses queue-type-roundId for uniqueness)
  queueDraftId?: string;

  // Engine state for resuming mid-draft
  enginePicks?: Array<{
    pickNumber: number; round: number; pickInRound: number;
    ownerName: string; ownerIndex: number;
    playerId: string; position: string; team: string;
  }>;
  enginePickNumber?: number;
  engineQueue?: Array<{
    playerId: string; team: string; position: string;
    adp: number; rank: number; byeWeek: number; playersFromTeam: string[];
  }>;
}

type Listener = () => void;

const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Migrate older cached display names to the current "League #N" shape.
// Earlier builds cached "BBB #N" or "BBB League #N" — both flatten to
// "League #N" so the UI is consistent regardless of when the entry was
// first cached. Exported so admin views can normalize the raw
// Firestore `displayName` (which the Go API still writes as "BBB #N")
// the same way the live drafting UI does.
export function normalizeContestName(name: string | undefined | null): string {
  if (!name) return '';
  if (name.startsWith('BBB League #')) return name.replace(/^BBB League\s*#/, 'League #');
  if (name.startsWith('BBB #')) return name.replace(/^BBB\s*#/, 'League #');
  return name;
}

// Clear any cached contestName that was derived from the slot number —
// older builds wrote "League #${slot}" or "BBB League #${slot}" into
// localStorage as a fallback when the backend didn't return a
// displayName. The slot counter drifts from the global league number,
// so that fallback is almost always wrong by mid-season. Blanking it
// forces useLeagueNumberForSlot to resolve the real number from Firestore.
function purgeSlotDerivedName(d: DraftState): DraftState {
  const slotMatch = /-draft-(\d+)$/.exec(d.id || '');
  if (!slotMatch) return d;
  const slot = slotMatch[1];
  if (
    d.contestName === `League #${slot}` ||
    d.contestName === `BBB League #${slot}` ||
    d.contestName === `BBB #${slot}`
  ) {
    return { ...d, contestName: '' };
  }
  return d;
}

function readAll(): DraftState[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DraftState[];
    return parsed.map(d => purgeSlotDerivedName({ ...d, contestName: normalizeContestName(d.contestName) }));
  } catch {
    return [];
  }
}

function writeAll(drafts: DraftState[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  notify();
}

export function getActiveDrafts(): DraftState[] {
  return readAll();
}

export function getDraft(id: string): DraftState | undefined {
  return readAll().find((d) => d.id === id);
}

export function addDraft(draft: Omit<DraftState, 'lastUpdated'>) {
  const all = readAll();
  // Avoid duplicates
  if (all.some((d) => d.id === draft.id)) return;
  all.push({ ...draft, lastUpdated: Date.now() });
  writeAll(all);
}

export function updateDraft(id: string, patch: Partial<DraftState>) {
  const all = readAll();
  const idx = all.findIndex((d) => d.id === id);
  if (idx === -1) return;
  all[idx] = { ...all[idx], ...patch, lastUpdated: Date.now() };
  writeAll(all);
}

export function removeDraft(id: string) {
  const all = readAll().filter((d) => d.id !== id);
  writeAll(all);
}

/**
 * Drop drafts whose `state/info` endpoint returns 404 — i.e. the backend has
 * deleted/expired/aborted the draft but the local cache still points at it,
 * leaving a ghost row in the user's lobby. Designed to run on drafting-page
 * mount so admin-side deletions propagate without a manual "Clear All" step.
 *
 * Conservative rules:
 *   - Only prune drafts older than STALE_GUARD_MS, so in-flight joins aren't
 *     wrongly dropped while their first `state/info` is still 404 mid-race.
 *   - Only prune on a definite 404. 5xx / network errors leave the draft alone
 *     so a transient backend blip can't wipe a real user's lobby.
 *   - Skip `pending-*` ids — those are placeholder rows that exist before the
 *     real draftId comes back from joinDraft.
 *
 * Returns the list of pruned ids.
 */
const STALE_GUARD_MS = 30_000;

export async function pruneMissingDrafts(): Promise<string[]> {
  if (typeof window === 'undefined') return [];
  const all = readAll();
  if (all.length === 0) return [];

  // Dynamic imports keep draftStore SSR-safe. `lib/staging` reads
  // window-side flags during isStagingMode(); `lib/clientLog` ships to
  // /api/debug/log so prune activity shows up in the admin Logs tab.
  const [{ createDraftsHttpClient }, { clientLog }] = await Promise.all([
    import('@/lib/draftsHttpClient'),
    import('@/lib/clientLog'),
  ]);
  const client = createDraftsHttpClient();

  const now = Date.now();
  const candidates = all.filter((d) => {
    if (!d.id || d.id.startsWith('pending-')) return false;
    const age = now - (d.joinedAt ?? d.lastUpdated ?? 0);
    return age > STALE_GUARD_MS;
  });

  clientLog('prune', 'start', {
    cached: all.length,
    candidates: candidates.length,
    skippedFresh: all.length - candidates.length,
  });

  const pruned: string[] = [];
  const errors: Array<{ id: string; reason: string }> = [];
  for (const d of candidates) {
    try {
      await client.get(`/draft/${d.id}/state/info`);
    } catch (e) {
      const { ApiError } = await import('@/lib/api/client');
      if (e instanceof ApiError && e.status === 404) {
        pruned.push(d.id);
        clientLog('prune', 'remove', { id: d.id });
      } else if (e instanceof ApiError && e.status && e.status >= 500) {
        errors.push({ id: d.id, reason: `http_${e.status}` });
      } else {
        errors.push({
          id: d.id,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  if (pruned.length > 0) {
    const remaining = readAll().filter((d) => !pruned.includes(d.id));
    writeAll(remaining);
  }

  clientLog('prune', 'done', {
    prunedCount: pruned.length,
    pruned,
    errors,
  });

  return pruned;
}
