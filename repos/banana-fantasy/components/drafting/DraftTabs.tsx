'use client';

import React from 'react';

export type DraftTab = 'draft' | 'queue' | 'board' | 'roster' | 'chat';

interface DraftTabsProps {
  activeTab: DraftTab;
  onTabChange: (tab: DraftTab) => void;
  queueCount?: number;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

const TABS: { key: DraftTab; label: string }[] = [
  { key: 'draft', label: 'Draft' },
  { key: 'queue', label: 'Queue' },
  { key: 'board', label: 'Board' },
  { key: 'roster', label: 'Roster' },
  { key: 'chat', label: 'Chat' },
];

export function DraftTabs({ activeTab, onTabChange, queueCount = 0, sidebarOpen, onToggleSidebar }: DraftTabsProps) {
  return (
    <div className="relative flex items-center justify-center gap-4 md:gap-10 py-3 font-primary uppercase font-bold" style={{ backgroundColor: '#000' }}>
      {TABS.map(tab => (
        <button
          key={tab.key}
          onClick={() => onTabChange(tab.key)}
          className={`uppercase font-bold text-sm cursor-pointer transition-all ${
            activeTab === tab.key
              ? 'text-[#F3E216] border border-[#F3E216] px-2 rounded'
              : 'text-white'
          }`}
        >
          {tab.label}
          {tab.key === 'queue' && queueCount > 0 ? ` (${queueCount})` : ''}
        </button>
      ))}
      {onToggleSidebar && (
        <button
          onClick={onToggleSidebar}
          className="hidden xl:flex absolute right-4 top-1/2 -translate-y-1/2 items-center justify-center w-8 h-8 rounded-md text-white/55 hover:text-banana hover:bg-banana/10 transition-colors cursor-pointer"
          title={sidebarOpen ? 'Hide panel (⌘\\)' : 'Show panel (⌘\\)'}
          aria-label={sidebarOpen ? 'Hide queue and team panel' : 'Show queue and team panel'}
        >
          {/* Panel/sidebar icon — state-coded (filled right pane = panel
              currently shown; hollow right pane = currently hidden). Same
              visual language as macOS Mail / Finder / Notes sidebar
              toggles. Tooltip carries the full label. */}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
            <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
            <line x1="10" y1="2.5" x2="10" y2="13.5" />
            {sidebarOpen && <rect x="10" y="2.5" width="4.5" height="11" fill="currentColor" opacity="0.35" stroke="none" />}
          </svg>
        </button>
      )}
    </div>
  );
}
