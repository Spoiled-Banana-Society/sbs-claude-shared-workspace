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
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!loaded || !schedule.active || !schedule.at) return null;

  const eventMs = Date.parse(schedule.at);
  if (!Number.isFinite(eventMs)) return null;

  const diff = eventMs - now;
  // Show only BEFORE the event (24h out → 0:00:00). The moment the clock hits
  // the start time we pull the banner — once the founders' draft fills it's too
  // late to join, so we never leave a misleading "join now" up after the time.
  // The countdown reaching 0:00:00 IS the go signal.
  const showUntil = SHOW_WITHIN_HOURS * 3600_000;
  if (diff <= 0 || diff > showUntil) return null;

  const isImminent = diff <= 60_000; // last minute — red urgency

  // Always derive the label from the real event time so it can never disagree
  // with the countdown. Say "today" when the event is on the current day.
  const eventDate = new Date(eventMs);
  const isToday = eventDate.toDateString() === new Date(now).toDateString();
  const timeLabel = eventDate.toLocaleString(undefined, {
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
  const fullLabel = eventDate.toLocaleString(undefined, {
    weekday: 'long', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
  const headline = isToday
    ? `Founder Draft today · ${timeLabel}`
    : `Next Founder Draft: ${fullLabel}`;

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
            {/* Info (i) — full how-it-works details */}
            <button
              type="button"
              onClick={() => setShowInfo((v) => !v)}
              aria-label="How Founder Drafts work"
              aria-expanded={showInfo}
              className="w-5 h-5 rounded-full border flex items-center justify-center text-[11px] font-bold leading-none transition-colors hover:bg-white/10"
              style={{ borderColor: `${FOUNDER_CYAN}88`, color: FOUNDER_CYAN }}
            >
              i
            </button>
            {isImminent && (
              <span className="text-[11px] uppercase tracking-wider font-bold text-red-400 animate-pulse">
                ● Starting now — get ready
              </span>
            )}
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-white">{headline}</h2>
          <p className="text-xs sm:text-sm text-white/60 mt-1">
            Happens every week at this time. The second the clock hits
            <span className="text-white font-mono"> 0:00:00</span>, hit <span className="text-white font-medium">Join Draft</span>. You won&apos;t know
            yet — <span className="text-white">once your draft fills</span>, the founders + the <span className="font-semibold" style={{ color: FOUNDER_CYAN }}>FOUNDER</span> sticker
            appear if you landed in the right one. No sticker once it&apos;s full = you joined a different draft and missed it. Paid entries in the founder&apos;s draft earn a free spin + a shot at skipping the playoffs.
          </p>
        </div>

        <div className="text-right">
          <div className="text-[11px] uppercase tracking-widest text-white/50">Starts in</div>
          <div
            className="font-mono font-bold text-2xl sm:text-3xl"
            style={{ color: isImminent ? '#ef4444' : FOUNDER_CYAN }}
          >
            {formatCountdown(diff)}
          </div>
        </div>
      </div>

      {/* How it works — full detail, toggled by the (i) */}
      {showInfo && (
        <div
          className="mt-4 pt-4 border-t text-xs sm:text-sm text-white/75 space-y-3 leading-relaxed"
          style={{ borderColor: `${FOUNDER_CYAN}33` }}
        >
          <div>
            <span className="font-semibold text-white">How to get in.</span> There&apos;s no special room —
            at exactly the start time, jump into a draft. Drafts fill fast in the rush, and only the one
            the founders actually land in counts. You won&apos;t know the moment you join —
            <span className="text-white"> once your draft fills (all 10 seats)</span>, the founders and the
            <span className="font-semibold" style={{ color: FOUNDER_CYAN }}> FOUNDER</span> sticker show up if you
            landed in the right one (they&apos;re hidden while it&apos;s still filling). <span className="text-white">If they&apos;re
            not there once it&apos;s full, you joined a different draft and missed it this week</span> — try again next week.
          </div>
          <div>
            <span className="font-semibold text-white">Free Spin + Founders badge.</span> Everyone who enters
            the Founder Draft with a <span className="font-semibold text-white">paid</span> pass gets a Free
            Banana Spin (added straight to your wheel) and unlocks the exclusive Founders badge. Free entries
            are welcome in the draft — they just don&apos;t earn the rewards.
          </div>
          <div>
            <span className="font-semibold text-white">Skip the playoffs.</span> If your team outscores the
            founder&apos;s team over the regular season (weeks 1–14), you&apos;re entered into a draw against
            everyone who beat the founder across all Founder leagues. One winner is picked at random to
            <span className="font-semibold text-white"> skip straight to the finals</span>.
          </div>
        </div>
      )}
    </section>
  );
}
