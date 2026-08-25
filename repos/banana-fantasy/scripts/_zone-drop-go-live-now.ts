/**
 * ZONE PACKS — go INSTANT mid-window (Richard 8/25: "you're gonna have to
 * put jackhofs in some people's packs and the future ones cuz we're mid
 * into a batch").
 *
 * Converts the LIVE batch-mode band in place: re-spans it to the new tier
 * end (60), gives it the new seat count, draws the sealed seat positions
 * across its WHOLE range (already-filled drafts included), deals every
 * already-filled draft right now (their sealed packs become openable, some
 * loaded), flips the config to instant + new tiers, and lets the webhook
 * deal every fill from here on.
 *
 *   npx tsx scripts/_zone-drop-go-live-now.ts               # DRY RUN (default)
 *   npx tsx scripts/_zone-drop-go-live-now.ts --seats 7      # dry run with the count you want
 *   npx tsx scripts/_zone-drop-go-live-now.ts --seats 7 --execute [--bell]
 *
 * --bell sends ONE neutral bell per holder of a dealt pack ("your packs are
 * open now"), never winners-only. Reads .env.production for Firestore creds.
 */
process.loadEnvFile('/Users/richardvagner/banana-fantasy/.env.production');

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const after = (f: string) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1]; };
const EXECUTE = has('--execute');
const SEATS = Number(after('--seats') ?? '7');
const RAMP = Number(after('--ramp') ?? '1');
const TIERS: [number, number, number] = [Number(after('--t1') ?? '30'), Number(after('--t2') ?? '60'), Number(after('--t2') ?? '60')];
const NEW_SEATS_BY_BAND = [3, SEATS, 0];

async function main() {
  const { getAdminFirestore } = await import('@/lib/firebaseAdmin');
  const { readBonusZoneConfig, readBonusZoneView } = await import('@/lib/bonusZone');
  const zd = await import('@/lib/zoneDrop');
  const { getSealedDrawSeed } = await import('@/lib/jackpotDrawProof');
  const { nightSeedDigest } = await import('@/lib/drop');
  const { FieldValue } = await import('firebase-admin/firestore');

  const db = getAdminFirestore();
  const cfg = await zd.readZoneDropConfig({ fresh: true });
  const bz = await readBonusZoneConfig({ fresh: true });
  const view = await readBonusZoneView();
  const windowStart = view.windowStart;
  console.log(`config: enabled=${cfg.enabled} instant=${cfg.instant} seatsByBand=${JSON.stringify(cfg.seatsByBand)} tiers=${bz.tier1Through}/${bz.tier2Through}/${bz.tier3Through}`);
  console.log(`live: windowStart=${windowStart} nextPosition=${view.position} tier=${view.tier}`);
  if (!cfg.enabled) throw new Error('zone drop switch is OFF');
  if (cfg.instant) throw new Error('already instant — nothing to convert');

  const bandId = zd.bandIdFor(windowStart, 2);
  const bandRef = db.collection('zone_drop_bands').doc(bandId);
  const band = (await bandRef.get()).data() as import('@/lib/zoneDrop').BandDoc | undefined;
  if (!band) throw new Error(`no band ${bandId}`);
  if (band.status !== 'earning' || band.mode === 'instant') throw new Error(`band ${bandId} is ${band.status}/${band.mode ?? 'batch'} — expected earning batch`);

  const packs = (await bandRef.collection('packs').get()).docs.map((d) => d.data() as import('@/lib/zoneDrop').ZonePackDoc);
  const byPos = new Map<number, { draftId: string; packs: number; opened: number }>();
  for (const p of packs) {
    const cur = byPos.get(p.position) ?? { draftId: p.source, packs: 0, opened: 0 };
    cur.packs += 1; if (p.opened) cur.opened += 1;
    byPos.set(p.position, cur);
  }
  const filled = [...byPos.keys()].sort((a, b) => a - b);
  const toPos = TIERS[1];
  console.log(`band ${bandId}: batch, ${band.fromPos} to ${band.toPos}, tickets=${band.tickets}, packs=${packs.length} across ${filled.length} filled drafts (${filled[0]}..${filled[filled.length - 1]})`);
  console.log(`→ becomes INSTANT ${band.fromPos} to ${toPos}, ${SEATS} seats, ramp ${RAMP}`);

  const seed = await getSealedDrawSeed();
  const seedDigest = seed ? nightSeedDigest(seed, `${bandId}:instant`) : null;
  if (!seedDigest) throw new Error('no sealed period seed — refusing to convert on process randomness; retry when a wheel period is active');
  const seatPositions = zd.sealedSeatPositions(seedDigest, bandId, band.fromPos, toPos, SEATS, RAMP);
  const alreadyFilledSeats = seatPositions.filter((p) => byPos.has(p));
  console.log(`sealed seat positions: [${seatPositions.join(', ')}]`);
  console.log(`  → land NOW in already-filled drafts: [${alreadyFilledSeats.join(', ')}]  (${alreadyFilledSeats.length} seat${alreadyFilledSeats.length === 1 ? '' : 's'} dealt immediately)`);
  console.log(`  → still hidden in drafts ahead: [${seatPositions.filter((p) => !byPos.has(p)).join(', ')}]`);
  for (const p of filled) {
    const r = byPos.get(p)!;
    console.log(`  pos ${p} ${r.draftId}: ${r.packs} packs${r.opened ? ` (${r.opened} opened?!)` : ''}${seatPositions.includes(p) ? '  ← SEAT' : ''}`);
  }

  if (!EXECUTE) { console.log('\nDRY RUN — nothing written. Re-run with --execute to convert.'); return; }

  const nowIso = new Date().toISOString();
  // 1. tiers + config (instant, seats, ramp); clear any staged `next`.
  await db.collection('system_config').doc('bonusZone').set({ tier1Through: TIERS[0], tier2Through: TIERS[1], tier3Through: TIERS[2], updatedAtIso: nowIso }, { merge: true });
  await db.collection('system_config').doc('zoneDrop').set({
    instant: true, seatsByBand: NEW_SEATS_BY_BAND, seatRamp: RAMP, next: FieldValue.delete(), liveSeats: FieldValue.delete(),
    appliedAtIso: nowIso, appliedWindowStart: windowStart,
    applied: FieldValue.arrayUnion({ at: nowIso, windowStart, tiers: TIERS, seatsByBand: NEW_SEATS_BY_BAND, instant: true, midWindowConversion: bandId }),
  }, { merge: true });
  console.log('config written: tiers', TIERS.join('/'), 'seatsByBand', NEW_SEATS_BY_BAND, 'instant=true');

  // 2. the band: re-span + seal.
  await bandRef.set({
    mode: 'instant', toPos, tickets: SEATS, seedDigest, seedSource: 'period', seatRamp: RAMP,
    ...(seed ? { saltHash: seed.saltHash, periodNumber: seed.periodNumber } : {}),
    seatPositions, resolved: {}, absorbedPositions: [], rollover: 0, seatsDealt: 0,
    convertedAtIso: nowIso, convertedFrom: { toPos: band.toPos, tickets: band.tickets, packCount: packs.length },
  }, { merge: true });
  console.log('band converted');

  // 3. deal every already-filled draft, ascending (rollover rides forward).
  await zd.readZoneDropConfig({ fresh: true });
  await readBonusZoneConfig({ fresh: true });
  const dealtHolders = new Set<string>();
  for (const p of filled) {
    const r = byPos.get(p)!;
    const res = await zd.resolveZoneDraft({ windowStart, position: p, draftId: r.draftId, isHit: false, notify: false, bandId });
    console.log(`  dealt pos ${p}: ${JSON.stringify(res)}`);
    for (const pk of packs) if (pk.position === p) dealtHolders.add(pk.userId);
  }
  const after2 = (await bandRef.get()).data() as import('@/lib/zoneDrop').BandDoc;
  console.log(`done: seatsDealt=${after2.seatsDealt} winners=${JSON.stringify((after2.winners ?? []).map((w) => w.userId))} rollover=${after2.rollover}`);

  if (has('--bell')) {
    let n = 0;
    for (const w of dealtHolders) {
      const docId = `${w}__zone-drop-convert-${bandId}`.replace(/[/\\\s]+/g, '_').slice(0, 1400);
      await db.collection('marketplace_notifications').doc(docId).create({
        wallet: w, type: 'promo', icon: '📦',
        title: '📦 Your Banana Zone packs are open now',
        message: `New rule: packs open the moment your draft fills, no more waiting for the batch. ${SEATS} JackHOF seats are hidden in drafts ${band.fromPos} to ${toPos} and some already landed. Rip yours.`,
        link: '/promos?promo=bonus-zone', read: false, createdAt: FieldValue.serverTimestamp(),
      }).then(() => { n += 1; }).catch((err: { code?: number }) => { if (err?.code !== 6) throw err; });
    }
    console.log(`bell sent to ${n} holders`);
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error('FAILED:', err.message); process.exit(1); });
