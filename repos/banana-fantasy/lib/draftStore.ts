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
// first cached.
function normalizeContestName(name: string | undefined): string {
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
