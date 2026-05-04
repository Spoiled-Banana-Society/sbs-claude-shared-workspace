import { randomBytes } from 'node:crypto';

export interface RngCommitRecord {
  commitId: string;
  serverSeed: string;
  serverSeedHash: string;
  createdAt: number;
  revealed: boolean;
  contextId?: string;
}

const STORE_KEY = '__sbs_rng_commit_store';

function getStore(): Map<string, RngCommitRecord> {
  const globalAny = globalThis as typeof globalThis & { [STORE_KEY]?: Map<string, RngCommitRecord> };
  if (!globalAny[STORE_KEY]) {
    globalAny[STORE_KEY] = new Map<string, RngCommitRecord>();
  }
  return globalAny[STORE_KEY] as Map<string, RngCommitRecord>;
}

export function createCommit(params: {
  serverSeed: string;
  serverSeedHash: string;
  contextId?: string;
}): RngCommitRecord {
  const store = getStore();
  const commitId = randomBytes(16).toString('hex');
  const record: RngCommitRecord = {
    commitId,
    serverSeed: params.serverSeed,
    serverSeedHash: params.serverSeedHash,
    createdAt: Date.now(),
    revealed: false,
    contextId: params.contextId,
  };
  store.set(commitId, record);
  return record;
}

export function getCommit(commitId: string): RngCommitRecord | undefined {
  const store = getStore();
  return store.get(commitId);
}

export function markRevealed(commitId: string): RngCommitRecord | undefined {
  const store = getStore();
  const record = store.get(commitId);
  if (!record) return undefined;
  if (!record.revealed) {
    record.revealed = true;
    store.set(commitId, record);
  }
  return record;
}
