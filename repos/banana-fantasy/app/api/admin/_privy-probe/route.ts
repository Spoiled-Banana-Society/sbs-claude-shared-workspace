// TEMP diagnostic (new-web2 wallet resolution). Gated behind the prelaunch
// wall (needs sbs_preview cookie) + a key param. Returns what the Privy User
// API actually knows about a given wallet, so we can confirm whether the
// embedded wallet is linked server-side (and thus resolvable by getPrivyUser).
// REMOVE after debugging.
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get('key');
  if (key !== process.env.PRELAUNCH_BYPASS_KEY) {
    return NextResponse.json({ error: 'nope' }, { status: 403 });
  }
  const wallet = (url.searchParams.get('wallet') || '').toLowerCase();
  const appId = process.env.PRIVY_APP_ID?.trim() || process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  const secret = process.env.PRIVY_APP_SECRET?.trim();
  if (!appId || !secret) return NextResponse.json({ error: 'no privy creds', hasAppId: !!appId, hasSecret: !!secret });
  const auth = Buffer.from(`${appId}:${secret}`).toString('base64');
  const headers = { Authorization: `Basic ${auth}`, 'privy-app-id': appId, 'Content-Type': 'application/json' };

  // Privy "get user by wallet address" endpoint.
  const out: Record<string, unknown> = { wallet, appId };
  try {
    const r = await fetch('https://auth.privy.io/api/v1/users/wallet/address', {
      method: 'POST', headers, body: JSON.stringify({ address: wallet }),
    });
    out.byWalletStatus = r.status;
    const txt = await r.text();
    try {
      const j = JSON.parse(txt);
      out.did = j.id ?? null;
      out.linked = (j.linked_accounts || []).map((a: Record<string, unknown>) => ({
        type: a.type, wallet_client_type: a.wallet_client_type, connector_type: a.connector_type,
        address: a.address, chain_type: a.chain_type,
      }));
    } catch { out.byWalletRaw = txt.slice(0, 300); }
  } catch (e) {
    out.byWalletError = String(e);
  }
  return NextResponse.json(out);
}
