'use client';

import React from 'react';
import { SLOT_STATS_HISTORY } from '@/data/slot-stats-history';

/** Slot history — what this team-position slot actually scored the past
 *  3 seasons (weeks 1-17, SBS scoring). Four equal centered columns; rank
 *  is within the same slot group only (WR1 vs WR1s, RB2 vs RB2s).
 *  Shared by the Draft tab and Queue tab player expansions. */
export function SlotHistoryTable({ playerId }: { playerId: string }) {
  const history = SLOT_STATS_HISTORY[playerId];
  if (!history) return null;

  return (
    <div style={{ width: 304, maxWidth: '95%', paddingBottom: 14 }}>
      <div style={{ display: 'flex', paddingBottom: 4 }}>
        <div style={{ flex: 1 }} />
        <div style={{ flex: 1, textAlign: 'center', color: '#555', fontSize: 9, fontWeight: 'bold', letterSpacing: 1 }}>
          AVG / WK
        </div>
        <div style={{ flex: 1, textAlign: 'center', color: '#555', fontSize: 9, fontWeight: 'bold', letterSpacing: 1 }}>
          TOTAL
        </div>
        <div style={{ flex: 1, textAlign: 'center', color: '#555', fontSize: 9, fontWeight: 'bold', letterSpacing: 1 }}>
          RANK
        </div>
      </div>
      {['2025', '2024', '2023'].map(season => {
        const s = history[season];
        if (!s) return null;
        return (
          <div key={season} style={{ display: 'flex', alignItems: 'baseline', padding: '7px 0', borderTop: '1px solid #16161c' }}>
            <div style={{ flex: 1, textAlign: 'center', fontWeight: 'bold', fontSize: 14, color: '#9ca3af' }}>
              {season}
            </div>
            <div style={{ flex: 1, textAlign: 'center', color: '#fff', fontWeight: 'bold', fontSize: 17 }}>
              {s.avg}
            </div>
            <div style={{ flex: 1, textAlign: 'center', color: '#fff', fontWeight: 'bold', fontSize: 17 }}>
              {s.total}
            </div>
            <div style={{ flex: 1, textAlign: 'center', color: '#fff', fontWeight: 'bold', fontSize: 17 }}>
              {s.rank}
            </div>
          </div>
        );
      })}
    </div>
  );
}
