/**
 * Single source-of-truth table for every admin metric.
 *
 * The dashboard / user lookup / users-aggregate read from many
 * different Firestore collections. When the same number is computed
 * from two different sources, they drift — and Boris correctly caught
 * the promo counts being 3× lower than reality because we were
 * counting event-log entries (lossy fire-and-forget writes) instead
 * of the atomic claimCount counter on each promo doc.
 *
 * This file is the canonical mapping. Every read of an admin metric
 * should route through one of these helpers. Adding a new metric:
 * add a row to the table below + a helper.
 *
 *  ┌─────────────────────────┬────────────────────────────────────────────────────┐
 *  │ METRIC                  │ CANONICAL SOURCE                                   │
 *  ├─────────────────────────┼────────────────────────────────────────────────────┤
 *  │ promo claims (lifetime) │ sum(claimCount) across collectionGroup('promos')   │
 *  │                         │   keyed by type field on each doc.                 │
 *  │ promo claims (today)    │ v2_user_events.where(eventType==promo_claimed,     │
 *  │                         │   timestamp>=todayIso) — event log; may dropout    │
 *  │                         │   slightly but only used for today, never lifetime │
 *  │ promo progress          │ progressCurrent / progressMax on the promo doc     │
 *  │ wheel spins (lifetime)  │ count() on collectionGroup('wheelSpins')           │
 *  │ wheel per-prize         │ scan collectionGroup('wheelSpins') and bucket by   │
 *  │                         │   prize.type / prize.value with the 5-shape parser │
 *  │ users total             │ count() on v2_users                                │
 *  │ users new today/week    │ count(v2_users.where(createdAt >= cutoff))         │
 *  │ pass_purchased lifetime │ count(v2_activity_events.where(type==pass_purch.)) │
 *  │ pass_purchased revenue  │ scan v2_activity_events.where(type==pass_purch.),  │
 *  │                         │   sum metadata.totalPrice                          │
 *  │ drafts entered          │ scan v2_activity_events.where(type==draft_entered) │
 *  │ withdrawal volume       │ scan withdrawalRequests.where(status==X), sum amt  │
 *  │ lastActiveAt (per user) │ v2_users/{wallet}.lastActiveAt                     │
 *  └─────────────────────────┴────────────────────────────────────────────────────┘
 *
 * Anti-patterns documented here so they don't re-emerge:
 *   - DO NOT use compound `.where(A,'==',X).where(B,'>=',Y)` queries
 *     without confirming the composite Firestore index exists. They
 *     throw silently and return 0. Use single-field where + client
 *     filter instead.
 *   - DO NOT count promo_claimed event-log entries for lifetime totals.
 *     The event log uses fire-and-forget writes that drop. Use
 *     claimCount (atomic, transaction-guaranteed) instead.
 *   - DO NOT use bounded scans (`.limit(2000)`) without confirming
 *     they exceed actual collection size by 50×. Once the underlying
 *     volume crosses the limit, every metric undercounts silently.
 */

import { getAdminFirestore } from '@/lib/firebaseAdmin';

export interface PromoTypeCount {
  /** Sum of `claimCount` across every user's doc of this type — atomic ground truth. */
  claimsTotal: number;
  /** Count of `promo_claimed` events whose timestamp is in today — best-effort. */
  claimsToday: number;
  /** Users with any progressCurrent>0 or claimCount>0 on this promo type. */
  usersStarted: number;
  /** Users with claimCount>0 on this promo type. */
  usersCompleted: number;
  /** Users with progressCurrent>0 but claimCount<progressMax — true "in progress". */
  usersPending: number;
}

/**
 * Compute per-promo-type aggregate counts from the canonical source.
 *
 * Single collectionGroup scan (50k cap; we have 603 docs at the moment)
 * plus a small single-field where on v2_user_events for today bucketing.
 */
export async function readPromoCounts(opts: { todayIso: string }): Promise<{
  byType: Record<string, PromoTypeCount>;
  /** Per-user claimCount sums, keyed by lower-cased wallet → type → count.
   *  Used by users-aggregate so the bottom table's "promos" column is
   *  also pulled from claimCount instead of the lossy event stream. */
  byUserAndType: Map<string, Record<string, number>>;
  /** Diagnostics — surface scan sizes in admin Logs so we can verify
   *  accuracy is holding. */
  diag: { promoDocs: number; eventsLifetime: number; eventsToday: number };
}> {
  const db = getAdminFirestore();
  const promoSnap = await db.collectionGroup('promos').limit(50_000).get();

  const byType: Record<string, PromoTypeCount> = {};
  const byUserAndType = new Map<string, Record<string, number>>();

  for (const doc of promoSnap.docs) {
    const data = doc.data() as {
      type?: string;
      claimCount?: number;
      progressCurrent?: number;
      progressMax?: number;
    };
    const type = String(data.type ?? 'unknown');
    const claimCount = typeof data.claimCount === 'number' ? data.claimCount : 0;
    const progressCurrent = typeof data.progressCurrent === 'number' ? data.progressCurrent : 0;
    const progressMax = typeof data.progressMax === 'number' ? data.progressMax : 0;

    if (!byType[type]) {
      byType[type] = {
        claimsTotal: 0,
        claimsToday: 0,
        usersStarted: 0,
        usersCompleted: 0,
        usersPending: 0,
      };
    }
    byType[type].claimsTotal += claimCount;

    const started = progressCurrent > 0 || claimCount > 0;
    const completed = claimCount > 0;
    const pending = progressMax > 1 && started && progressCurrent < progressMax;
    if (started) byType[type].usersStarted += 1;
    if (completed) byType[type].usersCompleted += 1;
    if (pending) byType[type].usersPending += 1;

    // Per-user roll-up — extract wallet from doc path
    // (v2_users/{wallet}/promos/{promoId}).
    const segments = doc.ref.path.split('/');
    const wallet = (segments[1] ?? '').toLowerCase();
    if (claimCount > 0 && wallet) {
      const existing = byUserAndType.get(wallet) ?? {};
      existing[type] = (existing[type] ?? 0) + claimCount;
      byUserAndType.set(wallet, existing);
    }
  }

  // Event log scan — used for two things:
  //  1. "today" bucketing (we have no per-claim timestamp on the promo
  //     doc, so the event log is the only signal for today vs. older)
  //  2. Fallback lifetime count for promo types that DON'T bump
  //     claimCount on the promo doc. Some promos (new-user, referral,
  //     tweet-engagement) use a one-shot `claimable: true → false`
  //     transition and never increment claimCount. For those, the
  //     event log is the only signal of a real claim. We take the MAX
  //     of (claimCount sum, event count) per type so:
  //       - Multi-claim promos (mint, daily-drafts) use claimCount
  //         (atomic, no drops, can be 9+ per user)
  //       - Single-claim promos (new-user, referral) use the event log
  //       - Neither type is silently undercounted.
  let eventsToday = 0;
  let eventsLifetime = 0;
  const eventCountByType: Record<string, number> = {};
  try {
    const eventSnap = await db
      .collection('v2_user_events')
      .where('eventType', '==', 'promo_claimed')
      .limit(100_000)
      .get();
    eventsLifetime = eventSnap.size;
    for (const d of eventSnap.docs) {
      const data = d.data() as { timestamp?: string; meta?: { promoType?: unknown } };
      const type = String(data.meta?.promoType ?? 'unknown');
      const ts = data.timestamp ?? '';
      eventCountByType[type] = (eventCountByType[type] ?? 0) + 1;
      if (ts >= opts.todayIso) {
        eventsToday += 1;
        if (!byType[type]) {
          byType[type] = {
            claimsTotal: 0,
            claimsToday: 0,
            usersStarted: 0,
            usersCompleted: 0,
            usersPending: 0,
          };
        }
        byType[type].claimsToday += 1;
      }
    }
  } catch {
    // Event log read is best-effort; suppress so the claimCount-derived
    // lifetime numbers (the important ones) still ship.
  }

  // Apply max(claimCount-derived, event-log) per type for lifetime.
  for (const [type, n] of Object.entries(eventCountByType)) {
    if (!byType[type]) {
      byType[type] = {
        claimsTotal: 0,
        claimsToday: 0,
        usersStarted: 0,
        usersCompleted: 0,
        usersPending: 0,
      };
    }
    if (n > byType[type].claimsTotal) byType[type].claimsTotal = n;
  }

  return {
    byType,
    byUserAndType,
    diag: { promoDocs: promoSnap.size, eventsLifetime, eventsToday },
  };
}
