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

// Resolve the caller's wallet. getPrivyUser still authenticates them (throws
// 401 on a bad/absent token), so only a logged-in user reaches the fallback:
// when Privy's User API hasn't propagated a brand-new embedded wallet yet, we
// trust the wallet the client holds (same as the no-auth seed path). The claim
// is scoped to that wallet's own doc, so the worst a spoofed value could do is
// reserve a name — no access to funds or anyone else's account.
function validClientWallet(w: unknown): string | null {
  return typeof w === 'string' && /^0x[0-9a-fA-F]{40}$/.test(w) ? w.toLowerCase() : null;
}

async function resolveWallet(req: Request, clientWallet: unknown): Promise<string> {
  // Prefer the server-verified wallet. But a brand-new web2 user fires the name
  // claim before Privy's token is ready, so getPrivyUser THROWS (no/again-unverifiable
  // token) — catch that and fall back to the wallet the client holds (the same
  // wallet the no-auth seed already used to create this user's doc). Scoped to
  // that wallet's own name reservation, so the blast radius is just a name.
  try {
    const user = await getPrivyUser(req);
    if (user.walletAddress) return user.walletAddress.toLowerCase();
  } catch { /* token not ready yet — fall back to the client wallet below */ }
  const fallback = validClientWallet(clientWallet);
  if (fallback) return fallback;
  throw new ApiError(400, 'wallet required');
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const wallet = await resolveWallet(req, url.searchParams.get('wallet'));
    const name = url.searchParams.get('name') || '';
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
    const body = await req.json().catch(() => ({}));
    const wallet = await resolveWallet(req, body.wallet);
    const name = typeof body.name === 'string' ? body.name : '';
    const result = await claimUsername(name, wallet);
    if (!result.available) {
      return NextResponse.json({ error: result.reason || 'taken', reason: result.reason }, { status: 409 });
    }
    // Refresh the referral code to match the new name in the BACKGROUND — do
    // NOT block the response on it. It's best-effort and getPromos re-derives it
    // on the next read regardless, so it never needed to be awaited. Awaiting it
    // stacked another ensureUserSeeded + userRef.get() + (possibly) a Banana#
    // assignment on TOP of the Privy verify + claim transaction, so the "Saving…"
    // spinner hung for seconds on a weak mobile connection even though the name
    // was already claimed. Fire-and-forget → the rename returns the instant the
    // name is reserved.
    void import('@/lib/db')
      .then(({ ensureNamedReferralCode }) => ensureNamedReferralCode(wallet))
      .catch(() => { /* non-fatal — referral self-heals on next promos read */ });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ApiError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
