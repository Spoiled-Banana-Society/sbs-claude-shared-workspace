export const dynamic = 'force-dynamic';

import { createHash } from 'node:crypto';
import { FieldPath } from 'firebase-admin/firestore';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { requirePrivateLeagueAdmin, allowedEntriesFor } from '@/lib/privateLeagueAdmin';
import { logAdminAction } from '@/lib/adminAudit';
import { getRequestId } from '@/lib/requestId';
import { logger } from '@/lib/logger';

/**
 * Commissioner admin surface for ONE private league (ticket-3338, KFFL).
 *
 * GET  → the league's drafts + roster + per-wallet entries used/allowed.
 * POST → bump a wallet's allowed entries by ±1 (or pre-authorize a wallet
 *        that hasn't joined yet).
 *
 * Auth: requirePrivateLeagueAdmin — the league's own AdminWallets, or an SBS
 * site admin. Everything returned is scoped to this league's drafts; there is
 * deliberately nothing SBS-internal here (no global counters, no other users,
 * no revenue), because the KFFL commissioner is not a founder.
 */

interface LeagueUserDoc {
  OwnerId?: string;
  TokenId?: string;
}
interface DraftDoc {
  LeagueId?: string;
  DisplayName?: string;
  NumPlayers?: number;
  CurrentUsers?: LeagueUserDoc[];
}

const WALLET_RE = /^0x[0-9a-f]{40}$/i;

function draftNumber(id: string): number {
  const m = /-draft-(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
}

/** owners/{w}.PFP.DisplayName, filtered to real user-chosen names only. */
function realDisplayName(raw: unknown, wallet: string): string | null {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name) return null;
  if (/^user-/i.test(name)) return null;
  if (/^0x[0-9a-f]{4,}/i.test(name)) return null;
  if (name.toLowerCase() === wallet.toLowerCase()) return null;
  return name;
}

async function displayNames(wallets: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (wallets.length === 0) return out;
  const db = getAdminFirestore();
  const refs = wallets.map((w) => db.collection('owners').doc(w));
  const snaps = await db.getAll(...refs);
  snaps.forEach((snap, i) => {
    const wallet = wallets[i];
    const pfp = (snap.data() as { PFP?: { DisplayName?: string } } | undefined)?.PFP;
    out.set(wallet, realDisplayName(pfp?.DisplayName, wallet));
  });
  return out;
}

async function buildLeagueView(leagueId: string, cfg: Awaited<ReturnType<typeof requirePrivateLeagueAdmin>>['cfg']) {
  const db = getAdminFirestore();
  const draftSnaps = await db.collection('drafts').where('PrivateLeagueId', '==', leagueId).get();

  const drafts = draftSnaps.docs
    .map((d) => {
      const data = d.data() as DraftDoc;
      return {
        draftId: d.id,
        number: draftNumber(d.id),
        numPlayers: data.NumPlayers ?? 0,
        seats: (data.CurrentUsers ?? [])
          .map((u) => ({ wallet: (u.OwnerId ?? '').toLowerCase(), tokenId: u.TokenId ?? '' }))
          .filter((s) => s.wallet),
      };
    })
    .sort((a, b) => a.number - b.number)
    // Label by position in the league's own sequence, NOT the internal
    // 2026-fast-draft-N id (the commissioner sees "KFFL #1", "#2", …).
    .map((d, i) => ({ ...d, label: `${cfg.Name ?? leagueId} #${i + 1}`, filled: d.numPlayers >= 10 }));

  // Members = everyone seated + every wallet with an explicit entries grant
  // (covers "paid for 2 before ever joining").
  const used = new Map<string, number>();
  for (const d of drafts) for (const s of d.seats) used.set(s.wallet, (used.get(s.wallet) ?? 0) + 1);
  const memberWallets = new Set<string>(used.keys());
  for (const w of Object.keys(cfg.Entries ?? {})) memberWallets.add(w.toLowerCase());

  const names = await displayNames([...memberWallets]);
  const members = [...memberWallets]
    .map((wallet) => ({
      wallet,
      name: names.get(wallet) ?? null,
      used: used.get(wallet) ?? 0,
      allowed: allowedEntriesFor(cfg, wallet),
    }))
    .sort((a, b) => b.used - a.used || a.wallet.localeCompare(b.wallet));

  return {
    id: leagueId,
    name: cfg.Name ?? leagueId,
    draftType: cfg.DraftType === 'slow' ? 'slow' : 'fast',
    defaultEntries: cfg.DefaultEntries && cfg.DefaultEntries > 0 ? cfg.DefaultEntries : 1,
    members,
    drafts: drafts.map((d) => ({
      ...d,
      seats: d.seats.map((s) => ({ ...s, name: names.get(s.wallet) ?? null })),
    })),
  };
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePrivateLeagueAdmin(req, params.id);
    const view = await buildLeagueView(ctx.leagueId, ctx.cfg);
    return json({ ...view, viewer: { wallet: ctx.actorWallet, siteAdmin: ctx.siteAdmin } });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('private_league_admin.get.error', { err: err instanceof Error ? err.message : String(err) });
    return jsonError('Could not load the league right now', 500);
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const requestId = getRequestId(req);
  try {
    const ctx = await requirePrivateLeagueAdmin(req, params.id);
    const body = await parseBody<{ wallet?: string; delta?: number; action?: string; newPassword?: string }>(req);

    // Password rotation — break-glass for a leaked password. Same canonical
    // hashing as the Go verifier and create-private-league.mjs: sha256 of the
    // TRIMMED password, hex. Seats already taken are unaffected; members just
    // re-enter the new password on their next visit to /private/{id}.
    if (body.action === 'setPassword') {
      const pw = String(body.newPassword ?? '').trim();
      if (pw.length < 6 || pw.length > 64) throw new ApiError(400, 'Password must be 6–64 characters');
      const hash = createHash('sha256').update(pw).digest('hex');
      await ctx.cfgRef.set({ PasswordHash: hash }, { merge: true });
      await logAdminAction({
        actor: ctx.actorWallet,
        action: 'private-league-password',
        target: ctx.leagueId,
        after: { hashPrefix: hash.slice(0, 12) },
        requestId,
      });
      logger.info('private_league_admin.password_rotated', {
        actor: ctx.actorWallet, leagueId: ctx.leagueId, siteAdmin: ctx.siteAdmin,
      });
      return json({ ok: true });
    }

    const wallet = String(body.wallet ?? '').trim().toLowerCase();
    if (!WALLET_RE.test(wallet)) throw new ApiError(400, 'Bad wallet address');
    const delta = body.delta;
    if (delta !== 1 && delta !== -1) throw new ApiError(400, 'delta must be +1 or -1');

    const db = getAdminFirestore();
    let next = 0;
    let before = 0;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ctx.cfgRef);
      if (!snap.exists) throw new ApiError(404, 'League not found');
      const cfg = (snap.data() ?? {}) as typeof ctx.cfg;
      before = allowedEntriesFor(cfg, wallet);
      next = Math.max(0, before + delta);
      tx.update(ctx.cfgRef, new FieldPath('Entries', wallet), next);
    });

    await logAdminAction({
      actor: ctx.actorWallet,
      action: 'private-league-bump',
      target: wallet,
      before: { leagueId: ctx.leagueId, allowed: before },
      after: { leagueId: ctx.leagueId, allowed: next },
      requestId,
    });
    logger.info('private_league_admin.bump', {
      actor: ctx.actorWallet, leagueId: ctx.leagueId, target: wallet, before, after: next, siteAdmin: ctx.siteAdmin,
    });

    const view = await buildLeagueView(ctx.leagueId, ((await ctx.cfgRef.get()).data() ?? {}) as typeof ctx.cfg);
    return json({ ok: true, wallet, allowed: next, ...view, viewer: { wallet: ctx.actorWallet, siteAdmin: ctx.siteAdmin } });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('private_league_admin.bump.error', { err: err instanceof Error ? err.message : String(err) });
    return jsonError('Could not update entries right now', 500);
  }
}
