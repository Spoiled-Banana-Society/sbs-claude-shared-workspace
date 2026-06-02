import { NextRequest, NextResponse } from 'next/server';
import { getClientState, setClientFlag, type ClientStateValue } from '@/lib/clientState';
import { pushStreamEvent } from '@/lib/userEventStream';

// GET /api/user/client-state?wallet=0x...
// Returns the per-user client-state flag map (synced across devices).
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get('wallet');
  if (!wallet) return NextResponse.json({ state: {} });
  const state = await getClientState(wallet);
  return NextResponse.json({ state });
}

// PATCH /api/user/client-state  { wallet, key, value }
// Sets a single flag (merge — never clobbers other flags).
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { wallet, key } = body as { wallet?: string; key?: string; value?: ClientStateValue };
    if (!wallet || !key) {
      return NextResponse.json({ error: 'wallet and key required' }, { status: 400 });
    }
    await setClientFlag(wallet, key, (body.value ?? null) as ClientStateValue);
    // Real-time: nudge the user's other devices to reload client-state so
    // synced flags (e.g. the league chat unread badge) update near-instantly,
    // not just on focus/reload. Reuses the content-less 'notification' ping.
    void pushStreamEvent(wallet, 'notification', { source: 'client-state' });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[client-state] PATCH error:', err);
    return NextResponse.json({ error: 'Failed to set flag' }, { status: 500 });
  }
}
