/**
 * Chat for a draft, backed by Firebase RTDB but accessed via Admin SDK so we
 * sidestep client-side RTDB security rules. The frontend RTDB client is
 * anonymous (we use Privy, not Firebase Auth), and the staging rules deny
 * anonymous reads/writes on /drafts/{draftId}/chat. Routing through this
 * server endpoint with admin credentials avoids the rules problem entirely.
 *
 *   GET  /api/chat/{draftId}            → list last 200 messages, oldest→newest
 *   POST /api/chat/{draftId}            → append message
 *
 * Latency: GET is polled by the client every ~2s. Real-time-ish, no rules
 * change required. If Boris later opens up `/drafts/{$draftId}/chat`
 * (`.read: true, .write: "auth != null"` or similar) we can switch back to
 * the direct client subscription in lib/api/firebase.ts.
 */

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getAdminDatabase } from '@/lib/firebaseAdmin';
import { enrichChatIdentities } from '@/lib/chatProfiles';
import { getPrivyUser } from '@/lib/auth';
import { ApiError } from '@/lib/api/errors';

interface ChatMessageRecord {
  walletAddress: string;
  username: string;
  pfpUrl?: string;
  text: string;
  timestamp: number;
}

const HISTORY_LIMIT = 60; // 200->60 (cost audit 9/2): every poll re-downloads this many from RTDB; a live draft room rarely exceeds 60 on-screen
const TEXT_MAX = 500;

function chatRef(draftId: string) {
  return getAdminDatabase().ref(`/drafts/${draftId}/chat`);
}

function isValidDraftId(s: string): boolean {
  return /^[a-zA-Z0-9-]{3,64}$/.test(s);
}

export async function GET(
  _req: Request,
  { params }: { params: { draftId: string } },
) {
  const { draftId } = params;
  if (!isValidDraftId(draftId)) {
    return NextResponse.json({ error: 'invalid draftId' }, { status: 400 });
  }
  // PRIOR-SEASON short-circuit (cost audit 9/2): stale tabs kept polling dead
  // 2025 draft rooms' chat every few seconds, re-downloading history from RTDB
  // on every poll. Old seasons never get new messages — answer empty with a
  // long edge cache and skip RTDB entirely.
  const seasonPrefix = `${new Date().getFullYear()}-`;
  if (/^\d{4}-/.test(draftId) && !draftId.startsWith(seasonPrefix)) {
    return NextResponse.json(
      { messages: [] },
      { headers: { 'cache-control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400' } },
    );
  }
  try {
    const snap = await chatRef(draftId).limitToLast(HISTORY_LIMIT).once('value');
    const out: Array<ChatMessageRecord & { id: string }> = [];
    snap.forEach((child) => {
      const v = child.val() as Partial<ChatMessageRecord> | null;
      if (v && typeof v.text === 'string' && typeof v.walletAddress === 'string') {
        out.push({
          id: child.key || `${v.timestamp ?? Date.now()}`,
          walletAddress: v.walletAddress,
          username: typeof v.username === 'string' ? v.username : v.walletAddress,
          pfpUrl: typeof v.pfpUrl === 'string' ? v.pfpUrl : undefined,
          text: v.text,
          timestamp: typeof v.timestamp === 'number' ? v.timestamp : Date.now(),
        });
      }
    });
    // Overlay each sender's live profile (name + picture) so chat never shows
    // a stale wallet fragment or a missing avatar — see lib/chatProfiles.
    const messages = await enrichChatIdentities(out);
    return NextResponse.json({ messages });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'read failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: { draftId: string } },
) {
  const { draftId } = params;
  if (!isValidDraftId(draftId)) {
    return NextResponse.json({ error: 'invalid draftId' }, { status: 400 });
  }

  // Author identity comes from the verified Privy token, NOT the request
  // body — otherwise anyone could post messages as any wallet. The stored
  // username is cosmetic (GET overlays the live profile via enrichChatIdentities).
  let walletAddress: string;
  try {
    const user = await getPrivyUser(req);
    if (!user.walletAddress || !/^0x[a-f0-9]{40}$/.test(user.walletAddress.toLowerCase())) {
      return NextResponse.json({ error: 'wallet required' }, { status: 401 });
    }
    walletAddress = user.walletAddress.toLowerCase();
  } catch (err) {
    if (err instanceof ApiError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'auth failed' }, { status: 401 });
  }

  let body: { username?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const username = String(body.username || '').slice(0, 60) || walletAddress;
  const text = String(body.text || '').trim().slice(0, TEXT_MAX);

  if (!text) {
    return NextResponse.json({ error: 'empty text' }, { status: 400 });
  }

  try {
    const ref = await chatRef(draftId).push({
      walletAddress,
      username,
      text,
      timestamp: Date.now(),
    });
    return NextResponse.json({ ok: true, id: ref.key });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'write failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
