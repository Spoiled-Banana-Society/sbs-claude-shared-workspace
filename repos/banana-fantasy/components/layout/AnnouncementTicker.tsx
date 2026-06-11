'use client';

/**
 * AnnouncementTicker — thin scrolling "stock ticker" strip pinned at the very
 * top of a page (Boris 2026-06-10). Reusable for any announcement; the first
 * use is Founder Draft day: visible to EVERY user (logged in or not) from
 * 5 AM PT on event day, gone the moment the event starts.
 *
 * Apple-clean: 28px tall, dark glass, banana accent hairline, soft seamless
 * marquee (content duplicated so the loop never jumps).
 */

import React from 'react';
import { useFounderSchedule } from '@/hooks/useFounderSchedule';

// 6 PM event − 5 AM same day = 13h announcement window.
const SHOW_BEFORE_MS = 13 * 3600_000;

function eventTimeLabelPT(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: undefined, timeZone: 'America/Los_Angeles' }) + ' PT';
}

export function AnnouncementTicker() {
  const { schedule, loaded } = useFounderSchedule();
  const [, setTick] = React.useState(0);

  // Re-evaluate visibility each minute so it appears/disappears on time
  // without a reload (e.g. tab left open across 6 PM).
  React.useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  if (!loaded || !schedule.active || !schedule.at) return null;
  const eventMs = Date.parse(schedule.at);
  if (!Number.isFinite(eventMs)) return null;
  const now = Date.now();
  if (now < eventMs - SHOW_BEFORE_MS || now >= eventMs) return null;

  const timeLabel = eventTimeLabelPT(schedule.at);
  const message = `FOUNDER DRAFT TODAY · ${timeLabel} · Draft with the Vag Bros · Paid entries win a Free Banana Spin + the Founders badge`;
  // Repeat so the marquee loop is seamless at any viewport width.
  const strip = Array(4).fill(message).join('   ✦   ');

  return (
    <div
      className="relative w-full overflow-hidden select-none"
      style={{
        height: 28,
        background: 'rgba(12,12,16,0.92)',
        borderBottom: '1px solid rgba(251,191,36,0.35)',
        backdropFilter: 'blur(8px)',
      }}
      aria-label="announcement"
    >
      <div
        className="absolute whitespace-nowrap will-change-transform"
        style={{
          top: '50%',
          transform: 'translateY(-50%)',
          animation: 'sbs-ticker 38s linear infinite',
          fontSize: 11.5,
          fontWeight: 600,
          letterSpacing: '0.08em',
          color: '#fbbf24',
        }}
      >
        {strip}   ✦   {strip}
      </div>
      <style>{`
        @keyframes sbs-ticker {
          0% { transform: translate(0, -50%); }
          100% { transform: translate(-50%, -50%); }
        }
      `}</style>
    </div>
  );
}
