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

export type FlagValue = boolean | number | string | null;

const CACHE_PREFIX = 'sbs-cs:'; // per-device instant-paint cache (mirror of server)

// ── Module-level store (one fetch per wallet, shared across all hook users) ──
let _wallet: string | null = null;
let _state: Record<string, FlagValue> = {};
let _loaded = false;
let _inflight: Promise<void> | null = null;
const _subs = new Set<() => void>();

function notify() { _subs.forEach((fn) => fn()); }

function loadState(wallet: string): Promise<void> {
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const res = await fetch(`/api/user/client-state?wallet=${encodeURIComponent(wallet)}`);
      if (res.ok) {
        const json = await res.json();
        _state = (json.state as Record<string, FlagValue>) || {};
      }
    } catch { /* degrade to cache/defaults */ }
    _loaded = true;
    notify();
  })();
  return _inflight;
}

function ensureWallet(wallet: string | null) {
  if (wallet === _wallet) return;
  _wallet = wallet;
  _state = {};
  _loaded = false;
  _inflight = null;
  if (wallet) loadState(wallet);
  else { _loaded = true; notify(); }
}

/**
 * Standalone setter for code that isn't a React hook (e.g. markChatRead).
 * Updates the shared store + localStorage cache + server. Pass `wallet` when
 * the module wallet may not be set yet (the caller usually has it).
 */
export function writeSyncedFlag(key: string, value: FlagValue, wallet?: string) {
  _state[key] = value;
  if (typeof window !== 'undefined') {
    try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value)); } catch { /* quota */ }
  }
  notify();
  const w = wallet ? wallet.toLowerCase() : _wallet;
  if (w) {
    void fetch('/api/user/client-state', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: w, key, value }),
    }).catch(() => { /* best-effort */ });
  }
}

function readCache<T extends FlagValue>(key: string): T | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
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

  let value: T;
  if (_loaded && key in _state) {
    value = _state[key] as T;
  } else {
    const cached = readCache<T>(key);
    value = cached !== undefined ? cached : defaultValue;
  }

  const setValue = useCallback((v: T) => { writeSyncedFlag(key, v); }, [key]);

  return [value, setValue, _loaded];
}
