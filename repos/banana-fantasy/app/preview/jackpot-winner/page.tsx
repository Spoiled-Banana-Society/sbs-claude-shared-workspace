'use client';

import React, { useState } from 'react';
import { JackpotWinnerCycle } from '@/components/promos/JackpotWinnerCycle';

// Standalone preview of the Jackpot Hit promo modal flow:
// 1. User opens the promo → sees rules + progress + REVEAL button
// 2. Clicks REVEAL → cycle animation plays with the 10 drafter names
// 3. After settled → button becomes CONFIRM to finalize the claim
//
// Lets us verify the visual without filling a real JP draft (which we
// can't force on staging now that VRF decides slot positions).

const MOCK_LABELS = [
  'BananaKing99',
  'TouchdownTitan',
  'GridironKing',
  'MoonBoi',
  'BlitzMaster',
  'EndZoneKing',
  'Holder',
  'DraftKing',
  'Diamond',
  'PassPro',
];

export default function JackpotWinnerPreviewPage() {
  const [seed, setSeed] = useState('jackpot-promo-demo');
  const [revealing, setRevealing] = useState(false);
  const [settled, setSettled] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const reveal = () => {
    setRevealing(true);
    setSettled(false);
  };

  const confirm = () => setConfirmed(true);

  const reset = () => {
    setSeed(`demo-${Math.random().toString(36).slice(2, 10)}`);
    setRevealing(false);
    setSettled(false);
    setConfirmed(false);
  };

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-5">
        <header className="space-y-1 text-center">
          <h1 className="text-xl font-bold">Jackpot Hit → FREE SPIN</h1>
          <p className="text-sm text-text-muted">Modal flow preview</p>
        </header>

        <div className="bg-bg-secondary rounded-2xl p-5 space-y-4">
          {!revealing && (
            <>
              <div className="text-sm text-text-secondary leading-relaxed">
                <p>• 1 Jackpot draft in every 100 paid drafts</p>
                <p>• Hit within first 25 → 10 free spins</p>
                <p>• Hit within first 50 → 5 free spins</p>
                <p>• Cycle resets after every 100 drafts</p>
                <p>• Plus bonus Jackpot wins on the Banana Wheel</p>
              </div>

              <div className="bg-bg-tertiary rounded-xl p-4">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-text-primary font-medium">Progress</span>
                  <span className="text-xl font-bold">1/1</span>
                </div>
                <div className="h-1 bg-bg-elevated rounded-full overflow-hidden">
                  <div className="h-full bg-success" style={{ width: '100%' }} />
                </div>
                <p className="text-xs text-text-muted mt-2">Completed! Reveal who won.</p>
              </div>
            </>
          )}

          {revealing && (
            <JackpotWinnerCycle
              seed={seed}
              labels={MOCK_LABELS}
              onSettled={() => setSettled(true)}
            />
          )}

          {confirmed ? (
            <div className="bg-bg-tertiary rounded-xl p-4 text-center">
              <div className="text-3xl mb-2">🎉</div>
              <p className="font-bold">Claim confirmed</p>
              <p className="text-sm text-text-muted">In the real flow, you&apos;d be sent to spin the wheel.</p>
            </div>
          ) : (
            <button
              disabled={revealing && !settled}
              onClick={revealing ? confirm : reveal}
              className="w-full py-3 rounded-lg bg-banana text-bg-primary font-bold tracking-wide disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110 transition"
            >
              {revealing && !settled ? 'Picking winner…' : revealing ? 'CONFIRM' : 'REVEAL'}
            </button>
          )}
        </div>

        <div className="text-center space-y-2">
          <div className="text-[11px] uppercase tracking-widest text-text-muted">Seed</div>
          <div className="font-mono text-xs text-white/70 break-all">{seed}</div>
          <button
            onClick={reset}
            className="mt-2 px-5 py-2 rounded-lg bg-bg-tertiary text-text-primary font-bold tracking-wide hover:bg-bg-elevated transition"
          >
            Reset with new seed
          </button>
        </div>
      </div>
    </div>
  );
}
