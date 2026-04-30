'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { DraftBoardGrid } from '@/components/drafting/DraftBoardGrid';
import { POSITION_COLORS, TOTAL_PICKS, TOTAL_ROUNDS } from '@/lib/draftRoomConstants';
import type { DraftSummarySlot } from '@/hooks/useDraftEngine';
import type { DraftInfoResponse, DraftSummary, RosterState } from '@/lib/draftApi';

const POLL_INTERVAL_MS = 2000;

interface SpectateState {
  draftId: string;
  info: DraftInfoResponse;
  summary: DraftSummary;
  rosters: RosterState;
}

function snakeDrafterIndex(pick: number): number {
  const round = Math.ceil(pick / 10);
  const posInRound = (pick - 1) % 10;
  return round % 2 === 1 ? posInRound : 9 - posInRound;
}

function shortAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr || '???';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function levelToType(level: string | null | undefined): 'jackpot' | 'hof' | 'pro' | null {
  if (!level) return null;
  const l = level.toLowerCase();
  if (l.includes('jackpot')) return 'jackpot';
  if (l.includes('hall of fame') || l === 'hof') return 'hof';
  if (l.includes('pro')) return 'pro';
  return null;
}

export default function SpectatePage() {
  const params = useParams();
  const draftId = (params?.draftId as string) || '';
  const [state, setState] = useState<SpectateState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const bannerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!draftId) return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const res = await fetch(`/api/spectate/draft-state?draftId=${encodeURIComponent(draftId)}`);
        if (!res.ok) {
          throw new Error(`${res.status} ${res.statusText}`);
        }
        const data = (await res.json()) as SpectateState;
        if (cancelled) return;
        setState(data);
        setError(null);
        setLastUpdated(Date.now());
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'unknown error');
      } finally {
        if (!cancelled) timeoutId = setTimeout(tick, POLL_INTERVAL_MS);
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [draftId]);

  // Tick a clock so the countdown animates between polls.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  // Auto-scroll the banner to keep the active pick visible. Mirrors the
  // live draft-room behavior where the banner re-centers on each new pick.
  useEffect(() => {
    if (!state || !bannerRef.current) return;
    const el = bannerRef.current.querySelector(`[data-pick="${state.info.pickNumber}"]`);
    if (el) {
      (el as HTMLElement).scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [state]);

  // Build a 150-slot snake-ordered draft summary for DraftBoardGrid.
  // Pre-fill empty slots, then overlay actual picks from the Go API.
  const { draftSummary, currentDrafterIndex, picksMade, draftOrderNames } = useMemo(() => {
    if (!state) return { draftSummary: [] as DraftSummarySlot[], currentDrafterIndex: -1, picksMade: 0, draftOrderNames: [] as string[] };
    const order = state.info.draftOrder ?? [];
    const orderNames = order.map(o => shortAddr(o.ownerId));
    const slots: DraftSummarySlot[] = [];
    for (let pick = 1; pick <= TOTAL_PICKS; pick++) {
      const round = Math.ceil(pick / 10);
      const idx = snakeDrafterIndex(pick);
      slots.push({
        pickNum: pick,
        round,
        ownerName: orderNames[idx] ?? '',
        ownerIndex: idx,
        playerId: '',
        position: '',
        team: '',
      });
    }
    let madeCount = 0;
    for (const item of state.summary) {
      const p = item.playerInfo;
      if (!p?.playerId || !p.pickNum) continue;
      const slot = slots[p.pickNum - 1];
      if (!slot) continue;
      slot.playerId = p.playerId;
      slot.position = p.position;
      slot.team = p.team;
      madeCount++;
    }
    const currentIdx = order.findIndex(o => o.ownerId?.toLowerCase() === (state.info.currentDrafter || '').toLowerCase());
    return { draftSummary: slots, currentDrafterIndex: currentIdx, picksMade: madeCount, draftOrderNames: orderNames };
  }, [state]);

  if (!draftId) {
    return (
      <div className="min-h-screen bg-bg-primary text-text-primary flex items-center justify-center p-6">
        <p>No draft ID in URL.</p>
      </div>
    );
  }

  if (!state && !error) {
    return (
      <div className="min-h-screen bg-bg-primary text-text-primary flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-lg">Loading spectator view…</p>
          <p className="text-xs text-text-muted mt-2 font-mono">{draftId}</p>
        </div>
      </div>
    );
  }

  if (error && !state) {
    return (
      <div className="min-h-screen bg-bg-primary text-text-primary flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-lg text-red-400">Failed to load draft</p>
          <p className="text-sm text-text-muted mt-2">{error}</p>
          <p className="text-xs text-text-muted mt-2 font-mono">{draftId}</p>
        </div>
      </div>
    );
  }

  const info = state!.info;
  const draftType = levelToType(info.displayName?.includes('Jackpot') ? 'Jackpot' : null);
  const speed = draftId.includes('-fast-') ? 'fast' : draftId.includes('-slow-') ? 'slow' : '';
  const pickEndTime = info.currentPickEndTime ? info.currentPickEndTime * 1000 : null;
  const remainingMs = pickEndTime ? Math.max(0, pickEndTime - now) : null;
  const remainingSec = remainingMs !== null ? Math.ceil(remainingMs / 1000) : null;
  const formatTime = (s: number): string => {
    if (s >= 3600) {
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      return `${h}h ${m}m`;
    }
    if (s >= 60) {
      const m = Math.floor(s / 60);
      const sec = s % 60;
      return `${m}:${sec.toString().padStart(2, '0')}`;
    }
    return `${s}s`;
  };

  const isFilling = picksMade === 0 && (info.pickNumber ?? 0) === 0;
  const isDone = picksMade >= TOTAL_PICKS;

  const accentColor =
    draftType === 'jackpot' ? POSITION_COLORS.QB // red
      : draftType === 'hof' ? '#D4AF37'
      : '#a855f7';

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary font-primary">
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/10 bg-bg-secondary">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-3">
              {info.displayName || draftId}
              {draftType && (
                <span
                  className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full font-black"
                  style={{ background: accentColor, color: '#000' }}
                >
                  {draftType}
                </span>
              )}
              {speed && (
                <span className="text-[10px] uppercase tracking-widest text-text-muted">{speed}</span>
              )}
            </h1>
            <p className="text-xs text-text-muted mt-1 font-mono">{draftId}</p>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-widest text-text-muted">Spectator</div>
            <div className="text-xs text-text-muted">
              {lastUpdated ? `updated ${Math.max(0, Math.floor((now - lastUpdated) / 1000))}s ago` : 'connecting…'}
              {error && <span className="ml-2 text-yellow-400">last poll: {error}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Banner: horizontal scroll of all 150 slot tiles, 1:1 with the
          live DraftRoomDrafting banner. Active pick highlighted with
          countdown + "Picking..."; past picks show the playerId; future
          picks show R/P + the assigned drafter's roster counts. */}
      <div className="w-full overflow-hidden bg-black">
        <div ref={bannerRef} className="w-full flex gap-2 lg:gap-5 overflow-x-auto banner-no-scrollbar" style={{ marginTop: '15px' }}>
          {draftSummary.map((slot) => {
            const isPicked = slot.playerId !== '';
            const isCurrent = slot.pickNum === info.pickNumber && !isDone;
            const isUpcoming = slot.pickNum > info.pickNumber;
            const posHex = isPicked ? POSITION_COLORS[slot.position.replace(/[0-9]/g, '')] || '#888' : '';
            const ownerName = slot.ownerName || draftOrderNames[slot.ownerIndex] || '';
            const counts = (() => {
              const raw = state!.rosters[ownerName.toLowerCase()] || state!.rosters[ownerName] || {};
              return {
                QB: (raw as Record<string, string[]>).QB?.length ?? 0,
                RB: (raw as Record<string, string[]>).RB?.length ?? 0,
                WR: (raw as Record<string, string[]>).WR?.length ?? 0,
                TE: (raw as Record<string, string[]>).TE?.length ?? 0,
                DST: (raw as Record<string, string[]>).DST?.length ?? 0,
              };
            })();
            const truncated = ownerName.length > 14 ? `${ownerName.slice(0, 6)}…${ownerName.slice(-4)}` : ownerName;
            const borderColor = isCurrent ? '#fff' : '#444';
            const textColor = '#fff';
            return (
              <div
                key={slot.pickNum}
                data-pick={slot.pickNum}
                className="flex-shrink-0 text-center overflow-hidden"
                style={{
                  minWidth: 'clamp(100px, 12vw, 140px)',
                  flex: 1,
                  padding: '10px 0 0 0',
                  borderRadius: '5px',
                  borderWidth: 1,
                  borderStyle: 'solid',
                  borderColor,
                  transition: 'all 0.25s ease-in-out',
                  background: '#222',
                }}
              >
                <div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/banana-profile.png" alt="" className="rounded-full w-[30px] mx-auto h-[30px] border border-gray-500" />

                  {isCurrent ? (
                    <div style={{
                      fontWeight: 'bold',
                      fontSize: '18px',
                      margin: '5px auto 0px auto',
                      textAlign: 'center',
                      color: (remainingSec ?? 99) > 10 ? '#fff' : 'red',
                    }}>
                      {remainingSec !== null ? formatTime(remainingSec) : '—'}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 15, marginTop: 5, paddingBottom: 3 }}>
                      <span style={{ fontSize: '15px', fontWeight: 800, color: textColor }}>R{slot.round}</span>
                      <span style={{ fontSize: '15px', fontWeight: 800, color: textColor }}>P{slot.pickNum}</span>
                    </div>
                  )}

                  <div className="lg:mt-1 font-bold text-[11px] lg:text-[14px] font-primary" style={{ color: textColor }}>
                    {truncated || '???'}
                  </div>

                  {isUpcoming && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '54px', color: textColor }}>
                      {(['QB', 'RB', 'WR', 'TE', 'DST'] as const).map(pos => (
                        <div
                          key={pos}
                          style={{ flex: 1, borderTopWidth: '2px', borderTopStyle: 'solid', borderTopColor: POSITION_COLORS[pos], textAlign: 'center' }}
                        >
                          <p style={{ fontSize: '10px' }}>{pos}</p>
                          <p className="text-xs">{counts[pos]}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {isCurrent && (
                    <div style={{ borderBottomWidth: 5, borderBottomStyle: 'solid', borderBottomColor: '#fff', width: '100%', minHeight: '54px' }}>
                      <p className="font-primary text-[15px] font-bold italic text-center pt-2" style={{ color: textColor }}>
                        Picking...
                      </p>
                    </div>
                  )}
                  {isPicked && (
                    <div style={{ borderBottomWidth: 5, borderBottomStyle: 'solid', borderBottomColor: posHex, width: '100%', height: '55px' }}>
                      <p className="font-primary" style={{ fontWeight: 800, fontSize: 15, textAlign: 'center', paddingTop: 5, color: textColor }}>
                        {slot.playerId}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="text-center uppercase text-sm font-bold px-3 pt-2 mt-3 mb-2 pb-3">
          {isFilling ? (
            <span className="text-yellow-400">Filling — waiting for 10/10</span>
          ) : isDone ? (
            <span className="text-green-400">Draft complete</span>
          ) : (
            <span className="text-white/80">
              On the clock: <span className="text-yellow-400">{draftOrderNames[currentDrafterIndex] ?? 'unknown'}</span>
              <span className="ml-3 text-white/40">Pick {info.pickNumber} / {TOTAL_PICKS} (Round {Math.min(TOTAL_ROUNDS, Math.ceil(info.pickNumber / 10))})</span>
            </span>
          )}
        </div>
      </div>

      {/* Main grid */}
      <div className="px-4 py-6">
        <DraftBoardGrid
          draftOrder={draftOrderNames.map((name, i) => ({
            id: String(i + 1),
            name,
            displayName: name,
            isYou: false,
            avatar: '🍌',
          }))}
          draftSummary={draftSummary}
          currentPickNumber={info.pickNumber}
          userDraftPosition={-1}
          onViewRoster={() => { /* no-op for spectator */ }}
        />
      </div>
    </div>
  );
}
