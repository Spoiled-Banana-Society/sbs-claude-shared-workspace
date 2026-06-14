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
        <div className="text-center space-y-2 py-1">
          <p className="font-semibold text-text-primary">Draft {currentDraft} of {batchEnd}</p>
          {!jackpotHit && (
            <p className="text-red-400 text-xs">
              Jackpot must hit in next {draftsLeft} draft{draftsLeft !== 1 ? 's' : ''}!
            </p>
          )}
          {jackpotHit && (
            <p className="text-green-400 text-xs">Jackpot hit this batch!</p>
          )}
          {!allHofHit && (
            <p className="text-banana text-xs">
              {hofRemaining} HOF remaining this batch
            </p>
          )}
          {allHofHit && (
            <p className="text-green-400 text-xs">All 5 HOF hit this batch!</p>
          )}
          <div className="border-t border-bg-elevated pt-2 space-y-1">
            <p className="text-xs">
              <span className="text-red-400 font-semibold">Jackpot</span>{' '}
              <span className="text-text-secondary">&mdash; Win your league &amp; skip to finals</span>
            </p>
            <p className="text-xs">
              <span className="text-banana font-semibold">HOF</span>{' '}
              <span className="text-text-secondary">&mdash; Compete for bonus prizes</span>
            </p>
            <p className="text-text-muted text-xs mt-1">
              1 Jackpot &amp; 5 HOF guaranteed every 100 drafts
            </p>
          </div>
          <div className="border-t border-bg-elevated pt-2">
            {jackpotHit && allHofHit ? (
              <p className="text-banana text-xs font-semibold">
                🔥 All specials hit &mdash; Pick 10 now pays slots 6, 9 &amp; 10!
              </p>
            ) : (
              <p className="text-text-muted text-xs">
                Once all specials are hit, Pick 10 expands to slots 6, 9 &amp; 10 (until next batch)
              </p>
            )}
          </div>
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
