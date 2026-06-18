export const dynamic = 'force-dynamic';

import { getPrivyUser } from '@/lib/auth';
import { ApiError } from '@/lib/api/errors';
import { forwardResponse } from '@/lib/api/forwardResponse';
import { jsonError } from '@/lib/api/routeUtils';
import { assertSessionWallet } from '@/lib/assertSessionWallet';
import { draftsApiServer } from '@/lib/draftsApiServer';
import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';

const WALLET_RE = /0x[0-9a-fA-F]{40}/g;

function walletsInPath(path: string): string[] {
  const found = path.match(WALLET_RE) ?? [];
  return [...new Set(found.map((w) => w.toLowerCase()))];
}

async function proxy(req: Request, pathSegments?: string[]) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    const session = await getPrivyUser(req);
    const path = `/${(pathSegments ?? []).join('/')}`;
    const upstreamPath = path + new URL(req.url).search;

    for (const wallet of walletsInPath(path)) {
      assertSessionWallet(session, wallet);
    }

    let body: unknown;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const text = await req.text();
      body = text ? JSON.parse(text) : undefined;
    }

    const sessionWallet = session.walletAddress?.trim().toLowerCase();
    if (
      req.method === 'POST' &&
      path.endsWith('/actions/leave') &&
      body &&
      typeof body === 'object' &&
      'ownerId' in body
    ) {
      const ownerId = typeof (body as { ownerId?: unknown }).ownerId === 'string'
        ? (body as { ownerId: string }).ownerId
        : '';
      assertSessionWallet(session, ownerId);
    } else if (
      req.method === 'POST' &&
      path.endsWith('/actions/leave') &&
      sessionWallet
    ) {
      body = { ...(typeof body === 'object' && body ? body : {}), ownerId: sessionWallet };
    }

    const res = await draftsApiServer(upstreamPath, {
      method: req.method,
      wallet: sessionWallet,
      body,
    });
    return forwardResponse(res);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    if (err instanceof SyntaxError) return jsonError('Invalid JSON body', 400);
    return jsonError('Internal server error', 500);
  }
}

type RouteCtx = { params: { path?: string[] } };

export async function GET(req: Request, ctx: RouteCtx) {
  return proxy(req, ctx.params.path);
}

export async function POST(req: Request, ctx: RouteCtx) {
  return proxy(req, ctx.params.path);
}

export async function PUT(req: Request, ctx: RouteCtx) {
  return proxy(req, ctx.params.path);
}

export async function PATCH(req: Request, ctx: RouteCtx) {
  return proxy(req, ctx.params.path);
}

export async function DELETE(req: Request, ctx: RouteCtx) {
  return proxy(req, ctx.params.path);
}
