'use client';

/**
 * The Banana Pack visuals — the sealed pack and the physical pile — extracted
 * verbatim from app/drop/page.tsx so ZONE PACKS (inside the Banana Zone promo
 * modal) renders the exact same pack people ripped in THE DROP (Richard 8/23:
 * "same visual where you see the pack and click it open"). The reveal
 * ceremony itself stays in components/promos/DropPackReveal.
 *
 * Carries its own global styles, so it works anywhere — the /drop page keeps
 * an identical copy of these rules in its own style block; the duplication is
 * harmless (same selectors, same declarations).
 */

import React from 'react';
import Image from 'next/image';

export function SealedPack({ w = 112, dusty = false }: { w?: number; dusty?: boolean }) {
  const s = w / 132;
  return (
    <div
      className={`drop-sealed ${dusty ? 'drop-sealed-dusty' : ''}`}
      style={{ width: w, height: Math.round(w * 1.43) }}
    >
      <div className="drop-sealed-crimp" style={{ height: Math.max(12, Math.round(18 * s)) }} />
      <div
        className="absolute left-0 right-0 flex flex-col items-center"
        style={{ top: Math.round(38 * s), gap: Math.round(5 * s) }}
      >
        <Image
          src="/sbs-logo-white-v2.png" alt="" width={36} height={36}
          style={{ width: Math.round(36 * s), height: 'auto' }}
        />
        <span
          className="font-black tracking-[0.2em] text-white/90"
          style={{ fontSize: Math.max(9, Math.round(13 * s)) }}
        >
          SBS
        </span>
      </div>
      <div className="drop-sealed-band" style={{ height: Math.round(28 * s), top: '60%' }}>
        <span style={{ fontSize: Math.max(7, Math.round(11 * s)) }}>Banana Pack</span>
      </div>
      {w >= 108 && (
        <span
          className="absolute left-0 right-0 text-center font-extrabold uppercase tracking-[0.16em] text-white/50"
          style={{ bottom: Math.round(12 * s), fontSize: 7 }}
        >
          1 prize inside
        </span>
      )}
      <PackStyles />
    </div>
  );
}

/** Fan layouts for 1–5 packs. Sides render first so the center sits on top. */
const FANS: Record<number, Array<{ r: number; x: number; y: number }>> = {
  1: [{ r: 0, x: 0, y: 0 }],
  2: [{ r: -7, x: -34, y: 2 }, { r: 7, x: 34, y: 2 }],
  3: [{ r: -10, x: -48, y: 4 }, { r: 10, x: 48, y: 4 }, { r: 0, x: 0, y: 0 }],
  4: [{ r: -14, x: -68, y: 7 }, { r: 14, x: 68, y: 7 }, { r: -5, x: -26, y: 1 }, { r: 5, x: 26, y: 1 }],
  5: [{ r: -14, x: -70, y: 7 }, { r: 14, x: 70, y: 7 }, { r: -7, x: -36, y: 2 }, { r: 7, x: 36, y: 2 }, { r: 0, x: 0, y: 0 }],
};

/**
 * The pile — the stack IS the visual. Bobs gently while sealed, shakes when
 * asked, and (new for ZONE PACKS) accepts an onClick so tapping the pile
 * itself rips a pack.
 */
export function PackPile({ count, shaking = false, stamped = false, onClick, clickHint }: {
  count: number;
  shaking?: boolean;
  stamped?: boolean;
  /** Tapping the pile opens a pack — set only while packs are openable. */
  onClick?: () => void;
  /** Tiny label shown over the pile when it's clickable ("TAP TO RIP"). */
  clickHint?: string;
}) {
  const fan = FANS[Math.min(Math.max(count, 1), 5)];
  const ghost = count === 0;
  return (
    <div
      className={`relative mx-auto ${onClick && !ghost ? 'cursor-pointer select-none' : ''}`}
      style={{ height: 224, maxWidth: 340 }}
      onClick={onClick && !ghost ? onClick : undefined}
      role={onClick && !ghost ? 'button' : undefined}
      tabIndex={onClick && !ghost ? 0 : undefined}
      onKeyDown={onClick && !ghost ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
    >
      {fan.map((f, i) => {
        const center = f.r === 0 && f.x === 0;
        const tf = `rotate(${f.r}deg) translateX(${f.x}px) translateY(${f.y}px)`;
        return (
          <div
            key={i}
            className={`absolute bottom-3 left-1/2 -ml-[56px] ${
              shaking ? 'drop-pile-shake' : center ? 'drop-pile-bob' : ''}`}
            style={{
              ['--tf' as string]: tf,
              transform: tf,
              transformOrigin: '50% 90%',
              opacity: ghost ? 0.35 : 1,
              zIndex: center ? 3 : 1,
              animationDuration: shaking ? `${0.42 + i * 0.05}s` : undefined,
            }}
          >
            <SealedPack w={112} />
          </div>
        );
      })}
      {!ghost && (
        <span
          className="absolute z-[5] rounded-full bg-banana px-3.5 py-1 text-[15px] font-black text-black"
          style={{ top: 2, right: 'calc(50% - 120px)', transform: 'rotate(6deg)' }}
        >
          ×{count}
        </span>
      )}
      {!ghost && onClick && clickHint && (
        <span className="pointer-events-none absolute inset-x-0 z-[6] flex justify-center" style={{ bottom: -6 }}>
          <span className="rounded-full border border-banana/50 bg-black/70 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-banana">
            {clickHint}
          </span>
        </span>
      )}
      {stamped && (
        <span className="pointer-events-none absolute inset-0 z-[6] flex items-center justify-center">
          <span className="drop-stamp-in rounded-lg border-[3px] border-banana bg-[#020204]/85 px-6 py-2.5 text-lg font-black uppercase tracking-[0.14em] text-banana">
            Locked · prizes inside
          </span>
        </span>
      )}
    </div>
  );
}

/** The pack/pile CSS, identical to the /drop page's block. Rendered from
 *  SealedPack so any surface using these components gets the styles. */
function PackStyles() {
  return (
    <style jsx global>{`
      .drop-sealed{
        position:relative; border-radius:10px; overflow:hidden; flex:none;
        background:linear-gradient(160deg,#22222e 0%,#12121a 55%,#0a0a0f 100%);
        outline:1px solid #33333f; outline-offset:-1px;
      }
      .drop-sealed-crimp{
        position:absolute; top:0; left:0; right:0; border-radius:10px 10px 0 0;
        background:repeating-linear-gradient(90deg,#3a3a46 0 3px,#1a1a24 3px 6px);
      }
      .drop-sealed-band{
        position:absolute; left:-12px; right:-12px;
        display:flex; align-items:center; justify-content:center;
        background:linear-gradient(90deg,#f59e0b,#fbbf24 40%,#fcd34d);
        transform:rotate(-6deg);
      }
      .drop-sealed-band span{
        color:#0a0a0f; font-weight:900; letter-spacing:.08em; text-transform:uppercase;
      }
      .drop-sealed-dusty{filter:brightness(.62) saturate(.75)}
      @keyframes drop-pile-bob-kf{
        0%,100%{transform:var(--tf) translateY(0)}
        50%{transform:var(--tf) translateY(-7px) rotate(-1.2deg)}
      }
      .drop-pile-bob{animation:drop-pile-bob-kf 3.2s ease-in-out infinite}
      @keyframes drop-pile-shake-kf{
        0%,100%{transform:var(--tf)}
        50%{transform:var(--tf) rotate(1.6deg) translateY(-4px)}
      }
      .drop-pile-shake{animation:drop-pile-shake-kf .45s ease-in-out infinite}
      @keyframes drop-stamp-kf{
        from{transform:rotate(-7deg) scale(2.4); opacity:0}
        to{transform:rotate(-7deg) scale(1); opacity:1}
      }
      .drop-stamp-in{animation:drop-stamp-kf .35s cubic-bezier(.2,2.2,.4,1) both}
      @media (prefers-reduced-motion: reduce){
        .drop-pile-bob,.drop-pile-shake,.drop-stamp-in{animation:none !important}
      }
    `}</style>
  );
}
