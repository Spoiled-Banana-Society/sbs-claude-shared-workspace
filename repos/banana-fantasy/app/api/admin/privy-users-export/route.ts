import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Pages the Privy user list for email-marketing export. The Privy app secret
 * only exists in Vercel env (sensitive — not pullable), so the paging has to
 * happen server-side; callers loop this route with `cursor` until
 * `next_cursor` is null. One Privy page (100 users) per call keeps each
 * invocation well under the function time limit.
 *
 * Auth: `Authorization: Bearer ${PRIVY_EXPORT_SECRET}` — same pattern as the
 * cron routes, separate secret so it can be shared with a local script
 * without exposing CRON_SECRET.
 */
export async function GET(req: Request) {
  const expected = (process.env.PRIVY_EXPORT_SECRET || '').trim();
  const auth = req.headers.get('authorization') || '';
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const appId = (process.env.PRIVY_APP_ID || process.env.NEXT_PUBLIC_PRIVY_APP_ID || '').trim();
  const secret = (process.env.PRIVY_APP_SECRET || '').trim();
  if (!appId || !secret) {
    return NextResponse.json({ error: 'privy not configured' }, { status: 500 });
  }

  const cursor = new URL(req.url).searchParams.get('cursor');
  const url = new URL('https://auth.privy.io/api/v1/users');
  url.searchParams.set('limit', '100');
  if (cursor) url.searchParams.set('cursor', cursor);

  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${appId}:${secret}`).toString('base64')}`,
      'privy-app-id': appId,
    },
  });
  if (!res.ok) {
    return NextResponse.json({ error: 'privy error', status: res.status }, { status: 502 });
  }

  const body = (await res.json()) as {
    data?: Array<{
      id: string;
      created_at?: number;
      linked_accounts?: Array<{
        type: string;
        address?: string;
        email?: string;
        username?: string;
        wallet_client_type?: string;
      }>;
    }>;
    next_cursor?: string | null;
  };

  const users = (body.data || []).map((u) => {
    const accts = u.linked_accounts || [];
    const emailAcct = accts.find((a) => a.type === 'email' && a.address);
    const googleAcct = accts.find((a) => a.type === 'google_oauth' && (a.email || a.address));
    const wallet =
      accts.find((a) => a.type === 'wallet' && a.wallet_client_type === 'privy')?.address ||
      accts.find((a) => a.type === 'wallet')?.address ||
      '';
    return {
      did: u.id,
      email: (emailAcct?.address || googleAcct?.email || googleAcct?.address || '').toLowerCase() || null,
      emailSource: emailAcct ? 'email' : googleAcct ? 'google' : null,
      twitter: accts.find((a) => a.type === 'twitter_oauth')?.username || null,
      wallet: wallet.toLowerCase() || null,
      createdAt: u.created_at || null,
    };
  });

  return NextResponse.json({ users, next_cursor: body.next_cursor || null });
}
