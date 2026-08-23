import { describe, it, expect } from 'vitest';
import {
  bonusZoneTierForPosition,
  bonusZoneViewForLane,
  laneViewFromTracker,
  isBonusZoneDraftId,
  entryDocId,
  progressCopy,
  GRANDFATHERED_TOKEN_IDS,
  BZ_TIER1_THROUGH,
  BZ_TIER2_THROUGH,
  BZ_TIER3_THROUGH,
  BZ_UNITS_PER_PASS,
} from '@/lib/bonusZone';

const cfg = { enabled: true, tier1Through: BZ_TIER1_THROUGH, tier2Through: BZ_TIER2_THROUGH, tier3Through: BZ_TIER3_THROUGH };

describe('bonus zone tiers (Richard 2026-08-22 FINAL: 1-20 Buy 1 Get 1, 21-40 Buy 2 Get 1, 41-60 Buy 3 Get 1, 61+ nothing)', () => {
  it('defaults', () => {
    expect(BZ_TIER1_THROUGH).toBe(20);
    expect(BZ_TIER2_THROUGH).toBe(40);
    expect(BZ_TIER3_THROUGH).toBe(60);
  });

  it('maps window positions to tiers', () => {
    expect(bonusZoneTierForPosition(1)?.tier).toBe(1);
    expect(bonusZoneTierForPosition(20)?.tier).toBe(1);
    expect(bonusZoneTierForPosition(21)?.tier).toBe(2);
    expect(bonusZoneTierForPosition(40)?.tier).toBe(2);
    expect(bonusZoneTierForPosition(41)?.tier).toBe(3);
    expect(bonusZoneTierForPosition(60)?.tier).toBe(3);
    expect(bonusZoneTierForPosition(61)).toBeNull();
    expect(bonusZoneTierForPosition(100)).toBeNull();
    expect(bonusZoneTierForPosition(0)).toBeNull();
  });

  it('credits: tier 1 = 1 free draft (6 units), tier 2 = half (3), tier 3 = third (2)', () => {
    expect(bonusZoneTierForPosition(5)?.credit).toBe(1);
    expect(bonusZoneTierForPosition(5)?.units).toBe(6);
    expect(bonusZoneTierForPosition(30)?.credit).toBe(0.5);
    expect(bonusZoneTierForPosition(30)?.units).toBe(3);
    expect(bonusZoneTierForPosition(50)?.credit).toBeCloseTo(1 / 3);
    expect(bonusZoneTierForPosition(50)?.units).toBe(2);
    expect(bonusZoneTierForPosition(5)?.label).toBe('Buy 1 Get 1 Spin');
    expect(bonusZoneTierForPosition(30)?.label).toBe('Buy 2 Get 1 Spin');
    expect(bonusZoneTierForPosition(50)?.label).toBe('Buy 3 Get 1 Spin');
    expect(BZ_UNITS_PER_PASS).toBe(6);
  });

  it('a half plus two thirds never mint early; 3+3, 2+2+2, 3+2+... all reach 6', () => {
    expect(3 + 2 < BZ_UNITS_PER_PASS).toBe(true);
    expect(3 + 3).toBe(BZ_UNITS_PER_PASS);
    expect(2 + 2 + 2).toBe(BZ_UNITS_PER_PASS);
  });

  it('the third band collapses when tier3Through == tier2Through (config)', () => {
    const c = { tier1Through: 20, tier2Through: 60, tier3Through: 60 };
    expect(bonusZoneTierForPosition(50, c)?.tier).toBe(2);
    expect(bonusZoneTierForPosition(61, c)).toBeNull();
  });

  it('progress copy', () => {
    expect(progressCopy(3)).toBe('1 of 2 toward a Free Spin');
    expect(progressCopy(2)).toBe('1 of 3 toward a Free Spin');
    expect(progressCopy(4)).toBe('2 of 3 toward a Free Spin');
    expect(progressCopy(5)).toMatch(/83%/);
  });
});

describe('bonus zone live view', () => {
  it('right after a hit the NEXT draft is position 1 with 20 left in tier 1, 60 in the zone', () => {
    const v = bonusZoneViewForLane(818, 817, cfg);
    expect(v.position).toBe(1);
    expect(v.tier).toBe(1);
    expect(v.draftsLeftInTier).toBe(20);
    expect(v.draftsLeftInZone).toBe(60);
  });

  it('live 8/22 state: window 818, 852 filled → next is position 36 (Buy 2 Get 1, 5 left)', () => {
    const v = bonusZoneViewForLane(818, 852, cfg);
    expect(v.position).toBe(36);
    expect(v.tier).toBe(2);
    expect(v.draftsLeftInTier).toBe(40 - 36 + 1);
  });

  it('tier boundaries: 19 filled → next is 20 (last BOGO); 20 → 21 (B2G1); 40 → 41 (B3G1)', () => {
    expect(bonusZoneViewForLane(818, 818 + 18, cfg).position).toBe(20);
    expect(bonusZoneViewForLane(818, 818 + 18, cfg).tier).toBe(1);
    expect(bonusZoneViewForLane(818, 818 + 18, cfg).draftsLeftInTier).toBe(1);
    expect(bonusZoneViewForLane(818, 818 + 19, cfg).tier).toBe(2);
    expect(bonusZoneViewForLane(818, 818 + 39, cfg).position).toBe(41);
    expect(bonusZoneViewForLane(818, 818 + 39, cfg).tier).toBe(3);
  });

  it('zone closes at 61 and the pill hides (tier null, 0 left)', () => {
    const v = bonusZoneViewForLane(818, 818 + 59, cfg);
    expect(v.position).toBe(61);
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
    const tracker = {
      FilledLeaguesCount: 853,
      RollingStartDraft: 201,
      JackpotLeagueIds: [255, 817, 853],
      RecentFills: [{ Id: 853, StartTime: Math.floor(now / 1000) + 55 }],
    };
    const lane = laneViewFromTracker(tracker, now);
    expect(lane.windowStart).toBe(818);
    expect(lane.revealedFilled).toBe(852);
    expect(bonusZoneViewForLane(lane.windowStart, lane.revealedFilled, cfg).position).toBe(36);
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
