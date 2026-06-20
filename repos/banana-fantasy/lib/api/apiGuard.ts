/**
 * API guard utilities: CORS, request size limits, input sanitization.
 */

import { NextResponse } from 'next/server';

// ─── CORS ────────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
  // Apex + ANY sbsfantasy.com subdomain (www, staging, launch domain). Must
  // stay in sync with middleware.ts — both guards 403 disallowed origins, and
  // a domain missing here silently breaks any route that calls handleCors().
  /^https:\/\/([a-z0-9-]+\.)?sbsfantasy\.com$/,
  /^https:\/\/banana-fantasy-.*\.vercel\.app$/,
  'http://localhost:3000',
  'http://localhost:3001',
];

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGINS.some((allowed) =>
    typeof allowed === 'string' ? allowed === origin : allowed.test(origin)
  );
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
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

/**
 * Handle CORS preflight. Returns a Response for OPTIONS, null otherwise.
 */
export function handleCors(req: Request): NextResponse | null {
  const origin = req.headers.get('origin');

  // Reject disallowed origins
  if (origin && !isOriginAllowed(origin)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
  }

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
  }

  return null;
}

// ─── Request Size ────────────────────────────────────────────────────────

const MAX_BODY_SIZE = 1 * 1024 * 1024; // 1MB

/**
 * Check Content-Length header. Returns 413 if too large, null if OK.
 */
export function checkRequestSize(req: Request): NextResponse | null {
  const contentLength = req.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
    return NextResponse.json(
      { error: 'Request body too large. Maximum size is 1MB.' },
      { status: 413 }
    );
  }
  return null;
}

// ─── Input Sanitization ──────────────────────────────────────────────────

/** Validate Ethereum address format (0x + 40 hex chars) */
export function isValidAddress(addr: unknown): addr is string {
  return typeof addr === 'string' && /^0x[a-fA-F0-9]{40}$/.test(addr);
}

/** Validate a draft/league ID (alphanumeric + hyphens, reasonable length) */
export function isValidId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
}

/** Validate a positive integer */
export function isPositiveInt(val: unknown): val is number {
  return typeof val === 'number' && Number.isInteger(val) && val > 0;
}

/** Strip HTML/script tags from string input */
export function sanitizeString(input: string, maxLength = 500): string {
  return input
    .replace(/<[^>]*>/g, '')
    .replace(/[<>"'&]/g, '')
    .trim()
    .slice(0, maxLength);
}

/** Validate and sanitize an amount (positive number, max 2 decimals) */
export function sanitizeAmount(val: unknown): number | null {
  const num = Number(val);
  if (!Number.isFinite(num) || num <= 0 || num > 1_000_000) return null;
  return Math.round(num * 100) / 100;
}
