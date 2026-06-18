import {
  capDisplayTimeRemaining,
  expectedPickLengthFromSpeed,
  looksLikeUnconfirmedTimerRemaining,
} from '@/utils/draftTimer';

describe('draftTimer', () => {
  describe('capDisplayTimeRemaining', () => {
    it('caps at pickLength when backend grace adds +1s', () => {
      expect(capDisplayTimeRemaining(31, 30)).toBe(30);
    });

    it('leaves sub-cap values unchanged', () => {
      expect(capDisplayTimeRemaining(15, 30)).toBe(15);
    });

    it('passes through when pickLength is missing', () => {
      expect(capDisplayTimeRemaining(31, null)).toBe(31);
    });
  });

  describe('expectedPickLengthFromSpeed', () => {
    it('returns 30 for fast and 28800 for slow', () => {
      expect(expectedPickLengthFromSpeed('fast')).toBe(30);
      expect(expectedPickLengthFromSpeed('slow')).toBe(28800);
    });
  });

  describe('looksLikeUnconfirmedTimerRemaining', () => {
    it('flags values above 98% of pick length', () => {
      expect(looksLikeUnconfirmedTimerRemaining(31, 30)).toBe(true);
      expect(looksLikeUnconfirmedTimerRemaining(30, 30)).toBe(true);
    });

    it('allows values at or below 98% of pick length', () => {
      expect(looksLikeUnconfirmedTimerRemaining(29, 30)).toBe(false);
    });
  });
});
