// Decommissioned diagnostic. The Privy wallet-probe was a one-off used to
// confirm new web2 embedded wallets are linked in Privy's User API. It is now
// inert — always 404 — and the file can be deleted in a cleanup pass (the
// deploy sync doesn't propagate file deletions, so it's neutered in place).
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ error: 'not found' }, { status: 404 });
}
