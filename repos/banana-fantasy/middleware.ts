import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Next.js Edge Middleware — runs before every request.
 * Handles: pre-launch gate (countdown wall), CORS preflight, origin
 * validation, request size limits for API routes.
 */

const ALLOWED_ORIGINS = [
  // Apex + ANY sbsfantasy.com subdomain (www, staging, the launch domain, etc.).
  // Without staging.sbsfantasy.com here, every POST /api/* from the staging
  // domain was 403'd at the middleware before reaching the route — which broke
  // returning-check (firstLoginAt + bells), the username claim, metadata, etc.
  // for users on that domain (GETs were unaffected: browsers omit the Origin
  // header on same-origin GETs, so the seed still ran).
  /^https:\/\/([a-z0-9-]+\.)?sbsfantasy\.com$/,
  /^https:\/\/.*\.vercel\.app$/,
  'http://localhost:3000',
  'http://localhost:3001',
];

const MAX_BODY_SIZE = 1 * 1024 * 1024; // 1MB — default for typical JSON payloads
// File-upload endpoints get a higher cap. KYC ID photos are typically
// 300-600 KB after client-side compression but can be larger (HEIC files
// where canvas compression fell back to original, edge-of-camera-roll cases).
// 5 MB matches Vercel's serverless function request limit, gives headroom.
const FILE_UPLOAD_MAX_BODY_SIZE = 5 * 1024 * 1024; // 5MB
const FILE_UPLOAD_PATHS = ['/api/verify/submit'];

// ── Pre-launch gate ─────────────────────────────────────────────────────
// When PRELAUNCH_MODE === 'true', the public sees ONLY the countdown
// (/coming-soon) no matter what URL they hit; the API is fully sealed.
// The team gets in via /enter?key=<PRELAUNCH_BYPASS_KEY>, which drops a
// preview cookie and bounces back to a clean URL showing the real app.
// /exit clears it. When the flag is off (default), this is a no-op and the
// app behaves exactly as before.
const PRELAUNCH_COOKIE = 'sbs_preview';
const COMING_SOON_PATH = '/coming-soon';

function handlePrelaunch(req: NextRequest): NextResponse | null {
  if (process.env.PRELAUNCH_MODE !== 'true') return null; // gate off → no-op

  const { pathname } = req.nextUrl;
  const bypassKey = process.env.PRELAUNCH_BYPASS_KEY;

  // Secret entry: correct key → set preview cookie, bounce to clean root.
  // Wrong/missing key reveals nothing — just the countdown.
  if (pathname === '/enter') {
    const key = req.nextUrl.searchParams.get('key');
    if (bypassKey && key === bypassKey) {
      const res = NextResponse.redirect(new URL('/', req.url));
      res.cookies.set(PRELAUNCH_COOKIE, '1', {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 30, // 30 days
      });
      return res;
    }
    return NextResponse.rewrite(new URL(COMING_SOON_PATH, req.url));
  }

  // Secret exit: clear preview, bounce to clean root (now showing countdown).
  if (pathname === '/exit') {
    const res = NextResponse.redirect(new URL('/', req.url));
    res.cookies.delete(PRELAUNCH_COOKIE);
    return res;
  }

  // Team preview holders → let everything through to the real app.
  if (req.cookies.get(PRELAUNCH_COOKIE)?.value === '1') return null;

  // Card / OG images are PUBLIC by design — OpenSea, X/social previews, and
  // Next.js's own <Image> optimizer all fetch them server-side with NO preview
  // cookie. Gating them 404s every team card across the marketplace (Sell/Buy),
  // My Teams, and elsewhere. They expose no private app data, so always allow.
  if (pathname.startsWith('/api/og/')) return NextResponse.next();

  // Internal server-to-server callers authenticate via a shared secret, NOT
  // the preview cookie — the public prelaunch seal must let them through or
  // every webhook silently 404s. Caught 2026-06-20: ALL draft notifications
  // (filled + on-the-clock, fast + slow) died the moment PRELAUNCH_MODE flipped
  // on, because the onDraftFilled / onPickAdvance Cloud Functions POST with no
  // cookie. Vercel crons are cookieless too. These routes still run their OWN
  // in-route auth, so allowing them past the seal exposes nothing.
  if (pathname.startsWith('/api/')) {
    const internalSecret = process.env.NOTIFICATIONS_INTERNAL_SECRET;
    const cronSecret = process.env.CRON_SECRET;
    const authedInternal =
      !!internalSecret && req.headers.get('x-internal-secret') === internalSecret;
    const authedCron =
      (!!cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`) ||
      !!req.headers.get('x-vercel-cron');
    if (authedInternal || authedCron) return null; // proceed to normal /api handling
  }

  // Public: the rest of the API is fully sealed (nothing to probe).
  if (pathname.startsWith('/api/')) {
    return new NextResponse('Not Found', { status: 404 });
  }

  // Public: the countdown route renders normally...
  if (pathname === COMING_SOON_PATH) return NextResponse.next();

  // ...and every other path shows the countdown, URL kept clean (rewrite).
  return NextResponse.rewrite(new URL(COMING_SOON_PATH, req.url));
}

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return true;
  return ALLOWED_ORIGINS.some((allowed) =>
    typeof allowed === 'string' ? allowed === origin : allowed.test(origin)
  );
}

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
  if (origin && isOriginAllowed(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

export function middleware(req: NextRequest) {
  // Pre-launch gate runs first, for every path.
  const gated = handlePrelaunch(req);
  if (gated) return gated;

  const { pathname } = req.nextUrl;

  // Beyond the gate, the rest only applies to API routes.
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  const origin = req.headers.get('origin');

  // Block disallowed origins
  if (origin && !isOriginAllowed(origin)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
  }

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: corsHeaders(origin),
    });
  }

  // Check request size — file-upload endpoints get a higher cap
  const contentLength = req.headers.get('content-length');
  const isFileUpload = FILE_UPLOAD_PATHS.some((p) => pathname === p);
  const sizeLimit = isFileUpload ? FILE_UPLOAD_MAX_BODY_SIZE : MAX_BODY_SIZE;
  if (contentLength && parseInt(contentLength, 10) > sizeLimit) {
    const limitMb = Math.floor(sizeLimit / 1024 / 1024);
    return NextResponse.json(
      { error: `Request body too large. Maximum size is ${limitMb}MB.` },
      { status: 413 }
    );
  }

  // Add CORS headers to response
  const response = NextResponse.next();
  const cors = corsHeaders(origin);
  for (const [key, value] of Object.entries(cors)) {
    response.headers.set(key, value);
  }

  return response;
}

export const config = {
  // Match every route (so the gate can cover pages + API) EXCEPT Next.js
  // internals and static files (anything with a "." — e.g. /sbs-logo.png),
  // so the countdown's own assets always load.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
