'use client';

import { useBatchProgress } from '@/hooks/useBatchProgress';
import { Tooltip } from '../ui/Tooltip';
import { useAuth } from '@/hooks/useAuth';

export function BatchProgressIndicator() {
  const { isLoggedIn } = useAuth();
  const { data } = useBatchProgress();

  if (!isLoggedIn || !data) return null;

  const { jackpotRemaining, hofRemaining, filledLeaguesCount } = data;
  const currentDraft = filledLeaguesCount;
  const batchEnd = filledLeaguesCount === 0 ? 100 : Math.ceil(filledLeaguesCount / 100) * 100;
  const jackpotHit = jackpotRemaining <= 0;
  const allHofHit = hofRemaining <= 0;
  const draftsLeft = batchEnd - currentDraft;

  return (
    <Tooltip
      content={
        <div className="w-[240px] py-0.5">
          {/* Where this batch is */}
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm font-semibold text-text-primary">Draft {currentDraft} of {batchEnd}</span>
            <span className="text-[11px] tabular-nums text-text-muted">{draftsLeft} left</span>
          </div>
          <div className="mb-3 h-1 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-white/45"
              style={{ width: `${Math.min(100, Math.max(0, ((currentDraft - (batchEnd - 100)) / 100) * 100))}%` }}
            />
          </div>

          {/* Specials still to drop this batch (the live hook) */}
          <div className="mb-3 flex items-center justify-center gap-6">
            <span className="flex items-center gap-1.5">
              <span className={`text-base font-bold tabular-nums ${jackpotHit ? 'text-green-400' : 'text-red-400'}`}>{jackpotHit ? '✓' : jackpotRemaining}</span>
              <span className="text-[11px] font-medium text-text-secondary">{jackpotHit ? 'Jackpot hit' : 'Jackpot left'}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className={`text-base font-bold tabular-nums ${allHofHit ? 'text-green-400' : 'text-banana'}`}>{allHofHit ? '✓' : hofRemaining}</span>
              <span className="text-[11px] font-medium text-text-secondary">{allHofHit ? 'HOF hit' : 'HOF left'}</span>
            </span>
          </div>

          {/* What they are — one line each */}
          <div className="space-y-1 border-t border-white/[0.08] pt-2.5 text-center">
            <p className="text-[11.5px]"><span className="font-semibold text-red-400">Jackpot</span><span className="text-text-secondary"> · win your league, skip to finals</span></p>
            <p className="text-[11.5px]"><span className="font-semibold text-banana">HOF</span><span className="text-text-secondary"> · compete for bonus prizes</span></p>
          </div>
          <p className="mt-2 text-center text-[10.5px] text-text-muted">1 Jackpot + 5 HOF guaranteed every 100 drafts</p>
        </div>
      }
    >
      <div className="flex flex-col items-center w-[56px] sm:w-[72px] py-1 mr-2 md:mr-0 cursor-help">
        <span className="text-[13px] sm:text-[16px] font-semibold tabular-nums text-white/75 leading-tight">
          {currentDraft}<span className="text-white/40 font-normal">/{batchEnd}</span>
        </span>
        <div className="flex items-center justify-center gap-[4px] sm:gap-[6px] leading-tight">
          <span className="inline-flex items-center gap-[2px]">
            <span className={`text-[10px] sm:text-[12px] font-bold tabular-nums ${jackpotHit ? 'text-green-400' : 'text-red-400'}`}>
              {jackpotHit ? '\u2713' : jackpotRemaining}
            </span>
            <span className="text-[8px] sm:text-[9px] font-semibold text-white/50">JP</span>
          </span>
          <span className="inline-flex items-center gap-[2px]">
            <span className={`text-[10px] sm:text-[12px] font-bold tabular-nums ${allHofHit ? 'text-green-400' : 'text-banana'}`}>
              {allHofHit ? '\u2713' : hofRemaining}
            </span>
            <span className="text-[8px] sm:text-[9px] font-semibold text-white/50">HOF</span>
          </span>
        </div>
      </div>
    </Tooltip>
  );
}
