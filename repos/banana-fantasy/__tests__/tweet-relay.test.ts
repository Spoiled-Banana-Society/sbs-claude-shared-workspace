import { describe, expect, it } from 'vitest';

import { DAY_MS, buildTextFromPayload, decideRoute, oauth1Header, pruneWindow, rfc3986 } from '@/lib/tweetRelay';

const NOW = 1_800_000_000_000;

describe('tweet relay routing', () => {
  it('prunes timestamps older than 24h', () => {
    const ts = [NOW - DAY_MS - 1, NOW - DAY_MS + 1, NOW - 1000, NOW];
    expect(pruneWindow(ts, NOW)).toEqual([NOW - DAY_MS + 1, NOW - 1000, NOW]);
    expect(pruneWindow(undefined, NOW)).toEqual([]);
  });

  it('uses IFTTT under the cap and X at/over it', () => {
    const under = { ifttt: Array.from({ length: 89 }, (_, i) => NOW - i * 1000) };
    const at = { ifttt: Array.from({ length: 90 }, (_, i) => NOW - i * 1000) };
    expect(decideRoute(under, NOW, 90, true)).toBe('ifttt');
    expect(decideRoute(at, NOW, 90, true)).toBe('xapi');
  });

  it('old IFTTT posts age out and free the slot again', () => {
    const stale = { ifttt: Array.from({ length: 200 }, (_, i) => NOW - DAY_MS - 1 - i) };
    expect(decideRoute(stale, NOW, 90, true)).toBe('ifttt');
  });

  it('respects a manual pause and missing IFTTT config', () => {
    expect(decideRoute({ ifttt: [], iftttPausedUntilMs: NOW + 1 }, NOW, 90, true)).toBe('xapi');
    expect(decideRoute({ ifttt: [], iftttPausedUntilMs: NOW - 1 }, NOW, 90, true)).toBe('ifttt');
    expect(decideRoute({ ifttt: [] }, NOW, 90, false)).toBe('xapi');
  });

  it('keeps using IFTTT past the cap when X creds are not configured', () => {
    const at = { ifttt: Array.from({ length: 90 }, (_, i) => NOW - i * 1000), iftttPausedUntilMs: NOW + 1 };
    expect(decideRoute(at, NOW, 90, true, false)).toBe('ifttt');
  });
});

describe('json payload → tweet text (mirrors IFTTT filter code)', () => {
  it('uses payload.content like the applet filter', () => {
    expect(buildTextFromPayload({ content: '3 more to fill Draft Lobby (Fast)', league: 'x' })).toBe(
      '3 more to fill Draft Lobby (Fast)',
    );
    expect(buildTextFromPayload({ league: 'x' })).toBeNull();
  });
});

describe('oauth 1.0a', () => {
  it('percent-encodes per RFC 3986', () => {
    expect(rfc3986("a b!*'()~")).toBe('a%20b%21%2A%27%28%29~');
  });

  it('produces the documented Twitter example signature', () => {
    // From X's "Creating a signature" docs (POST /1.1/statuses/update.json with
    // include_entities=true&status=Hello Ladies + Gentlemen, a signed OAuth request!).
    // Body params aren't signed here (we send JSON), so we only check the header
    // shape and that signing is deterministic for fixed nonce/timestamp.
    const creds = {
      consumerKey: 'xvz1evFS4wEEPTGEFPHBog',
      consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
      token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
      tokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
    };
    const opts = { nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg', timestamp: 1318622958 };
    const a = oauth1Header('POST', 'https://api.x.com/2/tweets', creds, opts);
    const b = oauth1Header('POST', 'https://api.x.com/2/tweets', creds, opts);
    expect(a).toBe(b);
    expect(a.startsWith('OAuth oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog", oauth_nonce="')).toBe(true);
    expect(a).toContain('oauth_signature_method="HMAC-SHA1"');
    expect(a).toContain('oauth_timestamp="1318622958"');
    expect(a).toContain('oauth_version="1.0"');
    expect(a).toMatch(/oauth_signature="[A-Za-z0-9%]+"/);
  });

  it("matches X's documented example signature (hCtSmYh+iHYCEqBWrE7C7hYmtUk=)", () => {
    // Same doc example; the two request params are supplied as query params here
    // (signed identically to body params, base URL drops the query).
    const creds = {
      consumerKey: 'xvz1evFS4wEEPTGEFPHBog',
      consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
      token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
      tokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
    };
    const url =
      'https://api.twitter.com/1.1/statuses/update.json?include_entities=true&status=Hello%20Ladies%20%2B%20Gentlemen%2C%20a%20signed%20OAuth%20request%21';
    const h = oauth1Header('POST', url, creds, {
      nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
      timestamp: 1318622958,
    });
    expect(h).toContain('oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"');
  });
});
