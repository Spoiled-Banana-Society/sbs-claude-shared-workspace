import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  submitPickREST,
  patchDraftPreferences,
  getDraftPreferences,
  getSortPreference,
  updateSortPreference,
  getDraftInfo,
  getDraftSummary,
  getDraftRosters,
} from '@/lib/draftApi';

const DRAFT_ID = 'draft-abc';
const WALLET = '0x438bbe98eed1dd2df244b007dab0583cc9be72e0';

function mockFetch(json: unknown = {}, ok = true, status = 200) {
  const fn = vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: ok ? 'OK' : 'Server Error',
    json: async () => json,
    text: async () => (ok ? JSON.stringify(json) : 'err body'),
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

function lastCall(fn: ReturnType<typeof vi.fn>) {
  const calls = fn.mock.calls;
  return {
    url: calls[calls.length - 1][0] as string,
    init: (calls[calls.length - 1][1] || {}) as RequestInit,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('submitPickREST', () => {
  it('POSTs to /draft-actions/{id}/owner/{wallet}/actions/pick with the pick body', async () => {
    const fn = mockFetch({ ok: true });
    await submitPickREST(DRAFT_ID, WALLET, {
      playerId: 'SF-RB1',
      displayName: 'SF RB1',
      team: 'SF',
      position: 'RB',
    });

    const { url, init } = lastCall(fn);
    expect(url).toContain(`/draft-actions/${DRAFT_ID}/owner/${WALLET}/actions/pick`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({
      playerId: 'SF-RB1',
      displayName: 'SF RB1',
      team: 'SF',
      position: 'RB',
    });
  });

  it('reports a client error and re-throws on non-2xx response', async () => {
    mockFetch({}, false, 409);
    await expect(
      submitPickREST(DRAFT_ID, WALLET, {
        playerId: 'X',
        displayName: 'X',
        team: 'X',
        position: 'X',
      })
    ).rejects.toThrow(/409/);
  });
});

describe('patchDraftPreferences (autoDraft flag)', () => {
  it('PATCHes /draft-actions/{id}/owner/{wallet}/preferences with {autoDraft: true}', async () => {
    const fn = mockFetch({ autoDraft: true, sortBy: 'ADP', numPicksMissedConsecutive: 0 });
    const res = await patchDraftPreferences(DRAFT_ID, WALLET, true);

    const { url, init } = lastCall(fn);
    expect(url).toContain(`/draft-actions/${DRAFT_ID}/owner/${WALLET}/preferences`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ autoDraft: true });
    expect(res.autoDraft).toBe(true);
  });

  it('also supports {autoDraft: false}', async () => {
    const fn = mockFetch({ autoDraft: false, sortBy: 'ADP', numPicksMissedConsecutive: 0 });
    await patchDraftPreferences(DRAFT_ID, WALLET, false);
    const { init } = lastCall(fn);
    expect(JSON.parse(init.body as string)).toEqual({ autoDraft: false });
  });
});

describe('getDraftPreferences', () => {
  it('GETs the preferences path and parses the SortByObj shape', async () => {
    const fn = mockFetch({ autoDraft: true, sortBy: 'RANK', numPicksMissedConsecutive: 2 });
    const prefs = await getDraftPreferences(DRAFT_ID, WALLET);

    const { url, init } = lastCall(fn);
    expect(url).toContain(`/draft-actions/${DRAFT_ID}/owner/${WALLET}/preferences`);
    expect(init.method).toBeUndefined();
    expect(prefs).toEqual({ autoDraft: true, sortBy: 'RANK', numPicksMissedConsecutive: 2 });
  });
});

describe('getSortPreference / updateSortPreference', () => {
  it('GETs /owner/{wallet}/drafts/{id}/state/sort', async () => {
    const fn = mockFetch('ADP');
    await getSortPreference(WALLET, DRAFT_ID);
    expect(lastCall(fn).url).toContain(`/owner/${WALLET}/drafts/${DRAFT_ID}/state/sort`);
  });

  it('PUTs to /owner/{wallet}/drafts/{id}/state/sort/{sortBy}', async () => {
    const fn = mockFetch(null);
    await updateSortPreference(WALLET, DRAFT_ID, 'RANK');
    const { url, init } = lastCall(fn);
    expect(url).toContain(`/owner/${WALLET}/drafts/${DRAFT_ID}/state/sort/RANK`);
    expect(init.method).toBe('PUT');
  });
});

describe('GET draft state endpoints', () => {
  it('getDraftInfo hits /draft/{id}/state/info', async () => {
    const fn = mockFetch({
      draftId: DRAFT_ID,
      displayName: 'BBB #1',
      draftStartTime: 1700000000,
      pickLength: 30,
      currentDrafter: WALLET,
      pickNumber: 1,
      roundNum: 1,
      pickInRound: 1,
      draftOrder: [],
      adp: [],
    });
    await getDraftInfo(DRAFT_ID);
    expect(lastCall(fn).url).toContain(`/draft/${DRAFT_ID}/state/info`);
  });

  it('getDraftSummary hits /draft/{id}/state/summary', async () => {
    const fn = mockFetch({ picks: [] });
    await getDraftSummary(DRAFT_ID);
    expect(lastCall(fn).url).toContain(`/draft/${DRAFT_ID}/state/summary`);
  });

  it('getDraftRosters hits /draft/{id}/state/rosters', async () => {
    const fn = mockFetch({});
    await getDraftRosters(DRAFT_ID);
    expect(lastCall(fn).url).toContain(`/draft/${DRAFT_ID}/state/rosters`);
  });
});
