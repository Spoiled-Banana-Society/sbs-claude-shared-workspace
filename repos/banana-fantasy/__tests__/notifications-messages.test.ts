import { describe, it, expect } from 'vitest';
import { renderMessage } from '@/lib/notifications/messages';

describe('renderMessage', () => {
  describe('draft.filled', () => {
    it('renders just "League #<n> filled" (League number, no BBB, no emoji)', () => {
      const m = renderMessage({
        type: 'draft.filled',
        draftId: 'league-25',
        draftName: 'BBB #25',
      });
      // Boris 2026-06-20: the visible line is only "League #<n> filled".
      expect(m.title).toBe('League #25 filled');
      expect(m.title).not.toMatch(/BBB|🍌/);
      // body exists only so web push has contents; channels don't show it.
      expect(m.body.length).toBeGreaterThan(0);
    });

    it('falls back to generic copy when no league number is resolvable', () => {
      const m = renderMessage({ type: 'draft.filled', draftId: 'd1' });
      expect(m.title).toMatch(/filled/i);
      expect(m.title).not.toContain('undefined');
      expect(m.title).not.toContain('#');
    });
  });

  describe('draft.your_turn', () => {
    it('renders "You\'re on the clock — League #<n>"', () => {
      const m = renderMessage({
        type: 'draft.your_turn',
        draftId: 'league-25',
        draftName: 'BBB #25',
        pickNumber: 5,
        pickLengthSeconds: 30,
      });
      expect(m.title).toMatch(/clock/i);
      expect(m.title).toContain('League #25');
      expect(m.title).not.toMatch(/BBB|🍌/);
      // timer lives in the push-only body, not the visible title line.
      expect(m.body).toContain('30 seconds');
    });

    it('rounds long pick lengths to whole hours (push body)', () => {
      const m = renderMessage({
        type: 'draft.your_turn',
        draftId: 'd1',
        pickLengthSeconds: 28800,
      });
      expect(m.body).toContain('8 hours');
    });

    it('omits the timer when pickLengthSeconds is absent', () => {
      const m = renderMessage({
        type: 'draft.your_turn',
        draftId: 'league-9',
        draftName: 'BBB #9',
      });
      expect(m.body).not.toMatch(/seconds|hours/);
    });
  });

  it('builds a draft-room deep link with the draft id (push tap-target)', () => {
    const m = renderMessage({ type: 'draft.filled', draftId: 'abc123' });
    expect(m.url).toContain('/draft-room?id=abc123');
  });
});
