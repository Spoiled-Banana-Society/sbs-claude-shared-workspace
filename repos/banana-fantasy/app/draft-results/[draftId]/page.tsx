'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { getDraftInfo } from '@/lib/api/drafts';
import { getOwnerDraftTokens, isPlaceholderName } from '@/lib/api/owner';
import { getDraftsApiUrl } from '@/lib/staging';
import { bananaPlaceholderName } from '@/utils/helpers';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import TeamCardObsidian, { type CardTier } from '@/components/draft/TeamCardObsidian';
import { teamNoFromToken } from '@/lib/teamCardData';
import { buildOgCardUrl } from '@/lib/nftCard';
import { saveImageToDevice } from '@/lib/saveImage';
import { AvatarWithBadge } from '@/components/badges/AvatarWithBadge';
import { useDraftRoomUsers } from '@/hooks/useDraftRoomUsers';

// ─── Types ───────────────────────────────────────────────────────────────

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
  pfpImageUrl: string;
  pfpDisplayName: string;
}

// ─── Position Colors (old prod exact) ────────────────────────────────────

const POS_COLORS: Record<string, string> = {
  QB: '#FF474C',
  RB: '#3c9120',
  WR: '#cb6ce6',
  TE: '#326cf8',
  DST: '#DF893E',
};

const POSITION_ORDER: (keyof Pick<PlayerRoster, 'QB' | 'RB' | 'WR' | 'TE' | 'DST'>)[] = ['QB', 'RB', 'WR', 'TE', 'DST'];

function positionColor(playerId: string): string {
  const pos = playerId.split('-').pop()?.replace(/[0-9]/g, '').toUpperCase() || '';
  return POS_COLORS[pos] || '#cb6ce6';
}

// ─── Fetch rosters (returns all 10 teams) ────────────────────────────────

async function fetchRosters(draftId: string): Promise<Record<string, Record<string, unknown>>> {
  const base = getDraftsApiUrl();
  const res = await fetch(`${base}/draft/${draftId}/state/rosters`);
  if (!res.ok) throw new Error('Failed to fetch rosters');
  return res.json();
}

function parseRoster(raw: Record<string, unknown>): PlayerRoster {
  const result: PlayerRoster = { QB: [], RB: [], WR: [], TE: [], DST: [], pfpImageUrl: '', pfpDisplayName: '' };

  // PFP info
  const pfp = (raw.PFP || {}) as Record<string, unknown>;
  result.pfpImageUrl = String(pfp.imageUrl || '');
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

// ─── Main Page Component ─────────────────────────────────────────────────

export default function DraftResultsPage() {
  const params = useParams();
  const draftId = typeof params?.draftId === 'string' ? params.draftId : '';
  const { user } = useAuth();
  const walletAddress = user?.walletAddress ?? '';

  // New-user first-purchase gate. Landing on this roster page means the draft is
  // FINISHED and the user is OUTSIDE the draft room — the correct moment for the
  // gate (it used to fire when a draft merely FILLED, which pinged too early).
  // We tell the server this draft finished; when it was the user's LAST free
  // draft, the server unlocks the promo and the popup/notification/banner fire
  // (globally, so they follow the user if they navigate away from here).
  // Fires once per draft (flag set only on success so a failure retries next
  // visit); the server also dedups per draftId, so a re-visit is harmless.
  // Deps are stable scalars only — no Privy-derived callback — so this can't
  // render-loop (see shared-workspace CLAUDE.md Rule #0).
  useEffect(() => {
    if (!draftId) return;
    const userId = user?.id || walletAddress?.toLowerCase();
    if (!userId) return;
    const firedKey = `fp-finished:${draftId}`;
    try { if (localStorage.getItem(firedKey)) return; } catch { /* ignore */ }
    void fetch('/api/promos/first-purchase-finished', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, draftId }),
    })
      .then((res) => { if (res.ok) { try { localStorage.setItem(firedKey, '1'); } catch { /* ignore */ } } })
      .catch(() => { /* best-effort — retries on next visit */ });
  }, [draftId, user?.id, walletAddress]);

  const [allRosters, setAllRosters] = useState<Record<string, PlayerRoster>>({});
  const [playerKeys, setPlayerKeys] = useState<string[]>([]);
  // Live identity (edited name/pfp/badge if set, on-brand Banana default
  // otherwise) — the SAME source the in-draft roster uses, so names + avatars
  // match across the draft room and this results page. Keyed by lowercase
  // wallet; SWR-like with internal polling (safe re: render-loop rule — input
  // is the stable playerKeys state array).
  const usersMap = useDraftRoomUsers(playerKeys);
  const [selectedPlayer, setSelectedPlayer] = useState('');
  // '' = type not yet known. Render NEUTRAL (not pro/purple) until the
  // authoritative Firestore Level loads, so a jackpot/HOF draft never flashes
  // as Pro. Was `useState('Pro')` — that default made every jackpot/HOF results
  // screen show purple because the Go `/state/info` endpoint doesn't carry the
  // type (see the level fetch below + /api/drafts/status).
  const [draftLevel, setDraftLevel] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [cardImages, setCardImages] = useState<Record<string, { imageUrl: string; cardId: string }>>({});
  // wallet → authoritative on-chain BBB4 token id (realTokenId). Captured
  // independently of the backend image so the NFT-image write can fire promptly.
  const [realTokenIds, setRealTokenIds] = useState<Record<string, string>>({});
  // ownerId → 1-indexed pick position in the draft order. Renders as the
  // "Pick #N" badge in the header + share image. Falls back to nothing when
  // we couldn't resolve the draft order (e.g., very old draft missing info).
  const [pickPositionByOwner, setPickPositionByOwner] = useState<Record<string, number>>({});
  const [fetchedPlayers, setFetchedPlayers] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped when the tab regains focus — drives the loader effect below to
  // refetch so a user returning after their draft auto-completed sees the
  // final roster instead of the snapshot from when they last looked.
  const [reloadTick, setReloadTick] = useState(0);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setReloadTick((n) => n + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);

  // Instant card: the generating screen handed us the card URL via
  // sessionStorage (and preloaded the image), so seed it immediately instead of
  // waiting on the token fetch. The full fetch below still runs and fills in the
  // real cardId; this just makes the image appear the moment the page opens.
  useEffect(() => {
    if (!draftId || !walletAddress) return;
    try {
      const handoff = sessionStorage.getItem(`sbs-draftcard:${draftId}`);
      if (handoff) {
        const key = walletAddress.toLowerCase();
        setCardImages((prev) => (prev[key] ? prev : { ...prev, [key]: { imageUrl: handoff, cardId: '' } }));
      }
    } catch { /* ignore */ }
  }, [draftId, walletAddress]);

  useEffect(() => {
    if (!draftId) { setIsLoading(false); return; }

    // Authoritative draft type. The Go `/state/info` endpoint (getDraftInfo)
    // does NOT return the level, so it can never tell us jackpot vs pro — the
    // real type lives on the Firestore draft doc `Level` (stamped at the
    // slot-machine reveal, long before this screen). Firestore-only route so it
    // resolves fast — before the team card / badge paint — and only set it when
    // known (leaves draftLevel '' → neutral, never a wrong 'Pro' flash).
    fetch(`/api/drafts/${encodeURIComponent(draftId)}/level`)
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => { if (s?.level) setDraftLevel(String(s.level)); })
      .catch(() => {});

    (async () => {
      try {
        const promises: Promise<unknown>[] = [
          getDraftInfo(draftId),
          fetchRosters(draftId),
        ];
        if (walletAddress) {
          promises.push(getOwnerDraftTokens(walletAddress));
        }

        const results = await Promise.allSettled(promises);
        const [infoRes, rostersRes, tokensRes] = results;

        // Draft info
        if (infoRes.status === 'fulfilled') {
          const info = infoRes.value as Record<string, unknown>;
          // Level intentionally NOT read from info here — /state/info never
          // carries it; the authoritative Firestore Level is fetched above.
          const name = String(info.displayName ?? '');
          if (name) setDisplayName(name);

          // Build owner → pick-position map from draftOrder (1-indexed).
          // draftOrder is an array of { ownerId, tokenId } in pick order.
          const order = info.draftOrder;
          if (Array.isArray(order)) {
            const map: Record<string, number> = {};
            for (let i = 0; i < order.length; i++) {
              const entry = order[i] as Record<string, unknown>;
              const id = String(entry.ownerId || '').toLowerCase();
              if (id) map[id] = i + 1;
            }
            setPickPositionByOwner(map);
          }
        }

        // Owner tokens → card image for current user
        if (tokensRes && tokensRes.status === 'fulfilled' && walletAddress) {
          const tokens = tokensRes.value as Array<Record<string, unknown>>;
          if (Array.isArray(tokens)) {
            const match = tokens.find(
              (t) => String(t.leagueId || t._leagueId || '').toLowerCase() === draftId.toLowerCase()
            );
            if (match) {
              const imgUrl = String(match._imageUrl ?? match.imageUrl ?? '');
              const cId = String(match.cardId || match._cardId || '');
              const rtid = String(match.realTokenId ?? '');
              const owk = walletAddress.toLowerCase();
              if (/^\d+$/.test(rtid)) setRealTokenIds(prev => (prev[owk] === rtid ? prev : { ...prev, [owk]: rtid }));
              if (imgUrl && !imgUrl.includes('draft-token-image-default')) {
                setCardImages(prev => ({ ...prev, [owk]: { imageUrl: imgUrl, cardId: cId } }));
              }
              const tokenName = String(match.leagueDisplayName || match._leagueDisplayName || '');
              if (tokenName) setDisplayName(prev => prev || tokenName);
              setFetchedPlayers(prev => new Set(prev).add(walletAddress.toLowerCase()));
            }
          }
        }

        // All rosters
        if (rostersRes.status === 'fulfilled') {
          const raw = rostersRes.value as Record<string, Record<string, unknown>>;
          const parsed: Record<string, PlayerRoster> = {};
          const keys = Object.keys(raw);
          for (const key of keys) {
            parsed[key] = parseRoster(raw[key]);
          }
          setAllRosters(parsed);
          setPlayerKeys(keys);

          // Default to user's wallet, fallback to first 0x address
          const userKey = walletAddress
            ? keys.find(k => k.toLowerCase() === walletAddress.toLowerCase())
            : undefined;
          setSelectedPlayer(userKey || keys.find(k => k.startsWith('0x')) || keys[0] || '');
        } else {
          setError('Failed to load roster data.');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load draft.');
      } finally {
        setIsLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, walletAddress, reloadTick]);

  const title = displayName || draftId;
  const roster = allRosters[selectedPlayer];
  const cardImageUrl = cardImages[selectedPlayer.toLowerCase()]?.imageUrl || null;
  const cardId = cardImages[selectedPlayer.toLowerCase()]?.cardId || '';
  // Snake-draft pick position (1-10) — currently unused for rendering but
  // kept in state since it's cheap to compute from draftOrder and useful
  // for future UI (e.g. "Pick #5" alongside the team identity).
  void pickPositionByOwner[selectedPlayer.toLowerCase()];

  // "Team #N" is the user's BBB4 NFT token ID. Resolve it the ONE canonical way
  // (realTokenId preferred, else the cardId suffix) via the shared helper so the
  // header, the card, and the downloadable image all show the IDENTICAL number —
  // previously the header used the cardId suffix while the card used realTokenId,
  // which could be two different numbers. Legacy ms-timestamp ids (>100k) → ''.
  const teamNumber = teamNoFromToken({
    realTokenId: realTokenIds[selectedPlayer.toLowerCase()],
    cardId,
  });

  // Fetch card image for selected player on demand
  useEffect(() => {
    if (!selectedPlayer || !draftId) return;
    const key = selectedPlayer.toLowerCase();
    if (fetchedPlayers.has(key)) return;

    setFetchedPlayers(prev => new Set(prev).add(key));

    (async () => {
      try {
        const tokens = await getOwnerDraftTokens(selectedPlayer);
        const match = tokens.find(
          (t: Record<string, unknown>) => String(t.leagueId || t._leagueId || '').toLowerCase() === draftId.toLowerCase()
        );
        if (match) {
          const imgUrl = String((match as Record<string, unknown>)._imageUrl ?? (match as Record<string, unknown>).imageUrl ?? '');
          const cId = String(match.cardId || (match as Record<string, unknown>)._cardId || '');
          const rtid = String((match as Record<string, unknown>).realTokenId ?? '');
          if (/^\d+$/.test(rtid)) setRealTokenIds(prev => (prev[key] === rtid ? prev : { ...prev, [key]: rtid }));
          if (imgUrl && !imgUrl.includes('draft-token-image-default')) {
            setCardImages(prev => ({ ...prev, [key]: { imageUrl: imgUrl, cardId: cId } }));
          }
        }
      } catch { /* silent — bot tokens may not exist */ }
    })();
  }, [selectedPlayer, draftId, fetchedPlayers]);

  // Poll for the card while it's still missing. Covers the case where the user
  // clicks through from the "Draft Complete" screen before card generation
  // finished — instead of having to refresh, the card pops in on its own the
  // moment the backend has it. Self-limiting: the effect early-returns (no
  // interval started) as soon as a real card exists for the selected player,
  // and is hard-capped at ~30s of attempts so it can never become a runaway
  // fetch loop (Rule #0). Deps are stable scalars only (no Privy-derived
  // callbacks), so it fires once per state change, not once per render.
  useEffect(() => {
    if (!selectedPlayer || !draftId) return;
    if (cardImageUrl) return; // already have it — nothing to wait for
    const key = selectedPlayer.toLowerCase();

    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 10; // ~30s at 3s spacing, matching DraftComplete

    const check = async () => {
      attempts += 1;
      try {
        const tokens = await getOwnerDraftTokens(selectedPlayer);
        if (cancelled) return;
        const match = tokens.find(
          (t: Record<string, unknown>) => String(t.leagueId || t._leagueId || '').toLowerCase() === draftId.toLowerCase()
        );
        if (match) {
          const imgUrl = String((match as Record<string, unknown>)._imageUrl ?? (match as Record<string, unknown>).imageUrl ?? '');
          const cId = String(match.cardId || (match as Record<string, unknown>)._cardId || '');
          const rtid = String((match as Record<string, unknown>).realTokenId ?? '');
          if (/^\d+$/.test(rtid)) setRealTokenIds(prev => (prev[key] === rtid ? prev : { ...prev, [key]: rtid }));
          if (imgUrl && !imgUrl.includes('draft-token-image-default')) {
            // Found it — write to state. cardImageUrl flips truthy, this effect
            // re-runs and early-returns, and the cleanup below clears the timer.
            setCardImages(prev => ({ ...prev, [key]: { imageUrl: imgUrl, cardId: cId } }));
            return;
          }
        }
      } catch { /* silent — keep trying until the cap */ }
      if (!cancelled && attempts >= MAX_ATTEMPTS) clearInterval(id);
    };

    const id = setInterval(check, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [selectedPlayer, draftId, cardImageUrl]);

  // Get display name for a player key
  const getPlayerLabel = (key: string): string => {
    const r = allRosters[key];
    // The viewer's OWN team reads "My Team" — same as the in-draft roster shows
    // for yourself — instead of your own Banana #/handle.
    if (walletAddress && key.toLowerCase() === walletAddress.toLowerCase()) return 'My Team';
    // Real wallets: prefer a user-chosen displayName; otherwise the on-brand
    // Banana #N handle (NOT the raw wallet — that's what was leaking when
    // the backend's PFP.DisplayName defaults to ownerId on new accounts).
    if (key.startsWith('0x')) {
      // Prefer the LIVE resolved name (picks up a freshly-edited username), then
      // the results-API PFP name, then the on-brand Banana default. Never the wallet.
      const live = usersMap[key.toLowerCase()]?.displayName;
      if (live && !isPlaceholderName(live, key)) return live;
      if (r?.pfpDisplayName && !isPlaceholderName(r.pfpDisplayName, key)) {
        return r.pfpDisplayName;
      }
      return bananaPlaceholderName(key);
    }
    // Bots — clean up the timestamp prefix.
    if (key.startsWith('bot-')) return key.replace(/^bot-fast-\d+-/, 'Bot ');
    return r?.pfpDisplayName || key;
  };

  // Generate roster image for download
  const generateRosterImage = useCallback((): Promise<Blob | null> => {
    if (!roster) return Promise.resolve(null);
    return new Promise((resolve) => {
      // Load logo first
      const logo = new Image();
      logo.crossOrigin = 'anonymous';
      logo.src = '/sbs-logo.png';

      const render = () => {
        const canvas = document.createElement('canvas');
        const W = 1080;
        const H = 1350; // 4:5 ratio — optimal for X and Instagram
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }

        // Background
        ctx.fillStyle = '#0a0a0f';
        ctx.fillRect(0, 0, W, H);

        // Margins
        const L = 80;
        const R = W - 80;

        // Logo + SBS at top
        const logoH = 50;
        if (logo.complete && logo.naturalWidth > 0) {
          const logoW = (logo.naturalWidth / logo.naturalHeight) * logoH;
          ctx.font = 'bold 32px system-ui, sans-serif';
          const textW = ctx.measureText('SBS').width;
          const totalW = logoW + 12 + textW;
          const startX = (W - totalW) / 2;
          ctx.drawImage(logo, startX, 40, logoW, logoH);
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'left';
          ctx.fillText('SBS', startX + logoW + 12, 40 + logoH / 2 + 11);
        } else {
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 32px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('SBS', W / 2, 75);
        }

        // League · Team · Level
        const leagueNum = (title).replace(/\D/g, '') || title;
        const levelColor = draftLevel.toLowerCase() === 'jackhof' ? '#ef6c37' : draftLevel.toLowerCase() === 'jackpot' ? '#ef4444' : draftLevel.toLowerCase() === 'hof' || draftLevel.toLowerCase() === 'hall of fame' ? '#D4AF37' : '#a855f7';

        ctx.font = '22px system-ui, sans-serif';
        ctx.textAlign = 'center';

        // Build parts with measurements
        const parts: Array<{ text: string; color: string }> = [
          { text: `League #${leagueNum}`, color: '#ffffff' },
        ];
        if (teamNumber) {
          parts.push({ text: ' · ', color: 'rgba(255,255,255,0.3)' });
          parts.push({ text: `Team #${teamNumber}`, color: '#ffffff' });
        }
        // Only show the type once known — never stamp a default 'Pro' on the card.
        if (draftLevel) {
          parts.push({ text: ' · ', color: 'rgba(255,255,255,0.3)' });
          parts.push({ text: draftLevel, color: levelColor });
        }

        // Measure total width
        const totalTextW = parts.reduce((w, p) => w + ctx.measureText(p.text).width, 0);
        let tx = (W - totalTextW) / 2;

        ctx.textAlign = 'left';
        for (const part of parts) {
          ctx.fillStyle = part.color;
          ctx.fillText(part.text, tx, 135);
          tx += ctx.measureText(part.text).width;
        }

        // Position counts
        const posGroups = POSITION_ORDER.filter(pos => (roster[pos]?.length || 0) > 0);
        let pcX = W / 2 - (posGroups.length * 50) / 2 + 25;
        const pcY = 185;
        for (const pos of POSITION_ORDER) {
          const count = roster[pos]?.length || 0;
          if (count === 0) continue;
          ctx.fillStyle = POS_COLORS[pos];
          ctx.font = 'bold 18px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(pos, pcX, pcY);
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 24px system-ui, sans-serif';
          ctx.fillText(String(count), pcX, pcY + 28);
          pcX += 50;
        }

        // Column headers
        const statW = 80;
        const byeX = R - statW * 2;
        const adpX = R - statW;
        const pickX = R;

        let y = 260;
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = 'bold 16px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('BYE', byeX, y);
        ctx.fillText('ADP', adpX, y);
        ctx.fillText('PICK', pickX, y);

        // Divider
        y += 14;
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(L, y);
        ctx.lineTo(R, y);
        ctx.stroke();
        y += 10;

        // Roster by position
        for (const pos of POSITION_ORDER) {
          const players = roster[pos] || [];
          if (players.length === 0) continue;
          const color = POS_COLORS[pos];

          // Position title
          y += 30;
          ctx.fillStyle = color;
          ctx.font = 'bold 24px system-ui, sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(pos, L, y);
          y += 12;

          // Players
          for (const p of players) {
            y += 38;
            // Left border
            ctx.strokeStyle = color;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(L, y - 22);
            ctx.lineTo(L, y + 6);
            ctx.stroke();

            // Name
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 20px system-ui, sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(p.playerId, L + 14, y);

            // Stats
            ctx.textAlign = 'center';
            ctx.fillText(p.byeWeek, byeX, y);
            ctx.fillText(String(p.adp || '-'), adpX, y);
            ctx.fillText(String(p.pickNum), pickX, y);
          }
          y += 20;
        }

        // Footer
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font = '16px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('sbsfantasy.com', W / 2, H - 40);

        canvas.toBlob((blob) => resolve(blob), 'image/png');
      };

      // Load logo then render, or render immediately if cached
      if (logo.complete) {
        render();
      } else {
        logo.onload = render;
        logo.onerror = render; // Render without logo if load fails
      }
    });
  }, [roster, selectedPlayer, title, cardId, draftLevel, teamNumber]);

  // Save roster image
  const [rosterSaved, setRosterSaved] = useState(false);
  const handleSaveRoster = useCallback(async () => {
    const blob = await generateRosterImage();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `League-${(title).replace(/\D/g, '') || title}-roster.png`;
    a.click();
    URL.revokeObjectURL(url);
    setRosterSaved(true);
    setTimeout(() => setRosterSaved(false), 2000);
  }, [generateRosterImage, title]);

  // Save card image — fetch→blob→download via the shared helper (mobile gets
  // the native share sheet). The old /api/save-card proxy rejected our
  // same-origin /api/og/team-card URL, so it "downloaded" a JSON error named
  // .png that failed to save on desktop and mobile.
  const [saved, setSaved] = useState(false);
  const handleSave = useCallback(async (url: string) => {
    if (!url) return;
    const ok = await saveImageToDevice(url, title);
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }, [title]);

  // Point this token's NFT image (OpenSea / marketplace / X) at the obsidian team
  // card, once per token, for the OWNER's own team. Fire-and-forget; deps are
  // stable scalars + a synchronous ref guard so it can't render-loop (Rule #0).
  const nftImgFiredRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!walletAddress || selectedPlayer.toLowerCase() !== walletAddress.toLowerCase()) return;
    // Key on the on-chain realTokenId — the id OpenSea / our metadata endpoint use.
    const tokenId = realTokenIds[selectedPlayer.toLowerCase()] || '';
    if (!/^\d+$/.test(tokenId)) return;
    if (nftImgFiredRef.current.has(tokenId)) return;
    const r = allRosters[selectedPlayer];
    if (!r) return;
    const players = POSITION_ORDER
      .flatMap((pos) => r[pos] || [])
      .sort((a, b) => a.pickNum - b.pickNum)
      .map((p) => {
        const [tm, ps] = p.playerId.split('-');
        return { team: tm || p.team, pos: ps || p.position, bye: p.byeWeek, adp: p.adp || '-', pick: p.pickNum };
      });
    if (players.length === 0) return;
    const tier: CardTier = /jackhof/i.test(draftLevel) ? 'jackhof' : /jackpot/i.test(draftLevel) ? 'jackpot' : /hof|hall of fame/i.test(draftLevel) ? 'hof' : 'pro';
    const leagueNo = title.replace(/\D/g, '');
    nftImgFiredRef.current.add(tokenId);
    void fetch('/api/nft/card-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenId, tier, passNo: tokenId, teamNo: tokenId, leagueNo, players }),
    }).catch(() => { nftImgFiredRef.current.delete(tokenId); });
  }, [walletAddress, selectedPlayer, draftLevel, realTokenIds, allRosters, title]);

  // ─── Loading ───
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] px-4 py-10">
        <div className="w-full lg:w-[900px] mx-auto space-y-6 text-center">
          <Skeleton width={160} height={24} className="mx-auto" />
          <Skeleton width={300} height={420} className="mx-auto rounded-2xl" />
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} width="100%" height={32} className="rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0a0a0f]">
        <ErrorState title="Couldn't load your team" message={error} icon="😔" onRetry={() => window.location.reload()} />
      </div>
    );
  }

  if (!roster) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <h2 className="text-white text-xl font-bold mb-2">No Results Yet</h2>
          <p className="text-white/50 mb-6 text-sm">This draft hasn&apos;t completed or no picks were found.</p>
          <Link href="/buy-drafts" className="px-5 py-2.5 bg-[#F3E216] text-black font-semibold rounded-xl">Buy Draft Pass</Link>
        </div>
      </div>
    );
  }

  // Build the obsidian team card from the selected roster (instant, no image wait).
  const cardTier: CardTier = /jackhof/i.test(draftLevel)
    ? 'jackhof'
    : /jackpot/i.test(draftLevel)
      ? 'jackpot'
      : /hof|hall of fame/i.test(draftLevel)
        ? 'hof'
        : 'pro';
  const cardPlayers = POSITION_ORDER
    .flatMap((pos) => roster[pos] || [])
    .sort((a, b) => a.pickNum - b.pickNum)
    .map((p) => {
      const [tm, ps] = p.playerId.split('-');
      return { team: tm || p.team, pos: ps || p.position, bye: p.byeWeek, adp: p.adp || '-', pick: p.pickNum };
    });
  // Team identity for the card: TEAM # = the SAME unified teamNumber the header
  // uses (realTokenId preferred, else cardId suffix), LEAGUE # = numeric league
  // id from the title. One source → header, card, and download never disagree.
  const cardTeamNo = teamNumber;
  const leagueNumber = title.replace(/\D/g, '');
  // The 1080x1350 (X-safe) NFT image for download/share (team card has no pass #).
  const ogImageUrl = cardPlayers.length > 0
    ? buildOgCardUrl({ tier: cardTier, players: cardPlayers, teamNo: cardTeamNo, leagueNo: leagueNumber })
    : '';

  return (
    <div className="min-h-screen bg-[#0a0a0f] px-4 py-8">
      <div className="w-full lg:w-[900px] mx-auto">

        {/* Header */}
        <div className="text-center mb-4">
          <h1 className="text-white text-2xl font-bold">League #{title.replace(/\D/g, '') || title}</h1>

          {/* Team # = the user's BBB4 NFT token ID (sequential 1-800).
              Skipped entirely for legacy cards with timestamp-shaped ids
              that would otherwise render as a 13-digit number. */}
          <div className="flex items-center justify-center gap-2 mt-2">
            {teamNumber && (
              <span className="text-white/70 text-sm font-medium">
                Team #{teamNumber}
              </span>
            )}
            {/* Only render the type badge once the authoritative level is known
                — no default 'Pro' flash for jackpot/HOF drafts. */}
            {draftLevel && (
              <>
                {teamNumber && <span className="text-white/10 text-xs">·</span>}
                <span
                  className="text-sm font-semibold"
                  style={{
                    color: draftLevel.toLowerCase() === 'jackhof' ? '#ef6c37' : draftLevel.toLowerCase() === 'jackpot' ? '#ef4444' : draftLevel.toLowerCase() === 'hof' || draftLevel.toLowerCase() === 'hall of fame' ? '#D4AF37' : '#a855f7',
                  }}
                >
                  {draftLevel}
                </span>
              </>
            )}
          </div>
        </div>

        {/* The obsidian team NFT card — rendered from roster data (instant) + download. */}
        <div className="text-center mb-6">
          <div className="flex justify-center">
            <TeamCardObsidian tier={cardTier} players={cardPlayers} teamNumber={cardTeamNo} leagueNumber={leagueNumber} width={300} />
          </div>
          {ogImageUrl && (
            <button
              onClick={() => handleSave(ogImageUrl)}
              className="mt-3 p-2 text-white/30 hover:text-white/70 transition-colors"
              aria-label="Download card"
            >
              {saved ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-400">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              )}
            </button>
          )}
        </div>

        {/* Marketplace CTA — the team is a tradeable NFT; invite them in. */}
        <Link
          href="/marketplace?tab=sell"
          className="block mb-6 rounded-2xl px-4 py-3.5 relative overflow-hidden border border-[#F3E216]/25 bg-gradient-to-br from-[#F3E216]/10 to-purple-500/10 hover:border-[#F3E216]/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#F3E216]/15 flex items-center justify-center text-lg flex-shrink-0">🛒</div>
            <div className="flex-1 text-left">
              <p className="text-white font-bold text-sm">Sell your team. Buy other teams.</p>
              <p className="text-white/55 text-xs mt-0.5">All season on our Marketplace</p>
            </div>
            <span className="text-[#F3E216] text-xl font-bold leading-none">›</span>
          </div>
        </Link>

        {/* Player Selector Dropdown */}
        {playerKeys.length > 1 && (
          <div className="mb-6">
            <select
              value={selectedPlayer}
              onChange={(e) => setSelectedPlayer(e.target.value)}
              className="w-full bg-[#1a1a24] border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm font-primary font-bold appearance-none cursor-pointer"
            >
              {playerKeys.map((key) => (
                <option key={key} value={key}>
                  {getPlayerLabel(key)}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Profile + Position Counts Header (old prod style) */}
        <div className="text-center mb-4">
          {/* Profile photo — auth pic for the current user, else the live
              resolved pfp (usersMap) then results-API PFP, then banana default.
              AvatarWithBadge so it shows the equipped badge/ripeness and never
              blanks — same component the in-draft roster uses. */}
          <div className="flex justify-center mb-2">
            <AvatarWithBadge
              imageUrl={
                (selectedPlayer.toLowerCase() === walletAddress.toLowerCase() && user?.profilePicture)
                  ? user.profilePicture
                  : (usersMap[selectedPlayer.toLowerCase()]?.imageUrl || roster.pfpImageUrl || '/banana-profile.png')
              }
              alt="Profile"
              size={40}
              equippedBadge={usersMap[selectedPlayer.toLowerCase()]?.equippedBadge}
              ripeness={usersMap[selectedPlayer.toLowerCase()]?.ripeness}
              useNextImage={false}
              className=""
            />
          </div>
          <p className="text-white font-bold text-lg mb-3">
            {getPlayerLabel(selectedPlayer)}
          </p>

          {/* Position counts row */}
          <div className="flex items-center justify-center gap-5">
            {POSITION_ORDER.map((pos) => (
              <div key={pos} className="text-center">
                <p className="font-primary font-bold text-sm" style={{ color: POS_COLORS[pos] }}>{pos}</p>
                <p className="text-white font-bold text-lg">{roster[pos]?.length || 0}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Roster Header Row */}
        <div className="flex items-center py-2 pl-[12px] border-b border-white/10 mt-6">
          <div className="flex-1" />
          <div className="w-[44px] text-center">
            <p className="text-white/40 text-xs font-bold uppercase">BYE</p>
          </div>
          <div className="w-[44px] text-center">
            <p className="text-white/40 text-xs font-bold uppercase">ADP</p>
          </div>
          <div className="w-[44px] text-center">
            <p className="text-white/40 text-xs font-bold uppercase">Pick</p>
          </div>
        </div>

        {/* Roster Sections */}
        <div className="pb-4">
          {POSITION_ORDER.map((pos) => {
            const players = roster[pos] || [];
            const color = POS_COLORS[pos];

            return (
              <div key={pos} className="border-b border-white/10 pb-4">
                {/* Position title */}
                <p className="font-primary font-bold pt-5 pb-1" style={{ fontSize: 21, color }}>
                  {pos}
                </p>

                {players.length === 0 ? (
                  <p className="text-white/30 my-3">--</p>
                ) : (
                  players.map((player) => (
                    <div
                      key={player.playerId + player.pickNum}
                      className="flex items-center py-[7px] pl-[10px]"
                      style={{ borderLeft: `2px solid ${positionColor(player.playerId)}` }}
                    >
                      <div className="flex-1">
                        <p className="text-white font-bold uppercase text-[13px]">{player.playerId}</p>
                      </div>
                      <div className="w-[44px] text-center">
                        <p className="text-white font-bold uppercase text-[13px]">{player.byeWeek}</p>
                      </div>
                      <div className="w-[44px] text-center">
                        <p className="text-white font-bold uppercase text-[13px]">{player.adp || '-'}</p>
                      </div>
                      <div className="w-[44px] text-center">
                        <p className="text-white font-bold uppercase text-[13px]">{player.pickNum}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            );
          })}
        </div>

        {/* Download roster image */}
        <div className="text-center py-4">
          <button
            onClick={handleSaveRoster}
            className="p-2 text-white/30 hover:text-white/70 transition-colors"
            aria-label="Download roster"
          >
            {rosterSaved ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-400">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            )}
          </button>
        </div>

        <div className="pb-8" />
      </div>
    </div>
  );
}
