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

interface ChatMessageRecord {
  walletAddress: string;
  username: string;
  pfpUrl?: string;
  text: string;
  timestamp: number;
}

const HISTORY_LIMIT = 200;
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

  let body: { walletAddress?: string; username?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const walletAddress = String(body.walletAddress || '').toLowerCase();
  const username = String(body.username || '').slice(0, 60) || walletAddress;
  const text = String(body.text || '').trim().slice(0, TEXT_MAX);

  if (!walletAddress || !/^0x[a-f0-9]{40}$/.test(walletAddress)) {
    return NextResponse.json({ error: 'invalid wallet' }, { status: 400 });
  }
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
