'use client';

import React from 'react';

export type DraftTab = 'draft' | 'queue' | 'board' | 'roster' | 'chat';

interface DraftTabsProps {
  activeTab: DraftTab;
  onTabChange: (tab: DraftTab) => void;
  queueCount?: number;
}

const TABS: { key: DraftTab; label: string }[] = [
  { key: 'draft', label: 'Draft' },
  { key: 'queue', label: 'Queue' },
  { key: 'board', label: 'Board' },
  { key: 'roster', label: 'Roster' },
  { key: 'chat', label: 'Chat' },
];

export function DraftTabs({ activeTab, onTabChange, queueCount = 0 }: DraftTabsProps) {
  return (
    <div className="mx-auto flex items-center justify-center gap-4 md:gap-10 py-3 font-primary uppercase cursor-pointer font-bold" style={{ backgroundColor: '#000' }}>
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
    </div>
  );
}
