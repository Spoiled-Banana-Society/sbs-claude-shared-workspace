import { describe, it, expect } from 'vitest';
import {
  bonusZoneTierForPosition,
  bonusZoneViewForLane,
  laneViewFromTracker,
  isBonusZoneDraftId,
  entryDocId,
  GRANDFATHERED_TOKEN_IDS,
  BZ_TIER1_THROUGH,
  BZ_TIER2_THROUGH,
} from '@/lib/bonusZone';

const cfg = { enabled: true, tier1Through: BZ_TIER1_THROUGH, tier2Through: BZ_TIER2_THROUGH };

describe('bonus zone tiers (Richard 2026-08-22: 1-33 BOGO, 34-69 B2G1, 70+ nothing)', () => {
  it('maps window positions to tiers', () => {
    expect(bonusZoneTierForPosition(1)?.tier).toBe(1);
    expect(bonusZoneTierForPosition(33)?.tier).toBe(1);
    expect(bonusZoneTierForPosition(34)?.tier).toBe(2);
    expect(bonusZoneTierForPosition(69)?.tier).toBe(2);
    expect(bonusZoneTierForPosition(70)).toBeNull();
    expect(bonusZoneTierForPosition(100)).toBeNull();
    expect(bonusZoneTierForPosition(0)).toBeNull();
  });

  it('credits: tier 1 = 1 free draft, tier 2 = half', () => {
    expect(bonusZoneTierForPosition(10)?.credit).toBe(1);
    expect(bonusZoneTierForPosition(50)?.credit).toBe(0.5);
    expect(bonusZoneTierForPosition(10)?.label).toBe('Buy 1 Get 1');
    expect(bonusZoneTierForPosition(50)?.label).toBe('Buy 2 Get 1');
  });

  it('honours config overrides', () => {
    const c = { tier1Through: 25, tier2Through: 50 };
    expect(bonusZoneTierForPosition(30, c)?.tier).toBe(2);
    expect(bonusZoneTierForPosition(51, c)).toBeNull();
  });
});

describe('bonus zone live view', () => {
  it('right after a hit the NEXT draft is position 1 with 33 left', () => {
    // window opened at 818; nothing filled in it yet (revealedFilled = 817)
    const v = bonusZoneViewForLane(818, 817, cfg);
    expect(v.position).toBe(1);
    expect(v.tier).toBe(1);
    expect(v.draftsLeftInTier).toBe(33);
    expect(v.draftsLeftInZone).toBe(69);
  });

  it('live 8/22 state: window 818, 852 filled → next is position 36 (Buy 2 Get 1, 34 left)', () => {
    const v = bonusZoneViewForLane(818, 852, cfg);
    expect(v.position).toBe(36);
    expect(v.tier).toBe(2);
    expect(v.draftsLeftInTier).toBe(69 - 36 + 1);
  });

  it('tier boundary: 32 filled in window → next is 33 (last BOGO), 33 filled → next is 34 (B2G1)', () => {
    expect(bonusZoneViewForLane(818, 818 + 31, cfg).position).toBe(33);
    expect(bonusZoneViewForLane(818, 818 + 31, cfg).tier).toBe(1);
    expect(bonusZoneViewForLane(818, 818 + 31, cfg).draftsLeftInTier).toBe(1);
    expect(bonusZoneViewForLane(818, 818 + 32, cfg).position).toBe(34);
    expect(bonusZoneViewForLane(818, 818 + 32, cfg).tier).toBe(2);
  });

  it('zone closes at 70 and the pill hides (tier null, 0 left)', () => {
    const v = bonusZoneViewForLane(818, 818 + 68, cfg);
    expect(v.position).toBe(70);
    expect(v.tier).toBeNull();
    expect(v.draftsLeftInTier).toBe(0);
  });

  it('switch off → never a tier, even at position 1', () => {
    const v = bonusZoneViewForLane(818, 817, { ...cfg, enabled: false });
    expect(v.enabled).toBe(false);
    expect(v.tier).toBeNull();
  });
});

describe('reveal gating mirrors the header pill', () => {
  const now = 1_787_400_000_000; // ms
  it('an unrevealed jackpot fill keeps the OLD window on screen (no spoiler)', () => {
    // Draft 853 filled 5s ago and is the JP hit; its slot lands at start-39s.
    const tracker = {
      FilledLeaguesCount: 853,
      RollingStartDraft: 201,
      JackpotLeagueIds: [255, 817, 853],
      RecentFills: [{ Id: 853, StartTime: Math.floor(now / 1000) + 55 }],
    };
    const lane = laneViewFromTracker(tracker, now);
    expect(lane.windowStart).toBe(818);         // still the old window
    expect(lane.revealedFilled).toBe(852);      // 853 not revealed yet
    const v = bonusZoneViewForLane(lane.windowStart, lane.revealedFilled, cfg);
    expect(v.position).toBe(36);                // NOT position 1 — reveal first
  });

  it('once the slot has landed the window resets and the zone reopens at 1', () => {
    const tracker = {
      FilledLeaguesCount: 853,
      RollingStartDraft: 201,
      JackpotLeagueIds: [255, 817, 853],
      RecentFills: [{ Id: 853, StartTime: Math.floor(now / 1000) - 100 }],
    };
    const lane = laneViewFromTracker(tracker, now);
    expect(lane.windowStart).toBe(854);
    expect(lane.revealedFilled).toBe(853);
    expect(bonusZoneViewForLane(lane.windowStart, lane.revealedFilled, cfg).position).toBe(1);
  });

  it('a SCHEDULED (unfilled) jackpot id never advances the window', () => {
    const tracker = { FilledLeaguesCount: 852, RollingStartDraft: 201, JackpotLeagueIds: [817, 880], RecentFills: [] };
    expect(laneViewFromTracker(tracker, now).windowStart).toBe(818);
  });

  it('provisional {StartTime:0} fill is held as unrevealed', () => {
    const tracker = { FilledLeaguesCount: 853, RollingStartDraft: 201, JackpotLeagueIds: [817, 853], RecentFills: [{ Id: 853, StartTime: 0 }] };
    const lane = laneViewFromTracker(tracker, now);
    expect(lane.windowStart).toBe(818);
    expect(lane.revealedFilled).toBe(852);
  });
});

describe('scope + keys', () => {
  it('only BBB fast/slow lobbies count', () => {
    expect(isBonusZoneDraftId('2026-fast-draft-700')).toBe(true);
    expect(isBonusZoneDraftId('2026-slow-draft-72')).toBe(true);
    expect(isBonusZoneDraftId('jackpot-round-12')).toBe(false);
    expect(isBonusZoneDraftId('2026-private-kffl-3')).toBe(false);
  });

  it('entry doc id is per (draft, wallet), wallet lowercased', () => {
    expect(entryDocId('2026-fast-draft-700', '0xABC')).toBe('2026-fast-draft-700__0xabc');
  });

  it('grandfather list = the 19 plain pre-launch passes (VagBros 2160/2168 left out)', () => {
    expect(GRANDFATHERED_TOKEN_IDS).toHaveLength(19);
    expect(GRANDFATHERED_TOKEN_IDS).not.toContain('2160');
    expect(GRANDFATHERED_TOKEN_IDS).not.toContain('2168');
    for (const t of ['6803', '6810', '9117', '9338', '7943', '7944', '8919', '8993', '8422']) {
      expect(GRANDFATHERED_TOKEN_IDS).toContain(t);
    }
  });
});
