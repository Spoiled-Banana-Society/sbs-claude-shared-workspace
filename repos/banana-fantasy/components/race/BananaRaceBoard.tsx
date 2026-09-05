'use client';

// BANANA RACE — the /race page body (lib/bananaRace.ts). Pure render: takes a
// RaceBoard and the viewer's login state, draws the countdown, the seat
// board, the viewer's pinned row, the leaderboard and the rules. No fetching
// here — /race polls, /preview/banana-race passes a mock.
//
// Copy rules baked in: points + tickets only (no percent odds), no bots,
// "PT" not PST, plain language, nothing says pending/filling.

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import type { RaceBoard } from '@/lib/bananaRace';

function useCountdown(targetIso: string): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const ms = Date.parse(targetIso) - now;
  if (!(ms > 0)) return 'Closed';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60); const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d > 0 ? `${d}d ` : ''}${pad(h)}:${pad(m)}:${pad(sec)}`;
}

const PT: Intl.DateTimeFormatOptions = { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
const fmtPT = (iso: string) => new Date(iso).toLocaleString('en-US', PT).replace(',', ' ·') + ' PT';

const TIER_META = {
  jackhof: { name: 'JackHOF seats', sub: 'Jackpot and HOF entry in one', color: 'text-banana' },
  jackpot: { name: 'Jackpot seats', sub: 'Jackpot entry', color: 'text-[#c98cff]' },
  hof: { name: 'HOF seats', sub: 'Hall of Fame entry', color: 'text-[#7cc0ff]' },
} as const;

export function BananaRaceBoard({ board, loggedIn, onLogin }: { board: RaceBoard; loggedIn: boolean; onLogin?: () => void }) {
  const clock = useCountdown(board.endAtIso);
  const closed = board.frozen || Date.parse(board.endAtIso) <= Date.now();
  const cutoff = board.board[board.topN - 1]?.points ?? 0;

  return (
    <div className="mx-auto w-full max-w-[900px] px-4 pb-16 pt-5 text-white">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-banana pb-3.5">
        <div>
          <div className="text-[13px] font-extrabold uppercase tracking-[.14em] text-white/50">SBS · Kickoff Week</div>
          <h1 className="mt-1 text-[44px] font-black uppercase leading-[.92] tracking-tight sm:text-[64px]">
            Banana <span className="text-banana">Race</span>
          </h1>
        </div>
        <div className="sm:text-right">
          <div className="text-[12px] uppercase tracking-[.12em] text-white/50">{closed ? 'Points closed' : 'Points close in'}</div>
          <div className="text-[36px] font-black leading-none text-banana tabular-nums">{closed ? 'Closed' : clock}</div>
          <div className="text-[13px] text-white/60">{fmtPT(board.endAtIso)}</div>
        </div>
      </header>

      {/* Pitch */}
      <p className="mt-5 max-w-[62ch] text-[18px] leading-snug">
        Every draft you buy is <b className="text-banana">1 point</b>. Points started counting{' '}
        <b className="text-banana">{fmtPT(board.startAtIso)}</b>. When points close, the board freezes:
        the <b className="text-banana">top {board.topN} lock in a JackHOF seat</b>, and every open Jackpot, HOF and
        JackHOF seat on the site gets handed out in a draw where each point is a ticket. Those leagues draft{' '}
        <b className="text-banana">{fmtPT(board.draftAtIso)}</b>, the night before kickoff.
      </p>

      {/* Steps */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          ['Buy drafts', '1 paid draft = 1 point. Bundles count per draft. No cap.'],
          [`Top ${board.topN} lock a JackHOF`, `Finish top ${board.topN} on points and your JackHOF seat is guaranteed. Ties go to whoever got there first.`],
          ['Everyone is in the draw', 'Every point you have is a ticket. More points, more chances at a Jackpot, HOF or JackHOF seat.'],
        ].map(([k, p]) => (
          <div key={k} className="rounded-lg border border-white/10 bg-white/[.04] px-4 py-3.5">
            <div className="text-[22px] font-black uppercase leading-tight text-banana">{k}</div>
            <p className="mt-1 text-[14px] text-white/65">{p}</p>
          </div>
        ))}
      </div>

      {/* Seats */}
      <h2 className="mt-7 text-[24px] font-black uppercase tracking-wide">Seats up for grabs right now</h2>
      <div className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {(['jackhof', 'jackpot', 'hof'] as const).map((tier) => {
          const t = board.seats.byTier[tier];
          const meta = TIER_META[tier];
          return (
            <div key={tier} className="relative rounded-lg border border-white/10 bg-white/[.04] px-4 py-3.5">
              {tier === 'jackhof' && (
                <span className="absolute right-3 top-3 rounded bg-banana px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[.1em] text-black">
                  Top {board.topN} guaranteed
                </span>
              )}
              <div className={`text-[52px] font-black leading-none tabular-nums ${meta.color}`}>{t.open}</div>
              <div className="text-[17px] font-bold uppercase tracking-[.06em]">{meta.name}</div>
              <div className="mt-1 text-[13px] text-white/60">
                across {t.leagues} {t.leagues === 1 ? 'league' : 'leagues'} · {meta.sub}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2.5 text-[13px] text-white/55">
        These numbers move as people win seats on the Wheel and leagues fill on their own. Whatever is still open when points close is what gets given away.
      </p>

      {/* You */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-banana bg-white/[.05] px-4 py-3.5">
        {board.you ? (
          <div>
            <div className="text-[26px] font-black uppercase leading-tight">
              You: <span className="text-banana">{board.you.points} {board.you.points === 1 ? 'point' : 'points'}</span> · #{board.you.rank}
            </div>
            <div className="text-[13px] text-white/65">
              {board.you.inTopN
                ? `Inside the top ${board.topN}. JackHOF seat locked as long as you stay there.`
                : `${board.you.toCutoff} ${board.you.toCutoff === 1 ? 'point' : 'points'} behind the JackHOF cutoff.`}
              {' '}{board.you.points} {board.you.points === 1 ? 'ticket' : 'tickets'} in the draw.
            </div>
          </div>
        ) : loggedIn ? (
          <div>
            <div className="text-[26px] font-black uppercase leading-tight">You: <span className="text-banana">0 points</span></div>
            <div className="text-[13px] text-white/65">Your first paid draft puts you on the board.</div>
          </div>
        ) : (
          <div>
            <div className="text-[26px] font-black uppercase leading-tight">Where do you stand?</div>
            <div className="text-[13px] text-white/65">Log in to see your points and your spot on the board.</div>
          </div>
        )}
        {!closed && (
          loggedIn || !onLogin ? (
            <Link href="/draft" className="rounded bg-banana px-5 py-2.5 text-[18px] font-black uppercase tracking-wide text-black hover:brightness-110">
              Buy drafts
            </Link>
          ) : (
            <button type="button" onClick={onLogin} className="rounded bg-banana px-5 py-2.5 text-[18px] font-black uppercase tracking-wide text-black hover:brightness-110">
              Log in
            </button>
          )
        )}
      </div>

      {/* Results (after the freeze) */}
      {board.results && (
        <>
          <h2 className="mt-7 text-[24px] font-black uppercase tracking-wide">Results</h2>
          <p className="text-[14px] text-white/65">Points closed {fmtPT(board.results.frozenAtIso)}. {board.results.seatsFilled} seats handed out. Winners drafted {fmtPT(board.draftAtIso)}.</p>
          <div className="mt-2.5 overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full min-w-[520px] border-collapse text-[15px]">
              <thead>
                <tr className="bg-white/[.04] text-left text-[11px] uppercase tracking-[.12em] text-white/50">
                  <th className="px-3 py-2.5">Player</th><th className="px-3 py-2.5">Won</th><th className="px-3 py-2.5">League</th>
                </tr>
              </thead>
              <tbody>
                {board.results.draw.map((d, i) => (
                  <tr key={i} className="border-t border-white/10">
                    <td className="px-3 py-2">{d.name}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-2 py-0.5 text-[11px] font-bold uppercase tracking-[.08em] ${d.guaranteed ? 'bg-banana text-black' : 'border border-white/15 text-white'}`}>
                        {d.tier === 'jackhof' ? 'JackHOF' : d.tier === 'jackpot' ? 'Jackpot' : 'HOF'}{d.guaranteed ? ' · top ' + board.topN : ''}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-white/70">{d.draftId ?? 'new league'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Leaderboard */}
      <h2 className="mt-7 text-[24px] font-black uppercase tracking-wide">Leaderboard</h2>
      <div className="mt-2.5 overflow-x-auto rounded-lg border border-white/10">
        <table className="w-full min-w-[520px] border-collapse text-[15px]">
          <thead>
            <tr className="bg-white/[.04] text-left text-[11px] uppercase tracking-[.12em] text-white/50">
              <th className="w-14 px-3 py-2.5">#</th>
              <th className="px-3 py-2.5">Player</th>
              <th className="px-3 py-2.5 text-right">Points</th>
              <th className="px-3 py-2.5">{closed ? 'Result' : 'Tuesday'}</th>
            </tr>
          </thead>
          <tbody>
            {board.board.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-white/55">Nobody on the board yet. First paid draft takes #1.</td></tr>
            )}
            {board.board.map((r, i) => (
              <React.Fragment key={r.rank}>
                <tr className={`border-t border-white/10 ${r.locked ? 'bg-gradient-to-r from-banana/10 to-transparent' : ''} ${r.you ? 'bg-[#5aa8ff]/10' : ''}`}>
                  <td className={`px-3 py-2 text-[18px] font-black tabular-nums ${r.locked ? 'text-banana' : 'text-white/50'}`}>{r.rank}</td>
                  <td className="px-3 py-2 font-semibold">{r.name}{r.you ? <span className="ml-2 text-[11px] uppercase tracking-[.1em] text-[#7cc0ff]">you</span> : null}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{r.points}</td>
                  <td className="px-3 py-2">
                    {r.locked
                      ? <span className="rounded bg-banana px-2 py-0.5 text-[11px] font-bold uppercase tracking-[.08em] text-black">JackHOF locked</span>
                      : <span className="rounded border border-white/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[.08em]">{r.points} {r.points === 1 ? 'ticket' : 'tickets'}</span>}
                  </td>
                </tr>
                {i === board.topN - 1 && board.board.length > board.topN && (
                  <tr><td colSpan={4} className="bg-white/[.04] py-1.5 text-center text-[11px] font-bold uppercase tracking-[.14em] text-banana">JackHOF cutoff · {cutoff} {cutoff === 1 ? 'point' : 'points'}</td></tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2.5 text-[13px] text-white/55">
        Board updates every minute. {board.totals.players} {board.totals.players === 1 ? 'player' : 'players'}, {board.totals.points} {board.totals.points === 1 ? 'point' : 'points'} so far. Bought drafts before we posted? They already count.
      </p>

      {/* Fine print */}
      <h2 className="mt-7 text-[24px] font-black uppercase tracking-wide">The fine print</h2>
      <div className="mt-2 grid grid-cols-1 gap-x-7 gap-y-2.5 text-[14px] text-white/65 sm:grid-cols-2">
        <p><b className="text-white">Window.</b> {fmtPT(board.startAtIso)} through {fmtPT(board.endAtIso)}. Anything bought in that window counts, including before we posted about it.</p>
        <p><b className="text-white">What counts.</b> Paid drafts only. A 5 pack is 5 points. Banana Zone bonus drafts, free drafts, wheel wins, promo code drafts and marketplace buys are not points.</p>
        <p><b className="text-white">Top {board.topN}.</b> The {board.topN} highest point totals when points close each get a JackHOF seat. Ties break by who reached that total first.</p>
        <p><b className="text-white">The draw.</b> Runs the moment points close. Every point is one ticket. One seat per person per league. You can win seats in more than one league. Winners are seated and told by bell.</p>
        <p><b className="text-white">Seats.</b> Whatever Jackpot, HOF and JackHOF seats are still open when points close. Win a seat on the Wheel before then and it is yours the normal way.</p>
        <p><b className="text-white">One person, one entry.</b> Wallets we know belong to the same person are combined.</p>
        <p><b className="text-white">Drafting.</b> Winner leagues draft {fmtPT(board.draftAtIso)} on the fast clock, so every team is set before Wednesday kickoff.</p>
      </div>
    </div>
  );
}
