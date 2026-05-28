/**
 * GET /api/notifications/debug-onesignal?wallet=0x...
 *
 * SERVER-TO-SERVER DEBUG ONLY (gated by NOTIFICATIONS_INTERNAL_SECRET).
 *
 * Asks the OneSignal REST API which subscriptions actually have the
 * `walletAddress` tag for a given wallet — the same filter our push
 * sender uses. Diagnoses cases where a user expects multi-device push
 * but only one device is actually subscribed/tagged.
 */
import { NextRequest, NextResponse } from 'next/server';

const INTERNAL_SECRET = process.env.NOTIFICATIONS_INTERNAL_SECRET;

export async function GET(req: NextRequest) {
  if (!INTERNAL_SECRET) {
    return NextResponse.json({ error: 'secret not configured' }, { status: 503 });
  }
  if (req.headers.get('x-internal-secret') !== INTERNAL_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !apiKey) {
    return NextResponse.json({ error: 'OneSignal not configured' }, { status: 503 });
  }

  // Mode: ?notifIds=id1,id2 → return delivery stats for those notifications.
  // Lets us inspect "did APNS/FCM actually deliver this push?" for any
  // notification id captured as providerId in v2_notification_deliveries.
  const notifIdsParam = req.nextUrl.searchParams.get('notifIds');
  if (notifIdsParam) {
    const ids = notifIdsParam.split(',').map((s) => s.trim()).filter(Boolean);
    const stats = await Promise.all(
      ids.map(async (id) => {
        const res = await fetch(
          `https://onesignal.com/api/v1/notifications/${encodeURIComponent(id)}?app_id=${appId}`,
          { headers: { Authorization: `Key ${apiKey}` } },
        );
        if (!res.ok) return { id, error: `HTTP ${res.status}` };
        const d = (await res.json()) as {
          successful?: number;
          failed?: number;
          errored?: number;
          converted?: number;
          remaining?: number;
          platform_delivery_stats?: unknown;
        };
        return {
          id,
          successful: d.successful ?? 0,
          failed: d.failed ?? 0,
          errored: d.errored ?? 0,
          converted: d.converted ?? 0,
          remaining: d.remaining ?? 0,
          platformStats: d.platform_delivery_stats ?? null,
        };
      }),
    );
    return NextResponse.json({ ok: true, stats });
  }

  const wallet = (req.nextUrl.searchParams.get('wallet') || '').trim().toLowerCase();
  if (!wallet) {
    return NextResponse.json({ error: 'wallet or notifIds required' }, { status: 400 });
  }

  const url = `https://onesignal.com/api/v1/players?app_id=${appId}&limit=300`;
  const res = await fetch(url, { headers: { Authorization: `Key ${apiKey}` } });
  if (!res.ok) {
    return NextResponse.json(
      { error: `OneSignal ${res.status}: ${await res.text().catch(() => '')}` },
      { status: 502 },
    );
  }
  const body = (await res.json()) as {
    total_count?: number;
    players?: Array<{
      id?: string;
      device_type?: number;
      device_os?: string;
      device_model?: string;
      created_at?: number;
      last_active?: number;
      invalid_identifier?: boolean;
      notification_types?: number;
      tags?: Record<string, string>;
    }>;
  };

  const matches = (body.players || []).filter(
    (p) => (p.tags?.walletAddress || '').toLowerCase() === wallet,
  );

  const deviceTypeName: Record<number, string> = {
    0: 'iOS', 1: 'Android', 5: 'Chrome web', 7: 'Firefox web',
    8: 'Safari web', 9: 'Edge web', 11: 'Chrome ext', 14: 'SMS', 15: 'Web',
  };

  // Recently-active players that are SUBSCRIBED but don't have the wallet
  // tag — diagnoses cases where re-opting-in created a fresh OneSignal
  // player whose tagging step never ran. These would receive nothing
  // because our server filters by walletAddress tag.
  const recentSubscribedUntagged = (body.players || [])
    .filter((p) => !p.tags?.walletAddress)
    .filter((p) => !p.invalid_identifier && (p.notification_types ?? 0) > 0)
    .sort((a, b) => (b.last_active ?? 0) - (a.last_active ?? 0))
    .slice(0, 5);

  const summarize = (p: typeof matches[number]) => ({
    playerId: p.id,
    deviceType: p.device_type,
    deviceTypeName: p.device_type !== undefined ? deviceTypeName[p.device_type] ?? `type ${p.device_type}` : '?',
    os: p.device_os,
    model: p.device_model,
    created: p.created_at ? new Date(p.created_at * 1000).toISOString() : null,
    lastActive: p.last_active ? new Date(p.last_active * 1000).toISOString() : null,
    subscribed: !p.invalid_identifier && (p.notification_types ?? 0) > 0,
    notificationTypes: p.notification_types,
    invalidIdentifier: p.invalid_identifier,
    tags: p.tags,
  });

  // If ?probe=1, fetch the FULL v1 record for each matching device AND
  // fire a direct-by-playerId send to learn whether OneSignal will
  // actually deliver. `recipients > 0` from include_player_ids targeting
  // is ground truth — bypasses tag filtering and v1-vs-v2 schema noise.
  const probe = req.nextUrl.searchParams.get('probe') === '1';
  const probeResults: unknown[] = [];
  if (probe) {
    for (const m of matches) {
      if (!m.id) continue;
      const fullRes = await fetch(
        `https://onesignal.com/api/v1/players/${m.id}?app_id=${appId}`,
        { headers: { Authorization: `Key ${apiKey}` } },
      );
      const full = fullRes.ok ? await fullRes.json() : { error: await fullRes.text().catch(() => '') };
      const sendRes = await fetch('https://onesignal.com/api/v1/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Key ${apiKey}` },
        body: JSON.stringify({
          app_id: appId,
          include_player_ids: [m.id],
          headings: { en: 'Push probe' },
          contents: { en: 'Direct playerId targeting' },
        }),
      });
      const send = sendRes.ok ? await sendRes.json() : { error: await sendRes.text().catch(() => '') };
      probeResults.push({ playerId: m.id, fullRecord: full, directSend: send });
    }
  }

  return NextResponse.json({
    ok: true,
    wallet,
    totalPlayersInApp: body.total_count ?? 0,
    matchingDevices: matches.length,
    probe: probe ? probeResults : undefined,
    devices: matches.map(summarize),
    recentSubscribedUntagged: recentSubscribedUntagged.map(summarize),
  });
}
