import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import { runInBackground } from '@/lib/serverBackground';

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { json, jsonError } from '@/lib/api/routeUtils';
import { logger } from '@/lib/logger';
import { recountFromInventory } from '@/lib/passLedger';
import { recordCronHeartbeat } from '@/lib/cronHeartbeat';

export const dynamic = 'force-dynamic';

/**
 * Auto-heals draft join/leave "split-brain" — with NO support ticket and NO
 * change to the live draft engine (this is a separate scheduled job, it never
 * touches the join/leave code path).
 *
 * A join and a leave in the Go engine are each two steps: (1) a Firestore tx
 * moves the SEAT (`drafts/{L}.CurrentUsers` + pass claim/return), then (2) a
 * SEPARATE non-transactional sync of the token's copies (`draftTokens`,
 * `owners/{w}/validDraftTokens|usedDraftTokens`, `drafts/{L}/cards`). If a
 * Firestore write-latency spike interrupts step 2, seat and token disagree:
 *   A) ORPHAN TOKEN  — token bound to L, owner not seated → "stuck in a draft,
 *      can't leave." Heal = finish the leave (return the pass).
 *   B) SEAT, NO TOKEN — owner seated, token records missing → "joined but the
 *      draft is invisible to me." Heal = finish the join (write the records).
 *
 * SAFETY — why this cannot hurt the 99% that works:
 *  - It is NOT in the join/leave path. The happy path is untouched.
 *  - TWO-PASS STALENESS GATE: a mismatch is only healed if it was ALSO seen on
 *    the previous run (persisted ≥ one interval). A legitimate in-flight join/
 *    leave completes in 1–8s, so it is gone by the next run and NEVER healed —
 *    the reconciler only ever cleans up genuinely-abandoned half-states.
 *  - Heals are idempotent, capped per run, skip special (JP/HOF) drafts and
 *    test drafts, and re-mirror the counter from real inventory afterward.
 *  - Auth: Vercel Cron `Authorization: Bearer ${CRON_SECRET}`.
 */

const STATE_DOC = 'system_cache/draftReconcilerState';
const MAX_HEAL_PER_RUN = 20;
const SPECIAL_LEVELS = new Set(['Jackpot', 'Hall of Fame']); // locked seats — never auto-touch

function authed(req: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false; // fail-closed
  return (req.headers.get('authorization') ?? '') === `Bearer ${expected}`;
}

const lc = (v: unknown) => String(v ?? '').toLowerCase();
const isRealDraft = (id: string) => !id.startsWith('_') && !id.includes('test');
const validCard = (c: string) => /^\d+$/.test(c);

type Mismatch = { type: 'A' | 'B'; wallet: string; cardId: string; league: string };
const keyOf = (m: Mismatch) => `${m.type}|${m.wallet}|${m.cardId}|${m.league}`;

export async function GET(req: Request) {
  if (!authed(req)) return jsonError('Unauthorized', 401);
  if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 503);

  runInBackground('cron.heartbeat', recordCronHeartbeat('reconcile-stuck-drafts'));

  const db = getAdminFirestore();

  // ── Detect current mismatches with two cheap bulk reads (no per-seat gets) ──
  // 1) every token record that claims to be in a league
  const used = await db.collectionGroup('usedDraftTokens').get();
  const boundByLeague = new Map<string, Set<string>>();       // league -> "owner|card"
  const hasTokenRecord = new Set<string>();                    // "owner|card|league"
  for (const d of used.docs) {
    const t = d.data() as { LeagueId?: string };
    const league = t.LeagueId;
    if (!league || !isRealDraft(league)) continue;
    const owner = lc(d.ref.parent.parent!.id);
    const card = d.id;
    if (!validCard(card)) continue;
    if (!boundByLeague.has(league)) boundByLeague.set(league, new Set());
    boundByLeague.get(league)!.add(`${owner}|${card}`);
    hasTokenRecord.add(`${owner}|${card}|${league}`);
  }

  // 2) every CURRENT-SEASON draft roster. Split-brains form within seconds of
  // a live join/leave, so prior-season drafts can never produce one — scanning
  // them was pure read spend (cost audit 9/2: this cron was 9.1M reads/day at
  // its old */2 cadence). __name__ range needs no index.
  const seasonStart = `${new Date().getFullYear()}-`;
  const seasonEnd = `${new Date().getFullYear() + 1}-`;
  const draftsSnap = await db.collection('drafts')
    .where(FieldPath.documentId(), '>=', seasonStart)
    .where(FieldPath.documentId(), '<', seasonEnd)
    .get();
  const current: Mismatch[] = [];
  const draftLevel = new Map<string, string>();
  for (const doc of draftsSnap.docs) {
    if (!isRealDraft(doc.id)) continue;
    const data = doc.data() as { CurrentUsers?: Array<{ OwnerId?: string; TokenId?: unknown }>; Level?: string; NumPlayers?: number };
    draftLevel.set(doc.id, String(data.Level ?? ''));
    const roster = data.CurrentUsers ?? [];
    const numPlayers = data.NumPlayers ?? roster.length;
    const seated = new Set(roster.map((u) => `${lc(u.OwnerId)}|${String(u.TokenId ?? '')}`));

    // Type A: a token bound to this league whose owner is NOT seated.
    for (const oc of boundByLeague.get(doc.id) ?? []) {
      if (!seated.has(oc)) {
        const [wallet, cardId] = oc.split('|');
        current.push({ type: 'A', wallet, cardId, league: doc.id });
      }
    }
    // Type B: a seated player with NO backing token record — but ONLY in a
    // FILLING lobby (numPlayers < 10). A full/completed draft's roster is
    // history: the same card is legitimately re-used in a LATER draft, so its
    // token record moved on (LeagueId now points elsewhere) — that is NOT a
    // broken join, and flagging it would spam the reconciler forever. We further
    // confirm the token still points at THIS draft before flagging (the exact
    // half-finished-join signature), so a reused card is never mistaken for a bug.
    if (numPlayers < 10) {
      for (const u of roster) {
        const wallet = lc(u.OwnerId);
        const cardId = String(u.TokenId ?? '');
        if (!validCard(cardId)) continue;
        if (hasTokenRecord.has(`${wallet}|${cardId}|${doc.id}`)) continue;
        const tok = (await db.collection('draftTokens').doc(cardId).get()).data();
        if (tok && lc(tok.OwnerId) === wallet && tok.LeagueId === doc.id) {
          current.push({ type: 'B', wallet, cardId, league: doc.id });
        }
      }
    }
  }

  // ── Two-pass gate: only heal what was already present on the previous run ──
  const stateRef = db.doc(STATE_DOC);
  const prev = new Set<string>(((await stateRef.get()).data()?.pending as string[] | undefined) ?? []);
  const currentKeys = current.map(keyOf);
  const toHeal = current.filter((m) => prev.has(keyOf(m))).slice(0, MAX_HEAL_PER_RUN);
  // Persist the current set as next run's baseline BEFORE healing, so a heal
  // that half-fails is simply retried next run (its key stays in `pending`).
  await stateRef.set({ pending: currentKeys, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

  const results: Array<{ key: string; status: string }> = [];
  const affected = new Set<string>();

  for (const m of toHeal) {
    if (SPECIAL_LEVELS.has(draftLevel.get(m.league) ?? '')) {
      logger.warn('reconcile-stuck-drafts.skip_special', m);
      results.push({ key: keyOf(m), status: 'skipped_special' });
      continue;
    }
    try {
      if (m.type === 'A') await healOrphan(db, m.wallet, m.cardId, m.league);
      else await healSeatNoToken(db, m.wallet, m.cardId, m.league);
      affected.add(m.wallet);
      results.push({ key: keyOf(m), status: 'healed' });
      logger.info('reconcile-stuck-drafts.healed', m);
    } catch (err) {
      results.push({ key: keyOf(m), status: 'heal_failed' });
      logger.error('reconcile-stuck-drafts.heal_failed', { ...m, err: (err as Error).message });
    }
  }

  for (const w of affected) {
    try { await recountFromInventory(w); } catch (e) {
      logger.warn('reconcile-stuck-drafts.recount_failed', { wallet: w, err: (e as Error).message });
    }
  }

  return json({ detected: current.length, pendingConfirmation: current.length - toHeal.length, healed: affected.size, results });
}

/** Finish an interrupted LEAVE — mirror of models/draft-token.go RemoveTokenFromLeague. */
async function healOrphan(db: FirebaseFirestore.Firestore, wallet: string, cardId: string, league: string) {
  const tokRef = db.collection('draftTokens').doc(cardId);
  const tok = (await tokRef.get()).data();
  if (!tok || lc(tok.OwnerId) !== wallet) throw new Error('owner-mismatch');
  const clean = { ...tok, LeagueId: '', DraftType: '', LeagueDisplayName: '' };
  await tokRef.set(clean);
  await db.collection(`owners/${wallet}/validDraftTokens`).doc(cardId).set(clean);
  await db.collection(`owners/${wallet}/usedDraftTokens`).doc(cardId).delete().catch(() => {});
  await db.collection(`drafts/${league}/cards`).doc(cardId).delete().catch(() => {});
  const md = await db.collection('draftTokenMetadata').doc(cardId).get();
  if (md.exists) await md.ref.set({ ...md.data(), LeagueId: '', LeagueDisplayName: '', DraftType: '' }, { merge: true });
}

/** Finish an interrupted JOIN — mirror of models/draft-token.go updateInUseDraftTokenInDatabase. */
async function healSeatNoToken(db: FirebaseFirestore.Firestore, wallet: string, cardId: string, league: string) {
  const tok = (await db.collection('draftTokens').doc(cardId).get()).data();
  // Only heal if the token itself confirms it belongs to this draft. Otherwise
  // the state is ambiguous (leave it for a human), never guessed.
  if (!tok || lc(tok.OwnerId) !== wallet || tok.LeagueId !== league) throw new Error('token-not-bound-here');
  await db.collection(`owners/${wallet}/usedDraftTokens`).doc(cardId).set(tok);
  await db.collection(`drafts/${league}/cards`).doc(cardId).set(tok);
}
