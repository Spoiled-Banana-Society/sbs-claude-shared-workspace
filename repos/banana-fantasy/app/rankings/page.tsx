'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { TeamPosition } from '@/types';
import { PositionLimitsPanel } from '@/components/rankings/PositionLimitsPanel';
import { DefaultSortToggle } from '@/components/rankings/DefaultSortToggle';
import { DraftSectionLinks } from '@/components/layout/DraftSectionLinks';
import { useAuth } from '@/hooks/useAuth';
import { Rankings } from '@/utils/api';

// Position color mapping
const getPositionColor = (position: string): string => {
  if (position === 'QB') return '#ef4444'; // Red
  if (position.startsWith('RB')) return '#22c55e'; // Green
  if (position.startsWith('WR')) return '#a855f7'; // Purple
  if (position === 'TE') return '#3b82f6'; // Blue
  if (position === 'DST') return '#f97316'; // Orange
  return '#94a3b8'; // Gray default
};

// Adapt the Go API's RankingsProps shape (playerId/rank/score/stats) into
// the page's TeamPosition shape so the existing row renderer just works.
// Same join key the dev's old draft-web site used: playerId is "TEAM-POS"
// like "DAL-WR1" / "KAN-QB", split into team + position[0..9]+ suffix.
interface GoRankingItem {
  playerId: string;
  rank: number;
  score: number;
  stats: {
    averageScore?: number;
    highestScore?: number;
    top5Finishes?: number;
    adp?: number;
    byeWeek?: string | number;
    playersFromTeam?: string[];
  };
}

function adaptRankingItem(item: GoRankingItem): TeamPosition {
  const [team, ...rest] = item.playerId.split('-');
  const position = rest.join('-') || 'UNK';
  const byeWeekRaw = item.stats?.byeWeek;
  const byeWeek = typeof byeWeekRaw === 'number'
    ? byeWeekRaw
    : Number.parseInt(String(byeWeekRaw ?? ''), 10) || 0;
  const adp = typeof item.stats?.adp === 'number' ? item.stats.adp : 0;
  return {
    id: item.playerId,
    team: team || 'UNK',
    position,
    currentPlayer: item.stats?.playersFromTeam?.[0] || '',
    seasonPoints: item.score ?? 0,
    weeklyPoints: item.stats?.averageScore ?? 0,
    projectedPoints: 0,
    byeWeek,
    adp,
    adpChange: 0,
    depthChart: [],
  };
}

export default function RankingsPage() {
  const { walletAddress } = useAuth();
  const [rankings, setRankings] = useState<TeamPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCsvMenu, setShowCsvMenu] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadedData, setUploadedData] = useState<string[][] | null>(null);
  const [uploadFileName, setUploadFileName] = useState<string>('');
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<TeamPosition | null>(null);
  const [savingRankings, setSavingRankings] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [positionFilter, setPositionFilter] = useState<'ALL' | 'QB' | 'RB' | 'WR' | 'TE' | 'DST'>('ALL');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load rankings from the Go API. ReturnUserRankings auto-seeds from
  // global ADP when the user has no saved doc, so first-time users still
  // see the full list — pre-sorted by ADP — without needing a separate
  // "global rankings" call. The /api/rankings → /league/rankings/global
  // route doesn't exist on the Go side and was always 404ing.
  useEffect(() => {
    if (!walletAddress) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    Rankings.getRankings(walletAddress)
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res) ? (res as GoRankingItem[]) : [];
        const adapted = [...list]
          .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
          .map(adaptRankingItem);
        setRankings(adapted);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load rankings');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [walletAddress]);

  // Persist the current order to the Go API. Fires after every reorder.
  const playerIdFor = (pos: TeamPosition) => pos.id || `${pos.team}-${pos.position}`;
  const persistRankings = (next: TeamPosition[]) => {
    if (!walletAddress) return;
    setSavingRankings(true);
    const payload = {
      ranking: next.map((pos, i) => ({
        playerId: playerIdFor(pos),
        rank: i + 1,
        score: pos.seasonPoints,
      })),
    };
    Rankings.updateRankings(walletAddress, payload)
      .then(() => setSavedAt(Date.now()))
      .catch(() => { /* swallow — UI shows "saving…" indicator */ })
      .finally(() => setSavingRankings(false));
  };

  const [resettingRankings, setResettingRankings] = useState(false);
  const resetRankingsToDefault = async () => {
    if (!walletAddress) return;
    if (!confirm('Reset rankings to ADP order? Your custom order will be lost.')) return;
    setResettingRankings(true);
    try {
      // DELETE the saved doc on the Go side. Next GET auto-seeds from
      // current ADP, which is exactly what we want for "reset to default."
      await Rankings.removeRankings(walletAddress);
      const fresh = await Rankings.getRankings(walletAddress);
      const list = Array.isArray(fresh) ? (fresh as GoRankingItem[]) : [];
      const adapted = [...list]
        .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
        .map(adaptRankingItem);
      setRankings(adapted);
      setSavedAt(Date.now());
    } catch (err) {
      console.error('Failed to reset rankings:', err);
    } finally {
      setResettingRankings(false);
    }
  };

  // Drag and drop handlers
  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDragEnd = () => {
    if (draggedIndex !== null && dragOverIndex !== null && draggedIndex !== dragOverIndex) {
      const newRankings = [...rankings];
      const [draggedItem] = newRankings.splice(draggedIndex, 1);
      newRankings.splice(dragOverIndex, 0, draggedItem);
      setRankings(newRankings);
      persistRankings(newRankings);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  // Move up/down handlers for keyboard accessibility
  const movePosition = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= rankings.length) return;

    const newRankings = [...rankings];
    [newRankings[index], newRankings[newIndex]] = [newRankings[newIndex], newRankings[index]];
    setRankings(newRankings);
    persistRankings(newRankings);
  };

  // CSV Download — clean, editable, re-uploadable. Columns: Rank, Player
  // (e.g. "CIN WR1"), Position (WR1/RB1/TE…), ADP. Edit the Rank column (or
  // reorder rows) and re-upload to set your own order.
  const downloadCSV = () => {
    const headers = ['Rank', 'Player', 'Position', 'ADP'];
    const rows = rankings.map((pos, index) => [
      (index + 1).toString(),
      `${pos.team} ${pos.position}`,
      pos.position,
      pos.adp.toString(),
    ]);
    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `sbs-rankings-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setShowCsvMenu(false);
  };

  // CSV Upload handler
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const rows = text.split(/\r?\n/).map(row =>
        row.split(',').map(cell => cell.replace(/^"|"$/g, '').trim())
      ).filter(row => row.some(cell => cell.length > 0));
      setUploadedData(rows);
      setShowUploadModal(true);
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const [uploadError, setUploadError] = useState<string | null>(null);
  // Apply an uploaded CSV as the user's custom order. The order = the ROW ORDER
  // of the file (top = #1) — that's what reordering rows in Excel/Numbers
  // produces, and it also works if they re-sort by an edited Rank column. We
  // read the team-position from a Player/Name column (e.g. "CIN WR1") to map
  // each row to a slot. Slots missing from the file keep their place at the end.
  const applyUploadedRankings = () => {
    setUploadError(null);
    if (!uploadedData || uploadedData.length < 2) { setUploadError('That file has no rows.'); return; }
    const header = uploadedData[0].map(h => h.toLowerCase().trim());
    const playerIdx = header.findIndex(h => h.includes('player') || h.includes('team position') || h === 'name' || h === 'slot');
    const byKey = new Map(rankings.map(p => [playerIdFor(p).toUpperCase(), p]));
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase().replace(' ', '-'); // "CIN WR1" -> "CIN-WR1"
    const seen = new Set<string>();
    const ordered: TeamPosition[] = [];
    for (const r of uploadedData.slice(1)) {            // row order = rank order
      const key = norm(playerIdx >= 0 ? r[playerIdx] : (r[1] ?? r[0] ?? ''));
      const p = byKey.get(key);
      if (p && !seen.has(key)) { ordered.push(p); seen.add(key); }
    }
    if (ordered.length === 0) {
      setUploadError('Couldn’t match any rows. Keep the "Player" column (e.g. "CIN WR1") from the downloaded file.');
      return;
    }
    for (const p of rankings) { const k = playerIdFor(p).toUpperCase(); if (!seen.has(k)) { ordered.push(p); seen.add(k); } }
    setRankings(ordered);
    persistRankings(ordered);
    setShowUploadModal(false);
    setUploadedData(null);
    setShowCsvMenu(false);
  };

  return (
    <div className="w-full px-4 sm:px-8 lg:px-12 py-8">
      {/* Page Header */}
      <div className="mb-8">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
          <h1 className="text-3xl font-bold text-text-primary">Rankings</h1>
          <DraftSectionLinks active="rankings" />
        </div>
        <p className="text-text-secondary">Draft team positions, not players. Each week you score the highest-scoring player at that position.</p>
      </div>

      <DefaultSortToggle />
      <PositionLimitsPanel />

      {/* CSV Controls + save status */}
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="text-xs text-text-muted">
          {!walletAddress ? (
            <span>Sign in to save your custom rankings.</span>
          ) : savingRankings ? (
            <span className="italic">Saving rankings…</span>
          ) : resettingRankings ? (
            <span className="italic">Resetting to ADP order…</span>
          ) : savedAt ? (
            <span className="text-text-secondary">Rankings saved</span>
          ) : (
            <span>Drag rows or use the arrows to reorder. Auto-saves to your account.</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {walletAddress && (
            <button
              type="button"
              onClick={resetRankingsToDefault}
              disabled={resettingRankings}
              className="text-xs uppercase tracking-wider px-3 py-1.5 rounded-md text-text-muted hover:text-banana hover:bg-white/[0.04] border border-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              Reset to current ADP
            </button>
          )}
        {/* CSV Upload/Download Button */}
        <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleFileUpload} className="hidden" />
        <div className="relative">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setShowCsvMenu(!showCsvMenu)}
            className="flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
            CSV
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${showCsvMenu ? 'rotate-180' : ''}`}>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </Button>

          {/* CSV Dropdown Menu */}
          {showCsvMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowCsvMenu(false)} />
              <div className="absolute right-0 top-full mt-2 w-64 bg-bg-elevated border border-white/10 rounded-xl shadow-xl z-50 overflow-hidden">
                <div className="p-2">
                  <button
                    onClick={downloadCSV}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-white hover:bg-white/5 rounded-lg transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-400">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    <div className="text-left">
                      <div>Download rankings</div>
                      <div className="text-xs text-white/40">Edit in Excel/Numbers, then re-upload</div>
                    </div>
                  </button>
                  <button
                    onClick={() => { setShowCsvMenu(false); fileInputRef.current?.click(); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-white hover:bg-white/5 rounded-lg transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-banana">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/>
                      <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    <div className="text-left">
                      <div>Upload your rankings</div>
                      <div className="text-xs text-white/40">Apply an edited CSV as your order</div>
                    </div>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
        </div>
      </div>

      {/* Rankings — list of stacked cards, 1:1 with the dev's old draft-web
          design (RankingItemComponent.tsx). Each row is its own card with
          position-color borders L+R; drag indicator on the left, playerId
          bold in the middle, BYE / ADP / RANK on the right. */}
      <div className="max-w-[900px] mx-auto">
        {/* Position filter — same shape as the draft-room player list. Hides
            non-matching rows; reorder actions still operate on the full list
            so dragging within a filter preserves the underlying order. */}
        <div className="flex items-center gap-2 flex-wrap mb-2 px-1">
          {(['ALL', 'QB', 'RB', 'WR', 'TE', 'DST'] as const).map(p => {
            const isActive = positionFilter === p;
            const accent = p === 'QB' ? '#FF474C'
              : p === 'RB' ? '#3c9120'
              : p === 'WR' ? '#cb6ce6'
              : p === 'TE' ? '#326cf8'
              : p === 'DST' ? '#DF893E'
              : '#fbbf24';
            return (
              <button
                key={p}
                onClick={() => setPositionFilter(p)}
                className="px-4 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-colors"
                style={{
                  borderWidth: 1,
                  borderStyle: 'solid',
                  borderColor: isActive ? accent : '#333',
                  background: isActive ? `${accent}22` : 'transparent',
                  color: isActive ? '#fff' : '#888',
                }}
              >
                {p}
              </button>
            );
          })}
        </div>

        {/* Heading row — column labels right-aligned to match data rows */}
        <div
          className="hidden sm:flex items-center justify-between gap-5 px-0 pt-2.5 pb-0 mt-5 bg-black"
        >
          <div className="w-[20px] h-[20px]" />
          <div />
          <div className="flex flex-1 justify-end pr-[15px] gap-[15px]">
            <div className="min-w-[40px] text-center">
              <h2 className="text-[12px] font-bold text-[#888] uppercase tracking-wide">BYE</h2>
            </div>
            <div className="min-w-[40px] text-center">
              <h2 className="text-[12px] font-bold text-[#888] uppercase tracking-wide">ADP</h2>
            </div>
            <div className="min-w-[40px] text-center">
              <h2 className="text-[12px] font-bold text-[#888] uppercase tracking-wide">RANK</h2>
            </div>
            <div className="min-w-[60px] text-center">
              <h2 className="text-[12px] font-bold text-[#888] uppercase tracking-wide">MOVE</h2>
            </div>
          </div>
        </div>

        {!walletAddress && !loading ? (
          <div className="px-6 py-12 text-center text-text-muted text-sm">
            Sign in to load and customize your rankings.
          </div>
        ) : loading ? (
          <div className="px-6 py-12 text-center text-text-muted text-sm">
            Loading rankings…
          </div>
        ) : loadError ? (
          <div className="px-6 py-12 text-center text-red-400 text-sm">
            Failed to load rankings: {loadError}
          </div>
        ) : rankings.length === 0 ? (
          <div className="px-6 py-12 text-center text-text-muted text-sm">
            No rankings available yet.
          </div>
        ) : (
          rankings.map((position, index) => {
            // Filter purely visual — non-matching rows aren't rendered, but
            // index is still the full-list index so drag/move ops apply
            // correctly across hidden rows.
            if (positionFilter !== 'ALL') {
              const basePos = position.position.replace(/[0-9]/g, '');
              if (basePos !== positionFilter) return null;
            }
            const color = getPositionColor(position.position);
            return (
              <div
                key={position.id}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                onClick={() => setSelectedPosition(position)}
                className={`
                  group cursor-grab active:cursor-grabbing transition-all
                  ${draggedIndex === index ? 'opacity-50' : ''}
                  ${dragOverIndex === index && draggedIndex !== index ? 'translate-y-[1px]' : ''}
                `}
                style={{
                  background: '#000',
                  margin: '20px auto 10px auto',
                  padding: '10px 0',
                  borderLeft: `2px solid ${color}`,
                  borderRight: `2px solid ${color}`,
                  borderTop: '1px solid #222',
                  borderBottom: '1px solid #222',
                }}
              >
                <div className="flex flex-row items-center justify-between gap-5">
                  {/* Drag handle */}
                  <div className="w-[20px] h-[20px] relative ml-[7px]">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="text-white/40 hidden group-hover:block absolute left-0 top-[3px]"
                    >
                      <circle cx="9" cy="5" r="1.5" />
                      <circle cx="9" cy="12" r="1.5" />
                      <circle cx="9" cy="19" r="1.5" />
                      <circle cx="15" cy="5" r="1.5" />
                      <circle cx="15" cy="12" r="1.5" />
                      <circle cx="15" cy="19" r="1.5" />
                    </svg>
                  </div>

                  {/* PlayerId */}
                  <div className="font-primary font-bold text-white text-[18px]">
                    {position.id || `${position.team}-${position.position}`}
                  </div>

                  {/* Right side: BYE / ADP / RANK / MOVE */}
                  <div className="flex flex-1 flex-row justify-end pr-[15px] gap-[15px] items-center">
                    <div className="min-w-[40px] text-center">
                      <div className="text-white font-bold">{position.byeWeek || '—'}</div>
                    </div>
                    <div className="min-w-[40px] text-center">
                      <div className="text-white font-bold">{position.adp === 0 ? 'N/A' : position.adp}</div>
                    </div>
                    <div className="min-w-[40px] text-center">
                      <div className="text-banana font-bold">{index + 1}</div>
                    </div>
                    <div
                      className="min-w-[60px] flex items-center justify-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => movePosition(index, 'up')}
                        disabled={index === 0}
                        className={`p-1 rounded transition-colors ${
                          index === 0
                            ? 'text-white/10 cursor-not-allowed'
                            : 'text-white/40 hover:text-white hover:bg-white/10'
                        }`}
                        aria-label="Move up"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="18 15 12 9 6 15" />
                        </svg>
                      </button>
                      <button
                        onClick={() => movePosition(index, 'down')}
                        disabled={index === rankings.length - 1}
                        className={`p-1 rounded transition-colors ${
                          index === rankings.length - 1
                            ? 'text-white/10 cursor-not-allowed'
                            : 'text-white/40 hover:text-white hover:bg-white/10'
                        }`}
                        aria-label="Move down"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* CSV Upload Preview Modal */}
      <Modal
        isOpen={showUploadModal}
        onClose={() => {
          setShowUploadModal(false);
          setUploadedData(null);
        }}
        title="Import Team Position Rankings"
        size="lg"
      >
        {uploadedData && (
          <div className="space-y-4">
            {/* File Info */}
            <div className="flex items-center gap-3 p-3 bg-banana/10 rounded-lg border border-banana/20">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-banana">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              <div>
                <p className="text-white font-medium">{uploadFileName}</p>
                <p className="text-white/50 text-sm">{uploadedData.length} rows detected</p>
              </div>
            </div>

            {/* Preview Table */}
            <div>
              <p className="text-white/50 text-sm mb-2">Preview (first 5 rows):</p>
              <div className="overflow-x-auto rounded-lg border border-white/10">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-white/5">
                      {uploadedData[0]?.map((header, i) => (
                        <th key={i} className="px-3 py-2 text-left text-white/60 font-medium">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {uploadedData.slice(1, 6).map((row, rowIndex) => (
                      <tr key={rowIndex} className="border-t border-white/5">
                        {row.map((cell, cellIndex) => (
                          <td key={cellIndex} className="px-3 py-2 text-white/80">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {uploadedData.length > 6 && (
                <p className="text-white/40 text-xs mt-2">
                  + {uploadedData.length - 6} more rows
                </p>
              )}
            </div>

            {uploadError && (
              <p className="text-error text-sm">{uploadError}</p>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setShowUploadModal(false);
                  setUploadedData(null);
                  setUploadError(null);
                }}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={applyUploadedRankings}
                className="flex-1"
              >
                Apply Rankings
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Depth Chart Modal */}
      <Modal
        isOpen={!!selectedPosition}
        onClose={() => setSelectedPosition(null)}
        title={selectedPosition ? `${selectedPosition.team} ${selectedPosition.position} Depth Chart` : ''}
        size="md"
      >
        {selectedPosition && (
          <div className="space-y-4">
            {/* Position Stats Summary */}
            <div className="grid grid-cols-4 gap-3 p-4 bg-bg-tertiary rounded-xl">
              <div className="text-center">
                <p className="text-text-muted text-xs uppercase tracking-wider mb-1">BYE</p>
                <p className="text-text-primary font-bold text-xl">{selectedPosition.byeWeek}</p>
              </div>
              <div className="text-center">
                <p className="text-text-muted text-xs uppercase tracking-wider mb-1">ADP</p>
                <div className="flex items-center justify-center gap-1">
                  <p className="text-text-primary font-bold text-xl">{selectedPosition.adp}</p>
                  {selectedPosition.adpChange !== 0 && (
                    <span className={`text-sm font-medium flex items-center ${
                      selectedPosition.adpChange > 0 ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {selectedPosition.adpChange > 0 ? `+${selectedPosition.adpChange}` : selectedPosition.adpChange}
                    </span>
                  )}
                </div>
              </div>
              <div className="text-center">
                <p className="text-text-muted text-xs uppercase tracking-wider mb-1">Season</p>
                <p className="text-banana font-bold text-xl">{selectedPosition.seasonPoints.toFixed(1)}</p>
              </div>
              <div className="text-center">
                <p className="text-text-muted text-xs uppercase tracking-wider mb-1">Projected</p>
                <p className="text-text-secondary font-bold text-xl">{selectedPosition.projectedPoints.toFixed(1)}</p>
              </div>
            </div>

            {/* Depth Chart Players */}
            <div>
              <h4 className="text-sm font-medium text-text-muted uppercase tracking-wider mb-1">Projected Scoring Order</h4>
              <p className="text-text-muted text-xs mb-3">Ranked by projected points · You score the top performer each week</p>
              <div className="space-y-2">
                {(() => {
                  // Sort by projected points, injured players at bottom
                  const sorted = [...selectedPosition.depthChart].sort((a, b) => {
                    if (a.status === 'injured' && b.status !== 'injured') return 1;
                    if (b.status === 'injured' && a.status !== 'injured') return -1;
                    return b.projectedPoints - a.projectedPoints;
                  });
                  // Get base position without number (WR1 -> WR, RB2 -> RB)
                  const basePos = selectedPosition.position.replace(/[0-9]/g, '');
                  // Track position number for non-injured
                  let posRank = 0;

                  return sorted.map((player, index) => {
                    const isInjured = player.status === 'injured';
                    if (!isInjured) posRank++;
                    const projLabel = isInjured ? 'OUT' : `Proj ${basePos}${posRank}`;

                    return (
                      <div
                        key={index}
                        className={`flex items-center justify-between p-4 rounded-xl transition-colors ${
                          isInjured
                            ? 'bg-red-500/10 border border-red-500/20 opacity-60'
                            : posRank === 1
                            ? 'bg-banana/10 border border-banana/20'
                            : 'bg-bg-tertiary border border-bg-elevated'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                            isInjured
                              ? 'bg-red-500/20 text-red-400'
                              : posRank === 1
                              ? 'bg-banana/20 text-banana'
                              : 'bg-white/10 text-white/60'
                          }`}>
                            {isInjured ? '—' : posRank}
                          </div>
                          <div>
                            <p className={`font-medium ${isInjured ? 'text-text-muted line-through' : 'text-text-primary'}`}>{player.name}</p>
                            <p className={`text-xs font-medium ${
                              isInjured
                                ? 'text-red-400'
                                : posRank === 1
                                ? 'text-banana'
                                : 'text-text-muted'
                            }`}>
                              {projLabel}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`font-medium ${isInjured ? 'text-text-muted' : 'text-text-primary'}`}>{player.projectedPoints.toFixed(1)}</p>
                          <p className="text-xs text-text-muted">Proj Pts</p>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>

            {/* Close Button */}
            <Button
              variant="ghost"
              onClick={() => setSelectedPosition(null)}
              className="w-full"
            >
              Close
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
