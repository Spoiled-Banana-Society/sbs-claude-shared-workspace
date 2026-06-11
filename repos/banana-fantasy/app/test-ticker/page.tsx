'use client';

// Ticker preview (TEMP — safe to delete). Shows the AnnouncementTicker forced
// visible over a home-like backdrop, in both day-of and day-before copy.

import { AnnouncementTicker } from '@/components/layout/AnnouncementTicker';

export default function TestTicker() {
  return (
    <div style={{ background: '#0a0a0f', minHeight: '100vh' }}>
      <AnnouncementTicker previewMessage="FOUNDER DRAFT TODAY · 6 PM PT · Draft with the Vag Bros · Paid entries win a Free Banana Spin + the Founders badge" />
      <div style={{ padding: '40px 24px', maxWidth: 900, margin: '0 auto' }}>
        <h1 style={{ color: '#fff', fontSize: 22, fontWeight: 800 }}>Ticker preview</h1>
        <p style={{ color: '#9ca3af', fontSize: 13 }}>Top strip = day-of copy, exactly as it renders on home + drafting. Below = the day-before variant.</p>
        <div style={{ marginTop: 28, border: '1px solid rgba(255,255,255,.1)', borderRadius: 12, overflow: 'hidden' }}>
          <AnnouncementTicker previewMessage="FOUNDER DRAFT TOMORROW · Wednesday 6 PM PT · Draft with the Vag Bros · Paid entries win a Free Banana Spin + the Founders badge" />
          <div style={{ height: 120, background: 'linear-gradient(180deg,#101016,#0a0a0f)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#374151', fontSize: 13 }}>
            (page content)
          </div>
        </div>
      </div>
    </div>
  );
}
