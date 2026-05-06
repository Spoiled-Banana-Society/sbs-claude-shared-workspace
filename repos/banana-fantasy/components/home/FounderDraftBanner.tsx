'use client';

import React, { useEffect, useState } from 'react';
import { useFounderSchedule } from '@/hooks/useFounderSchedule';

// Homepage hero banner for the next Founder Draft event. Shows a live
// countdown when the schedule is active and the event is within 24 hours.
// Hides at all other times so the rest of the homepage doesn't get
// crowded with a perpetually-quiet banner.

const FOUNDER_CYAN = '#06b6d4';
const SHOW_WITHIN_HOURS = 24;

function formatCountdown(ms: number): string {
  if (ms <= 0) return '0:00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export function FounderDraftBanner() {
  const { schedule, loaded } = useFounderSchedule();
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!loaded || !schedule.active || !schedule.at) return null;

  const eventMs = Date.parse(schedule.at);
  if (!Number.isFinite(eventMs)) return null;

  const diff = eventMs - now;
  // Show within 24h before, and for the duration of the window after start.
  const windowMs = Math.max(0, schedule.windowMinutes) * 60_000;
  const showFrom = -windowMs;
  const showUntil = SHOW_WITHIN_HOURS * 3600_000;
  if (diff < showFrom || diff > showUntil) return null;

  const isLive = diff <= 0 && diff >= showFrom;
  const isImminent = diff > 0 && diff <= 60_000; // last minute
  const dateLabel = schedule.dayLabel || new Date(eventMs).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });

  return (
    <section
      className="mb-6 rounded-2xl px-5 py-4 sm:px-6 sm:py-5 relative overflow-hidden"
      style={{
        background: `linear-gradient(135deg, ${FOUNDER_CYAN}22 0%, ${FOUNDER_CYAN}05 60%, transparent 100%)`,
        border: `1px solid ${FOUNDER_CYAN}55`,
      }}
    >
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span
              className="text-[10px] uppercase tracking-widest font-black px-2 py-0.5 rounded-full"
              style={{ background: FOUNDER_CYAN, color: '#000' }}
            >
              Founder Draft
            </span>
            {isLive && (
              <span className="text-[11px] uppercase tracking-wider font-bold text-red-400 animate-pulse">
                ● Live now — join immediately
              </span>
            )}
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-white">
            {isLive
              ? 'Founder Draft is live — join now to qualify'
              : `Next Founder Draft: ${dateLabel}`}
          </h2>
          <p className="text-xs sm:text-sm text-white/60 mt-1">
            Happens every week at this time. Click <span className="text-white font-medium">Join Draft</span> the second the clock hits
            <span className="text-white font-mono"> 0:00:00</span>. Everyone in the draft with the founder
            earns a free spin + a shot at skipping playoffs.
          </p>
        </div>

        {!isLive && (
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-widest text-white/50">Starts in</div>
            <div
              className="font-mono font-bold text-2xl sm:text-3xl"
              style={{ color: isImminent ? '#ef4444' : FOUNDER_CYAN }}
            >
              {formatCountdown(diff)}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
