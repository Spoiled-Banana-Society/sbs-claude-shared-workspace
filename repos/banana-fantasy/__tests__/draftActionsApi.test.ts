import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setPrivyAccessTokenGetter } from '@/lib/privyAccessToken';
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
import { joinDraft, leaveDraft } from '@/lib/api/leagues';

const DRAFT_ID = 'draft-abc';
const WALLET = '0x438bbe98eed1dd2df244b007dab0583cc9be72e0';

function mockFetch(json: unknown = {}, ok = true, status = 200) {
  const fn = vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: ok ? 'OK' : 'Server Error',
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
    },
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
  setPrivyAccessTokenGetter(async () => 'test-privy-jwt');
  vi.stubGlobal('window', globalThis);
});

describe('submitPickREST', () => {
  const getAccessToken = vi.fn().mockResolvedValue('test-privy-jwt');

  it('POSTs to /api/draft/{id}/pick with Bearer token and pick body', async () => {
    const fn = mockFetch({ ok: true });
    await submitPickREST(DRAFT_ID, WALLET, {
      playerId: 'SF-RB1',
      displayName: 'SF RB1',
      team: 'SF',
      position: 'RB',
    }, getAccessToken);

    const { url, init } = lastCall(fn);
    expect(url).toBe(`/api/draft/${DRAFT_ID}/pick`);
    expect(init.method).toBe('POST');
    const headers = init.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer test-privy-jwt');
    expect(headers.get('Content-Type')).toBe('application/json');
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
      }, getAccessToken)
    ).rejects.toThrow(/409/);
  });
});

describe('patchDraftPreferences (autoDraft flag)', () => {
  const getAccessToken = vi.fn().mockResolvedValue('test-privy-jwt');

  it('PATCHes /api/draft/{id}/preferences with {autoDraft: true}', async () => {
    const fn = mockFetch({ autoDraft: true, sortBy: 'ADP', numPicksMissedConsecutive: 0 });
    const res = await patchDraftPreferences(DRAFT_ID, WALLET, true, getAccessToken);

    const { url, init } = lastCall(fn);
    expect(url).toBe(`/api/draft/${DRAFT_ID}/preferences`);
    expect(init.method).toBe('PATCH');
    const headers = init.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer test-privy-jwt');
    expect(JSON.parse(init.body as string)).toEqual({ autoDraft: true });
    expect(res.autoDraft).toBe(true);
  });

  it('also supports {autoDraft: false}', async () => {
    const fn = mockFetch({ autoDraft: false, sortBy: 'ADP', numPicksMissedConsecutive: 0 });
    await patchDraftPreferences(DRAFT_ID, WALLET, false, getAccessToken);
    const { init } = lastCall(fn);
    expect(JSON.parse(init.body as string)).toEqual({ autoDraft: false });
  });
});

describe('getDraftPreferences', () => {
  const getAccessToken = vi.fn().mockResolvedValue('test-privy-jwt');

  it('GETs /api/draft/{id}/preferences with Bearer token', async () => {
    const fn = mockFetch({ autoDraft: true, sortBy: 'RANK', numPicksMissedConsecutive: 2 });
    const prefs = await getDraftPreferences(DRAFT_ID, WALLET, getAccessToken);

    const { url, init } = lastCall(fn);
    expect(url).toBe(`/api/draft/${DRAFT_ID}/preferences`);
    expect(init.method).toBeUndefined();
    const headers = init.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer test-privy-jwt');
    expect(prefs).toEqual({ autoDraft: true, sortBy: 'RANK', numPicksMissedConsecutive: 2 });
  });
});

describe('getSortPreference / updateSortPreference', () => {
  const getAccessToken = vi.fn().mockResolvedValue('test-privy-jwt');

  it('GETs /api/draft/{id}/sort', async () => {
    const fn = mockFetch('ADP');
    await getSortPreference(WALLET, DRAFT_ID, getAccessToken);
    expect(lastCall(fn).url).toBe(`/api/draft/${DRAFT_ID}/sort`);
  });

  it('PUTs to /api/draft/{id}/sort with {sortBy}', async () => {
    const fn = mockFetch(null);
    await updateSortPreference(WALLET, DRAFT_ID, 'RANK', getAccessToken);
    const { url, init } = lastCall(fn);
    expect(url).toBe(`/api/draft/${DRAFT_ID}/sort`);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ sortBy: 'RANK' });
  });
});

describe('joinDraft / leaveDraft', () => {
  const getAccessToken = vi.fn().mockResolvedValue('test-privy-jwt');

  it('POSTs to /api/league/join with Bearer token and speed', async () => {
    const fn = mockFetch([{ _leagueId: DRAFT_ID, draftId: DRAFT_ID }]);
    await joinDraft(WALLET, 'fast', getAccessToken, 1);

    const { url, init } = lastCall(fn);
    expect(url).toBe('/api/league/join');
    expect(init.method).toBe('POST');
    const headers = init.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer test-privy-jwt');
    expect(JSON.parse(init.body as string)).toEqual({
      speed: 'fast',
      numLeaguesToJoin: 1,
      passType: 'paid',
    });
  });

  it('throws when join response is missing a draft ID', async () => {
    mockFetch([{ players: 1, maxPlayers: 10 }]);
    await expect(joinDraft(WALLET, 'fast', getAccessToken, 1)).rejects.toThrow(
      'Join succeeded but the server response did not include a draft ID.',
    );
  });

  it('POSTs to /api/league/leave with draftId and tokenId', async () => {
    const fn = mockFetch({ ok: true });
    await leaveDraft(DRAFT_ID, WALLET, getAccessToken, 'token-42');

    const { url, init } = lastCall(fn);
    expect(url).toBe('/api/league/leave');
    expect(init.method).toBe('POST');
    const headers = init.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer test-privy-jwt');
    expect(JSON.parse(init.body as string)).toEqual({
      draftId: DRAFT_ID,
      tokenId: 'token-42',
    });
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
    expect(lastCall(fn).url).toBe(`/api/drafts-api/draft/${DRAFT_ID}/state/info`);
  });

  it('getDraftSummary hits /draft/{id}/state/summary', async () => {
    const fn = mockFetch({ picks: [] });
    await getDraftSummary(DRAFT_ID);
    expect(lastCall(fn).url).toBe(`/api/drafts-api/draft/${DRAFT_ID}/state/summary`);
  });

  it('getDraftRosters hits /draft/{id}/state/rosters', async () => {
    const fn = mockFetch({});
    await getDraftRosters(DRAFT_ID);
    expect(lastCall(fn).url).toBe(`/api/drafts-api/draft/${DRAFT_ID}/state/rosters`);
  });
});
