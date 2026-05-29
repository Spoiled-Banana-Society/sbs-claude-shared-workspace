/**
 * GET /api/friends/suggestions
 *
 * "People you recently drafted with" — friend suggestions for the Messages
 * page. Walks the signed-in user's recent draft tokens, collects the other
 * real (non-bot) owners who were in those drafts, drops anyone who is already
 * a friend or has a pending request either way, and returns the rest as
 * PublicUser cards (real name or "Banana #1234", + avatar), most-shared-drafts
 * first.
 *
 * All server-side — one round-trip for the client, no chatty per-draft fetches
 * from the browser. Sender wallet comes from the Privy JWT (same as the other
 * /api/friends routes).
 */

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getPrivyUser } from '@/lib/auth';
import { ApiError } from '@/lib/api/errors';
import { listForUser, getPublicUsers, getNamedMembers, type PublicUser } from '@/lib/friends';

const API_BASE = process.env.NEXT_PUBLIC_DRAFTS_API_URL
  || process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL
  || 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';

const MAX_DRAFTS = 8;       // how many of the user's recent drafts to scan
const MAX_SUGGESTIONS = 6;  // how many suggestions to surface

function isRealWallet(id: unknown): id is string {
  return typeof id === 'string' && /^0x[a-fA-F0-9]{6,}/.test(id) && !id.startsWith('bot-');
}

/** Recent league ids the user holds a draft token for (active first, deduped). */
async function getUserLeagueIds(wallet: string): Promise<string[]> {
  const res = await fetch(`${API_BASE}/owner/${wallet}/draftToken/all`, { cache: 'no-store' });
  if (!res.ok) return [];
  const raw: unknown = await res.json().catch(() => null);
  let tokens: Record<string, unknown>[] = [];
  if (Array.isArray(raw)) {
    tokens = raw as Record<string, unknown>[];
  } else if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const active = Array.isArray(o.active) ? o.active : [];
    const available = Array.isArray(o.available) ? o.available : [];
    tokens = [...active, ...available] as Record<string, unknown>[];
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    const id = String(t._leagueId ?? t.leagueId ?? '');
    if (id && !seen.has(id)) { seen.add(id); ids.push(id); }
  }
  return ids.slice(0, MAX_DRAFTS);
}

/** Owner wallets (non-bot, excluding `self`) who were in the given draft. */
async function getCoDrafters(leagueId: string, self: string): Promise<string[]> {
  const res = await fetch(`${API_BASE}/draft/${leagueId}/state/info`, { cache: 'no-store' });
  if (!res.ok) return [];
  const data = await res.json().catch(() => null) as { draftOrder?: { ownerId?: string }[] } | null;
  const order = Array.isArray(data?.draftOrder) ? data!.draftOrder : [];
  const out: string[] = [];
  for (const slot of order) {
    const id = slot?.ownerId;
    if (isRealWallet(id) && id.toLowerCase() !== self) out.push(id.toLowerCase());
  }
  return out;
}

export async function GET(req: Request) {
  let wallet: string;
  try {
    const user = await getPrivyUser(req);
    if (!user.walletAddress) return NextResponse.json({ error: 'wallet required' }, { status: 400 });
    wallet = user.walletAddress.toLowerCase();
  } catch (err) {
    if (err instanceof ApiError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    // Exclude self + existing friends + anyone with a pending request either way.
    const buckets = await listForUser(wallet);
    const exclude = new Set<string>([wallet]);
    for (const u of [...buckets.friends, ...buckets.incoming, ...buckets.outgoing]) {
      exclude.add(u.walletAddress.toLowerCase());
    }

    // 1. People you recently drafted with, ranked by shared-draft count.
    const counts = new Map<string, number>();
    const leagueIds = await getUserLeagueIds(wallet);
    if (leagueIds.length > 0) {
      const perDraft = await Promise.all(leagueIds.map((id) => getCoDrafters(id, wallet)));
      for (const wallets of perDraft) {
        for (const w of wallets) counts.set(w, (counts.get(w) ?? 0) + 1);
      }
    }
    const ranked = Array.from(counts.entries())
      .filter(([w]) => !exclude.has(w))
      .sort((a, b) => b[1] - a[1])
      .map(([w]) => w);

    // Pick draft-based suggestions first…
    const picked: string[] = [];
    const taken = new Set<string>(exclude);
    for (const w of ranked) {
      if (picked.length >= MAX_SUGGESTIONS) break;
      if (taken.has(w)) continue;
      taken.add(w); picked.push(w);
    }

    // 2. …then top up with other members who've set a real name, so the list
    //    is never empty just because you haven't drafted with anyone yet.
    if (picked.length < MAX_SUGGESTIONS) {
      const named = await getNamedMembers(MAX_SUGGESTIONS * 5);
      for (const w of named) {
        if (picked.length >= MAX_SUGGESTIONS) break;
        if (taken.has(w)) continue;
        taken.add(w); picked.push(w);
      }
    }

    if (picked.length === 0) return NextResponse.json({ suggestions: [] });

    const profiles = await getPublicUsers(picked);
    const suggestions: PublicUser[] = picked.map(
      (w) => profiles.get(w) ?? { walletAddress: w, username: w.slice(0, 8) },
    );
    return NextResponse.json({ suggestions });
  } catch (err) {
    if (err instanceof ApiError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
