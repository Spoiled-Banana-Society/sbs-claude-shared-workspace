import { waitUntil } from '@vercel/functions';
import { logger } from '@/lib/logger';

/**
 * Run post-response work that must SURVIVE the response.
 *
 * A bare `void somePromise` / detached `.catch()` dies when the Vercel lambda
 * freezes the moment the response is sent — the work lands late (next thaw)
 * or never. That bug silently dropped queue notifications, badge unlocks and
 * NFT metadata writes. `waitUntil` keeps the function alive until the work
 * completes without delaying the response.
 *
 * Same idea as pushStreamEventBg (lib/userEventStream.ts), generalized for
 * any fire-and-forget server work. Rejections are logged with the label —
 * never thrown.
 */
export function runInBackground(label: string, work: Promise<unknown>): void {
  const safe = Promise.resolve(work).catch((err) => {
    logger.warn('background.task.failed', {
      label,
      err: err instanceof Error ? err.message : String(err),
    });
  });
  try {
    waitUntil(safe);
  } catch {
    // No Vercel request context (local dev / scripts) — runs detached.
  }
}
