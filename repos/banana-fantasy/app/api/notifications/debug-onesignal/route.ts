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

  const wallet = (req.nextUrl.searchParams.get('wallet') || '').trim().toLowerCase();
  if (!wallet) {
    return NextResponse.json({ error: 'wallet required' }, { status: 400 });
  }

  const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !apiKey) {
    return NextResponse.json({ error: 'OneSignal not configured' }, { status: 503 });
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

  return NextResponse.json({
    ok: true,
    wallet,
    totalPlayersInApp: body.total_count ?? 0,
    matchingDevices: matches.length,
    devices: matches.map((p) => ({
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
    })),
  });
}
