'use client';

/**
 * Static "FOUNDER" pill for team cards (marketplace + My Teams). Whether to
 * show it is decided in a batch via useFounderTeams — this is purely visual,
 * styled to sit alongside the PRO/HOF/JACKPOT rarity pills.
 */
export function FounderTeamBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`px-3 py-1 text-[10px] font-bold uppercase rounded-full text-white ${className}`}
      style={{ background: '#06b6d4' }}
    >
      Founder
    </span>
  );
}
