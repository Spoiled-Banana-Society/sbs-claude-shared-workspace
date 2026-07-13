export const dynamic = 'force-dynamic';

import { jsonError } from '@/lib/api/routeUtils';

/**
 * One-off Therec HOF repair — COMPLETED 2026-06-28 (HOF pass #492 minted +
 * seated in his lobby). Permanently disabled tombstone: no mint logic, no
 * secret. Retained only because the deploy sync doesn't propagate file
 * deletions; safe to delete the folder once that's possible.
 */
export async function POST() {
  return jsonError('gone — one-off repair completed', 410);
}
