'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as draftStore from '@/lib/draftStore';
import { logger } from '@/lib/logger';
import { reportClientEvent } from '@/lib/clientErrors';
import { LOG_SOURCES } from '@/lib/logSources';
import type { DraftType } from '@/lib/draftRoomConstants';

interface RosterEntry {
  playerId: string;
  position: string;
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
const TYPE_FOIL: Record<DraftType, string> = {
  pro: 'linear-gradient(135deg,#5b1d9e 0%,#e9d5ff 22%,#a855f7 46%,#f3e8ff 62%,#7e22ce 82%,#c084fc 100%)',
  hof: 'linear-gradient(135deg,#9c7619 0%,#ffe9a0 22%,#d4af37 42%,#fff6cf 58%,#c0941d 78%,#e8c869 100%)',
  jackpot: 'linear-gradient(135deg,#7f1d1d 0%,#fecaca 22%,#ef4444 46%,#fee2e2 60%,#b91c1c 82%,#f87171 100%)',
};
const STAMP_LABEL: Record<DraftType, string> = { pro: 'PRO', hof: 'HOF', jackpot: 'JACKPOT' };
const STAMP_COLOR: Record<DraftType, string> = { pro: '#a855f7', hof: '#C99700', jackpot: '#ef4444' };

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
  const mountedAtRef = useRef(Date.now());

  const destination = draftId ? `/draft-results/${draftId}` : '/drafting';

  // ── Card-ready signal ──────────────────────────────────────────────
  // The parent sets `initialCardUrl` once the backend finishes the card
  // (isDraftClosed → fetch). We also poll as a fallback. Either way, the
  // FIRST time the card URL is known is our authoritative "generation done"
  // signal — it snaps the bar to 100% and routes to the roster.
  useEffect(() => {
    if (initialCardUrl) setCardReady(true);
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

  // "Done" = the card has actually generated AND the full animation has played.
  // This is what guarantees the screen never flashes past in under MIN_SHOW_MS.
  const done = cardReady && minElapsed;
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

  return (
    <div className="dc-wrap" style={{ '--c': accent } as React.CSSProperties}>
      <div className="dc-eyebrow" style={{ color: accent }}>Draft Complete</div>
      <h1 className="dc-h1">Finalizing your<br />Digital Team</h1>

      {/* ── the card ── */}
      <div className={`dc-forge${cardReady ? ' done' : ''}`}>
        <div className="dc-card" style={{ background: TYPE_FOIL[type] }}>
          <div className="dc-ticket">
            <div className="dc-tinner" />
            <div className="dc-thead">
              BANANA BEST BALL IV
              <span
                className={`dc-stamp${type === 'jackpot' ? ' jp' : ''}`}
                style={{ color: STAMP_COLOR[type] }}
              >
                {STAMP_LABEL[type]}
              </span>
            </div>
            <div className="dc-rows">
              {roster.slice(0, 15).map((p, i) => (
                <div key={`${p.playerId}-${i}`} className={`dc-row${i < revealCount ? ' on' : ''}`}>
                  <span className="dc-name">{p.playerId}</span>
                </div>
              ))}
            </div>
            <div className="dc-tfoot">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/sbs-logo-black.png" alt="SBS" />
              <span>SPOILED BANANA SOCIETY</span>
            </div>
          </div>
          <div className="dc-holo" />
          {!cardReady && <div className="dc-scan" />}
        </div>
      </div>

      {/* ── real-time bar ── */}
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
        .dc-wrap{min-height:100vh;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px 18px}
        .dc-eyebrow{font-size:12px;letter-spacing:3px;text-transform:uppercase;font-weight:800;margin-top:6px}
        .dc-h1{font-size:30px;font-weight:900;font-style:italic;text-transform:uppercase;letter-spacing:.4px;margin-top:8px;line-height:1.05;
          background:linear-gradient(180deg,#fff,rgba(255,255,255,.65));-webkit-background-clip:text;background-clip:text;color:transparent}

        .dc-forge{margin:20px auto 0;position:relative;width:236px;max-width:74vw}
        .dc-card{position:relative;border-radius:18px;aspect-ratio:5/7;overflow:hidden;padding:7px}
        .dc-ticket{height:100%;border-radius:11px;background:linear-gradient(165deg,#f0dc57,#e2c93f);position:relative;border:1.5px solid #23205c;padding:8px;display:flex;flex-direction:column}
        .dc-tinner{position:absolute;inset:5px;border:1.2px solid rgba(35,32,92,.5);border-radius:8px;pointer-events:none}
        .dc-thead{position:relative;text-align:center;color:#23205c;font-weight:900;font-size:9px;letter-spacing:.2px;padding:3px 8px 4px;border-bottom:1.2px solid rgba(35,32,92,.5);font-style:italic;white-space:nowrap}
        .dc-stamp{position:absolute;top:3px;right:9px;font-size:9px;font-weight:900;letter-spacing:.4px;line-height:1;white-space:nowrap;-webkit-text-stroke:.3px currentColor;text-shadow:0 1px 1px rgba(0,0,0,.2)}
        .dc-stamp.jp{font-size:6.5px;top:4px;right:6px;letter-spacing:0;-webkit-text-stroke:.45px currentColor}
        .dc-rows{flex:1;display:flex;flex-direction:column;justify-content:space-between;padding:4px 1px}
        .dc-row{display:flex;align-items:center;height:14px}
        .dc-name{flex:1;text-align:center;color:#23205c;font-weight:800;font-style:italic;font-size:9px;letter-spacing:.2px;white-space:nowrap;opacity:0;transform:translateY(3px)}
        .dc-row.on .dc-name{animation:dcLock .5s cubic-bezier(.16,1,.3,1) forwards}
        @keyframes dcLock{0%{opacity:0;transform:translateY(3px);filter:brightness(2.4)}100%{opacity:1;transform:translateY(0);filter:brightness(1)}}
        .dc-tfoot{display:flex;align-items:center;justify-content:center;gap:6px;padding-top:5px;border-top:1.2px solid rgba(35,32,92,.5)}
        .dc-tfoot img{width:14px;height:14px;object-fit:contain}
        .dc-tfoot span{color:#23205c;font-weight:900;font-size:8px;letter-spacing:.3px;font-style:italic}

        .dc-holo{position:absolute;inset:0;border-radius:18px;z-index:5;pointer-events:none;mix-blend-mode:screen;
          background:linear-gradient(115deg,transparent 38%,var(--c) 49%,#fff 50%,var(--c) 51%,transparent 62%);background-size:300% 300%;animation:dcHolo 2.8s linear infinite;opacity:.4}
        @keyframes dcHolo{0%{background-position:130% 0}100%{background-position:-130% 0}}
        .dc-scan{position:absolute;left:5%;right:5%;height:2px;border-radius:2px;top:0;z-index:6;pointer-events:none;
          background:linear-gradient(90deg,transparent,var(--c),transparent);animation:dcScan 1.9s cubic-bezier(.45,0,.55,1) infinite}
        @keyframes dcScan{0%{top:5%;opacity:0}10%{opacity:.9}90%{opacity:.9}100%{top:95%;opacity:0}}
        .dc-forge.done .dc-holo{opacity:0;transition:opacity .4s}

        .dc-pwrap{width:300px;max-width:88vw;margin:22px auto 0}
        .dc-barrow{display:flex;align-items:center;gap:10px}
        .dc-ptrack{flex:1;height:7px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden;position:relative}
        .dc-pfill{height:100%;border-radius:999px;transition:width .2s linear;position:relative}
        .dc-pfill::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.6),transparent);background-size:50% 100%;animation:dcGloss 1.3s linear infinite}
        @keyframes dcGloss{0%{background-position:-50% 0}100%{background-position:150% 0}}
        .dc-ppct{font-size:13px;font-weight:800;font-variant-numeric:tabular-nums}
        .dc-ptext{margin-top:11px;font-size:12px;line-height:1.5;text-align:center;color:rgba(255,255,255,.6)}
        .dc-ptext :global(b){color:#fff;font-weight:800}
        .dc-mut{color:rgba(255,255,255,.5);font-weight:600}
      `}</style>
    </div>
  );
}
