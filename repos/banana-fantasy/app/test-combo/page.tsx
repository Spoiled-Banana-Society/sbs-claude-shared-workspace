'use client';

import { useState } from 'react';
import { ComboRevealBanner, type ComboKind } from '@/components/drafting/ComboRevealBanner';

/**
 * Preview page for the combo "screen goes insane" reveal. Pick a combo, watch it
 * fire over a mock draft-room background. Not linked anywhere — /test-combo.
 */
export default function TestComboPage() {
  const [active, setActive] = useState<ComboKind | null>(null);

  const buttons: { kind: ComboKind; label: string }[] = [
    { kind: 'jackpot-jackpot', label: 'Jackpot × Jackpot' },
    { kind: 'hof-hof', label: 'HOF × HOF' },
    { kind: 'mixed', label: 'Jackpot × HOF' },
  ];

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-8 p-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-2">Combo Reveal Preview</h1>
        <p className="text-text-secondary text-sm">Tap a combo to watch the screen lose its mind. Auto-dismisses after ~6.5s.</p>
      </div>
      <div className="flex flex-wrap gap-3 justify-center">
        {buttons.map((b) => (
          <button
            key={b.kind}
            onClick={() => { setActive(null); requestAnimationFrame(() => setActive(b.kind)); }}
            className="px-6 py-3 rounded-xl bg-banana text-black font-bold hover:brightness-110 transition-all"
          >
            {b.label}
          </button>
        ))}
      </div>
      <p className="text-text-muted text-xs">Or in a real draft room: <span className="font-mono">/draft-room?forceCombo=jp-jp</span> (or hof-hof, mixed)</p>

      {active && <ComboRevealBanner kind={active} onClose={() => setActive(null)} />}
    </div>
  );
}
