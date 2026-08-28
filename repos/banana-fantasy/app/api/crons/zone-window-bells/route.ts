import { NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { readBonusZoneConfig, laneViewFromTracker, bonusZoneViewForLane } from '@/lib/bonusZone';
import { readZoneDropConfig } from '@/lib/zoneDrop';
import { createNotificationForWallets } from '@/lib/queueNotifications';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Banana Zone tier-2 opener bell (Boris 2026-08-28: "when it's the next
 * window, the bell to everyone"). Watches the zone the same way the header
 * and Draft Bot do (tracker → laneViewFromTracker → bonusZoneViewForLane,
 * reveal-gated so it can never announce ahead of a slot reveal) and the
 * moment a window's Buy 2 band is live, broadcasts once:
 *
 *   JackHOF Seats + Free Spins
 *   7 JackHOF seats in the next {N} Drafts
 *   Buy 2 Get 1 Spin for the next {N} Drafts
 *   Banana Zone Promo
 *
 * {N} live-updates client-side (dynamic 'zone-window-2', lib/liveCounters —
 * same plumbing as the tier-1 bell) and freezes at 1 when the band ends.
 *
 * Idempotent per window: promo_announcements/zone-b2-{windowStart} create()
 * guard + the same window-scoped dedupeKey on every bell doc.
 */
export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected || (req.headers.get('authorization') ?? '') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const db = getAdminFirestore();

  const bzCfg = await readBonusZoneConfig();
  if (!bzCfg.enabled) return NextResponse.json({ ok: true, skip: 'zone-disabled' });

  const tracker = (await db.collection('drafts').doc('draftTracker').get()).data();
  const lane = laneViewFromTracker(tracker as Parameters<typeof laneViewFromTracker>[0]);
  if (!lane.rolling) return NextResponse.json({ ok: true, skip: 'not-rolling' });

  const v = bonusZoneViewForLane(lane.windowStart, lane.revealedFilled, bzCfg);
  if (v.tier !== 2) return NextResponse.json({ ok: true, skip: `tier-${String(v.tier)}` });

  // Once per window, ever.
  const guardRef = db.collection('promo_announcements').doc(`zone-b2-${lane.windowStart}`);
  try {
    await guardRef.create({ windowStart: lane.windowStart, at: FieldValue.serverTimestamp() });
  } catch {
    return NextResponse.json({ ok: true, skip: 'already-announced' });
  }

  // Seat count at announce time (band 2 opens with its full allotment).
  let seats = 7;
  try {
    const zd = await readZoneDropConfig();
    if (zd.liveSeats && zd.liveSeats.windowStart === lane.windowStart && zd.liveSeats.band === 2) {
      seats = Math.max(1, zd.liveSeats.tickets - zd.liveSeats.dealt);
    }
  } catch { /* default holds */ }

  const [users, bots] = await Promise.all([
    db.collection('v2_users').select().get(),
    db.collection('botWallets').select().get(),
  ]);
  const botSet = new Set(bots.docs.map((d) => d.id.toLowerCase()));
  const wallets = users.docs.map((d) => d.id)
    .filter((w) => /^0x[0-9a-f]{40}$/i.test(w) && !botSet.has(w.toLowerCase()));

  const sent = await createNotificationForWallets(wallets, {
    type: 'promo',
    title: `${seats} JackHOF Seat${seats === 1 ? '' : 's'}`,
    message: `${seats} JackHOF seat${seats === 1 ? '' : 's'} in the next {N} Drafts\nBuy 2 Get 1 Spin for the next {N} Drafts\nBanana Zone Promo`,
    link: '/promos',
    dedupeKey: `zone-b2-${lane.windowStart}`,
    icon: '🍌',
    dynamic: 'zone-window-2',
  });

  return NextResponse.json({ ok: true, windowStart: lane.windowStart, seats, sent });
}
