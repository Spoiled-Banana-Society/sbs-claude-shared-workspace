import { describe, it, expect } from 'vitest';
import { planLobbyDeletes } from '@/lib/discordLobbyCleanup';

const bot = { id: '1', bot: true };
const msg = (id: string, content: string, author: { id: string; bot?: boolean } = bot) => ({
  id,
  content,
  timestamp: '2026-08-26T18:00:00Z',
  author,
});
const cd = (n: number, speed = 'Fast') =>
  `**${n}** more to fill Draft Lobby (${speed})\n\nHOF - 7.69% Jackpot - 3.13%\n\n🍌\n\n@everyone`;
const fill = (n: number, speed = 'Fast') => `**0** more to fill League #${n} (${speed})\n\n@everyone`;

describe('planLobbyDeletes', () => {
  it('keeps only the newest countdown per speed', () => {
    const plan = planLobbyDeletes([msg('10', cd(5)), msg('11', cd(4)), msg('12', cd(3))]);
    expect(plan).toEqual(['11', '10']);
  });
  it('drops the last countdown once the fill message lands, keeps the fill', () => {
    const plan = planLobbyDeletes([msg('10', cd(2)), msg('11', cd(1)), msg('12', fill(893))]);
    expect(plan).toEqual(['11', '10']);
  });
  it('never deletes fill messages, even old ones', () => {
    const plan = planLobbyDeletes([msg('10', fill(890)), msg('11', cd(6)), msg('12', fill(891)), msg('13', cd(5))]);
    expect(plan).toEqual(['11']);
  });
  it('treats Fast and Slow independently', () => {
    const plan = planLobbyDeletes([msg('10', cd(3, 'Slow')), msg('11', cd(3)), msg('12', cd(2))]);
    expect(plan).toEqual(['11']);
  });
  it('ignores human messages and unrelated bot messages', () => {
    const plan = planLobbyDeletes([
      msg('10', cd(3), { id: '99', bot: false }),
      msg('11', '1 fast draft going · a fast draft is on Round 15'),
      msg('12', cd(2)),
    ]);
    expect(plan).toEqual([]);
  });
  it('orders by snowflake, not array order', () => {
    const plan = planLobbyDeletes([msg('12', cd(3)), msg('10', cd(5)), msg('11', cd(4))]);
    expect(plan).toEqual(['11', '10']);
  });
});
