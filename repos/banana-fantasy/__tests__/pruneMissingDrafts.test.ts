import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/staging', () => ({
  getDraftsApiUrl: () => 'https://drafts-api.test',
}));
vi.mock('@/lib/clientLog', () => ({
  clientLog: vi.fn(),
}));
// pruneMissingDrafts now calls the API via createDraftsHttpClient, which awaits
// an auth token (getPrivyAccessToken) before fetching. Mock it so the test
// exercises the real 404 -> prune path instead of erroring on the token.
vi.mock('@/lib/privyAccessToken', () => ({
  getPrivyAccessToken: async () => 'test-token',
}));

// jsdom-free env — stub localStorage + window for the module's window check.
function fakeLocalStorage() {
  const store: Record<string, string> = {};
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  };
}

beforeEach(() => {
  // Need a window + localStorage for draftStore to operate.
  (globalThis as { window?: object }).window = globalThis;
  (globalThis as { localStorage?: object }).localStorage = fakeLocalStorage();
});

afterEach(() => {
  delete (globalThis as { window?: object }).window;
  delete (globalThis as { localStorage?: object }).localStorage;
  vi.restoreAllMocks();
});

function seed(drafts: Array<Partial<{ id: string; lastUpdated: number; joinedAt: number; liveWalletAddress: string }>>) {
  const full = drafts.map(d => ({
    contestName: '',
    status: 'filling' as const,
    type: null,
    draftSpeed: 'fast' as const,
    players: 1,
    maxPlayers: 10,
    lastUpdated: Date.now() - 60_000, // default: stale enough to be eligible
    ...d,
  }));
  (globalThis as { localStorage: { setItem: (k: string, v: string) => void } }).localStorage.setItem(
    'banana-active-drafts',
    JSON.stringify(full),
  );
}

function mockFetchByStatus(perId: Record<string, number>) {
  const fn = vi.fn().mockImplementation(async (url: string | URL) => {
    const s = String(url);
    const m = /\/draft\/([^/]+)\/state\/info/.exec(s);
    const id = m?.[1] ?? '';
    const status = perId[id] ?? 200;
    // Full Response shape: the HTTP client reads res.headers too (the old
    // direct-fetch path didn't), so the mock must provide it.
    return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => ({}), text: async () => '' };
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('pruneMissingDrafts', () => {
  it('removes drafts whose state/info endpoint returns 404', async () => {
    seed([
      { id: '2024-fast-draft-100', liveWalletAddress: '0xa' },
      { id: '2024-fast-draft-101', liveWalletAddress: '0xa' },
    ]);
    mockFetchByStatus({
      '2024-fast-draft-100': 200,
      '2024-fast-draft-101': 404,
    });
    const { pruneMissingDrafts, getActiveDrafts } = await import('@/lib/draftStore');

    const pruned = await pruneMissingDrafts();

    expect(pruned).toEqual(['2024-fast-draft-101']);
    const remaining = getActiveDrafts().map(d => d.id);
    expect(remaining).toEqual(['2024-fast-draft-100']);
  });

  it('keeps drafts that return 200', async () => {
    seed([{ id: '2024-fast-draft-100', liveWalletAddress: '0xa' }]);
    mockFetchByStatus({ '2024-fast-draft-100': 200 });
    const { pruneMissingDrafts, getActiveDrafts } = await import('@/lib/draftStore');

    const pruned = await pruneMissingDrafts();

    expect(pruned).toEqual([]);
    expect(getActiveDrafts().length).toBe(1);
  });

  it('does NOT prune on 5xx (server error — could be transient)', async () => {
    seed([{ id: '2024-fast-draft-100', liveWalletAddress: '0xa' }]);
    mockFetchByStatus({ '2024-fast-draft-100': 500 });
    const { pruneMissingDrafts, getActiveDrafts } = await import('@/lib/draftStore');

    const pruned = await pruneMissingDrafts();

    expect(pruned).toEqual([]);
    expect(getActiveDrafts().length).toBe(1);
  });

  it('does NOT prune on network errors (offline)', async () => {
    seed([{ id: '2024-fast-draft-100', liveWalletAddress: '0xa' }]);
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
    const { pruneMissingDrafts, getActiveDrafts } = await import('@/lib/draftStore');

    const pruned = await pruneMissingDrafts();

    expect(pruned).toEqual([]);
    expect(getActiveDrafts().length).toBe(1);
  });

  it('skips drafts younger than the stale-guard window (avoid mid-join race)', async () => {
    seed([
      { id: '2024-fast-draft-fresh', joinedAt: Date.now() - 1_000, liveWalletAddress: '0xa' }, // 1s old
      { id: '2024-fast-draft-old', joinedAt: Date.now() - 120_000, liveWalletAddress: '0xa' }, // 2min old
    ]);
    mockFetchByStatus({
      '2024-fast-draft-fresh': 404,
      '2024-fast-draft-old': 404,
    });
    const { pruneMissingDrafts, getActiveDrafts } = await import('@/lib/draftStore');

    const pruned = await pruneMissingDrafts();

    expect(pruned).toEqual(['2024-fast-draft-old']);
    expect(getActiveDrafts().map(d => d.id)).toContain('2024-fast-draft-fresh');
  });

  it('skips pending- prefixed ids (still mid-join)', async () => {
    seed([{ id: 'pending-12345', liveWalletAddress: '0xa', lastUpdated: Date.now() - 120_000 }]);
    mockFetchByStatus({}); // any fetch would be a bug
    const { pruneMissingDrafts, getActiveDrafts } = await import('@/lib/draftStore');

    const pruned = await pruneMissingDrafts();

    expect(pruned).toEqual([]);
    expect(getActiveDrafts().length).toBe(1);
  });

  it('returns [] when no drafts in cache', async () => {
    const { pruneMissingDrafts } = await import('@/lib/draftStore');
    const fn = vi.fn();
    global.fetch = fn as unknown as typeof fetch;
    const pruned = await pruneMissingDrafts();
    expect(pruned).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });
});
