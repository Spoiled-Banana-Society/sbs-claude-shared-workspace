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
