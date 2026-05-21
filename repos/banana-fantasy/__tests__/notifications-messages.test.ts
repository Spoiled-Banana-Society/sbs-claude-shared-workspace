import { describe, it, expect } from 'vitest';
import { renderMessage } from '@/lib/notifications/messages';

describe('renderMessage', () => {
  describe('draft.filled', () => {
    it('includes the draft name and "starting" language', () => {
      const m = renderMessage({
        type: 'draft.filled',
        draftId: 'd1',
        draftName: 'Sunday Slugfest',
      });
      expect(m.title).toMatch(/start/i);
      expect(m.body).toContain('Sunday Slugfest');
    });

    it('falls back to generic copy when draftName is missing', () => {
      const m = renderMessage({ type: 'draft.filled', draftId: 'd1' });
      expect(m.body.length).toBeGreaterThan(0);
      expect(m.body).not.toContain('undefined');
    });
  });

  describe('draft.your_turn', () => {
    it('uses "on the clock" copy', () => {
      const m = renderMessage({
        type: 'draft.your_turn',
        draftId: 'd1',
        draftName: 'X',
        pickNumber: 5,
        pickLengthSeconds: 30,
      });
      expect(m.title).toMatch(/clock/i);
      expect(m.body).toContain('30 seconds');
    });

    it('rounds long pick lengths to whole hours', () => {
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
        draftId: 'd1',
        draftName: 'X',
      });
      expect(m.body).not.toMatch(/seconds|hours/);
    });
  });

  it('builds a draft-room deep link with the draft id', () => {
    const m = renderMessage({ type: 'draft.filled', draftId: 'abc123' });
    expect(m.url).toContain('/draft-room?id=abc123');
  });
});
