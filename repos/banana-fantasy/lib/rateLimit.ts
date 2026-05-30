/**
 * In-memory sliding window rate limiter for Next.js API routes.
 *
 * Usage:
 *   import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
 *
 *   export async function POST(req: Request) {
 *     const limited = rateLimit(req, RATE_LIMITS.purchases);
 *     if (limited) return limited;
 *     // ... handler
 *   }
 */

import { NextResponse } from 'next/server';

interface RateLimitConfig {
  /** Max requests per window */
  limit: number;
  /** Window size in milliseconds */
  windowMs: number;
}

interface WindowEntry {
  timestamps: number[];
  blockedUntil: number;
}

// In-memory store: IP → sliding window timestamps
const store = new Map<string, WindowEntry>();

// Cleanup stale entries every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup(windowMs: number) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;

  const cutoff = now - windowMs * 2;
  for (const [key, entry] of store) {
    if (entry.timestamps.length === 0 || entry.timestamps[entry.timestamps.length - 1] < cutoff) {
      store.delete(key);
    }
  }
}

function getClientIp(req: Request): string {
  const headers = new Headers(req.headers);
  // Vercel/Cloudflare set these
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    headers.get('cf-connecting-ip') ||
    '127.0.0.1'
  );
}

/**
 * Check rate limit. Returns a 429 Response if limit exceeded, or null if OK.
 */
export function rateLimit(req: Request, config: RateLimitConfig): NextResponse | null {
  const ip = getClientIp(req);
  const now = Date.now();
  const { limit, windowMs } = config;

  cleanup(windowMs);

  const key = `${ip}:${limit}:${windowMs}`;
  let entry = store.get(key);

  if (!entry) {
    entry = { timestamps: [], blockedUntil: 0 };
    store.set(key, entry);
  }

  // If actively blocked, reject immediately
  if (entry.blockedUntil > now) {
    const retryAfter = Math.ceil((entry.blockedUntil - now) / 1000);
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(limit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(entry.blockedUntil / 1000)),
        },
      }
    );
  }

  // Sliding window: remove timestamps outside window
  const windowStart = now - windowMs;
  entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

  if (entry.timestamps.length >= limit) {
    // Rate limited — block for remainder of window
    const oldestInWindow = entry.timestamps[0];
    entry.blockedUntil = oldestInWindow + windowMs;
    const retryAfter = Math.ceil((entry.blockedUntil - now) / 1000);

    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(limit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(entry.blockedUntil / 1000)),
        },
      }
    );
  }

  // Allow request
  entry.timestamps.push(now);
  return null;
}

/** Pre-configured rate limits */
export const RATE_LIMITS = {
  /** Purchases: 10 req/min */
  purchases: { limit: 10, windowMs: 60_000 },
  /** Admin: 300 req/min — admin auth already gates access; this is just scanner protection */
  admin: { limit: 300, windowMs: 60_000 },
  /** Wheel spin action: 20 req/min. ONLY the spin POST uses this now — the
   *  page's read/polling routes + confirm-reveal were moved to `general`.
   *  A spin can't happen without a server-checked spin credit, so this is
   *  just bot-flood protection; 5/min was blocking users with banked spins. */
  wheel: { limit: 20, windowMs: 60_000 },
  /** RNG: 5 req/min */
  rng: { limit: 5, windowMs: 60_000 },
  /** General reads: 60 req/min */
  general: { limit: 60, windowMs: 60_000 },
  /** Auth/owner: 15 req/min */
  auth: { limit: 15, windowMs: 60_000 },
  /** Prizes/withdrawals: 10 req/min */
  prizes: { limit: 10, windowMs: 60_000 },
} as const;
