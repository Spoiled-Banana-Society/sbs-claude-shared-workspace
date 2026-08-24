import { NextResponse } from 'next/server';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { reserveTokensToWallet, isAdminMintConfigured } from '@/lib/onchain/adminMint';
import { recordPassOrigins } from '@/lib/onchain/passOrigin';
import { getOnchainOwner } from '@/lib/onchain/ownerOf';
import { upsertMarketplaceIndex, normalizeLevel } from '@/lib/marketplaceIndex';
import { recountFromInventory } from '@/lib/passLedger';
import { acquireAdminWalletLock } from '@/lib/onchain/adminWalletLock';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * ONE-OFF (2026-08-24, Richard: "do it to everyone affected"). Remove after use.
 *
 * Transferred DRAFTED TEAMS were re-registered as fresh passes by
 * reconcilePassesForWallet (fixed in 2066d993). 8 drafts were played on such
 * phantom passes and 5 more sit unused. For each played draft: mint a real
 * BBB4 NFT to the drafter and point the engine card at it (RealTokenId) — the
 * same move link-wheel-teams makes — so the team lives on its own token and the
 * original token goes back to its original team. Unused phantom passes are
 * deleted (the NFT underneath stays with the buyer as the team they bought).
 *
 * Lives here only because BBB4_OWNER_PRIVATE_KEY is a Vercel-sensitive env
 * (cannot be pulled locally). The rebuild (refresh-draft) + OpenSea refresh
 * run from the local companion script scripts/_tmp-phantom-pass-remediation.mts.
 *
 * Auth: `Authorization: Bearer ${PHANTOM_REMEDIATION_SECRET}` (one-off env).
 * Body: { apply?: boolean }. Every fact is re-proven from chain + engine before
 * any write; any preflight failure aborts the whole run.
 */

interface Case { name: string; holder: string; league: string; leagueName: string; synth: string; real: string; origName: string; origLeague: string }
const CASES: Case[] = [
  { name: 'GatorMAB', holder: '0x4cb8a72d3456ff8124285869270af99598371b7c', league: '2026-slow-draft-102', leagueName: 'BBB #742', synth: '1786902037970176032', real: '1081', origName: 'Sh0resi', origLeague: '2026-fast-draft-57' },
  { name: 'GatorMAB', holder: '0x4cb8a72d3456ff8124285869270af99598371b7c', league: '2026-slow-draft-103', leagueName: 'BBB #744', synth: '1786902038110414078', real: '2099', origName: 'Goodtimes', origLeague: '2026-fast-draft-107' },
  { name: 'AkFF', holder: '0xe2fe2efbbe8eca9884a22f13bafbf38538c16a77', league: '2026-fast-draft-773', leagueName: 'BBB #879', synth: '1787588443206418297', real: '9283', origName: '9erFan', origLeague: '2026-fast-draft-749' },
  { name: 'sdotdfs', holder: '0xdbcb63b2e5155bc80f636ad7268b3e82434c9bed', league: '2026-slow-draft-62', leagueName: 'BBB #534', synth: '1786147539864086059', real: '815', origName: 'Goodtimes', origLeague: '2026-fast-draft-55' },
  { name: 'sdotdfs', holder: '0xdbcb63b2e5155bc80f636ad7268b3e82434c9bed', league: '2026-fast-draft-484', leagueName: 'BBB #537', synth: '1786147540199454569', real: '3743', origName: 'Bananaknight', origLeague: '2026-fast-draft-395' },
  { name: 'sdotdfs', holder: '0xdbcb63b2e5155bc80f636ad7268b3e82434c9bed', league: '2026-slow-draft-67', leagueName: 'BBB #586', synth: '1786147540421925191', real: '3744', origName: 'Bananaknight', origLeague: '2026-fast-draft-404' },
  { name: 'sdotdfs', holder: '0xdbcb63b2e5155bc80f636ad7268b3e82434c9bed', league: '2026-slow-draft-107', leagueName: 'KFFL #1', synth: '1786147540614001380', real: '3745', origName: 'Bananaknight', origLeague: '2026-slow-draft-46' },
  { name: 'JonnyCanuck', holder: '0xff851f761aa3d7d1e9b812176c4106f6d3f3aee5', league: '2026-slow-draft-107', leagueName: 'KFFL #1', synth: '1786145301527114354', real: '4156', origName: 'tomalom69', origLeague: '2026-fast-draft-453' },
];
const UNUSED: Array<{ name: string; holder: string; synth: string; real: string }> = [
  { name: 'GatorMAB', holder: '0x4cb8a72d3456ff8124285869270af99598371b7c', synth: '1786936838069515041', real: '7971' },
  { name: 'GatorMAB', holder: '0x4cb8a72d3456ff8124285869270af99598371b7c', synth: '1787451319159223120', real: '8738' },
  { name: 'GatorMAB', holder: '0x4cb8a72d3456ff8124285869270af99598371b7c', synth: '1787578833158095325', real: '8698' },
  { name: 'GatorMAB', holder: '0x4cb8a72d3456ff8124285869270af99598371b7c', synth: '1787578833315118787', real: '9089' },
  { name: 'sdotdfs', holder: '0xdbcb63b2e5155bc80f636ad7268b3e82434c9bed', synth: '1786147540948760683', real: '3747' },
];
const GO = process.env.STAGING_DRAFTS_API_URL || 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';

function rosterAttrs(roster: Record<string, Array<{ PlayerId?: string }> | null> | undefined): Array<{ Trait_Type: string; Value: string }> {
  const out: Array<{ Trait_Type: string; Value: string }> = [];
  for (const pos of ['QB', 'RB', 'WR', 'TE', 'DST']) {
    (roster?.[pos] ?? []).filter(Boolean).forEach((p, i) => out.push({ Trait_Type: `${pos}${i + 1}`, Value: String(p.PlayerId ?? '') }));
  }
  return out;
}

export async function POST(req: Request) {
  const expected = (process.env.PHANTOM_REMEDIATION_SECRET || '').trim();
  const auth = req.headers.get('authorization') || '';
  if (!expected || auth !== `Bearer ${expected}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isFirestoreConfigured()) return NextResponse.json({ error: 'firestore not configured' }, { status: 503 });
  if (!isAdminMintConfigured()) return NextResponse.json({ error: 'admin mint not configured' }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { apply?: boolean };
  const apply = body.apply === true;
  const db = getAdminFirestore();
  const lines: string[] = [];
  const fail: string[] = [];

  // ── Preflight ──────────────────────────────────────────────────────────────
  const walletOf = async (u: string) => (await db.collection('v2_users').where('username_lower', '==', u.toLowerCase()).get()).docs[0]?.id ?? '';
  const goTokens = async (w: string) => fetch(`${GO}/owner/${w}/draftToken/all`, { cache: 'no-store' }).then((r) => r.json() as Promise<{ active?: Array<Record<string, unknown>> }>).catch(() => ({ active: [] }));
  const already = new Set<string>();
  for (const c of CASES) {
    const done = await db.collection('phantom_pass_remediation').doc(c.synth).get();
    if (done.exists) { already.add(c.synth); lines.push(`⏭ ${c.name} ${c.leagueName}: already remediated → ${done.get('newId')}`); continue; }
    const used = await db.collection('owners').doc(c.holder).collection('usedDraftTokens').doc(c.synth).get();
    const card = await db.collection('drafts').doc(c.league).collection('cards').doc(c.synth).get();
    const owner = (await getOnchainOwner(c.real))?.toLowerCase() ?? null;
    const orig = await goTokens(await walletOf(c.origName));
    const origStill = (orig.active ?? []).find((t) => String(t._cardId) === c.real);
    const p: string[] = [];
    if (!used.exists || String(used.get('RealTokenId')) !== c.real) p.push('usedDraftTokens missing/mismatch');
    if (!card.exists || String(card.get('RealTokenId')) !== c.real) p.push('cards doc missing/mismatch');
    if (owner !== c.holder) p.push(`ownerOf(${c.real})=${owner}`);
    if (!origStill || String(origStill._leagueId) !== c.origLeague) p.push(`${c.origName} no longer holds ${c.real} in ${c.origLeague}`);
    lines.push(`${p.length ? '❌' : '✅'} ${c.name} ${c.leagueName} synth=${c.synth} real=${c.real}${p.length ? ' → ' + p.join('; ') : ''}`);
    fail.push(...p.map((x) => `${c.name}/${c.leagueName}: ${x}`));
  }
  for (const u of UNUSED) {
    const done = await db.collection('phantom_pass_remediation').doc(u.synth).get();
    if (done.exists) { already.add(u.synth); lines.push(`⏭ ${u.name} unused ${u.real}: already deleted`); continue; }
    const v = await db.collection('owners').doc(u.holder).collection('validDraftTokens').doc(u.synth).get();
    const owner = (await getOnchainOwner(u.real))?.toLowerCase() ?? null;
    const p: string[] = [];
    if (!v.exists || String(v.get('RealTokenId')) !== u.real) p.push('validDraftTokens missing/mismatch');
    if (owner !== u.holder) p.push(`ownerOf(${u.real})=${owner}`);
    lines.push(`${p.length ? '❌' : '✅'} ${u.name} UNUSED synth=${u.synth} real=${u.real}${p.length ? ' → ' + p.join('; ') : ''}`);
    fail.push(...p.map((x) => `${u.name}/unused ${u.real}: ${x}`));
  }
  if (fail.length) return NextResponse.json({ ok: false, apply, aborted: true, fail, lines }, { status: 409 });
  const todo = CASES.filter((c) => !already.has(c.synth));
  const todoUnused = UNUSED.filter((u) => !already.has(u.synth));
  if (!apply) return NextResponse.json({ ok: true, apply: false, lines, plan: { mint: todo.length, deleteUnused: todoUnused.length } });

  // ── 1. Mint (one tx per wallet) ────────────────────────────────────────────
  const byHolder = new Map<string, Case[]>();
  for (const c of todo) byHolder.set(c.holder, [...(byHolder.get(c.holder) ?? []), c]);
  const minted: Array<Case & { newId: string; txHash: string }> = [];
  for (const [holder, cs] of byHolder) {
    const release = await acquireAdminWalletLock('phantom-pass-remediation');
    let res: { txHash: `0x${string}`; tokenIds: string[] };
    try { res = await reserveTokensToWallet({ to: holder, count: cs.length }); } finally { await release(); }
    await recordPassOrigins({ tokenIds: res.tokenIds, origin: 'admin_grant', ownerAtMint: holder, txHash: res.txHash, reason: 'phantom-pass-remediation-2026-08-24 (team NFT, never a pass)' });
    cs.forEach((c, i) => minted.push({ ...c, newId: res.tokenIds[i], txHash: res.txHash }));
    lines.push(`MINT ${cs[0].name}: ${res.tokenIds.join(', ')} tx=${res.txHash}`);
    logger.info('phantom_remediation.minted', { holder, tokenIds: res.tokenIds, txHash: res.txHash });
  }

  // ── 2. Re-point each engine card + team record under the new token ─────────
  const now = new Date().toISOString();
  for (const c of minted) {
    const cardRef = db.collection('drafts').doc(c.league).collection('cards').doc(c.synth);
    const usedRef = db.collection('owners').doc(c.holder).collection('usedDraftTokens').doc(c.synth);
    const card = (await cardRef.get()).data() ?? {};
    const meta = (await db.collection('draftTokenMetadata').doc(c.synth).get()).data();
    const fin = (meta?.Attributes as Array<{ Trait_Type?: string; Value?: string }> | undefined) ?? [];
    let attrs: Array<{ Trait_Type: string; Value: string }>;
    if (fin.length >= 20) attrs = fin.map((a) => ({ Trait_Type: String(a.Trait_Type), Value: String(a.Value) }));
    else {
      const rosters = ((await db.collection('drafts').doc(c.league).collection('state').doc('rosters').get()).data()?.Rosters ?? {}) as Record<string, Record<string, Array<{ PlayerId?: string }> | null>>;
      attrs = [...rosterAttrs(rosters[c.holder]),
        { Trait_Type: 'LEVEL', Value: String(card.Level ?? 'Pro') }, { Trait_Type: 'WEEK-SCORE', Value: '0' }, { Trait_Type: 'SEASON-SC0RE', Value: '0' },
        { Trait_Type: 'RANK', Value: 'N/A' }, { Trait_Type: 'LEAGUE-NAME', Value: c.leagueName }, { Trait_Type: 'LEAGUE-RANK', Value: '' }, { Trait_Type: 'PRIZES', Value: '0.000000 ETH' }];
    }
    const patch = { RealTokenId: c.newId, remediation: { previousRealTokenId: c.real, reason: 'phantom pass from transferred drafted team', at: now, txHash: c.txHash } };
    await cardRef.set(patch, { merge: true });
    await usedRef.set(patch, { merge: true });
    await db.collection('draftTokenMetadata').doc(c.newId).set({
      Name: `BBB pass #${c.newId}`,
      Description: meta?.Description ?? 'Banana Best Ball, the first ever Web3 Fantasy Football Draft tournament on chain.',
      Image: meta?.Image ?? card.ImageUrl ?? '', Attributes: attrs,
    }, { merge: true });
    await upsertMarketplaceIndex(c.newId, { status: 'team', level: normalizeLevel(String(card.Level ?? 'Pro')), levelRaw: String(card.Level ?? 'Pro'), leagueNumber: Number((c.leagueName.match(/\d+/) ?? ['0'])[0]) || null });
    await db.collection('nft_league_map').doc(c.newId).set({ tokenId: c.newId, leagueId: c.league, ownerAtMap: c.holder, mappedAt: Date.now(), mappedBy: 'admin:phantom-pass-remediation-2026-08-24' }, { merge: true });
    await db.collection('phantom_pass_remediation').doc(c.synth).set({ ...c, kind: 'drafted', at: now });
    lines.push(`REPOINT ${c.name} ${c.leagueName}: card ${c.synth} → RealTokenId ${c.newId} (was ${c.real}); attrs=${attrs.length}`);
  }

  // ── 3. Delete phantom unused passes + fix mirrors ──────────────────────────
  for (const u of todoUnused) {
    const ref = db.collection('owners').doc(u.holder).collection('validDraftTokens').doc(u.synth);
    const snap = (await ref.get()).data() ?? null;
    await db.collection('phantom_pass_remediation').doc(u.synth).set({ ...u, kind: 'unused', deletedDoc: snap, at: now });
    await ref.delete();
    lines.push(`DELETE ${u.name}: validDraftTokens/${u.synth} (real ${u.real})`);
  }
  for (const w of new Set(todoUnused.map((u) => u.holder))) {
    const c = await recountFromInventory(w);
    lines.push(`RECOUNT ${w.slice(0, 10)}: draftPasses=${c.draftPasses} freeDrafts=${c.freeDrafts}`);
  }

  return NextResponse.json({
    ok: true, apply: true, lines,
    minted: minted.map((c) => ({ name: c.name, league: c.league, leagueName: c.leagueName, newId: c.newId, real: c.real, origLeague: c.origLeague, txHash: c.txHash })),
    deleted: todoUnused.map((u) => u.synth),
  });
}
