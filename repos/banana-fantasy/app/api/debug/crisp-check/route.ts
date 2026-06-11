// TEMP staging diagnostic (Boris 2026-06-11): does the server's Crisp REST
// access actually work? Returns only statuses/counts — never credentials.
// Delete after the Support-tab issue is resolved.

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getCrispCredentials, listConversations } from '@/lib/crispApi';

export async function GET() {
  const creds = getCrispCredentials();
  const tier = (process.env.CRISP_TIER ?? 'user').trim();

  let directStatus: number | null = null;
  let directBody = '';
  if (creds) {
    try {
      const res = await fetch(
        'https://api.crisp.chat/v1/website/ed386428-a6f2-435a-a3e1-043f0a078093/conversations/1',
        {
          headers: {
            Authorization: `Basic ${Buffer.from(`${creds.identifier}:${creds.key}`).toString('base64')}`,
            'X-Crisp-Tier': tier,
          },
        },
      );
      directStatus = res.status;
      directBody = (await res.text()).slice(0, 300);
    } catch (err) {
      directBody = `fetch failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  const viaLib = await listConversations({}).catch((e) => ({ conversations: [], configured: true, err: String(e) }));

  return NextResponse.json({
    credsConfigured: !!creds,
    tier,
    directStatus,
    directBody,
    libConfigured: viaLib.configured,
    libCount: viaLib.conversations.length,
    libSample: viaLib.conversations.slice(0, 2).map((c) => ({
      session: c.session_id?.slice(0, 12),
      nickname: (c as { meta?: { nickname?: string } }).meta?.nickname ?? null,
    })),
  });
}
