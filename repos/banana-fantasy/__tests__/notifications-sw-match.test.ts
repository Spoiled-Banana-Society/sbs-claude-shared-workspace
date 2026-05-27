import { describe, it, expect } from 'vitest';
import { findMatchingClient } from '@/lib/notifications/swClickMatch';

const ORIGIN = 'https://banana-fantasy-sbs.vercel.app';

describe('findMatchingClient', () => {
  it('returns null when there are no open clients', () => {
    expect(findMatchingClient([], `${ORIGIN}/draft-room?id=d1`)).toBeNull();
  });

  it('returns null when origins do not match', () => {
    expect(
      findMatchingClient(
        [{ url: 'https://other-site.com/draft-room?id=d1' }],
        `${ORIGIN}/draft-room?id=d1`,
      ),
    ).toBeNull();
  });

  it('matches a draft-room tab by draftId even if other params differ', () => {
    // Real-world: a user opens /draft-room?id=d1&wallet=0xabc&mode=live.
    // Notification URL is just /draft-room?id=d1 (no wallet). Loose
    // match on draftId so the existing tab gets focused, not a new
    // tab opened that's missing the user's session params.
    const clients = [
      { url: `${ORIGIN}/draft-room?id=d1&wallet=0xabc&mode=live` },
    ];
    const result = findMatchingClient(clients, `${ORIGIN}/draft-room?id=d1`);
    expect(result?.url).toBe(`${ORIGIN}/draft-room?id=d1&wallet=0xabc&mode=live`);
  });

  it('does NOT match a different draft on the same path', () => {
    const clients = [
      { url: `${ORIGIN}/draft-room?id=DIFFERENT_DRAFT&wallet=0xabc` },
    ];
    expect(
      findMatchingClient(clients, `${ORIGIN}/draft-room?id=d1`),
    ).toBeNull();
  });

  it('falls back to origin+pathname match for non-draft URLs', () => {
    // Tap a notification with a URL like /promos — focus an existing
    // /promos tab even though there are no query params to match on.
    const clients = [{ url: `${ORIGIN}/promos` }];
    const result = findMatchingClient(clients, `${ORIGIN}/promos`);
    expect(result?.url).toBe(`${ORIGIN}/promos`);
  });

  it('matches by pathname when only origin differs in subdomain/port', () => {
    // Production-ish: notification URL might be on banana-fantasy.com
    // but the user's open tab is on banana-fantasy-sbs.vercel.app. We
    // only match within the SAME origin (no cross-origin focus, that
    // would be a security footgun) — return null here.
    const clients = [{ url: `${ORIGIN}/draft-room?id=d1` }];
    expect(
      findMatchingClient(clients, 'https://banana-fantasy.com/draft-room?id=d1'),
    ).toBeNull();
  });

  it('prefers a draft-room match over a homepage match', () => {
    // If user has BOTH the homepage and the specific draft open, focus
    // the draft tab (more specific match).
    const clients = [
      { url: `${ORIGIN}/` },
      { url: `${ORIGIN}/draft-room?id=d1&wallet=0xabc` },
    ];
    const result = findMatchingClient(clients, `${ORIGIN}/draft-room?id=d1`);
    expect(result?.url).toContain('/draft-room');
  });

  it('returns null for a malformed target URL', () => {
    expect(
      findMatchingClient([{ url: `${ORIGIN}/draft-room?id=d1` }], 'not-a-url'),
    ).toBeNull();
  });

  it('skips clients with malformed URLs without throwing', () => {
    const clients = [
      { url: 'garbage://!!!' },
      { url: `${ORIGIN}/draft-room?id=d1` },
    ];
    const result = findMatchingClient(clients, `${ORIGIN}/draft-room?id=d1`);
    expect(result?.url).toBe(`${ORIGIN}/draft-room?id=d1`);
  });
});
