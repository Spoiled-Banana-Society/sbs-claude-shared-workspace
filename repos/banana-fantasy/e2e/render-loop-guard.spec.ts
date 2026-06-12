import { test, expect } from '@playwright/test';

// Guards against the bug class that took the site down on May 27, 2026
// (Vercel DDoS Mitigation fired because a render-loop in MessagesHub was
// hammering /api/users/search thousands of times per minute from one tab).
//
// Strategy: open a high-risk page, count outbound /api/* requests over a
// fixed observation window, fail if the count exceeds a sane threshold.
// The threshold is well above legitimate polling traffic (each page polls
// at 2-15s intervals + a few initial loads, ~20-30 requests in 10s) but
// well below storm levels (10× polling baseline = thousands/min).
//
// This catches the entire bug class — render loops, unstable callback
// identity in useEffect deps, missing memoization, anything that causes
// repeated fetches — not just the specific Privy pattern. Any future
// regression of this shape fails CI before it can deploy.
//
// See `CLAUDE.md` (shared workspace) Rule #0 for the bug pattern itself.

const OBSERVATION_WINDOW_MS = 10_000;
const MAX_API_REQUESTS_IN_WINDOW = 75;

type PageUnderTest = {
  name: string;
  path: string;
  // Pages that fail to render at all (auth wall, 404) shouldn't be in
  // here — they generate near-zero traffic and would silently pass.
};

const PAGES: PageUnderTest[] = [
  { name: 'messages hub', path: '/messages' },
  { name: 'draft room (filling)', path: '/draft-room?name=BBB+%23200&players=1&speed=fast' },
  { name: 'coming soon', path: '/coming-soon' },
  { name: 'lobby world', path: '/lobby-world' },
  // Marketplace polls wheel-passes every 5s; banana-wheel polls the queue
  // after JP/HOF wins — both must stay interval-driven, never render-coupled.
  { name: 'marketplace', path: '/marketplace' },
  { name: 'banana wheel', path: '/banana-wheel' },
];

for (const target of PAGES) {
  test(`${target.name}: no render-loop fetch storm`, async ({ page }) => {
    const apiRequests: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      // Count only application API calls — skip Next static, Vercel
      // telemetry, RPC, third-party SDKs, fonts, etc.
      if (url.includes('/api/') && !url.includes('/_next/')) {
        apiRequests.push(`${req.method()} ${new URL(url).pathname}`);
      }
    });

    await page.goto(target.path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(OBSERVATION_WINDOW_MS);

    if (apiRequests.length > MAX_API_REQUESTS_IN_WINDOW) {
      // Show the top offenders so a failure is debuggable.
      const counts: Record<string, number> = {};
      for (const r of apiRequests) counts[r] = (counts[r] ?? 0) + 1;
      const sorted = Object.entries(counts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([url, n]) => `  ${n}× ${url}`)
        .join('\n');
      throw new Error(
        `Render-loop guard tripped on ${target.path}: ${apiRequests.length} ` +
        `/api/* requests in ${OBSERVATION_WINDOW_MS}ms ` +
        `(threshold: ${MAX_API_REQUESTS_IN_WINDOW}).\n` +
        `Top endpoints:\n${sorted}\n` +
        `Likely cause: a useEffect with an unstable callback in its deps. ` +
        `See shared workspace CLAUDE.md Rule #0 for the fix pattern.`,
      );
    }

    expect(apiRequests.length).toBeLessThanOrEqual(MAX_API_REQUESTS_IN_WINDOW);
  });
}
