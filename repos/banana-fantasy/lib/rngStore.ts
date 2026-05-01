import { randomBytes } from 'node:crypto';

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

export interface RngCommitRecord {
  commitId: string;
  serverSeed: string;
  serverSeedHash: string;
  createdAt: number;
  revealed: boolean;
  contextId?: string;
}

/**
 * Durable RNG commit store. Previously kept commits in `globalThis.<key>`
 * which dies on every cold start — a server restart between commit and
 * reveal made the user's spin unverifiable forever. Firestore-backed
 * persistence closes that window.
 *
 * In-process Map kept as a hot cache so we don't pay a Firestore read on
 * every reveal. Cache is best-effort; Firestore is the source of truth.
 */
const COLLECTION = 'rng_commits';
const STORE_KEY = '__sbs_rng_commit_cache';

function getCache(): Map<string, RngCommitRecord> {
  const globalAny = globalThis as typeof globalThis & { [STORE_KEY]?: Map<string, RngCommitRecord> };
  if (!globalAny[STORE_KEY]) {
    globalAny[STORE_KEY] = new Map<string, RngCommitRecord>();
  }
  return globalAny[STORE_KEY] as Map<string, RngCommitRecord>;
}

export async function createCommit(params: {
  serverSeed: string;
  serverSeedHash: string;
  contextId?: string;
}): Promise<RngCommitRecord> {
  const commitId = randomBytes(16).toString('hex');
  const record: RngCommitRecord = {
    commitId,
    serverSeed: params.serverSeed,
    serverSeedHash: params.serverSeedHash,
    createdAt: Date.now(),
    revealed: false,
    contextId: params.contextId,
  };
  getCache().set(commitId, record);

  if (isFirestoreConfigured()) {
    try {
      const db = getAdminFirestore();
      // contextId is optional — Firestore rejects undefined fields, so omit
      // when missing.
      const doc: Record<string, unknown> = {
        commitId,
        serverSeed: record.serverSeed,
        serverSeedHash: record.serverSeedHash,
        createdAt: record.createdAt,
        revealed: false,
      };
      if (record.contextId) doc.contextId = record.contextId;
      await db.collection(COLLECTION).doc(commitId).set(doc);
    } catch (err) {
      logger.warn('rng.commit.persist_failed', { commitId, err: (err as Error).message });
    }
  }

  return record;
}

export async function getCommit(commitId: string): Promise<RngCommitRecord | undefined> {
  const cache = getCache();
  const cached = cache.get(commitId);
  if (cached) return cached;

  if (!isFirestoreConfigured()) return undefined;

  try {
    const db = getAdminFirestore();
    const snap = await db.collection(COLLECTION).doc(commitId).get();
    if (!snap.exists) return undefined;
    const data = snap.data() as RngCommitRecord;
    cache.set(commitId, data);
    return data;
  } catch (err) {
    logger.warn('rng.commit.read_failed', { commitId, err: (err as Error).message });
    return undefined;
  }
}

export async function markRevealed(commitId: string): Promise<RngCommitRecord | undefined> {
  const record = await getCommit(commitId);
  if (!record) return undefined;
  if (record.revealed) return record;

  record.revealed = true;
  getCache().set(commitId, record);

  if (isFirestoreConfigured()) {
    try {
      const db = getAdminFirestore();
      await db.collection(COLLECTION).doc(commitId).update({ revealed: true });
    } catch (err) {
      logger.warn('rng.commit.reveal_persist_failed', { commitId, err: (err as Error).message });
    }
  }

  return record;
}
