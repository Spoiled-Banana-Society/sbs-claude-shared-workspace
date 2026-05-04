import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Next.js Edge Middleware — runs before every request.
 * Handles: CORS preflight, origin validation, request size limits for API routes.
 */

const ALLOWED_ORIGINS = [
  'https://sbsfantasy.com',
  'https://www.sbsfantasy.com',
  /^https:\/\/.*\.vercel\.app$/,
  'http://localhost:3000',
  'http://localhost:3001',
];

const MAX_BODY_SIZE = 1 * 1024 * 1024; // 1MB

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
  const { pathname } = req.nextUrl;

  // Only apply to API routes
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

  // Check request size
  const contentLength = req.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
    return NextResponse.json(
      { error: 'Request body too large. Maximum size is 1MB.' },
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
  matcher: '/api/:path*',
};
