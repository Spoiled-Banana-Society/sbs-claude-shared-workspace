/**
 * Username availability + claim.
 *
 *   GET  /api/username?name=Foo   → { available, reason? }  (live check while typing)
 *   POST /api/username  { name }  → 200 { ok } | 409 { error:'taken', reason }
 *
 * Both require a Privy JWT — the caller can only check/claim for their own
 * wallet. Uniqueness is enforced in lib/usernames (Firestore reservation).
 */

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getPrivyUser } from '@/lib/auth';
import { ApiError } from '@/lib/api/errors';
import { checkUsername, claimUsername } from '@/lib/usernames';

async function requireWallet(req: Request): Promise<string> {
  const user = await getPrivyUser(req);
  if (!user.walletAddress) throw new ApiError(400, 'wallet required');
  return user.walletAddress;
}

export async function GET(req: Request) {
  try {
    const wallet = await requireWallet(req);
    const name = new URL(req.url).searchParams.get('name') || '';
    if (!name.trim()) return NextResponse.json({ available: false, reason: 'too_short' });
    const result = await checkUsername(name, wallet);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ApiError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const wallet = await requireWallet(req);
    const body = await req.json().catch(() => ({}));
    const name = typeof body.name === 'string' ? body.name : '';
    const result = await claimUsername(name, wallet);
    if (!result.available) {
      return NextResponse.json({ error: result.reason || 'taken', reason: result.reason }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ApiError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
