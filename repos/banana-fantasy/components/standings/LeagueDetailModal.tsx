'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { getDraftSummary, getDraftInfo, type ApiDraftPick } from '@/lib/api/drafts';
import { getOwnerDraftTokens } from '@/lib/api/owner';
import { getDraftsApiUrl } from '@/lib/staging';
import type { League, Ripeness } from '@/types';
import { LeagueChat } from '@/components/standings/LeagueChat';
import { useAuth } from '@/hooks/useAuth';
import { useDraftRoomUsers } from '@/hooks/useDraftRoomUsers';
import { AvatarWithBadge } from '@/components/badges/AvatarWithBadge';
import { saveImageToDevice } from '@/lib/saveImage';

export type ModalTab = 'roster' | 'board' | 'standings' | 'team' | 'chat';

interface LeagueDetailModalProps {
  league: League;
  initialTab: ModalTab;
  initialPlayer?: string;
  walletAddress: string;
  /** The NEW obsidian team card image (from the marketplace index). Preferred
   *  over the legacy Go `_imageUrl` so the Team tab shows the current card. */
  imageUrl?: string | null;
  onClose: () => void;
}

// Position colors (same as draft-results)
const POS_COLORS: Record<string, string> = {
  QB: '#FF474C',
  RB: '#3c9120',
  WR: '#cb6ce6',
  TE: '#326cf8',
  DST: '#DF893E',
};

const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'DST'] as const;

const typeConfig: Record<string, { label: string; text: string; bg: string }> = {
  jackpot: { label: 'Jackpot', text: 'text-jackpot', bg: 'bg-jackpot/10' },
  hof: { label: 'HOF', text: 'text-hof', bg: 'bg-hof/10' },
  pro: { label: 'Pro', text: 'text-pro', bg: 'bg-pro/10' },
  regular: { label: 'Pro', text: 'text-pro', bg: 'bg-pro/10' },
};

interface RosterPlayer {
  playerId: string;
  displayName: string;
  team: string;
  position: string;
  pickNum: number;
  round: number;
  byeWeek: string;
  adp: number;
}

interface PlayerRoster {
  QB: RosterPlayer[];
  RB: RosterPlayer[];
  WR: RosterPlayer[];
  TE: RosterPlayer[];
  DST: RosterPlayer[];
  pfpDisplayName: string;
}

function parseRoster(raw: Record<string, unknown>): PlayerRoster {
  const result: PlayerRoster = { QB: [], RB: [], WR: [], TE: [], DST: [], pfpDisplayName: '' };
  const pfp = (raw.PFP || {}) as Record<string, unknown>;
  result.pfpDisplayName = String(pfp.displayName || '');

  for (const pos of POSITION_ORDER) {
    const players = (raw[pos] as unknown[]) || [];
    result[pos] = players.map((p: unknown) => {
      const item = p as Record<string, unknown>;
      const info = (item.playerStateInfo || {}) as Record<string, unknown>;
      const stats = (item.stats || {}) as Record<string, unknown>;
      return {
        playerId: String(info.playerId ?? item.playerId ?? ''),
        displayName: String(info.displayName ?? item.displayName ?? ''),
        team: String(info.team ?? item.team ?? ''),
        position: String(info.position ?? pos),
        pickNum: Number(info.pickNum ?? 0),
        round: Number(info.round ?? 0),
        byeWeek: String(stats.byeWeek ?? '-'),
        adp: Number(stats.adp ?? 0),
      };
    });
  }
  return result;
}

function truncateAddress(addr: string): string {
  if (!addr.startsWith('0x') || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

async function fetchRosters(draftId: string): Promise<Record<string, Record<string, unknown>>> {
  const base = getDraftsApiUrl();
  const res = await fetch(`${base}/draft/${draftId}/state/rosters`);
  if (!res.ok) throw new Error('Failed to fetch rosters');
  return res.json();
}

const NUM_TEAMS = 10;
const NUM_ROUNDS = 15;

export function LeagueDetailModal({ league, initialTab, initialPlayer, walletAddress, imageUrl, onClose }: LeagueDetailModalProps) {
  const { user: authUser } = useAuth();
  const [activeTab, setActiveTab] = useState<ModalTab>(initialTab);
  const [isClosing, setIsClosing] = useState(false);
  const config = typeConfig[league.type] || typeConfig.regular;
  const draftId = league.id;
  const isPlayerDetail = !!initialPlayer;
  const cardFetchWallet = initialPlayer || walletAddress;

  // Roster state
  const [allRosters, setAllRosters] = useState<Record<string, PlayerRoster>>({});
  const [playerKeys, setPlayerKeys] = useState<string[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState('');
  const [playerMenuOpen, setPlayerMenuOpen] = useState(false);
  const [rostersLoading, setRostersLoading] = useState(true);

  // Board state
  const [boardPicks, setBoardPicks] = useState<ApiDraftPick[]>([]);
  const [boardLoading, setBoardLoading] = useState(true);

  // Team state
  // Prefer the new obsidian image passed from the card; fall back to the Go
  // `_imageUrl` only when we weren't given one.
  const [cardImageUrl, setCardImageUrl] = useState<string | null>(imageUrl ?? null);
  const [draftLevel, setDraftLevel] = useState('Pro');
  const [teamLoading, setTeamLoading] = useState(true);

  // Per-owner scores for the standings tab. Populated by parallel
  // fetches of /owner/{addr}/draftToken/all once playerKeys are known.
  const [scoresByOwner, setScoresByOwner] = useState<Record<string, {
    seasonScore: number;
    weekScore: number;
    rank: number;
    leagueRank: number;
  }>>({});

  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(onClose, 200);
  }, [onClose]);

  // Close on escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleClose]);

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // Fetch rosters
  useEffect(() => {
    if (!draftId) return;
    (async () => {
      try {
        const raw = await fetchRosters(draftId);
        const parsed: Record<string, PlayerRoster> = {};
        const keys = Object.keys(raw);
        for (const key of keys) parsed[key] = parseRoster(raw[key]);
        setAllRosters(parsed);
        setPlayerKeys(keys);
        // Prefer initialPlayer (clicked from league lookup), then current user's wallet
        const targetWallet = initialPlayer || walletAddress;
        const matchKey = targetWallet
          ? keys.find(k => k.toLowerCase() === targetWallet.toLowerCase())
          : undefined;
        setSelectedPlayer(matchKey || keys.find(k => k.startsWith('0x')) || keys[0] || '');
      } catch { /* silent */ }
      finally { setRostersLoading(false); }
    })();
  }, [draftId, walletAddress]);

  // Fetch board data — re-fetches if the summary comes back short of the
  // expected 150 picks. The Go API occasionally returns the last pick(s)
  // with empty playerInfo right after a draft finishes (race between final
  // pick write and the summary read), which the normalizer in getDraftSummary
  // filters out as malformed. Re-fetching after a beat almost always fills
  // the hole. Capped at 6 retries (~30s) so we don't loop forever on a
  // genuinely incomplete draft.
  useEffect(() => {
    if (!draftId) return;
    const TOTAL_PICKS = NUM_TEAMS * NUM_ROUNDS;
    const MAX_ATTEMPTS = 6;
    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const fetchBoard = async () => {
      try {
        const picks = await getDraftSummary(draftId);
        if (cancelled) return;
        setBoardPicks(picks);
        if (picks.length < TOTAL_PICKS && attempt < MAX_ATTEMPTS) {
          attempt += 1;
          timer = setTimeout(fetchBoard, 5000);
        }
      } catch { /* silent — next attempt will retry */ }
      finally { if (!cancelled) setBoardLoading(false); }
    };

    void fetchBoard();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [draftId]);

  // Fetch per-owner scores (season/week + ranks) for the standings tab.
  // 10 parallel fetches, one per draft participant. Each owner's draft
  // tokens are filtered to the one matching this league.
  useEffect(() => {
    if (!draftId || playerKeys.length === 0) return;
    (async () => {
      const results = await Promise.allSettled(
        playerKeys.map(k => getOwnerDraftTokens(k)),
      );
      const map: Record<string, { seasonScore: number; weekScore: number; rank: number; leagueRank: number }> = {};
      results.forEach((res, i) => {
        if (res.status !== 'fulfilled') return;
        const match = res.value.find(
          t => String(t.leagueId || '').toLowerCase() === draftId.toLowerCase(),
        );
        if (!match) return;
        const raw = match as Record<string, unknown>;
        const num = (v: unknown): number => {
          if (typeof v === 'number') return v;
          if (typeof v === 'string') {
            const n = parseFloat(v);
            return Number.isFinite(n) ? n : 0;
          }
          return 0;
        };
        const intOr = (v: unknown, fallback: number): number => {
          if (typeof v === 'number') return v;
          if (typeof v === 'string') {
            const n = parseInt(v, 10);
            return Number.isFinite(n) ? n : fallback;
          }
          return fallback;
        };
        map[playerKeys[i]] = {
          seasonScore: num(match.seasonScore ?? raw._seasonScore),
          weekScore: num(match.weekScore ?? raw._weekScore),
          rank: intOr(match.rank ?? raw._rank, 0),
          leagueRank: intOr(raw._leagueRank ?? raw.leagueRank, 0),
        };
      });
      setScoresByOwner(map);
    })();
  }, [draftId, playerKeys]);

  // Fetch team card (for the target player — initialPlayer or current user)
  useEffect(() => {
    if (!cardFetchWallet || !draftId) { setTeamLoading(false); return; }
    (async () => {
      try {
        const [tokens, info] = await Promise.allSettled([
          getOwnerDraftTokens(cardFetchWallet),
          getDraftInfo(draftId),
        ]);
        if (tokens.status === 'fulfilled') {
          const match = tokens.value.find(
            (t) => String(t.leagueId || '').toLowerCase() === draftId.toLowerCase()
          );
          if (match) {
            const imgUrl = String((match as Record<string, unknown>)._imageUrl ?? (match as Record<string, unknown>).imageUrl ?? '');
            // Only use the legacy Go image when the card didn't hand us the new
            // obsidian one (the preferred, current card art).
            if (!imageUrl && imgUrl && !imgUrl.includes('draft-token-image-default')) {
              setCardImageUrl(imgUrl);
            }
          }
        }
        if (info.status === 'fulfilled') {
          const d = info.value as Record<string, unknown>;
          setDraftLevel(String(d.draftLevel ?? d.level ?? d.draftType ?? 'Pro'));
        }
      } catch { /* silent */ }
      finally { setTeamLoading(false); }
    })();
  }, [cardFetchWallet, draftId]);

  // Resolve EVERY player wallet → real display name + pfp. Defaults are a
  // banana name ("Banana" + 5 digits) and the plain banana avatar; a custom
  // name/pfp wins if set. We never surface a raw 0x wallet anywhere in the UI.
  const usersMap = useDraftRoomUsers(playerKeys);

  interface ResolvedUser { name: string; imageUrl: string | null; equippedBadge: string | null; ripeness: Ripeness | null; }
  const resolveUser = useCallback((key: string): ResolvedUser => {
    if (key.startsWith('bot-')) {
      return { name: key.replace(/^bot-fast-\d+-/, 'Bot '), imageUrl: null, equippedBadge: null, ripeness: null };
    }
    const u = usersMap[key.toLowerCase()];
    const pfpName = allRosters[key]?.pfpDisplayName;
    const name = u?.displayName || pfpName || (key.startsWith('0x') ? truncateAddress(key) : key);
    return { name, imageUrl: u?.imageUrl ?? null, equippedBadge: u?.equippedBadge ?? null, ripeness: u?.ripeness ?? null };
  }, [usersMap, allRosters]);

  const getPlayerLabel = (key: string): string => resolveUser(key).name;

  const roster = allRosters[selectedPlayer];

  // Build standings entries from roster data + per-owner scores. Sorted
  // by leagueRank (season standing) once scores load; falls back to
  // playerKeys order while scores are pending.
  const standingsEntries = useMemo(() => {
    if (playerKeys.length === 0) return [];
    const rows = playerKeys.map((key, idx) => {
      const r = allRosters[key];
      const totalPlayers = r
        ? POSITION_ORDER.reduce((sum, pos) => sum + (r[pos]?.length || 0), 0)
        : 0;
      const displayName = resolveUser(key).name;
      const score = scoresByOwner[key];
      return {
        ownerKey: key,
        displayName,
        playerCount: totalPlayers,
        isCurrentUser: key.toLowerCase() === walletAddress?.toLowerCase(),
        rank: score?.leagueRank && score.leagueRank > 0 ? score.leagueRank : idx + 1,
        seasonScore: score?.seasonScore ?? 0,
        weekScore: score?.weekScore ?? 0,
        weeklyRank: score?.rank ?? 0,
        hasScores: !!score,
      };
    });
    return rows.sort((a, b) => {
      if (a.hasScores && b.hasScores) return a.rank - b.rank;
      if (a.hasScores) return -1;
      if (b.hasScores) return 1;
      return 0;
    });
  }, [playerKeys, allRosters, walletAddress, scoresByOwner, resolveUser]);

  // Build board grid
  const { boardGrid, drafterOrder } = useMemo(() => {
    if (boardPicks.length === 0) return { boardGrid: [], drafterOrder: [] };

    // Build drafter order from round 1
    const round1 = boardPicks
      .filter(p => (p.pickNum || 0) >= 1 && (p.pickNum || 0) <= NUM_TEAMS)
      .sort((a, b) => (a.pickNum || 0) - (b.pickNum || 0));
    const order = round1.map(p => p.ownerAddress || '');

    const grid: (ApiDraftPick | null)[][] = Array.from({ length: NUM_ROUNDS }, () =>
      Array.from({ length: NUM_TEAMS }, () => null)
    );

    for (const pick of boardPicks) {
      const pn = pick.pickNum || 0;
      if (pn < 1 || pn > NUM_TEAMS * NUM_ROUNDS) continue;
      const round = Math.ceil(pn / NUM_TEAMS);
      const posInRound = (pn - 1) % NUM_TEAMS;
      const col = round % 2 === 1 ? posInRound : NUM_TEAMS - 1 - posInRound;
      if (round <= NUM_ROUNDS) grid[round - 1][col] = pick;
    }

    return { boardGrid: grid, drafterOrder: order };
  }, [boardPicks]);

  const userColumnIndex = useMemo(() => {
    if (!walletAddress || drafterOrder.length === 0) return -1;
    return drafterOrder.findIndex(addr => addr.toLowerCase() === walletAddress.toLowerCase());
  }, [walletAddress, drafterOrder]);

  const columnHeaders = useMemo(() => {
    if (drafterOrder.length > 0) {
      return drafterOrder.map(addr => {
        if (!addr) return '?';
        return resolveUser(addr).name;
      });
    }
    return Array.from({ length: NUM_TEAMS }, (_, i) => `Team ${i + 1}`);
  }, [drafterOrder, resolveUser]);

  const getPosition = (playerId: string): string => {
    const parts = playerId.split('-');
    return parts[parts.length - 1]?.replace(/[0-9]/g, '').toUpperCase() || '';
  };

  // Download card — shared fetch→blob helper (the old /api/save-card proxy
  // rejects same-origin card URLs; see lib/saveImage.ts).
  const handleSaveCard = useCallback(() => {
    if (!cardImageUrl) return;
    void saveImageToDevice(cardImageUrl, league.name);
  }, [cardImageUrl, league.name]);

  // Download roster image
  const handleSaveRoster = useCallback(() => {
    if (!roster) return;

    const canvas = document.createElement('canvas');
    const W = 1080, H = 1350;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const L = 80, R = W - 80;

    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, W, H);

    // Title
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 32px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(league.name, W / 2, 80);

    let y = 140;
    const statW = 80;
    const byeX = R - statW * 2;
    const adpX = R - statW;
    const pickX = R;

    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('BYE', byeX, y);
    ctx.fillText('ADP', adpX, y);
    ctx.fillText('PICK', pickX, y);

    y += 14;
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(L, y);
    ctx.lineTo(R, y);
    ctx.stroke();
    y += 10;

    for (const pos of POSITION_ORDER) {
      const players = roster[pos] || [];
      if (players.length === 0) continue;
      const color = POS_COLORS[pos];

      y += 30;
      ctx.fillStyle = color;
      ctx.font = 'bold 24px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(pos, L, y);
      y += 12;

      for (const p of players) {
        y += 38;
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(L, y - 22);
        ctx.lineTo(L, y + 6);
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 20px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(p.playerId, L + 14, y);

        ctx.textAlign = 'center';
        ctx.fillText(p.byeWeek, byeX, y);
        ctx.fillText(String(p.adp || '-'), adpX, y);
        ctx.fillText(String(p.pickNum), pickX, y);
      }
      y += 20;
    }

    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('sbsfantasy.com', W / 2, H - 40);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${league.name}-roster.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }, [roster, league.name]);

  const tabs: { id: ModalTab; label: string }[] = [
    { id: 'roster', label: 'Roster' },
    { id: 'board', label: 'Board' },
    { id: 'chat', label: 'Chat' },
  ];

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end sm:items-center justify-center ${
        isClosing ? 'opacity-0 pointer-events-none' : ''
      }`}
      style={{ transition: 'opacity 0.2s ease' }}
      onClick={handleClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-modal-backdrop" />

      {/* Sheet */}
      <div
        className={`relative w-full sm:max-h-[85vh] max-h-[90vh] bg-[#111118] border border-white/[0.08] sm:rounded-2xl rounded-t-2xl overflow-hidden flex flex-col animate-modal-sheet ${
          activeTab === 'board' ? 'sm:w-[95vw] sm:max-w-[1240px]' : 'sm:w-[640px]'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] flex-shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-white font-bold text-lg truncate">{league.name}</h2>
              <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full flex-shrink-0 ${config.bg} ${config.text}`}>
                {config.label}
              </span>
            </div>
            {isPlayerDetail && roster && (
              <div className="flex items-center gap-1.5 mt-1">
                <AvatarWithBadge imageUrl={resolveUser(selectedPlayer).imageUrl} alt={resolveUser(selectedPlayer).name} size={18} showBadge={false} useNextImage={false} />
                <p className="text-white/50 text-xs">{getPlayerLabel(selectedPlayer)}</p>
              </div>
            )}
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-full bg-white/[0.06] hover:bg-white/[0.12] flex items-center justify-center transition-colors flex-shrink-0 text-white/50"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tab bar — hidden in player detail mode */}
        {!isPlayerDetail && (
          <div className="flex border-b border-white/[0.06] flex-shrink-0">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 py-3 text-sm font-medium transition-colors relative ${
                  activeTab === tab.id ? 'text-banana' : 'text-white/40 hover:text-white/70'
                }`}
              >
                {tab.label}
                {activeTab === tab.id && (
                  <div className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-banana rounded-full" />
                )}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-5">

          {/* PLAYER DETAIL MODE — combined card + roster */}
          {isPlayerDetail ? (
            <div>
              {/* Card image with rank badge */}
              {teamLoading ? (
                <div className="w-64 h-80 rounded-xl bg-white/[0.03] animate-pulse mx-auto mb-5" />
              ) : cardImageUrl ? (
                <div className="flex flex-col items-center mb-6">
                  <div className="relative">
                    {/* Rank badge */}
                    {(() => {
                      const playerEntry = standingsEntries.find(e => e.ownerKey.toLowerCase() === selectedPlayer.toLowerCase());
                      const rank = playerEntry?.rank ?? 0;
                      if (rank <= 0) return null;
                      return (
                        <div className="absolute -top-2 -right-2 z-10 bg-[#111118] rounded-full p-0.5">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                            rank === 1 ? 'bg-banana text-black' :
                            rank === 2 ? 'bg-white/80 text-black' :
                            'bg-white/10 text-white/60'
                          }`}>
                            {rank}
                          </div>
                        </div>
                      );
                    })()}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={cardImageUrl} alt="Draft Card" className="w-64 md:w-72 rounded-xl" />
                  </div>
                  <div className="flex items-center gap-3 mt-3">
                    <button
                      onClick={handleSaveCard}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-white/50 text-xs transition-colors"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      Save Card
                    </button>
                    <button
                      onClick={handleSaveRoster}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-white/50 text-xs transition-colors"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      Save Roster
                    </button>
                  </div>
                </div>
              ) : null}

              {/* Roster */}
              {rostersLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-8 rounded-lg bg-white/[0.03] animate-pulse" />
                  ))}
                </div>
              ) : roster ? (
                <>
                  {/* Header row */}
                  <div className="flex items-center py-2 border-b border-white/[0.08]">
                    <div className="flex-1" />
                    <div className="w-11 text-center text-white/30 text-[10px] font-bold uppercase">BYE</div>
                    <div className="w-11 text-center text-white/30 text-[10px] font-bold uppercase">ADP</div>
                    <div className="w-11 text-center text-white/30 text-[10px] font-bold uppercase">Pick</div>
                  </div>

                  {POSITION_ORDER.map((pos) => {
                    const players = roster[pos] || [];
                    if (players.length === 0) return null;
                    const color = POS_COLORS[pos];
                    return (
                      <div key={pos} className="border-b border-white/[0.06] pb-3">
                        <p className="font-bold pt-4 pb-1 text-lg" style={{ color }}>{pos}</p>
                        {players.map((player) => (
                          <div
                            key={player.playerId + player.pickNum}
                            className="flex items-center py-1.5 pl-2.5"
                            style={{ borderLeft: `2px solid ${color}` }}
                          >
                            <div className="flex-1">
                              <p className="text-white font-bold uppercase text-xs">{player.playerId}</p>
                            </div>
                            <div className="w-11 text-center text-white text-xs font-bold">{player.byeWeek}</div>
                            <div className="w-11 text-center text-white text-xs font-bold">{player.adp || '-'}</div>
                            <div className="w-11 text-center text-white text-xs font-bold">{player.pickNum}</div>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </>
              ) : (
                <p className="text-white/40 text-sm text-center py-8">No roster data available</p>
              )}
            </div>
          ) : (
          <>

          {/* ROSTER TAB */}
          {activeTab === 'roster' && (
            <div>
              {rostersLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-8 rounded-lg bg-white/[0.03] animate-pulse" />
                  ))}
                </div>
              ) : roster ? (
                <>
                  {/* Player selector — pick any of the 10 teams to see their
                      roster. Shows each owner's name + pfp, never a wallet. */}
                  {playerKeys.length > 1 && (
                    <div className="relative mb-4">
                      <button
                        type="button"
                        onClick={() => setPlayerMenuOpen((o) => !o)}
                        className="w-full flex items-center gap-2.5 bg-white/[0.06] border border-white/[0.08] rounded-lg px-3 py-2.5 text-white text-sm font-medium hover:bg-white/[0.09] transition-colors"
                      >
                        <AvatarWithBadge imageUrl={resolveUser(selectedPlayer).imageUrl} alt={resolveUser(selectedPlayer).name} size={26} showBadge={false} useNextImage={false} />
                        <span className="truncate flex-1 text-left">{getPlayerLabel(selectedPlayer)}</span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-white/40 transition-transform ${playerMenuOpen ? 'rotate-180' : ''}`}>
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>
                      {playerMenuOpen && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setPlayerMenuOpen(false)} />
                          <div className="absolute z-20 left-0 right-0 mt-1.5 max-h-72 overflow-y-auto bg-[#16161d] border border-white/[0.1] rounded-lg shadow-xl py-1">
                            {playerKeys.map((key) => {
                              const ru = resolveUser(key);
                              const isSel = key === selectedPlayer;
                              const isMe = key.toLowerCase() === walletAddress?.toLowerCase();
                              return (
                                <button
                                  key={key}
                                  type="button"
                                  onClick={() => { setSelectedPlayer(key); setPlayerMenuOpen(false); }}
                                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors ${isSel ? 'bg-white/[0.07] text-white' : 'text-white/70 hover:bg-white/[0.05]'}`}
                                >
                                  <AvatarWithBadge imageUrl={ru.imageUrl} alt={ru.name} size={26} showBadge={false} useNextImage={false} />
                                  <span className="truncate flex-1">{ru.name}{isMe ? ' (You)' : ''}</span>
                                  {isSel && (
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-banana flex-shrink-0">
                                      <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* Header row */}
                  <div className="flex items-center py-2 border-b border-white/[0.08]">
                    <div className="flex-1" />
                    <div className="w-11 text-center text-white/30 text-[10px] font-bold uppercase">BYE</div>
                    <div className="w-11 text-center text-white/30 text-[10px] font-bold uppercase">ADP</div>
                    <div className="w-11 text-center text-white/30 text-[10px] font-bold uppercase">Pick</div>
                  </div>

                  {/* Roster by position */}
                  {POSITION_ORDER.map((pos) => {
                    const players = roster[pos] || [];
                    if (players.length === 0) return null;
                    const color = POS_COLORS[pos];

                    return (
                      <div key={pos} className="border-b border-white/[0.06] pb-3">
                        <p className="font-bold pt-4 pb-1 text-lg" style={{ color }}>{pos}</p>
                        {players.map((player) => (
                          <div
                            key={player.playerId + player.pickNum}
                            className="flex items-center py-1.5 pl-2.5"
                            style={{ borderLeft: `2px solid ${color}` }}
                          >
                            <div className="flex-1">
                              <p className="text-white font-bold uppercase text-xs">{player.playerId}</p>
                            </div>
                            <div className="w-11 text-center text-white text-xs font-bold">{player.byeWeek}</div>
                            <div className="w-11 text-center text-white text-xs font-bold">{player.adp || '-'}</div>
                            <div className="w-11 text-center text-white text-xs font-bold">{player.pickNum}</div>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </>
              ) : (
                <p className="text-white/40 text-sm text-center py-8">No roster data available</p>
              )}
            </div>
          )}

          {/* BOARD TAB */}
          {activeTab === 'board' && (
            <div>
              {boardLoading ? (
                <div className="h-40 rounded-lg bg-white/[0.03] animate-pulse" />
              ) : boardGrid.length > 0 ? (
                <div className="overflow-x-auto -mx-5 px-5 pb-2" style={{ maxWidth: 1200, margin: '0 auto' }}>
                  {/* Header row: drafter names */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', padding: '10px 0 0' }}>
                    {columnHeaders.map((header, i) => {
                      // pfp + badge per drafter, exactly like the draft-room board.
                      const addr = drafterOrder[i];
                      const ru = addr ? resolveUser(addr) : null;
                      return (
                        <div
                          key={`heading-${i}`}
                          style={{
                            width: 100,
                            marginTop: 10,
                            padding: 5,
                            textAlign: 'center',
                            fontWeight: 'bold',
                            fontSize: 12,
                            color: i === userColumnIndex ? '#F3E216' : '#fff',
                            overflow: 'hidden',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          {ru && (
                            <AvatarWithBadge
                              imageUrl={ru.imageUrl || '/banana-profile.png'}
                              alt={header}
                              size={32}
                              equippedBadge={ru.equippedBadge}
                              ripeness={ru.ripeness}
                              useNextImage={false}
                            />
                          )}
                          <div style={{ width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {header}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Grid rows */}
                  {boardGrid.map((row, roundIdx) => (
                    <div
                      key={roundIdx}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(10, 1fr)',
                      }}
                    >
                      {row.map((pick, colIdx) => {
                        const isPicked = !!pick;
                        const pos = pick ? getPosition(pick.playerId) : '';
                        const hexColor = isPicked ? (POS_COLORS[pos] || '#888') : '';
                        const isUserPick = colIdx === userColumnIndex && isPicked;

                        return (
                          <div
                            key={`${roundIdx}-${colIdx}`}
                            style={{
                              width: 100,
                              height: 80,
                              margin: '7px 5px',
                              padding: 5,
                              borderRadius: 5,
                              backgroundColor: isPicked ? hexColor : '#333',
                              border: `3px solid ${isUserPick ? '#F3E216' : isPicked ? hexColor : 'transparent'}`,
                              display: 'flex',
                              flexFlow: 'column nowrap',
                              alignItems: 'flex-start',
                              justifyContent: 'space-between',
                              textAlign: 'left',
                              cursor: isPicked ? 'pointer' : 'default',
                              transition: 'transform 0.15s ease, filter 0.15s ease',
                            }}
                            onMouseEnter={(e) => {
                              if (isPicked) {
                                e.currentTarget.style.transform = 'scale(1.05)';
                                e.currentTarget.style.filter = 'brightness(2)';
                              }
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.transform = 'scale(1)';
                              e.currentTarget.style.filter = 'brightness(1)';
                            }}
                          >
                            {isPicked && pick ? (
                              <>
                                <span
                                  style={{
                                    fontSize: 17,
                                    fontWeight: 'bold',
                                    color: '#000',
                                    textAlign: 'left',
                                    lineHeight: 1.2,
                                  }}
                                >
                                  {pick.playerId}
                                </span>
                                <span
                                  style={{
                                    fontSize: 12,
                                    fontWeight: 'bold',
                                    color: '#000',
                                    textAlign: 'left',
                                  }}
                                >
                                  R{roundIdx + 1} P{pick.pickNum}
                                </span>
                              </>
                            ) : (
                              <span
                                style={{
                                  fontSize: 12,
                                  fontWeight: 'bold',
                                  color: 'rgba(255,255,255,0.2)',
                                  textAlign: 'left',
                                }}
                              >
                                R{roundIdx + 1}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-white/40 text-sm text-center py-8">Draft board not available</p>
              )}
            </div>
          )}

          {/* STANDINGS TAB — mirrors the old draft-web layout: rank +
              team + weekly rank + weekly score + season score. Trophy on
              season-rank 1, green text on rank 2 (the playoff cutoff). */}
          {activeTab === 'standings' && (
            <div>
              {rostersLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <div key={i} className="h-12 rounded-lg bg-white/[0.03] animate-pulse" />
                  ))}
                </div>
              ) : standingsEntries.length > 0 ? (
                <>
                  {/* Header */}
                  <div className="grid grid-cols-[36px_1fr_44px_56px_64px] gap-2 px-3 py-2 text-[10px] uppercase tracking-wider text-white/30 font-medium">
                    <div>#</div>
                    <div>Team</div>
                    <div className="text-right">Wk #</div>
                    <div className="text-right">Wk Pts</div>
                    <div className="text-right">Season</div>
                  </div>

                  <div className="space-y-1">
                    {standingsEntries.map((entry) => {
                      const seasonRankColor = entry.rank === 1
                        ? 'text-banana'
                        : entry.rank === 2
                          ? 'text-green-400'
                          : 'text-white/80';
                      const weeklyRankColor = entry.weeklyRank === 1
                        ? 'text-banana'
                        : 'text-white/60';
                      return (
                        <React.Fragment key={entry.ownerKey}>
                          <div
                            onClick={() => { setSelectedPlayer(entry.ownerKey); setActiveTab('roster'); }}
                            className={`
                              grid grid-cols-[36px_1fr_44px_56px_64px] gap-2 px-3 py-2.5 rounded-lg items-center cursor-pointer transition-colors
                              ${entry.isCurrentUser
                                ? 'bg-banana/[0.08] ring-1 ring-banana/20 hover:bg-banana/[0.12]'
                                : 'hover:bg-white/[0.04]'
                              }
                            `}
                          >
                            {/* Rank */}
                            <div className="flex items-center gap-1">
                              {entry.rank <= 2 ? (
                                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                                  entry.rank === 1 ? 'bg-banana text-black' : 'bg-green-400 text-black'
                                }`}>
                                  {entry.rank}
                                </span>
                              ) : (
                                <span className="text-white/50 text-sm font-medium">{entry.rank}</span>
                              )}
                              {entry.rank === 1 && (
                                <span className="text-banana text-xs leading-none" aria-hidden>🏆</span>
                              )}
                            </div>

                            {/* Team name */}
                            <div className="min-w-0">
                              <p className={`text-sm font-medium truncate ${entry.isCurrentUser ? 'text-banana' : seasonRankColor}`}>
                                {entry.displayName}
                                {entry.isCurrentUser && <span className="ml-1.5 text-[10px] text-banana/60">(You)</span>}
                              </p>
                            </div>

                            {/* Weekly rank */}
                            <div className={`text-right text-sm font-medium ${weeklyRankColor}`}>
                              {entry.weeklyRank > 0 ? entry.weeklyRank : '—'}
                            </div>

                            {/* Weekly score */}
                            <div className="text-right text-white/70 text-sm tabular-nums">
                              {entry.hasScores ? entry.weekScore.toFixed(1) : '—'}
                            </div>

                            {/* Season score */}
                            <div className={`text-right text-sm font-bold tabular-nums ${seasonRankColor}`}>
                              {entry.hasScores ? entry.seasonScore.toFixed(1) : '—'}
                            </div>
                          </div>

                          {/* Advance line between rank 2 and 3 */}
                          {entry.rank === 2 && standingsEntries.length > 2 && (
                            <div className="flex items-center gap-2 px-3 py-1.5">
                              <div className="flex-1 h-px bg-green-500/30" />
                              <span className="text-[9px] uppercase tracking-wider text-green-500/50 font-medium">Advance</span>
                              <div className="flex-1 h-px bg-green-500/30" />
                            </div>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>

                  <p className="text-white/20 text-[10px] text-center mt-4">Click a team to view their roster</p>
                </>
              ) : (
                <p className="text-white/40 text-sm text-center py-8">No standings data available</p>
              )}
            </div>
          )}

          {/* TEAM TAB */}
          {activeTab === 'team' && (
            <div className="text-center">
              {teamLoading ? (
                <div className="w-64 h-80 rounded-xl bg-white/[0.03] animate-pulse mx-auto" />
              ) : (
                <>
                  {/* Draft info */}
                  <div className="mb-4">
                    <span
                      className="text-sm font-semibold"
                      style={{
                        color: draftLevel.toLowerCase() === 'jackpot' ? '#ef4444'
                          : draftLevel.toLowerCase().includes('hof') || draftLevel.toLowerCase().includes('hall') ? '#D4AF37'
                          : '#a855f7',
                      }}
                    >
                      {draftLevel}
                    </span>
                    <span className="text-white/20 mx-2">&middot;</span>
                    <span className="text-white/70 text-sm">{league.name}</span>
                    {league.leagueRank > 0 && (
                      <>
                        <span className="text-white/20 mx-2">&middot;</span>
                        <span className="text-white/70 text-sm">Rank #{league.leagueRank}</span>
                      </>
                    )}
                  </div>

                  {/* Card image */}
                  {cardImageUrl ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={cardImageUrl}
                        alt="Draft Card"
                        className="w-64 md:w-72 rounded-xl mx-auto mb-5"
                      />
                      <div className="flex items-center justify-center gap-3">
                        <button
                          onClick={handleSaveCard}
                          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-white/70 text-sm transition-colors"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                          </svg>
                          Download Card
                        </button>
                        <button
                          onClick={handleSaveRoster}
                          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-white/70 text-sm transition-colors"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                          </svg>
                          Download Roster
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="w-64 h-80 rounded-xl border border-white/[0.06] bg-white/[0.02] mx-auto flex items-center justify-center">
                      <p className="text-white/30 text-sm">No card image available</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* CHAT TAB — keeps the draft-room conversation alive after the
              draft completes. Same RTDB-backed messages as in the draft
              room; unread badge on the TeamCard clears when this opens. */}
          {activeTab === 'chat' && (
            <LeagueChat
              draftId={league.id}
              walletAddress={walletAddress}
              username={authUser?.username || walletAddress?.slice(0, 6)}
            />
          )}
          </>
          )}
        </div>
      </div>
    </div>
  );
}
