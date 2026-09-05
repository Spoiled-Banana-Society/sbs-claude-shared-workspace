#!/usr/bin/env node
// BANANA RACE bells — three sends, each idempotent via .create() on
// `${wallet}__${dedupeKey}` in marketplace_notifications (bell inbox — NOT
// OneSignal push; bells always work). Dry run unless --apply.
//
//   node scripts/_banana-race-bells.mjs --launch   [--apply]   # Saturday, when the post goes out
//   node scripts/_banana-race-bells.mjs --reminder [--apply]   # Tuesday ~noon PT
//   node scripts/_banana-race-bells.mjs --winners  [--apply]   # Tuesday 5 PM, right after the freeze
//
// --winners sends TWO things: a personal bell to every winner (what they won,
// where, when it drafts) and a results bell to everyone else.
import { db, readConfig, FieldValue, fmtPT, TIER_LABEL } from './_banana-race-lib.mjs';

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const which = args.has('--launch') ? 'launch' : args.has('--reminder') ? 'reminder' : args.has('--winners') ? 'winners' : null;
if (!which) { console.error('pick one: --launch | --reminder | --winners'); process.exit(1); }
const cfg = await readConfig();
if (!cfg.enabled) { console.error('ABORT: race not enabled'); process.exit(1); }
const ZERO = '0x0000000000000000000000000000000000000000';
const day = cfg.endAtIso.slice(0, 10);

const shortTime = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'long', hour: 'numeric', minute: '2-digit' }) + ' PT';

const NOTIS = {
  launch: {
    dedupeKey: `banana-race-launch-${day}`,
    title: 'Banana Race is on',
    message: `Every paid draft is 1 point. Top ${cfg.topN} on points lock a JackHOF seat and every open JackHOF, Jackpot and HOF seat goes out in a points draw. Points close ${shortTime(cfg.endAtIso)}. Anything you bought since Saturday already counts.`,
    link: '/race',
  },
  reminder: {
    dedupeKey: `banana-race-reminder-${day}`,
    title: 'Banana Race closes at 5 PM',
    message: `Last call for points. Top ${cfg.topN} lock a JackHOF seat and every open special seat goes out in the draw at ${shortTime(cfg.endAtIso)}. Winners draft ${shortTime(cfg.draftAtIso)}.`,
    link: '/race',
  },
  results: {
    dedupeKey: `banana-race-results-${day}`,
    title: 'Banana Race results are in',
    message: `Points are closed and the draw is done. See who locked a JackHOF seat and where every seat went. Winner leagues draft ${shortTime(cfg.draftAtIso)}.`,
    link: '/race',
  },
};

async function sendTo(wallets, n) {
  let created = 0, skipped = 0, failed = 0;
  for (const wallet of wallets) {
    const docId = `${wallet}__${n.dedupeKey}`.replace(/[/\\\s]+/g, '_').slice(0, 1400);
    if (!APPLY) { created++; continue; }
    try {
      await db.collection('marketplace_notifications').doc(docId).create({
        wallet, type: 'promo', icon: 'crown', read: false, ...n, createdAt: FieldValue.serverTimestamp(),
      });
      created++;
    } catch (e) {
      if (e?.code === 6 || /already exists/i.test(String(e))) { skipped++; continue; }
      failed++; console.error('FAIL', wallet, String(e).slice(0, 120));
    }
  }
  return { created, skipped, failed };
}

const allWallets = (await db.collection('v2_users').listDocuments()).map((r) => r.id.toLowerCase()).filter((w) => w.startsWith('0x') && w !== ZERO);
console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${which} — ${allWallets.length} users`);

if (which === 'launch' || which === 'reminder') {
  console.log(JSON.stringify(NOTIS[which], null, 1));
  console.log(await sendTo(allWallets, NOTIS[which]));
  process.exit(0);
}

// winners
const plan = (await db.collection('banana_race').doc('plan').get()).data();
if (!plan) { console.error('ABORT: no plan (run the freeze first)'); process.exit(1); }
const byWallet = new Map();
for (const a of plan.assignments) {
  if (!byWallet.has(a.wallet)) byWallet.set(a.wallet, []);
  byWallet.get(a.wallet).push(a);
}
let tot = { created: 0, skipped: 0, failed: 0 };
for (const [wallet, wins] of byWallet) {
  const parts = wins.map((w) => `${TIER_LABEL[w.tier]} seat${w.guaranteed ? ` (top ${plan.topN})` : ''}${w.draftId ? ` in ${w.draftId}` : ' in a brand new league'}`);
  const n = {
    dedupeKey: `banana-race-win-${day}`,
    title: wins.length === 1 ? `You won a ${TIER_LABEL[wins[0].tier]} seat in the Banana Race` : `You won ${wins.length} seats in the Banana Race`,
    message: `${parts.join('. ')}. Your seat is being placed now and the league drafts ${shortTime(cfg.draftAtIso)} on the fast clock. Be in the draft room a few minutes early.`,
    link: '/draft',
  };
  if (!APPLY) console.log(`  ${wallet.slice(0, 8)}: ${n.title} — ${n.message}`);
  const r = await sendTo([wallet], n);
  tot = { created: tot.created + r.created, skipped: tot.skipped + r.skipped, failed: tot.failed + r.failed };
}
console.log('winner bells', tot, `(${byWallet.size} winners)`);
const rest = allWallets.filter((w) => !byWallet.has(w));
console.log('results bell to everyone else', await sendTo(rest, NOTIS.results));
process.exit(0);
