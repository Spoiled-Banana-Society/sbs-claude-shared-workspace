// Banana Race — shared bits for the ops scripts (READ helpers only; the
// scripts that write say so in their own headers). Mirrors lib/bananaRace.ts:
// keep the tally rules in both places identical.
//
//   import { db, readConfig, tally, openLeagues, personOf } from './_banana-race-lib.mjs';
import admin from 'firebase-admin';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const src = readFileSync(join(ROOT, 'lib', 'firebaseAdmin.ts'), 'utf8');
const sa = JSON.parse(Buffer.from(/STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src)[1], 'base64').toString('utf8'));
admin.initializeApp({
  credential: admin.credential.cert(sa),
  databaseURL: 'https://sbs-staging-env-default-rtdb.firebaseio.com',
});
export const db = admin.firestore();
export const rtdb = admin.database();
export const FieldValue = admin.firestore.FieldValue;
export const SITE = 'https://sbsfantasy.com'; // NOT www — 307s
export const TIERS = ['jackhof', 'jackpot', 'hof'];
export const TIER_LABEL = { jackhof: 'JackHOF', jackpot: 'Jackpot', hof: 'HOF' };

export const DEFAULTS = {
  startAtIso: '2026-09-05T07:00:00.000Z', // Sat Sep 5 12:00 AM PT
  endAtIso: '2026-09-09T00:00:00.000Z',   // Tue Sep 8 5:00 PM PT
  draftAtIso: '2026-09-09T01:00:00.000Z', // Tue Sep 8 6:00 PM PT
  topN: 10,
};

export const fmtPT = (iso) =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' PT';

export async function readConfig() {
  const cur = (await db.collection('system_config').doc('bananaRace').get()).data() ?? {};
  return { enabled: false, frozen: false, launchAtIso: null, ...DEFAULTS, ...cur };
}

// ── people: bots out, linked wallets merged ─────────────────────────────────
let _bots = null;
export async function botSet() {
  if (_bots) return _bots;
  _bots = new Set((await db.collection('botWallets').select().get()).docs.map((d) => d.id.toLowerCase()));
  return _bots;
}

let _groups = null;
async function linkedGroups() {
  if (_groups) return _groups;
  const shipped = [];
  const lw = readFileSync(join(ROOT, 'lib', 'linkedWallets.ts'), 'utf8');
  const block = /LINKED_WALLET_GROUPS[^=]*=\s*\[([\s\S]*?)\n\];/.exec(lw)?.[1] ?? '';
  for (const line of block.split('\n')) {
    const ws = [...line.matchAll(/0x[0-9a-fA-F]{40}/g)].map((m) => m[0].toLowerCase());
    if (ws.length >= 2) shipped.push(ws);
  }
  const remote = (await db.collection('system_config').doc('linkedWallets').get()).data()?.groups ?? [];
  _groups = [...shipped, ...remote.filter(Array.isArray).map((g) => g.map((w) => String(w).toLowerCase()))];
  return _groups;
}

/** Every wallet that is the same person as `wallet` (incl. itself), sorted. */
export async function personOf(wallet) {
  const w = wallet.toLowerCase();
  const groups = await linkedGroups();
  const seen = new Set([w]); const stack = [w];
  while (stack.length) {
    const cur = stack.pop();
    for (const g of groups) if (g.includes(cur)) for (const x of g) if (!seen.has(x)) { seen.add(x); stack.push(x); }
  }
  return [...seen].sort();
}
export const personKey = async (wallet) => (await personOf(wallet))[0];

// ── tally (mirror of lib/bananaRace.ts tallyBananaRace) ─────────────────────
export async function tally(cfg) {
  const bots = await botSet();
  const snap = await db.collection('v2_activity_events')
    .where('createdAtIso', '>=', cfg.startAtIso)
    .where('createdAtIso', '<', cfg.endAtIso)
    .select('type', 'userId', 'quantity', 'createdAtIso', 'username')
    .get();
  const events = snap.docs.map((d) => d.data())
    .filter((e) => e.type === 'pass_purchased' && typeof e.userId === 'string' && (Number(e.quantity) || 0) > 0)
    .sort((a, b) => String(a.createdAtIso).localeCompare(String(b.createdAtIso)));
  const byKey = new Map();
  for (const e of events) {
    const w = e.userId.toLowerCase();
    if (bots.has(w)) continue;
    const key = await personKey(w);
    let a = byKey.get(key);
    if (!a) { a = { key, wallets: new Set(), walletPoints: {}, points: 0, reachedAtIso: '', names: new Map() }; byKey.set(key, a); }
    a.wallets.add(w);
    const q = Math.floor(Number(e.quantity));
    a.points += q; a.walletPoints[w] = (a.walletPoints[w] ?? 0) + q;
    a.reachedAtIso = String(e.createdAtIso ?? a.reachedAtIso);
    if (e.username && !String(e.username).startsWith('User-')) a.names.set(w, e.username);
  }
  const missing = [...byKey.values()].filter((a) => a.names.size === 0).flatMap((a) => [...a.wallets]);
  if (missing.length) {
    const snaps = await db.getAll(...missing.map((w) => db.collection('v2_users').doc(w)));
    for (const s of snaps) {
      const d = s.data() ?? {};
      const name = [d.username, d.displayName].find((v) => typeof v === 'string' && v && !v.startsWith('User-'));
      if (name) byKey.get(await personKey(s.id))?.names.set(s.id, name);
    }
  }
  const rows = [...byKey.values()].map((a) => ({
    key: a.key,
    wallets: [...a.wallets].sort(),
    /** The wallet to SEAT: the one that bought the most in the window. */
    seatWallet: Object.entries(a.walletPoints).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0],
    name: a.names.get(a.key) ?? [...a.names.values()][0] ?? `${a.key.slice(0, 6)}…${a.key.slice(-4)}`,
    points: a.points,
    reachedAtIso: a.reachedAtIso,
  }));
  rows.sort((x, y) => y.points - x.points || x.reachedAtIso.localeCompare(y.reachedAtIso) || x.key.localeCompare(y.key));
  return { rows, totals: { players: rows.length, points: rows.reduce((s, r) => s + r.points, 0) }, computedAtIso: new Date().toISOString() };
}

// ── open special leagues ────────────────────────────────────────────────────
/** Every special round still filling, members resolved to PERSON keys. */
export async function openLeagues() {
  const out = [];
  for (const tier of TIERS) {
    const q = (await db.collection('v2_queues').doc(tier).get()).data() ?? { rounds: [] };
    for (const r of q.rounds ?? []) {
      if (r.status !== 'filling') continue;
      const members = [];
      for (const m of r.members ?? []) members.push({ wallet: String(m.wallet).toLowerCase(), tokenId: m.tokenId ? String(m.tokenId) : null, person: await personKey(m.wallet), joinedAt: m.joinedAt ?? null });
      if (members.length >= 10) continue;
      let started = false;
      if (r.draftId) started = (await db.collection('drafts').doc(r.draftId).collection('state').doc('info').get()).exists;
      out.push({ tier, roundId: r.roundId, draftId: r.draftId ?? null, source: r.source ?? 'wheel', reserved: r.reservedForRace === true, started, members, open: 10 - members.length });
    }
  }
  return out;
}

// ── deterministic RNG for the draw (mulberry32 over a recorded seed) ────────
export function rng(seedHex) {
  let a = parseInt(seedHex.slice(0, 8), 16) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
