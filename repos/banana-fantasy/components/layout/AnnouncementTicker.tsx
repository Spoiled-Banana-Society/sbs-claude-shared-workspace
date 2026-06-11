'use client';

/**
 * AnnouncementTicker — thin announcement strip pinned at the top of a page
 * (Boris 2026-06-10). First use: Founder Draft day, visible to EVERY user.
 *
 * Two modes:
 *  - "static" (default): Apple-style — centered one-liner, no motion.
 *    Clickable → /faq#founder-draft for the full how-it-works.
 *  - "marquee": slow scroll, kept for preview/comparison.
 */

import React from 'react';
import { useRouter } from 'next/navigation';
import { useFounderSchedule } from '@/hooks/useFounderSchedule';

// 6 PM event − 5 AM same day = 13h announcement window.
const SHOW_BEFORE_MS = 13 * 3600_000;

function eventTimeLabelPT(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', timeZone: 'America/Los_Angeles' }) + ' PT';
}

interface Props {
  previewMessage?: string;
  mode?: 'static' | 'marquee';
}

export function AnnouncementTicker({ previewMessage, mode = 'static' }: Props = {}) {
  const { schedule, loaded } = useFounderSchedule();
  const router = useRouter();
  const [, setTick] = React.useState(0);

  // Re-evaluate visibility each minute so it appears/disappears on time.
  React.useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  let lead = '';
  let rest = '';
  if (previewMessage) {
    const [a, ...b] = previewMessage.split('·');
    lead = a.trim();
    rest = b.join('·').trim();
  } else {
    if (!loaded || !schedule.active || !schedule.at) return null;
    const eventMs = Date.parse(schedule.at);
    if (!Number.isFinite(eventMs)) return null;
    const now = Date.now();
    if (now < eventMs - SHOW_BEFORE_MS || now >= eventMs) return null;
    lead = 'Founder Draft today';
    rest = `${eventTimeLabelPT(schedule.at)} — paid entries win a Free Banana Spin`;
  }

  const open = () => router.push('/faq#founder-draft');

  if (mode === 'marquee') {
    const message = `${lead} · ${rest}`;
    const strip = Array(3).fill(message).join('      ✦      ');
    return (
      <div
        onClick={open}
        className="relative w-full overflow-hidden select-none cursor-pointer"
        style={{ height: 28, background: 'rgba(12,12,16,0.92)', borderBottom: '1px solid rgba(251,191,36,0.3)', backdropFilter: 'blur(8px)' }}
      >
        <div
          className="absolute whitespace-nowrap will-change-transform"
          style={{ top: '50%', transform: 'translateY(-50%)', animation: 'sbs-ticker 90s linear infinite', fontSize: 12 }}
        >
          <Spans lead={lead} rest={rest} strip={strip} />
        </div>
        <style>{`@keyframes sbs-ticker { 0% { transform: translate(0, -50%); } 100% { transform: translate(-50%, -50%); } }`}</style>
      </div>
    );
  }

  // STATIC (default): centered one-liner, no motion, whole bar clickable.
  return (
    <button
      type="button"
      onClick={open}
      className="block w-full text-center select-none cursor-pointer hover:brightness-110 transition-all"
      style={{
        height: 32,
        lineHeight: '32px',
        background: 'rgba(12,12,16,0.92)',
        borderBottom: '1px solid rgba(251,191,36,0.3)',
        backdropFilter: 'blur(8px)',
        fontSize: 12.5,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        padding: '0 12px',
      }}
    >
      <span style={{ color: '#fbbf24', fontWeight: 700 }}>{lead}</span>
      <span style={{ color: 'rgba(255,255,255,0.65)', fontWeight: 400 }}> · {rest} </span>
      <span style={{ color: '#fbbf24', fontWeight: 600 }}>Learn more ›</span>
    </button>
  );
}

function Spans({ lead, rest, strip }: { lead: string; rest: string; strip: string }) {
  // Marquee variant keeps typographic rhythm: lead bold banana, rest muted.
  const parts = strip.split('      ✦      ');
  return (
    <>
      {parts.map((_, i) => (
        <React.Fragment key={i}>
          <span style={{ color: '#fbbf24', fontWeight: 700 }}>{lead}</span>
          <span style={{ color: 'rgba(255,255,255,0.6)' }}> · {rest}</span>
          <span style={{ color: 'rgba(251,191,36,0.45)' }}>      ✦      </span>
        </React.Fragment>
      ))}
    </>
  );
}
