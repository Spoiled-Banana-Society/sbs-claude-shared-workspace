'use client';

/**
 * useSyncedFlag — account-level flags that sync across all the user's devices.
 *
 * Replaces per-device localStorage flags (onboarding/tutorial done, promo
 * seen/dismissed, cashout-returning, chat read timestamps, opt-in cooldown).
 * Backed by /api/user/client-state (Firestore per wallet). A localStorage
 * cache provides instant paint before the server load resolves, so there's no
 * flash on the device that last set the flag.
 *
 * Render-loop safety (CLAUDE.md Rule #0): the whole flag map is fetched ONCE
 * per wallet via a module-level store (in-flight promise dedupes concurrent
 * callers), and the effect deps are scalar (walletAddress) — no Privy-derived
 * callbacks, no per-render fetches.
 */

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { subscribeUserEvents } from '@/lib/api/firebase';

export type FlagValue = boolean | number | string | null;

const CACHE_PREFIX = 'sbs-cs:'; // per-device instant-paint cache (mirror of server)

// ── Module-level store (one fetch per wallet, shared across all hook users) ──
let _wallet: string | null = null;
let _state: Record<string, FlagValue> = {};
let _loaded = false;
let _inflight: Promise<void> | null = null;
let _unsubStream: (() => void) | null = null;
let _reloadTimer: ReturnType<typeof setTimeout> | null = null;
let _globalListenersBound = false;
const _subs = new Set<() => void>();

function notify() { _subs.forEach((fn) => fn()); }

function loadState(wallet: string): Promise<void> {
  if (_inflight) return _inflight;
  const p = (async () => {
    try {
      const res = await fetch(`/api/user/client-state?wallet=${encodeURIComponent(wallet)}`);
      if (res.ok) {
        const json = await res.json();
        _state = (json.state as Record<string, FlagValue>) || {};
        // Mark the store server-authoritative ONLY on a real 200. A failed/404
        // read (e.g. cookieless mobile cold-start behind the prelaunch wall, or a
        // network blip on app-resume) must NOT flip _loaded true with an EMPTY
        // _state — that resolves every flag to its DEFAULT (onboardingComplete →
        // false) and re-traps a user who already finished onboarding into the
        // tutorial on every return-to-app. Leaving _loaded false keeps the read on
        // the per-wallet cache, which holds their real value. (Root cause of the
        // recurring "tutorial keeps popping up after I leave and come back" —
        // surfaced when the site went private/walled. 2026-06-22.)
        _loaded = true;
      }
    } catch { /* network fail — keep _loaded/_state as-is; read falls back to cache */ }
    notify();
  })();
  // Clear when done so a later reload (focus / real-time ping) actually refetches.
  _inflight = p;
  void p.finally(() => { if (_inflight === p) _inflight = null; });
  return p;
}

// Debounced reload — coalesces a burst of pings/focus events into one refetch.
function scheduleReload() {
  if (!_wallet) return;
  if (_reloadTimer) return;
  _reloadTimer = setTimeout(() => {
    _reloadTimer = null;
    if (_wallet) loadState(_wallet);
  }, 250);
}

function bindGlobalListeners() {
  if (_globalListenersBound || typeof window === 'undefined') return;
  _globalListenersBound = true;
  // Refetch the instant the user focuses this device/tab — covers the common
  // "read on desktop, pick up phone" case where the backgrounded tab was throttled.
  const onFocus = () => { if (document.visibilityState !== 'hidden') scheduleReload(); };
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onFocus);
}

function ensureWallet(wallet: string | null) {
  if (wallet === _wallet) return;
  _wallet = wallet;
  _state = {};
  _loaded = false;
  _inflight = null;
  if (_unsubStream) { try { _unsubStream(); } catch { /* ignore */ } _unsubStream = null; }
  if (wallet) {
    bindGlobalListeners();
    loadState(wallet);
    // Real-time: reload when the server pings (a flag changed on another device).
    _unsubStream = subscribeUserEvents(wallet, () => scheduleReload());
  } else {
    _loaded = true;
    notify();
  }
}

/**
 * Standalone setter for code that isn't a React hook (e.g. markChatRead).
 * Updates the shared store + localStorage cache + server. Pass `wallet` when
 * the module wallet may not be set yet (the caller usually has it).
 */
export function writeSyncedFlag(key: string, value: FlagValue, wallet?: string) {
  _state[key] = value;
  const w = (wallet ?? _wallet)?.toLowerCase() ?? null;
  if (typeof window !== 'undefined' && w) {
    // Cache key is scoped to the wallet so flags never leak across wallets on
    // the same browser (instant-paint must reflect THIS account only).
    try { localStorage.setItem(`${CACHE_PREFIX}${w}:${key}`, JSON.stringify(value)); } catch { /* quota */ }
  }
  notify();
  if (w) {
    void fetch('/api/user/client-state', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: w, key, value }),
    }).catch(() => { /* best-effort */ });
  }
}

function readCache<T extends FlagValue>(wallet: string | null, key: string): T | undefined {
  if (typeof window === 'undefined' || !wallet) return undefined;
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${wallet}:${key}`);
    if (raw != null) return JSON.parse(raw) as T;
  } catch { /* ignore */ }
  return undefined;
}

/**
 * @returns [value, setValue, loaded] — `loaded` is true once the server map
 * has resolved; gate first-render decisions (e.g. "show onboarding") on it to
 * avoid a flash on a fresh device.
 */
export function useSyncedFlag<T extends FlagValue>(key: string, defaultValue: T): [T, (v: T) => void, boolean] {
  const { walletAddress } = useAuth();
  const [, force] = useState(0);

  useEffect(() => {
    ensureWallet(walletAddress ?? null);
    const sub = () => force((x) => x + 1);
    _subs.add(sub);
    return () => { _subs.delete(sub); };
  }, [walletAddress]);

  const cacheWallet = walletAddress ? walletAddress.toLowerCase() : null;
  let value: T;
  if (_loaded) {
    // Server map has resolved → it is authoritative for THIS wallet. A missing
    // key means the flag was never set for this account, so the answer is the
    // default. The per-wallet cache is only for instant-paint BEFORE the server
    // load resolves (below); never read it post-load.
    value = (key in _state) ? (_state[key] as T) : defaultValue;
  } else {
    // Pre-load instant paint — wallet-scoped cache, so a previous wallet's
    // flags on this same browser can't bleed into this account.
    const cached = readCache<T>(cacheWallet, key);
    value = cached !== undefined ? cached : defaultValue;
  }

  const setValue = useCallback((v: T) => { writeSyncedFlag(key, v); }, [key]);

  return [value, setValue, _loaded];
}
