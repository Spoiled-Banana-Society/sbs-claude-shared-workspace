import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { type CollectionReference, type DocumentData, type Query, type Timestamp } from 'firebase-admin/firestore';

import { json, jsonError } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';

type FirestoreTimestamp = Timestamp | { toDate: () => Date };

const MOCK_SEED_WALLET = '0x1234567890abcdef1234567890abcdef12345678';

function toIsoDate(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as FirestoreTimestamp).toDate === 'function') {
    const date = (value as FirestoreTimestamp).toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function toNonNegativeInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

async function resolveUsersCollection(): Promise<CollectionReference<DocumentData>> {
  const db = getAdminFirestore();
  const v2 = db.collection('v2_users');
  const legacy = db.collection('users');
  const v2Probe = await v2.limit(1).get();
  if (!v2Probe.empty) return v2;
  const legacyProbe = await legacy.limit(1).get();
  if (!legacyProbe.empty) return legacy;
  return v2;
}

function mapUserDoc(doc: FirebaseFirestore.QueryDocumentSnapshot<DocumentData>) {
  const data = doc.data();
  const storedWallet = typeof data.walletAddress === 'string' ? data.walletAddress : '';
  const isStoredValid = storedWallet && storedWallet.toLowerCase() !== MOCK_SEED_WALLET;
  return {
    id: doc.id,
    walletAddress: isStoredValid ? storedWallet : doc.id,
    username: (typeof data.username === 'string' && !data.username.startsWith('User-')) ? data.username : null,
    email:
      (typeof data.blueCheckEmail === 'string' && data.blueCheckEmail) ||
      (typeof data.email === 'string' && data.email) ||
      null,
    createdAt: toIsoDate(data.createdAt),
    // Returning-player flag from the returning-check (email/social/wallet match
    // to an old-prod identity). This catches WEB2 returners that the on-chain
    // BBB3-holders set misses (their new wallet isn't on-chain from last year).
    isReturningPlayer: data.isReturningPlayer === true,
    returningVia: typeof data.returningVia === 'string' ? data.returningVia : null,
    blueCheckVerified: data.blueCheckVerified === true || data.isBlueCheckVerified === true,
    banned: data.banned === true,
    freeDrafts: typeof data.freeDrafts === 'number' ? data.freeDrafts : 0,
    paidDrafts: typeof data.draftPasses === 'number' ? data.draftPasses : 0,
    wheelSpins: typeof data.wheelSpins === 'number' ? data.wheelSpins : 0,
  };
}

export async function GET(req: Request) {
  const requestId = getRequestId(req);
  const start = Date.now();
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  try {
    await requireAdmin(req);

    const url = new URL(req.url);
    const limit = Math.min(toNonNegativeInt(url.searchParams.get('limit'), 50), 200);
    const offset = toNonNegativeInt(url.searchParams.get('offset'), 0);
    const qRaw = (url.searchParams.get('q') ?? '').trim();
    const q = qRaw.toLowerCase();

    const usersCollection = await resolveUsersCollection();

    // Search mode: run three prefix queries (doc id, walletAddress field, username)
    // and merge results. Firestore can only do prefix (startAt/endAt) — no substring.
    if (q) {
      const results = new Map<string, ReturnType<typeof mapUserDoc>>();

      const prefixEnd = q + '\uf8ff';
      // Generate case variants of the typed string so a single Firestore
      // prefix range hits at least one of them. Firestore prefix queries
      // are byte-comparison and case-sensitive \u2014 without this, typing
      // 'borisvagner' misses a username stored as 'Boris Vagner'.
      const titleCase = qRaw.length === 0
        ? ''
        : qRaw.charAt(0).toUpperCase() + qRaw.slice(1).toLowerCase();
      const usernameCandidates = Array.from(new Set([
        qRaw,
        qRaw.toLowerCase(),
        qRaw.toUpperCase(),
        titleCase,
      ].filter(Boolean)));

      const queries: Query<DocumentData>[] = [
        usersCollection.where('walletAddress', '>=', q).where('walletAddress', '<=', prefixEnd).limit(20),
        ...usernameCandidates.map((candidate) =>
          usersCollection.where('username', '>=', candidate).where('username', '<=', candidate + '\uf8ff').limit(20),
        ),
      ];

      // If q looks like a wallet or wallet-prefix, also try direct doc lookup
      if (/^0x[0-9a-fA-F]+$/.test(q)) {
        const direct = await usersCollection.doc(q).get();
        if (direct.exists) {
          results.set(direct.id, mapUserDoc(direct as unknown as FirebaseFirestore.QueryDocumentSnapshot<DocumentData>));
        }
      }

      const snaps = await Promise.all(queries.map((qq) => qq.get().catch(() => null)));
      for (const snap of snaps) {
        if (!snap) continue;
        for (const doc of snap.docs) {
          if (!results.has(doc.id)) results.set(doc.id, mapUserDoc(doc));
        }
      }

      const users = [...results.values()].slice(0, limit);
      logger.info('admin.users.search_ok', { requestId, q, count: users.length, durationMs: Date.now() - start });
      return json({
        users,
        pagination: { limit, offset: 0, total: users.length, hasMore: false },
        requestId,
      });
    }

    // Normal paginated list
    const totalSnap = await usersCollection.count().get();
    const total = totalSnap.data().count;

    let query = usersCollection.orderBy('createdAt', 'desc').limit(limit) as Query<DocumentData>;
    if (offset > 0) query = query.offset(offset);
    const snap = await query.get();
    const users = snap.docs.map(mapUserDoc);

    logger.info('admin.users.list_ok', { requestId, offset, limit, count: users.length, total, durationMs: Date.now() - start });
    return json({
      users,
      pagination: { limit, offset, total, hasMore: offset + users.length < total },
      requestId,
    });
  } catch (err) {
    logger.error('admin.users.failed', { requestId, err, durationMs: Date.now() - start });
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
