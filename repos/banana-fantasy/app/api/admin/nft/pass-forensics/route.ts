import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { requireAdmin } from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * READ-ONLY forensic dump for a wallet + specific token ids, to prove HOW a
 * drafted token ended up back in the spendable pool. For each token id it shows
 * every validDraftTokens / usedDraftTokens record (cardId + decoded on-chain id
 * + timestamps), the global draftTokens owner for those cardIds (collision
 * proof), the user's reconcile timestamps, and recent Alchemy webhook events
 * (each one triggers a reconcile). Nothing is mutated.
 */
async function authed(req: Request): Promise<boolean> {
  const provided = req.headers.get('x-admin-key') || '';
  const adminKey = process.env.ADMIN_API_KEY || '';
  const bootstrap = process.env.NFT_REFRESH_SECRET || '';
  if ((adminKey && provided === adminKey) || (bootstrap && provided === bootstrap)) return true;
  try { await requireAdmin(req); return true; } catch { return false; }
}

function decodeTokenId(cardId: string, realTokenId: string): string {
  const rt = String(realTokenId || '').trim();
  if (/^\d+$/.test(rt)) return rt;
  const c = String(cardId || '').trim();
  if (/^\d{1,7}$/.test(c)) return c;
  if (/^\d{10}\d{1,7}$/.test(c)) return c.slice(10);
  return '';
}

// First 10 digits of a synthetic/staging cardId are a unix timestamp (seconds
// for staging-encoded, or the leading seconds of a UnixNano synthetic).
function cardIdStamp(cardId: string): string {
  const c = String(cardId || '');
  if (c.length >= 13) {
    const secs = Number(c.slice(0, 10));
    if (secs > 1_700_000_000 && secs < 2_000_000_000) return `~${secs}`;
  }
  return '(no stamp)';
}

export async function POST(req: Request) {
  if (!(await authed(req))) return jsonError('Unauthorized', 401);
  const owner = (getSearchParam(req, 'owner') || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(owner)) return jsonError('owner required', 400);
  const tokens = (getSearchParam(req, 'tokens') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const db = getAdminFirestore();

  const scanCol = async (sub: string) => {
    const snap = await db.collection(`owners/${owner}/${sub}`).get();
    const rows: Array<Record<string, unknown>> = [];
    snap.forEach((d) => {
      const x = d.data() as Record<string, unknown>;
      const cardId = String(x.CardId ?? x.cardId ?? d.id);
      const realTokenId = String(x.RealTokenId ?? x.realTokenId ?? '');
      rows.push({ docId: d.id, cardId, realTokenId, tokenId: decodeTokenId(cardId, realTokenId), stamp: cardIdStamp(cardId), passType: x.PassType ?? x.passType, leagueId: x.LeagueId ?? x.leagueId, leagueName: x.LeagueDisplayName });
    });
    return rows;
  };

  const valid = await scanCol('validDraftTokens');
  const used = await scanCol('usedDraftTokens');

  const perToken: Record<string, unknown> = {};
  for (const t of tokens) {
    const v = valid.filter((r) => r.tokenId === t);
    const u = used.filter((r) => r.tokenId === t);
    // global draftTokens owner for each cardId seen — proves cross-owner collision.
    const globalOwners: Record<string, string> = {};
    for (const r of [...v, ...u]) {
      const cid = String(r.cardId);
      try {
        const g = await db.collection('draftTokens').doc(cid).get();
        globalOwners[cid] = g.exists ? String((g.data() as Record<string, unknown>)?.OwnerId ?? '(none)') : '(missing)';
      } catch { globalOwners[cid] = '(err)'; }
    }
    // does global draftTokens keyed by the BARE on-chain id exist + who owns it?
    let bareOwner = '(missing)';
    try { const g = await db.collection('draftTokens').doc(t).get(); if (g.exists) bareOwner = String((g.data() as Record<string, unknown>)?.OwnerId ?? '(none)'); } catch { bareOwner = '(err)'; }
    perToken[t] = { available: v, used: u, globalDraftTokensOwnerByCardId: globalOwners, globalDraftTokensBareIdOwner: bareOwner };
  }

  // Reconcile run evidence.
  let userDoc: Record<string, unknown> = {};
  try {
    const u = await db.collection('v2_users').doc(owner).get();
    const x = (u.data() ?? {}) as Record<string, unknown>;
    const tsToStr = (v: unknown) => (v && typeof v === 'object' && 'toDate' in (v as object)) ? (v as { toDate(): Date }).toDate().toISOString() : v;
    userDoc = { draftPasses: x.draftPasses, freeDrafts: x.freeDrafts, onchainSyncedAt: tsToStr(x.onchainSyncedAt), passesSyncedAt: tsToStr(x.passesSyncedAt) };
  } catch { /* ignore */ }

  // Recent webhook reconciles affecting this wallet.
  const webhooks: Array<Record<string, unknown>> = [];
  try {
    const snap = await db.collection('alchemy_webhook_events').where('affectedWallets', 'array-contains', owner).limit(25).get();
    snap.forEach((d) => {
      const x = d.data() as Record<string, unknown>;
      const r = x.receivedAt as { toDate?: () => Date } | undefined;
      webhooks.push({ id: d.id, receivedAt: r?.toDate ? r.toDate().toISOString() : x.receivedAt, activityCount: x.activityCount });
    });
  } catch (err) { webhooks.push({ error: String(err) }); }

  return json({ owner, userDoc, totals: { validDraftTokens: valid.length, usedDraftTokens: used.length }, webhookReconciles: webhooks.length, recentWebhooks: webhooks.slice(0, 25), perToken });
}
