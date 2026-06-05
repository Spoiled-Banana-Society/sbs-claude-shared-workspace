'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as draftStore from '@/lib/draftStore';
import { logger } from '@/lib/logger';
import { reportClientEvent } from '@/lib/clientErrors';
import { LOG_SOURCES } from '@/lib/logSources';
import type { DraftType } from '@/lib/draftRoomConstants';
import TeamCardObsidian from '@/components/draft/TeamCardObsidian';
import { toCardPlayers } from '@/lib/teamCardData';

interface RosterEntry {
  playerId: string;
  position: string;
  /** Overall draft pick number (1..150) — shown on the card. */
  pick?: number | string;
}

interface DraftCompleteProps {
  draftId?: string;
  /** URL of the generated card image — fetched when isDraftClosed transitions to true.
   *  Used here ONLY as the "generation finished" signal that drives the bar to 100%;
   *  the actual card art is shown on the roster page we route to. */
  generatedCardUrl?: string | null;
  /** Wallet address of the user (needed for the card-ready fetch). */
  walletAddress?: string;
  /** The user's drafted 15 picks, in pick order — rendered inside the card. */
  roster?: RosterEntry[];
  /** Draft type → drives the card border colour (pro=purple, hof=gold, jackpot=red). */
  draftType?: DraftType | null;
}

// ALWAYS play the full animation for at least this long, even if the card is
// already generated the instant we mount — otherwise the bar snaps to 100% and
// routes in a flash (the bug that made it feel "horrible / too fast").
const MIN_SHOW_MS = 4000;
// Soft ceiling the self-ease can reach; only the real "done" signal closes the
// last gap to 100% — so the bar never lies about being done.
const EASE_CEILING = 92;
// Brief beat at 100% so the user registers "done" before we route.
const DONE_HOLD_MS = 800;

const TYPE_COLOR: Record<DraftType, string> = {
  pro: '#a855f7',
  hof: '#D4AF37',
  jackpot: '#ef4444',
};
const STAMP_LABEL: Record<DraftType, string> = { pro: 'PRO', hof: 'HOF', jackpot: 'JACKPOT' };
const STAMP_COLOR: Record<DraftType, string> = { pro: '#a855f7', hof: '#C99700', jackpot: '#ef4444' };

// Warm the browser cache with the generated card image while the animation
// plays, so the roster page shows it INSTANTLY on arrival instead of running
// its own 404-retry loop (the "card takes time to update" bug).
function preloadCard(url: string) {
  if (typeof window === 'undefined' || !url) return;
  const img = new window.Image();
  img.src = url;
}

// The card thumbnail URL embeds the token id: .../thumbnails/{tokenId}-{uuid}_...png
// That token id IS the draft-pass number we show on the card.
function extractPassNo(url?: string | null): string | null {
  if (!url) return null;
  const m = url.match(/\/(\d{1,8})-[0-9a-f]/i);
  return m ? m[1] : null;
}

export function DraftComplete({
  draftId,
  generatedCardUrl: initialCardUrl,
  walletAddress,
  roster = [],
  draftType,
}: DraftCompleteProps) {
  const router = useRouter();
  const type: DraftType = draftType ?? 'pro';
  const accent = TYPE_COLOR[type];

  const [cardReady, setCardReady] = useState<boolean>(!!initialCardUrl);
  const [progress, setProgress] = useState(0);
  // Minimum-animation gate — flips true after MIN_SHOW_MS so we never flash.
  const [minElapsed, setMinElapsed] = useState(false);
  // True once the REAL NFT image is actually loadable — so we don't route to
  // the roster until the image will show there instantly (your timing idea:
  // do the waiting here on the generating screen, not on the roster).
  const [imageLoaded, setImageLoaded] = useState(false);
  // Draft-pass number shown on the card (derived from the card URL once known).
  const [passNumber, setPassNumber] = useState<string | null>(extractPassNo(initialCardUrl));
  const mountedAtRef = useRef(Date.now());
  // The actual generated card URL — handed to the roster page via sessionStorage
  // so it renders the image instantly instead of waiting on its own fetch.
  const cardUrlRef = useRef<string | null>(initialCardUrl || null);

  const destination = draftId ? `/draft-results/${draftId}` : '/drafting';

  // ── Card-ready signal ──────────────────────────────────────────────
  // The parent sets `initialCardUrl` once the backend finishes the card
  // (isDraftClosed → fetch). We also poll as a fallback. Either way, the
  // FIRST time the card URL is known is our authoritative "generation done"
  // signal — it snaps the bar to 100% and routes to the roster.
  useEffect(() => {
    if (initialCardUrl) { cardUrlRef.current = initialCardUrl; setPassNumber(extractPassNo(initialCardUrl)); preloadCard(initialCardUrl); setCardReady(true); }
  }, [initialCardUrl]);

  useEffect(() => {
    if (cardReady || !draftId || !walletAddress) return;
    let cancelled = false;

    logger.info('[DraftComplete] Generating digital team — polling for card-ready', { draftId, type });

    async function pollCardReady() {
      const { getDraftsApiUrl } = await import('@/lib/staging');
      const FALLBACK_URL = process.env.NEXT_PUBLIC_DRAFTS_API_URL || 'https://sbs-drafts-api-w5wydprnbq-uc.a.run.app';
      const baseUrl = getDraftsApiUrl() || FALLBACK_URL;

      // Retry up to 10 times over ~30s — matches prior behaviour. The card
      // usually lands in a few seconds; the cap only guards a stuck backend.
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          const res = await fetch(`${baseUrl}/owner/${walletAddress}/drafts/${draftId}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          if (cancelled) return;
          const imageUrl = data?.card?._imageUrl || data?.card?.imageUrl || data?.imageUrl;
          if (imageUrl) {
            logger.info('[DraftComplete] Card ready — team generated', { draftId, attempt });
            cardUrlRef.current = imageUrl;
            setPassNumber(extractPassNo(imageUrl));
            preloadCard(imageUrl);
            setCardReady(true);
            return;
          }
        } catch (err) {
          console.warn(`[DraftComplete] card-ready poll ${attempt + 1} failed:`, err);
        }
        if (cancelled) return;
        await new Promise(r => setTimeout(r, 3000));
      }
      // Exhausted: don't trap the user — treat as ready so we still route to
      // the roster (which keeps retrying for the image on its own).
      if (!cancelled) {
        logger.info('[DraftComplete] Card-ready poll exhausted — routing to roster anyway', { draftId });
        setCardReady(true);
      }
    }

    pollCardReady();
    return () => { cancelled = true; };
  }, [draftId, walletAddress, cardReady, type]);

  // Start the minimum-animation timer once on mount.
  useEffect(() => {
    const t = setTimeout(() => setMinElapsed(true), MIN_SHOW_MS);
    return () => clearTimeout(t);
  }, []);

  // ── Server-shipped timing traces (admin Logs tab) ──────────────────
  // So we can SEE, remotely: was the card ready instantly, how fast did it
  // generate, and how long was the screen actually shown before routing.
  useEffect(() => {
    reportClientEvent({
      source: LOG_SOURCES.draft.COMPLETE_TRACE,
      message: '[DraftComplete] generating screen mounted',
      route: 'DraftComplete',
      actor: walletAddress,
      context: { event: 'mount', draftId, type, rosterLen: roster.length, cardReadyOnMount: !!initialCardUrl },
    }, { skipThrottle: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!cardReady) return;
    reportClientEvent({
      source: LOG_SOURCES.draft.COMPLETE_TRACE,
      message: '[DraftComplete] card ready',
      route: 'DraftComplete',
      actor: walletAddress,
      context: { event: 'card_ready', draftId, msSinceMount: Date.now() - mountedAtRef.current },
    }, { skipThrottle: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardReady]);

  // Once we know the card URL, actually LOAD the image here (retrying while GCS
  // finishes the upload), so the roster page shows it instantly instead of
  // running its own retry loop. Capped so a stuck image never traps the user.
  useEffect(() => {
    if (!cardReady) return;
    const url = cardUrlRef.current;
    if (!url) { setImageLoaded(true); return; } // error path — nothing to wait on
    let cancelled = false;
    let attempt = 0;
    const tryLoad = () => {
      if (cancelled) return;
      const img = new window.Image();
      img.onload = () => { if (!cancelled) setImageLoaded(true); };
      img.onerror = () => {
        attempt += 1;
        if (attempt >= 8) { if (!cancelled) setImageLoaded(true); return; } // give up waiting, route anyway
        setTimeout(tryLoad, 700); // GCS still propagating — retry
      };
      img.src = attempt === 0 ? url : `${url}${url.includes('?') ? '&' : '?'}r=${attempt}`;
    };
    tryLoad();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardReady]);

  // "Done" = the card generated, its IMAGE is loadable, AND the full animation
  // has played. Guarantees the roster shows the real NFT instantly and we never
  // flash past in under MIN_SHOW_MS.
  const done = cardReady && minElapsed && imageLoaded;
  const doneRef = useRef(done);
  doneRef.current = done;

  // ── Real-time bar ──────────────────────────────────────────────────
  // Eases toward EASE_CEILING over MIN_SHOW_MS; only `done` closes the final
  // gap to 100%. So 100% always means "actually done" AND the animation played.
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      if (doneRef.current) return; // done-effect owns the final climb to 100
      const t = Math.min(1, (Date.now() - start) / MIN_SHOW_MS);
      const eased = Math.round(EASE_CEILING * (1 - Math.pow(1 - t, 2)));
      setProgress(prev => (prev >= eased ? prev : eased));
    }, 80);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (draftId) draftStore.removeDraft(draftId);
  }, [draftId]);

  // ── On done → fill to 100%, hold a beat, route to the roster ───────
  useEffect(() => {
    if (!done) return;
    setProgress(100);
    // Hand the loaded NFT image URL to the roster so it shows the real card
    // INSTANTLY (already loaded here) instead of running its own fetch/retry.
    try {
      if (draftId && cardUrlRef.current) sessionStorage.setItem(`sbs-draftcard:${draftId}`, cardUrlRef.current);
    } catch { /* ignore */ }
    logger.info('[DraftComplete] Team secured — routing to roster', { draftId, destination });
    reportClientEvent({
      source: LOG_SOURCES.draft.COMPLETE_TRACE,
      message: '[DraftComplete] routing to roster',
      route: 'DraftComplete',
      actor: walletAddress,
      context: { event: 'route', draftId, destination, totalMsShown: Date.now() - mountedAtRef.current },
    }, { skipThrottle: true });
    const t = setTimeout(() => router.push(destination), DONE_HOLD_MS);
    return () => clearTimeout(t);
  }, [done, router, destination, draftId, walletAddress]);

  // Reveal players in sync with the bar.
  const revealCount = Math.round((progress / 100) * roster.length);
  const cardPlayers = toCardPlayers(
    roster.map((r) => ({ playerId: r.playerId, position: r.position, pick: r.pick ?? '' })),
  );

  return (
    <div className="dc-wrap" style={{ '--c': accent } as React.CSSProperties}>
      <div className="dc-eyebrow" style={{ color: accent }}>Draft Complete</div>
      <h1 className="dc-h1">Generating your<br />Digital Team</h1>

      {/* ── the obsidian team card — roster locks in as the bar fills ── */}
      <div className="dc-cardwrap">
        <TeamCardObsidian tier={type} players={cardPlayers} revealCount={revealCount} width={244} />
      </div>

      {/* type + draft-pass # badge */}
      <div className="dc-badge" style={{ color: STAMP_COLOR[type], borderColor: accent }}>
        {STAMP_LABEL[type]}{passNumber ? ` · DRAFT PASS #${passNumber}` : ''}
      </div>

      {/* ── real-time bar + prize copy ── */}
      <div className="dc-pwrap">
        <div className="dc-barrow">
          <div className="dc-ptrack">
            <div
              className="dc-pfill"
              style={{ width: `${progress}%`, background: `linear-gradient(90deg, ${accent}, #fff)` }}
            />
          </div>
          <div className="dc-ppct" style={{ color: accent }}>{progress}%</div>
        </div>
        <div className="dc-ptext">
          <b>Compete for weekly and season-long prizes.</b><br />
          <b>Sell your team. Buy other teams.</b><br />
          <span className="dc-mut">All season on our Marketplace.</span>
        </div>
      </div>

      <style jsx>{`
        .dc-wrap{min-height:100vh;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:28px 18px}
        .dc-eyebrow{font-size:11px;letter-spacing:3px;text-transform:uppercase;font-weight:800;margin-top:4px}
        .dc-h1{font-size:23px;font-weight:900;font-style:italic;text-transform:uppercase;letter-spacing:.4px;margin-top:7px;line-height:1.05;
          background:linear-gradient(180deg,#fff,rgba(255,255,255,.62));-webkit-background-clip:text;background-clip:text;color:transparent}

        .dc-cardwrap{margin:18px auto 0;display:flex;justify-content:center}
        .dc-forge{position:relative;margin:16px auto 0;width:min(236px,72vw)}
        .dc-card{width:100%;aspect-ratio:5/7;border-radius:16px;position:relative;overflow:hidden;padding:8px}
        .dc-ticket{height:100%;border-radius:10px;background:linear-gradient(165deg,#f0dc57,#e2c93f);position:relative;border:1.5px solid #23205c;padding:8px;display:flex;flex-direction:column;z-index:2}
        .dc-thead{position:relative;text-align:center;color:#23205c;font-weight:900;font-size:9px;letter-spacing:.2px;padding:2px 8px 4px;border-bottom:1.2px solid rgba(35,32,92,.5);font-style:italic;white-space:nowrap}
        .dc-rows{flex:1;display:flex;flex-direction:column;justify-content:space-between;padding:4px 1px}
        .dc-row{display:flex;align-items:center;height:13px}
        .dc-name{flex:1;text-align:center;color:#23205c;font-weight:800;font-style:italic;font-size:8.5px;letter-spacing:.2px;white-space:nowrap;opacity:0;transform:translateY(3px)}
        .dc-row.on .dc-name{animation:dcLock .55s cubic-bezier(.16,1,.3,1) forwards}
        @keyframes dcLock{0%{opacity:0;transform:translateY(4px) scale(.96);filter:brightness(3)}60%{filter:brightness(1.6)}100%{opacity:1;transform:translateY(0) scale(1);filter:brightness(1)}}
        .dc-tfoot{display:flex;align-items:center;justify-content:center;gap:5px;padding-top:4px;border-top:1.2px solid rgba(35,32,92,.5)}
        .dc-tfoot img{width:13px;height:13px;object-fit:contain}
        .dc-tfoot span{color:#23205c;font-weight:900;font-size:7px;letter-spacing:.3px;font-style:italic}

        .dc-foil{position:absolute;inset:0;border-radius:16px;z-index:4;pointer-events:none;mix-blend-mode:color-dodge;opacity:.35;
          background:linear-gradient(125deg,rgba(255,0,128,.6),rgba(0,255,200,.5),rgba(120,80,255,.6),rgba(255,210,0,.5),rgba(0,200,255,.6));background-size:300% 300%;animation:dcHue 6s ease-in-out infinite}
        @keyframes dcHue{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}
        .dc-shine{position:absolute;inset:0;border-radius:16px;z-index:5;pointer-events:none;mix-blend-mode:screen;
          background:linear-gradient(115deg,transparent 42%,rgba(255,255,255,.5) 50%,transparent 58%);background-size:250% 100%;animation:dcSweep 2.8s linear infinite}
        @keyframes dcSweep{0%{background-position:170% 0}100%{background-position:-170% 0}}
        .dc-scan{position:absolute;left:6%;right:6%;height:2px;border-radius:2px;top:0;z-index:6;pointer-events:none;
          background:linear-gradient(90deg,transparent,var(--c),transparent);box-shadow:0 0 16px 3px var(--c);animation:dcScan 1.5s cubic-bezier(.45,0,.55,1) infinite}
        @keyframes dcScan{0%{top:8%;opacity:0}12%{opacity:1}88%{opacity:1}100%{top:92%;opacity:0}}
        .dc-spark{position:absolute;width:4px;height:4px;border-radius:50%;background:#fff;z-index:6;opacity:0;animation:dcSp 1.9s infinite}
        @keyframes dcSp{0%,100%{opacity:0;transform:scale(.3)}45%{opacity:1;transform:scale(1.3)}}
        .dc-forge.done .dc-scan{opacity:0;transition:opacity .4s}
        .dc-forge.done .dc-foil{opacity:.5;transition:opacity .5s}

        .dc-notch{position:absolute;width:22px;height:22px;border-radius:50%;background:#000;top:50%;transform:translateY(-50%);z-index:7;box-shadow:inset 0 0 5px rgba(0,0,0,.6)}
        .dc-notch-l{left:-11px}.dc-notch-r{right:-11px}

        .dc-badge{margin-top:13px;font-size:11px;font-weight:900;letter-spacing:1.5px;padding:4px 14px;border-radius:999px;border:1.5px solid;background:rgba(0,0,0,.3)}

        .dc-pwrap{width:248px;max-width:88vw;margin:15px auto 0}
        .dc-barrow{display:flex;align-items:center;gap:10px}
        .dc-ptrack{flex:1;height:7px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden;position:relative}
        .dc-pfill{height:100%;border-radius:999px;transition:width .2s linear;position:relative}
        .dc-pfill::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.6),transparent);background-size:50% 100%;animation:dcGloss 1.2s linear infinite}
        @keyframes dcGloss{0%{background-position:-50% 0}100%{background-position:150% 0}}
        .dc-ppct{font-size:13px;font-weight:800;font-variant-numeric:tabular-nums}
        .dc-ptext{margin-top:12px;font-size:12px;line-height:1.5;text-align:center;color:rgba(255,255,255,.6)}
        .dc-ptext :global(b){color:#fff;font-weight:800}
        .dc-mut{color:rgba(255,255,255,.5);font-weight:600}
      `}</style>
    </div>
  );
}
