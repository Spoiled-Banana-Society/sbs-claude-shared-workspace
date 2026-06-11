'use client';

/**
 * TEMP preview page (Boris 2026-06-11) — full Jackpot Spin Draw flow with the
 * new VRF derivation + instant on-chain receipts, end to end: who gets which
 * ping, the draw animation, the provably-fair box, and the proof-feed row.
 * Synthetic data; delete when reviewed.
 */

import React, { useState } from 'react';
import { JackpotWinnerCycle } from '@/components/promos/JackpotWinnerCycle';

const PAID = ['BananaKing', 'Richard', 'Banana81244', 'GridironGor', 'Banana20471', 'MookieMash', 'Banana90211'];
const WINNER_IDX = 4; // Banana20471
const SAMPLE_TX = '0x3bb8f35f74523edef80058dc8e48c3fd40d2dddc9573e0431a0a1ef30330e8a1';

function NotiCard({ title, message, time }: { title: string; message: string; time: string }) {
  return (
    <div className="flex gap-3 items-start bg-bg-tertiary rounded-xl px-4 py-3">
      <div className="text-2xl leading-none mt-0.5">🎰</div>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <p className="text-white font-semibold text-sm">{title}</p>
          <span className="text-text-muted text-[10px] flex-shrink-0">{time}</span>
        </div>
        <p className="text-text-secondary text-xs mt-0.5 leading-relaxed">{message}</p>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-white font-bold text-base">
        <span className="text-banana mr-2">{n}.</span>{title}
      </h2>
      {children}
    </section>
  );
}

export default function TestJackpotDrawPage() {
  const [runId, setRunId] = useState(1);
  const [settled, setSettled] = useState(false);

  return (
    <div className="min-h-screen bg-bg-primary px-4 py-10">
      <div className="max-w-xl mx-auto space-y-10">
        <header className="space-y-2">
          <h1 className="text-white font-bold text-xl">Jackpot Spin Draw — full flow preview</h1>
          <p className="text-text-secondary text-sm leading-relaxed">
            What happens the moment a Jackpot draft fills, in order. Synthetic draft
            (#1391, 7 paid / 3 free entrants, position #14 of 100 → 10-Spin Draw).
          </p>
        </header>

        <Step n={1} title="Draft fills → draw runs server-side, receipt hits Base">
          <p className="text-text-secondary text-xs leading-relaxed">
            Winner = sha256(sealed period salt + VRF randomness + draft ID) over the 7 paid
            entrants in slot order. Free entrants are never in the draw. Within seconds the
            full draw record (paid wallets, winner, period + salt hash) posts on-chain —
            permanent before anyone&apos;s phone even buzzes.
          </p>
        </Step>

        <Step n={2} title="The winner's ping (bell + toast, instant)">
          <NotiCard
            title="You Won 10 Free Spins!"
            message="The 10-Spin Draw from your Jackpot draft landed on YOU — up to 200 free drafts. Claim your spins."
            time="just now"
          />
          <p className="text-text-muted text-[11px]">Tapping it opens the promo modal and the draw replays (step 4), then CLAIM unlocks.</p>
        </Step>

        <Step n={3} title="Everyone else's ping — one each, result unspoiled">
          <p className="text-text-muted text-[11px]">First time in a Jackpot draft (badge bundles in, one ping not two):</p>
          <NotiCard
            title="JACKPOT! Badge Unlocked + Draw Live"
            message="You're in a Jackpot draft — Jackpot Club badge unlocked, and the 10-Spin Draw just ran. Watch the draw."
            time="just now"
          />
          <p className="text-text-muted text-[11px]">Repeat Jackpot drafters (already have the badge):</p>
          <NotiCard
            title="The 10-Spin Draw Is Live"
            message="Your Jackpot draft triggered the 10-Spin Draw. Watch the draw."
            time="just now"
          />
        </Step>

        <Step n={4} title="They tap → the modal replays the REAL draw">
          <p className="text-text-muted text-[11px]">
            Same animation for winner and spectators — it cycles the actual paid entrants and
            settles on the recorded winner. Hit replay to watch it again:
          </p>
          <JackpotWinnerCycle
            key={runId}
            seed="2024-fast-draft-1391"
            labels={PAID}
            winnerLabel={PAID[WINNER_IDX]}
            winnerIdxOverride={WINNER_IDX}
            onSettled={() => setSettled(true)}
          />
          {settled && (
            <div className="bg-bg-tertiary/60 rounded-lg px-3 py-2 space-y-1">
              <p className="text-text-muted text-[10px] text-center">
                Provably fair ✓ — drawn from VRF randomness sealed on-chain before this draft existed (period 1).
              </p>
              <p className="text-[10px] text-center">
                <a href={`https://basescan.org/tx/${SAMPLE_TX}`} target="_blank" rel="noopener noreferrer" className="text-banana hover:underline">
                  View on-chain draw receipt →
                </a>
                <span className="text-text-muted"> (sample tx)</span>
              </p>
            </div>
          )}
          <button
            onClick={() => { setSettled(false); setRunId((n) => n + 1); }}
            className="w-full text-center text-banana text-xs hover:underline py-1"
          >
            ↻ Replay the draw
          </button>
        </Step>

        <Step n={5} title="The draw appears in the public live feed (/proof-feed)">
          <p className="text-text-muted text-[11px]">
            Every user&apos;s draws, not just yours — under the Jackpot draft&apos;s row, next to all the
            draft-type VRF rows:
          </p>
          <div className="rounded-xl border border-white/10 overflow-hidden text-sm">
            <div className="flex items-center justify-between px-4 py-2 bg-white/5">
              <span className="text-white/80 font-mono">#1391</span>
              <span className="font-semibold" style={{ color: '#ef4444' }}>JACKPOT</span>
              <span className="text-banana text-xs">Verify →</span>
            </div>
            <div className="px-4 py-1.5 text-[11px] text-white/55 bg-white/[0.02] border-t border-white/5">
              <span style={{ color: '#ef4444' }} className="font-semibold">Spin Draw</span>
              {' · '}10-Spin Draw among 7 paid entries · won by <span className="text-white/80">Banana20471</span>
              {' · '}<span className="text-banana">On-chain receipt →</span>
            </div>
          </div>
        </Step>

        <Step n={6} title="Promo card copy (new VRF bullet)">
          <div className="bg-bg-tertiary rounded-xl px-4 py-3 text-text-secondary text-xs leading-relaxed whitespace-pre-line">
            {'• 1 Jackpot draft in every 100 drafts\n• Jackpot hit within first 25 drafts → 1 of the 10 drafters in the Jackpot draft wins 10 Free Banana Spins — up to 200 Free Drafts\n• Jackpot hit within first 50 drafts → 1 of the 10 drafters in the Jackpot draft wins 5 Free Banana Spins — up to 100 Free Drafts\n• Cycle resets after every 100 drafts\n• Winner drawn from VRF randomness sealed on-chain before the draft exists — every draw posts an instant on-chain receipt\n• Jackpot League Perk: Win your Jackpot league and go straight to the finals, skipping the first two rounds of playoffs!\n• Paid Drafts Only.'}
          </div>
        </Step>

        <footer className="text-text-muted text-[11px] leading-relaxed border-t border-white/10 pt-4">
          Audit story: salt hash + VRF randomness lock on-chain before the round → each draw
          binds them to the paid list at fill (unpredictable, un-grindable) → instant on-chain
          receipt per draw → at period reveal the salt publishes and anyone can recompute every
          draw against its receipt.
        </footer>
      </div>
    </div>
  );
}
