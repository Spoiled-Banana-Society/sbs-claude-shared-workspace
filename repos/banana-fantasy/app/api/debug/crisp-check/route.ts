// TEMP staging diagnostic (Boris 2026-06-11): does the server's Crisp REST
// access actually work? Returns only statuses/counts — never credentials.
// Delete after the Support-tab issue is resolved.

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getCrispCredentials, listConversations } from '@/lib/crispApi';

export async function GET() {
  const creds = getCrispCredentials();
  const tier = (process.env.CRISP_TIER ?? 'user').trim();

  // Try BOTH tiers — Crisp's new website tokens vs legacy plugin tokens
  // disagree on the X-Crisp-Tier header, and 401 looks identical otherwise.
  const tries: Record<string, { status: number | null; body: string }> = {};
  if (creds) {
    for (const t of ['website', 'plugin']) {
      try {
        const res = await fetch(
          'https://api.crisp.chat/v1/website/ed386428-a6f2-435a-a3e1-043f0a078093/conversations',
          {
            headers: {
              Authorization: `Basic ${Buffer.from(`${creds.identifier}:${creds.key}`).toString('base64')}`,
              'X-Crisp-Tier': t,
            },
          },
        );
        tries[t] = { status: res.status, body: (await res.text()).slice(0, 160) };
      } catch (err) {
        tries[t] = { status: null, body: `fetch failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
  }

  const viaLib = await listConversations({}).catch((e) => ({ conversations: [], configured: true, err: String(e) }));

  return NextResponse.json({
    credsConfigured: !!creds,
    tier,
    // First 8 chars only — enough to confirm WHICH identifier the runtime
    // sees, never the secret.
    identifierPrefix: creds ? creds.identifier.slice(0, 8) : null,
    keyLength: creds ? creds.key.length : 0,
    tries,
    libConfigured: viaLib.configured,
    libCount: viaLib.conversations.length,
    libSample: viaLib.conversations.slice(0, 2).map((c) => ({
      session: c.session_id?.slice(0, 12),
      nickname: (c as { meta?: { nickname?: string } }).meta?.nickname ?? null,
    })),
  });
}
