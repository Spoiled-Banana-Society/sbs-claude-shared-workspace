import crypto from 'node:crypto';
export const dynamic = 'force-dynamic';

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { jsonError } from '@/lib/api/routeUtils';
import { BBB4_CONTRACT_ADDRESS } from '@/lib/contracts/bbb4';
import { reconcilePassesForWallet } from '@/lib/onchain/reconcilePasses';
import { logger } from '@/lib/logger';

const WEBHOOK_EVENTS_COLLECTION = 'alchemy_webhook_events';

/**
 * Alchemy Notify "Address Activity" webhook.
 *
 * Fires on every Transfer event involving the BBB4 contract (or any tracked
 * address — set in the Alchemy dashboard to watch `BBB4_CONTRACT_ADDRESS`).
 * For each affected wallet in the batch, runs the reconciler to align
 * Firestore + Go API with on-chain state in real-time.
 *
 * Security:
 *   - `x-alchemy-signature` is HMAC-SHA256(raw-body, signingKey). We reject
 *     anything without a valid signature — otherwise anyone could spoof
 *     transfers and bump counters.
 *
 * Idempotency:
 *   - Alchemy retries on 5xx. We dedupe via the event `id` field, storing
 *     processed ids in `alchemy_webhook_events/{id}` with a 7d TTL.
 */
export async function POST(req: Request) {
  // Read raw body for signature verification — must be string, not parsed JSON.
  const raw = await req.text();
  const provided = req.headers.get('x-alchemy-signature') ?? '';
  const signingKey = (process.env.ALCHEMY_WEBHOOK_SIGNING_KEY ?? '').trim();

  if (!signingKey) {
    logger.error('alchemy.webhook.no_signing_key');
    return jsonError('Webhook signing key not configured', 503);
  }

  const expected = crypto.createHmac('sha256', signingKey).update(raw).digest('hex');
  const providedBuf = Buffer.from(provided, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    logger.warn('alchemy.webhook.bad_signature', { providedLen: provided.length });
    return jsonError('Invalid signature', 401);
  }

  let payload: AlchemyWebhookPayload;
  try {
    payload = JSON.parse(raw) as AlchemyWebhookPayload;
  } catch {
    return jsonError('Invalid JSON', 400);
  }

  if (!isFirestoreConfigured()) {
    logger.error('alchemy.webhook.firestore_not_configured');
    return jsonError('Firestore not configured', 503);
  }

  const db = getAdminFirestore();
  const eventId = typeof payload.id === 'string' ? payload.id : '';
  if (!eventId) {
    return jsonError('Missing event id', 400);
  }

  // Idempotency check — Alchemy retries on 5xx and occasionally resends.
  const eventRef = db.collection(WEBHOOK_EVENTS_COLLECTION).doc(eventId);
  const existing = await eventRef.get();
  if (existing.exists) {
    logger.info('alchemy.webhook.duplicate_skipped', { eventId });
    return Response.json({ ok: true, deduped: true });
  }

  // Extract Transfer-affected wallets. The "event.activity" array contains
  // one entry per transfer. Each entry has `fromAddress` and `toAddress`.
  const activities = payload.event?.activity ?? [];
  const bbb4 = BBB4_CONTRACT_ADDRESS.toLowerCase();
  const affected = new Set<string>();
  for (const act of activities) {
    // Only process transfers for our BBB4 contract, ignore other NFTs tracked
    // on the same webhook address list (if any).
    if ((act.contractAddress ?? '').toLowerCase() !== bbb4) continue;
    if (act.fromAddress && /^0x[0-9a-fA-F]{40}$/.test(act.fromAddress) && act.fromAddress !== '0x0000000000000000000000000000000000000000') {
      affected.add(act.fromAddress.toLowerCase());
    }
    if (act.toAddress && /^0x[0-9a-fA-F]{40}$/.test(act.toAddress) && act.toAddress !== '0x0000000000000000000000000000000000000000') {
      affected.add(act.toAddress.toLowerCase());
    }
  }

  logger.info('alchemy.webhook.received', {
    eventId,
    activityCount: activities.length,
    affectedWallets: [...affected],
  });

  // Record receipt before we do the work so a crash mid-reconcile still
  // dedupes on retry. TTL field lets a scheduled cleanup prune old events.
  await eventRef.set({
    eventId,
    receivedAt: FieldValue.serverTimestamp(),
    affectedWallets: [...affected],
    activityCount: activities.length,
  });

  // Reconcile each affected wallet. Parallel, best-effort — any failure is
  // logged but the webhook still returns 200 so Alchemy doesn't retry
  // indefinitely (we have lazy reconcile as the safety net).
  const results = await Promise.allSettled(
    [...affected].map((w) => reconcilePassesForWallet(w)),
  );
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.length - ok;
  if (failed > 0) {
    logger.warn('alchemy.webhook.reconcile_partial_failures', { eventId, ok, failed });
  }

  // SERVER-SIDE sale notification + instant My Teams refresh on wallet→wallet
  // transfers. The seller's "Your Team Was Sold!" used to be fired by the
  // BUYER's browser after the tx — close the tab fast and it was lost
  // forever. This webhook is the chain's own signature-verified record of the
  // transfer, so it can't be missed. dedupeKey (tokenId + tx hash) matches
  // the client-side path so whichever fires second is a no-op.
  try {
    const { getAllRecentCachedListings } = await import('@/lib/marketplace/listingCache');
    const { createNotification } = await import('@/lib/queueNotifications');
    const { pushStreamEventBg } = await import('@/lib/userEventStream');
    const active = (await getAllRecentCachedListings()).filter((l) => l.status === 'active');
    const listingByToken = new Map(active.map((l) => [String(l.tokenId), l]));

    for (const act of activities) {
      if ((act.contractAddress ?? '').toLowerCase() !== bbb4) continue;
      const from = (act.fromAddress ?? '').toLowerCase();
      const to = (act.toAddress ?? '').toLowerCase();
      const zero = '0x0000000000000000000000000000000000000000';
      if (!from || !to || from === zero || to === zero) continue; // mint/burn — not a sale

      // Instant My Teams refresh on both sides (sold team vanishes from the
      // seller, appears for the buyer — no manual reload).
      pushStreamEventBg(from, 'notification', { source: 'nft-transfer' });
      pushStreamEventBg(to, 'notification', { source: 'nft-transfer' });

      // BigInt: synthetic staging token ids exceed Number.MAX_SAFE_INTEGER.
      let tokenId = '';
      try { tokenId = act.erc721TokenId ? BigInt(act.erc721TokenId).toString() : ''; } catch { /* non-numeric id */ }
      if (!tokenId) continue;

      const listing = listingByToken.get(tokenId);
      if (listing && (listing.offerer ?? '').toLowerCase() === from) {
        await createNotification(from, {
          type: 'sale_complete',
          title: 'Your Team Was Sold!',
          message: `Team #${tokenId} sold for $${Number(listing.priceUsd ?? 0).toFixed(2)}`,
          link: `/marketplace/${tokenId}`,
          dedupeKey: `sale-${tokenId}-${act.hash ?? eventId}`,
          icon: 'bag',
        });
      }
    }
  } catch (err) {
    logger.warn('alchemy.webhook.sale_notify_failed', { eventId, err: err instanceof Error ? err.message : String(err) });
  }

  return Response.json({ ok: true, walletsReconciled: ok, walletsFailed: failed });
}

/* -------------------- types -------------------- */

interface AlchemyWebhookActivity {
  fromAddress?: string;
  toAddress?: string;
  contractAddress?: string;
  category?: string; // 'token' | 'external' | 'erc721' ...
  erc721TokenId?: string;
  hash?: string;
}

interface AlchemyWebhookPayload {
  id?: string;
  webhookId?: string;
  type?: string;
  event?: {
    network?: string;
    activity?: AlchemyWebhookActivity[];
  };
}
