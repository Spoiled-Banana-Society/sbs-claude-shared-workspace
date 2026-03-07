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
  phase?: 'filling' | 'pre-spin' | 'spinning' | 'result' | 'drafting';
  fillingStartedAt?: number;
  fillingInitialPlayers?: number; // player count when filling began (for deriving live count)
  preSpinStartedAt?: number;
  randomizingStartedAt?: number;  // Timestamp when "Randomizing Draft Order" began (10/10 reached)
  draftType?: 'pro' | 'hof' | 'jackpot' | null;
  draftOrder?: Array<{ id: string; name: string; displayName: string; isYou: boolean; avatar: string }>;
  userDraftPosition?: number;

  // Live sync metadata (for REST polling on drafting page)
  liveWalletAddress?: string;    // Wallet address for API calls
  pickEndTimestamp?: number;     // Absolute Unix seconds — when current pick expires

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

function readAll(): DraftState[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
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
