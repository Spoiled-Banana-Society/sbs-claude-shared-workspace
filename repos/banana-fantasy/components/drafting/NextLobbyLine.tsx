'use client';

import { useNextLobbyFill } from '@/hooks/useNextLobbyFill';
import { LobbyFillBar } from '@/components/drafting/LobbyFillBar';

/**
 * "Next lobby — Fast 6/10 · Slow 3/10" under the Drafts header.
 *
 * The lobby rows below it already print their own seat count, and those are
 * drafts you're IN; this answers the different question you ask before you
 * press Enter. Lanes are speed-only — a paid and a free pass land in the same
 * lobby — so there are at most two numbers here, ever.
 *
 * Returns null when neither lane has a lobby worth showing, so the page looks
 * exactly as it does today whenever there's nothing to say.
 */
export default function NextLobbyLine({ className = '' }: { className?: string }) {
  const { fast, slow } = useNextLobbyFill();

  if (!fast && !slow) return null;

  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-white/35 ${className}`}>
      <span>Next lobby</span>
      {fast && (
        <span className="inline-flex items-center gap-1.5">
          Fast <LobbyFillBar fill={fast} />
        </span>
      )}
      {slow && (
        <span className="inline-flex items-center gap-1.5">
          Slow <LobbyFillBar fill={slow} />
        </span>
      )}
    </div>
  );
}
