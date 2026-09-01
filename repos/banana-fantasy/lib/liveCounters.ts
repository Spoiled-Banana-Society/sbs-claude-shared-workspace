/**
 * Tiny client-side store for live lane counters the HEADER already computes
 * (BatchProgressIndicator). Lets other surfaces — e.g. dynamic bells that say
 * "Jackpot in the next {N} drafts" — show the same live number with ZERO extra
 * network and no risk of disagreeing with the header (Boris 2026-08-26).
 */
import { useSyncExternalStore } from 'react';

type Counters = { jpLeft: number | null; hofLeft: number | null; zoneLeft: number | null; zoneLeft2: number | null };
let counters: Counters = { jpLeft: null, hofLeft: null, zoneLeft: null, zoneLeft2: null };
const subs = new Set<() => void>();

export function setLaneCounters(next: Partial<Counters>): void {
  counters = { ...counters, ...next };
  subs.forEach((fn) => fn());
}

export function useLaneCounters(): Counters {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => subs.delete(cb); },
    () => counters,
    () => counters,
  );
}
