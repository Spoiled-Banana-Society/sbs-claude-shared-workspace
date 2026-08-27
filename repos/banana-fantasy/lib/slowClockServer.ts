/**
 * Server-side read of system_config/slowDraftClock (see lib/slowClock.ts).
 * 60s in-process cache — one Firestore read a minute per instance. Any
 * failure → legacy (switch off), never a throw.
 */
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { LEGACY_SLOW_CLOCK, normalizeSlowClockConfig, slowClockCopy, type SlowClockConfig, type SlowClockCopy } from '@/lib/slowClock';

const TTL_MS = 60_000;
let cached: { at: number; cfg: SlowClockConfig } | null = null;

export async function getSlowClockConfig(): Promise<SlowClockConfig> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.cfg;
  let cfg = LEGACY_SLOW_CLOCK;
  try {
    if (isFirestoreConfigured()) {
      const snap = await getAdminFirestore().collection('system_config').doc('slowDraftClock').get();
      cfg = normalizeSlowClockConfig(snap.exists ? snap.data() : null);
    }
  } catch {
    // keep legacy / last value
    if (cached) cfg = cached.cfg;
  }
  cached = { at: Date.now(), cfg };
  return cfg;
}

export async function getSlowClockCopy(): Promise<SlowClockCopy> {
  return slowClockCopy(await getSlowClockConfig());
}
