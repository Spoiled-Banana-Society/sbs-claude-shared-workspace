/**
 * State-integrity audits — the proactive half of observability.
 *
 * Your logger/error-feed is REACTIVE: it fires when something throws in the
 * moment. But some bugs are SILENT STATE DRIFT — the data sits in a wrong state
 * and nothing errors until a user trips on it (e.g. the pass counter said 12
 * while real spendable tokens were 0; nothing logged until the join 500'd).
 *
 * These checks audit *state* (not events) for the money/fairness invariants
 * that can silently lie AND cost money. Findings flow into the SAME admin Logs
 * feed via `logErrorEvent`, keyed by `source` so `logSeverity()` tiers them.
 *
 * Keep the scope to MONEY + FAIRNESS only — never "every part of the site" —
 * so this never becomes noise. Add a new check by writing a function that
 * returns AuditFinding[] and listing it in AUDIT_CHECKS.
 *
 * NOTE: the standalone CLI `scripts/audit.mjs` mirrors this logic so the dev
 * (and Claude) can run it with just a service account + node, no Next build.
 * If you change a check here, mirror it there.
 */
import type { Firestore } from 'firebase-admin/firestore';

export interface AuditFinding {
  source: string; // area.feature.outcome — drives severity via logSeverity()
  severity: 'critical' | 'warning' | 'low';
  actor?: string; // affected wallet/user, shows in the feed's affected-users
  message: string;
  context?: Record<string, unknown>;
}

export interface AuditResult {
  findings: AuditFinding[];
  summary: { total: number; critical: number; warning: number; checks: string[] };
}

function passTypeOf(data: Record<string, unknown>): 'free' | 'paid' {
  const pt = String((data.PassType ?? data.passType ?? '')).toLowerCase();
  return pt === 'free' ? 'free' : 'paid';
}

/**
 * The on-chain token id a draft-token record points at. `realTokenId` on newer
 * records; legacy ones encode it in the cardId — bare on-chain id (≤7 digits)
 * or staging form `<10-digit unix-seconds><tokenId>`. Lets us line up the two
 * collections (validDraftTokens / usedDraftTokens) that use different cardId
 * schemes for the same physical token.
 */
function decodeOnchainId(cardId: string, realTokenId: string): string {
  const rt = String(realTokenId || '').trim();
  if (/^\d+$/.test(rt)) return rt;
  const c = String(cardId || '').trim();
  if (/^\d{1,7}$/.test(c)) return c;
  if (/^\d{10}\d{1,7}$/.test(c)) return c.slice(10);
  return '';
}

/**
 * One collectionGroup query → map of owner → spendable {paid, free} token
 * counts. This is the ground truth the draft engine actually spends from.
 */
async function spendableByOwner(db: Firestore): Promise<Map<string, { paid: number; free: number }>> {
  const snap = await db.collectionGroup('validDraftTokens').get();
  const map = new Map<string, { paid: number; free: number }>();
  snap.forEach((d) => {
    const m = d.ref.path.match(/owners\/([^/]+)\/validDraftTokens/);
    if (!m) return;
    const w = m[1].toLowerCase();
    const cur = map.get(w) ?? { paid: 0, free: 0 };
    if (passTypeOf(d.data() as Record<string, unknown>) === 'free') cur.free += 1;
    else cur.paid += 1;
    map.set(w, cur);
  });
  return map;
}

/**
 * PASSES — the counter must never exceed real spendable tokens. `over` is the
 * dangerous direction (user shown more than they can spend → blocked at join);
 * `under` is a softer warning (user under-credited).
 */
export async function auditPassLedger(db: Firestore): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const spend = await spendableByOwner(db);
  const users = await db.collection('v2_users').get();
  users.forEach((doc) => {
    const x = (doc.data() ?? {}) as Record<string, unknown>;
    const w = doc.id.toLowerCase();
    const dp = Math.max(0, Number(x.draftPasses) || 0);
    const fd = Math.max(0, Number(x.freeDrafts) || 0);
    const real = spend.get(w) ?? { paid: 0, free: 0 };
    if (dp > real.paid || fd > real.free) {
      findings.push({
        source: 'audit.passes.over',
        severity: 'critical',
        actor: doc.id,
        message: `Pass counter exceeds real spendable tokens — this wallet will be blocked from joining. counter=${dp}/${fd} (paid/free), real=${real.paid}/${real.free}`,
        context: { draftPasses: dp, freeDrafts: fd, realPaid: real.paid, realFree: real.free },
      });
    } else if (dp < real.paid || fd < real.free) {
      findings.push({
        source: 'audit.passes.under',
        severity: 'warning',
        actor: doc.id,
        message: `Pass counter below real spendable tokens — wallet under-credited. counter=${dp}/${fd}, real=${real.paid}/${real.free}`,
        context: { draftPasses: dp, freeDrafts: fd, realPaid: real.paid, realFree: real.free },
      });
    }
  });
  return findings;
}

/**
 * BALANCES — no money/pass counter should ever be negative (data corruption /
 * an unguarded decrement). Cheap integrity net across every account.
 */
export async function auditNegativeBalances(db: Firestore): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const fields = ['draftPasses', 'freeDrafts', 'wheelSpins', 'jackpotEntries', 'hofEntries', 'availableCredit', 'pendingCredit'];
  const users = await db.collection('v2_users').get();
  users.forEach((doc) => {
    const x = (doc.data() ?? {}) as Record<string, unknown>;
    const bad = fields.filter((f) => typeof x[f] === 'number' && (x[f] as number) < 0);
    if (bad.length) {
      findings.push({
        source: 'audit.balance.negative',
        severity: 'critical',
        actor: doc.id,
        message: `Negative balance field(s): ${bad.map((f) => `${f}=${x[f]}`).join(', ')}`,
        context: Object.fromEntries(bad.map((f) => [f, x[f]])),
      });
    }
  });
  return findings;
}

/**
 * DUPLICATE PASSES — two `validDraftTokens` records for ONE on-chain token
 * (same wallet, same `RealTokenId`). This is the failure mode that silently
 * inflated the pass count and that `auditPassLedger` CANNOT see: duplicates
 * inflate the counter AND the inventory count equally, so counter==count and it
 * looks healthy. Root cause was a non-idempotent Go registration (fixed), but
 * this check is the standing tripwire so any recurrence (or leftover from old
 * data) surfaces in the admin Logs feed immediately. Fix: /api/admin/nft/dedupe-passes.
 */
export async function auditDuplicatePasses(db: Firestore): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const snap = await db.collectionGroup('validDraftTokens').get();
  const byOwner = new Map<string, Map<string, number>>(); // owner -> realTokenId -> count
  snap.forEach((d) => {
    const m = d.ref.path.match(/owners\/([^/]+)\/validDraftTokens/);
    if (!m) return;
    const w = m[1].toLowerCase();
    const data = d.data() as Record<string, unknown>;
    const rt = String(data.RealTokenId ?? data.realTokenId ?? '').trim();
    if (!/^\d+$/.test(rt)) return; // only real-on-chain-id records can collide
    const inner = byOwner.get(w) ?? new Map<string, number>();
    inner.set(rt, (inner.get(rt) ?? 0) + 1);
    byOwner.set(w, inner);
  });
  for (const [w, inner] of byOwner) {
    const dups: Array<{ realTokenId: string; count: number }> = [];
    for (const [rt, c] of inner) if (c > 1) dups.push({ realTokenId: rt, count: c });
    if (dups.length) {
      const phantom = dups.reduce((s, d) => s + (d.count - 1), 0);
      findings.push({
        source: 'audit.passes.duplicate',
        severity: 'critical',
        actor: w,
        message: `Duplicate draft-pass records: ${dups.length} on-chain token(s) have >1 ledger record (${phantom} phantom pass(es) inflating the count). Fix via /api/admin/nft/dedupe-passes.`,
        context: { duplicateTokens: dups.length, phantomRecords: phantom, sample: dups.slice(0, 10) },
      });
    }
  }
  return findings;
}

/**
 * DRAFTED-BUT-STILL-SPENDABLE — a token that's been drafted (in usedDraftTokens)
 * must NOT also remain in validDraftTokens (the spendable pool). If it does, a
 * USED pass is still counted/usable — the "drafted pass came back" leak (a
 * reconcile re-registered a drafted token, or a draft-entry delete missed it
 * because the two collections key the same token under different cardIds). Keyed
 * on the decoded on-chain id so the differing cardId schemes still line up.
 */
export async function auditDraftedStillSpendable(db: Firestore): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const spendable = new Map<string, Set<string>>();
  const used = new Map<string, Set<string>>();
  const collect = async (sub: string, target: Map<string, Set<string>>) => {
    const snap = await db.collectionGroup(sub).get();
    snap.forEach((d) => {
      const m = d.ref.path.match(new RegExp(`owners/([^/]+)/${sub}`));
      if (!m) return;
      const w = m[1].toLowerCase();
      const x = d.data() as Record<string, unknown>;
      const id = decodeOnchainId(String(x.CardId ?? x.cardId ?? d.id), String(x.RealTokenId ?? x.realTokenId ?? ''));
      if (!id) return;
      const set = target.get(w) ?? new Set<string>();
      set.add(id);
      target.set(w, set);
    });
  };
  await collect('validDraftTokens', spendable);
  await collect('usedDraftTokens', used);
  for (const [w, usedSet] of used) {
    const spendSet = spendable.get(w);
    if (!spendSet) continue;
    const overlap = [...usedSet].filter((id) => spendSet.has(id));
    if (overlap.length) {
      findings.push({
        source: 'audit.passes.drafted_still_spendable',
        severity: 'critical',
        actor: w,
        message: `${overlap.length} drafted token(s) still in the spendable pool — a used pass is counted/usable again. tokens: ${overlap.slice(0, 10).join(', ')}`,
        context: { count: overlap.length, tokens: overlap.slice(0, 20) },
      });
    }
  }
  return findings;
}

/** Every check that runs. Add money/fairness checks here as we build them. */
export const AUDIT_CHECKS: Array<{ name: string; run: (db: Firestore) => Promise<AuditFinding[]> }> = [
  { name: 'passes', run: auditPassLedger },
  { name: 'duplicate_passes', run: auditDuplicatePasses },
  { name: 'drafted_still_spendable', run: auditDraftedStillSpendable },
  { name: 'negative_balances', run: auditNegativeBalances },
];

export async function runAllAudits(db: Firestore): Promise<AuditResult> {
  const findings: AuditFinding[] = [];
  for (const check of AUDIT_CHECKS) {
    try {
      findings.push(...(await check.run(db)));
    } catch (e) {
      findings.push({
        source: 'audit.check_failed',
        severity: 'warning',
        message: `Audit check "${check.name}" threw: ${e instanceof Error ? e.message : String(e)}`,
        context: { check: check.name },
      });
    }
  }
  return {
    findings,
    summary: {
      total: findings.length,
      critical: findings.filter((f) => f.severity === 'critical').length,
      warning: findings.filter((f) => f.severity === 'warning').length,
      checks: AUDIT_CHECKS.map((c) => c.name),
    },
  };
}
