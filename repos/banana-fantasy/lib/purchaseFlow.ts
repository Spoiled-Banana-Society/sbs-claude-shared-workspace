/**
 * Module-level purchase flow store.
 *
 * The card path opens an external Privy/MoonPay window, then awaits a USDC
 * top-up, then runs the mint. That whole sequence can take ~30s. If state
 * lived in BuyPassesModal's React state, closing/reopening the modal would
 * unmount the component and reset everything — the user comes back to a
 * blank "buy passes" form with no idea whether their card was charged.
 *
 * This singleton lets the modal remount and resume rendering whatever step
 * the in-flight purchase is on. Reads via useSyncExternalStore.
 */

export type FlowStep =
  | 'idle'
  | 'funding'          // card path — MoonPay open
  | 'waiting-for-usdc' // card path — polling balance
  | 'signing'          // both — wallet signature
  | 'processing'       // both — server tx
  | 'success'
  | 'error';

export type ModalPhase = 'purchase' | 'pick-speed' | 'joining' | 'error';

export interface PurchaseFlowState {
  flowStep: FlowStep;
  flowError: string | null;
  phase: ModalPhase;
  mintedCount: number;
  quantity: number;
  joinError: string | null;
  isJoiningDraft: boolean;
  waitingForUsdcStartedAt: number | null;
}

const initialState: PurchaseFlowState = {
  flowStep: 'idle',
  flowError: null,
  phase: 'purchase',
  mintedCount: 0,
  quantity: 1,
  joinError: null,
  isJoiningDraft: false,
  waitingForUsdcStartedAt: null,
};

let state: PurchaseFlowState = { ...initialState };
const listeners = new Set<() => void>();

export function getPurchaseFlow(): PurchaseFlowState {
  return state;
}

export function subscribePurchaseFlow(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function setPurchaseFlow(patch: Partial<PurchaseFlowState>): void {
  state = { ...state, ...patch };
  listeners.forEach((cb) => cb());
}

/**
 * True if a purchase is in flight or has reached a state the user hasn't
 * acknowledged yet (success awaiting "Pick speed", error awaiting retry,
 * pick-speed awaiting selection). The modal preserves state across close
 * while this is true.
 */
export function isPurchaseFlowActive(): boolean {
  if (state.flowStep !== 'idle') return true;
  if (state.phase !== 'purchase') return true;
  return false;
}

/**
 * Wipe everything back to defaults. Call this when the user explicitly
 * abandons or after they've fully completed and joined a draft.
 */
export function resetPurchaseFlow(): void {
  state = { ...initialState };
  listeners.forEach((cb) => cb());
}

// ── Card-purchase resume record (localStorage) ───────────────────────────────
// The in-memory store above survives modal close/reopen but NOT a full page
// reload. On mobile the browser can kill our backgrounded tab while the user is
// in the MoonPay window, so on return the tab reloads fresh and the in-flight
// mint is lost — their USDC arrives but no pass is minted. This durable marker
// lets a fresh load finish the mint (see PurchaseResumeRunner). CARD path only
// (USDC-on-Base has no external-window detour). Resume is double-mint-safe: it
// only mints if the USDC is still sitting un-pulled in the wallet.

const RESUME_KEY = 'sbs-card-purchase-resume';

export interface CardResumeRecord {
  quantity: number;
  walletAddress: string;
  ts: number;
  /** USDC balance (USD) right BEFORE the card flow started. Recovery only fires
   *  if the balance later GREW by ~the purchase amount — proof the card actually
   *  funded — so pre-existing USDC (e.g. team-sale proceeds) can't trip a false
   *  "your payment went through" prompt. */
  balanceBefore?: number;
}

export function writeResumeRecord(rec: { quantity: number; walletAddress: string; balanceBefore?: number }): void {
  try {
    if (typeof window === 'undefined') return;
    const payload: CardResumeRecord = { quantity: rec.quantity, walletAddress: rec.walletAddress, ts: Date.now(), balanceBefore: rec.balanceBefore };
    window.localStorage.setItem(RESUME_KEY, JSON.stringify(payload));
  } catch { /* storage unavailable — resume just won't be possible, no harm */ }
}

export function readResumeRecord(): CardResumeRecord | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw) as CardResumeRecord;
    if (
      !rec ||
      typeof rec.quantity !== 'number' || rec.quantity < 1 ||
      typeof rec.walletAddress !== 'string' || !rec.walletAddress ||
      typeof rec.ts !== 'number'
    ) {
      return null;
    }
    return rec;
  } catch { return null; }
}

export function clearResumeRecord(): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(RESUME_KEY);
  } catch { /* noop */ }
}
