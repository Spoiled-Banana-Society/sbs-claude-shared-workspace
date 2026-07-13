'use client';

// Ticker preview (TEMP — safe to delete). Compare the two modes.

import { AnnouncementTicker } from '@/components/layout/AnnouncementTicker';

export default function TestTicker() {
  return (
    <div style={{ background: '#0a0a0f', minHeight: '100vh' }}>
      <AnnouncementTicker mode="static" previewMessage="Founder Draft today · 6 PM PT — paid entries win a Free Banana Spin" />
      <div style={{ padding: '40px 24px', maxWidth: 900, margin: '0 auto' }}>
        <h1 style={{ color: '#fff', fontSize: 22, fontWeight: 800 }}>Announcement strip — pick a mode</h1>
        <p style={{ color: '#9ca3af', fontSize: 13 }}>Top of page = OPTION 1 (static, recommended): no motion, centered, whole bar clickable → opens the Founder Draft FAQ. Below = day-before copy, then OPTION 2 (marquee, much slower + typographic rhythm).</p>

        <h2 style={{ color: '#fbbf24', fontSize: 14, marginTop: 30 }}>Option 1 — static, day-before copy</h2>
        <div style={{ marginTop: 10, border: '1px solid rgba(255,255,255,.1)', borderRadius: 12, overflow: 'hidden' }}>
          <AnnouncementTicker mode="static" previewMessage="Founder Draft tomorrow · Wed 6 PM PT — paid entries win a Free Banana Spin" />
          <div style={{ height: 90, background: 'linear-gradient(180deg,#101016,#0a0a0f)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#374151', fontSize: 13 }}>(page content)</div>
        </div>

        <h2 style={{ color: '#fbbf24', fontSize: 14, marginTop: 30 }}>Option 2 — marquee, slowed way down</h2>
        <div style={{ marginTop: 10, border: '1px solid rgba(255,255,255,.1)', borderRadius: 12, overflow: 'hidden' }}>
          <AnnouncementTicker mode="marquee" previewMessage="Founder Draft today · 6 PM PT — paid entries win a Free Banana Spin" />
          <div style={{ height: 90, background: 'linear-gradient(180deg,#101016,#0a0a0f)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#374151', fontSize: 13 }}>(page content)</div>
        </div>
      </div>
    </div>
  );
}
