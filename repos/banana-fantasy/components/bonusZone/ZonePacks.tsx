'use client';

/**
 * ZONE PACKS — the pack room INSIDE the Banana Zone promo (Richard 8/23:
 * "the pack page will be gone, people will just get there from the promo"
 * + "same visual where you see the pack and click it open").
 *
 * Mounted in the zone card's modal. Renders NOTHING until the zone drop
 * switch is on (the status API returns enabled:false while dark). The hero
 * is THE DROP's physical pack pile — same sealed pack, same bob, same tear
 * ceremony — now tappable: click the pile, a pack rips. Batches: drafts 1
 * to 25 hide 6 JackHOF seats, 26 to 50 hide 4; packs unlock the INSTANT the
 * batch's last draft fills (no 9pm). Old DROP-night packs and past-window
 * packs stay openable here too — nothing earned is ever stranded.
 *
 * ⚠️ Rule #0: the fetch effect keys on [wallet] only — a stable scalar.
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { DropPackReveal, type RevealPrize } from '@/components/promos/DropPackReveal';
import { SealedPack, PackPile } from '@/components/promos/PackVisuals';
import { JackHofWordmark } from '@/components/ui/JackHofWordmark';

interface ZoneBand {
  bandId: string;
  band: number;
  fromPos: number;
  toPos: number;
  tickets: number;
  status: 'earning' | 'locked';
  packCount: number;
  revealAtMs: number | null;
  winners: Array<{ userId: string }> | null;
  myPacks: number;
  myUnopened: number;
  myUnopenedIds: string[];
}

interface ZoneStatus {
  enabled: boolean;
  windowStart: number | null;
  position: number | null;
  bands: ZoneBand[];
  backlog: ZoneBand[];
}

interface LegacyDropState {
  status: 'earning' | 'locked' | 'settled';
  you: { sealed: number } | null;
  nightId: string;
  previous: Array<{ nightId: string; sealed: number }>;
}

interface OpenResult { packId: string; prize: RevealPrize }

/**
 * PREVIEW mode (/preview/zone-drop): wrap the REAL PromoModal in this
 * provider and ZonePacks renders from the given mock instead of fetching —
 * opens play the reveal locally (first rip = JackHOF seat, then empties) and
 * never touch an API. Production never mounts the provider, so this is inert.
 */
export interface ZonePacksPreviewData { zone: ZoneStatus; legacy: LegacyDropState | null }
export const ZonePacksPreviewContext = createContext<ZonePacksPreviewData | null>(null);

const openable = (b: ZoneBand) =>
  b.status === 'locked' && (b.revealAtMs === null || Date.now() >= b.revealAtMs);

/** Compact batch chip above the pile — state at a glance, pile stays hero. */
function BatchChip({ b, position }: { b: ZoneBand; position: number | null }) {
  const ripe = openable(b);
  const live = b.status === 'earning' && position !== null && position >= b.fromPos && position <= b.toPos;
  const state = ripe && b.myUnopened > 0 ? 'OPEN NOW'
    : ripe ? `opened · ${b.winners?.length ?? 0} seat${(b.winners?.length ?? 0) === 1 ? '' : 's'} found`
      : live ? `draft ${position} of ${b.toPos}`
        : 'up next';
  return (
    <div className={`flex-1 rounded-xl border px-3 py-2 text-center ${
      ripe && b.myUnopened > 0 ? 'border-emerald-400/45 bg-emerald-400/[0.06]'
        : live ? 'border-banana/40 bg-banana/[0.05]'
          : 'border-white/[0.08] bg-white/[0.02]'}`}
    >
      <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-white/45">
        Drafts {b.fromPos} to {b.toPos}
      </p>
      <p className="mt-0.5 text-[12px] font-black text-white leading-tight">
        {b.tickets}× <JackHofWordmark size={11} /> <span className="font-extrabold text-white/60">SEATS</span>
      </p>
      <p className={`mt-0.5 text-[10px] font-bold uppercase tracking-[0.08em] ${
        ripe && b.myUnopened > 0 ? 'text-emerald-300' : live ? 'text-banana/90' : 'text-white/40'}`}>
        {state}
      </p>
      {live && (
        <div className="mx-auto mt-1 h-1 w-full max-w-[90px] overflow-hidden rounded-full bg-white/[0.08]">
          <div
            className="h-full rounded-full bg-banana"
            style={{ width: `${Math.min(100, Math.round((((position ?? b.fromPos) - b.fromPos + 1) / (b.toPos - b.fromPos + 1)) * 100))}%` }}
          />
        </div>
      )}
    </div>
  );
}

export function ZonePacks() {
  const { user, isLoggedIn } = useAuth();
  const preview = useContext(ZonePacksPreviewContext);
  const wallet = user?.walletAddress ?? null;

  const [zone, setZone] = useState<ZoneStatus | null>(null);
  const [legacy, setLegacy] = useState<LegacyDropState | null>(null);
  const [opening, setOpening] = useState(false);
  const [reveal, setReveal] = useState<OpenResult | null>(null);
  const [queue, setQueue] = useState<OpenResult[]>([]);
  const [batchMode, setBatchMode] = useState(false);
  const [seatsWon, setSeatsWon] = useState(0);
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    if (preview) { setZone(preview.zone); setLegacy(preview.legacy); return; }
    try {
      const qs = wallet ? `?wallet=${encodeURIComponent(wallet)}` : '';
      const [zres, lres] = await Promise.all([
        fetch(`/api/zone-drop/status${qs}`, { cache: 'no-store' }),
        wallet ? fetch(`/api/promos/drop${qs}`, { cache: 'no-store' }) : Promise.resolve(null),
      ]);
      if (zres.ok) setZone(await zres.json() as ZoneStatus);
      if (lres?.ok) setLegacy(await lres.json() as LegacyDropState);
    } catch { /* transient */ }
  }, [wallet, preview]);

  useEffect(() => { void load(); }, [load]);

  // Preview rips: pure local theater, first pack holds the seat.
  const previewRippedRef = useRef(0);
  const openPreview = useCallback((all: boolean) => {
    setZone((z) => {
      if (!z) return z;
      const bands = z.bands.map((b) => {
        if (b.myUnopened === 0 || !(b.status === 'locked')) return b;
        const take = all ? b.myUnopened : 1;
        const opened: OpenResult[] = Array.from({ length: take }, () => ({
          packId: `mock-${previewRippedRef.current}`,
          prize: (previewRippedRef.current++ === 0 ? { kind: 'jackhof' } : { kind: 'none' }) as RevealPrize,
        }));
        setSeatsWon((n) => n + opened.filter((o) => o.prize.kind === 'jackhof').length);
        setBatchMode(opened.length > 1);
        setReveal(opened[0]);
        if (opened.length > 1) setQueue(opened.slice(1));
        return { ...b, myUnopened: b.myUnopened - take, myUnopenedIds: b.myUnopenedIds.slice(take) };
      });
      return { ...z, bands };
    });
  }, []);

  const openZone = useCallback(async (bandId: string, packId?: string) => {
    if (preview) { openPreview(!packId); return; }
    if (!wallet || busyRef.current) return;
    busyRef.current = true;
    setOpening(true);
    try {
      const res = await fetch('/api/zone-drop/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: wallet, bandId, ...(packId ? { packId } : {}) }),
      });
      if (!res.ok) return;
      const data = await res.json() as { ok: boolean; opened: OpenResult[] };
      if (!data.ok || data.opened.length === 0) return;
      setSeatsWon((n) => n + data.opened.filter((o) => o.prize.kind === 'jackhof').length);
      setBatchMode(data.opened.length > 1);
      setReveal(data.opened[0]);
      if (data.opened.length > 1) setQueue(data.opened.slice(1));
      await load();
    } finally {
      busyRef.current = false;
      setOpening(false);
    }
  }, [wallet, load, preview, openPreview]);

  // Old DROP nights: sealed packs from the retired promo stay openable here.
  const openLegacy = useCallback(async (nightId: string) => {
    if (preview) { openPreview(false); return; }
    if (!wallet || busyRef.current) return;
    busyRef.current = true;
    setOpening(true);
    try {
      const res = await fetch('/api/promos/drop/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: wallet, nightId }),
      });
      if (!res.ok) return;
      const data = await res.json() as { opened: OpenResult[]; seat: boolean };
      if (data.opened.length === 0) return;
      if (data.seat) setSeatsWon((n) => n + 1);
      setBatchMode(data.opened.length > 1);
      setReveal(data.opened[0]);
      if (data.opened.length > 1) setQueue(data.opened.slice(1));
      await load();
    } finally {
      busyRef.current = false;
      setOpening(false);
    }
  }, [wallet, load, preview, openPreview]);

  const onRevealDone = useCallback(() => {
    setQueue((q) => {
      if (q.length === 0) { setReveal(null); return q; }
      setReveal(q[0]);
      return q.slice(1);
    });
  }, []);

  if (!zone?.enabled) return null;

  // The pile shows the batch that matters most right now: one you can OPEN,
  // else the one you're earning into.
  const ripeBand = zone.bands.find((b) => openable(b) && b.myUnopened > 0)
    ?? zone.backlog.find((b) => b.myUnopened > 0)
    ?? null;
  const liveBand = zone.bands.find((b) =>
    b.status === 'earning' && zone.position !== null && zone.position >= b.fromPos && zone.position <= b.toPos) ?? null;
  const pileCount = ripeBand ? ripeBand.myUnopened : (liveBand?.myPacks ?? 0);
  const canRip = !!ripeBand && pileCount > 0;

  const legacyNights: Array<{ nightId: string; sealed: number }> = [
    ...(legacy && legacy.status !== 'earning' && (legacy.you?.sealed ?? 0) > 0
      ? [{ nightId: legacy.nightId, sealed: legacy.you?.sealed ?? 0 }] : []),
    ...(legacy?.previous ?? []),
  ];
  const dustyBacklog = zone.backlog.filter((b) => b.myUnopened > 0 && b.bandId !== ripeBand?.bandId);

  return (
    <div className="mb-5" data-testid="zone-packs">
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/50">
          📦 Your packs
        </p>
        {!isLoggedIn && !preview && <p className="text-[11px] text-white/40">Log in to see yours</p>}
      </div>

      <div className="mt-3 flex gap-2">
        {zone.bands.map((b) => <BatchChip key={b.bandId} b={b} position={zone.position} />)}
      </div>

      {/* ── The pile — same pack, same bob, now tap-to-rip ── */}
      <div className="mt-4 text-center">
        <PackPile
          count={pileCount}
          onClick={canRip && !opening ? () => openZone(ripeBand!.bandId, ripeBand!.myUnopenedIds[0]) : undefined}
          clickHint={canRip ? 'TAP A PACK TO RIP' : undefined}
        />
        <p className="mt-2 text-[13px] text-white/50">
          {canRip ? (
            <>
              <b className="text-white">{pileCount} sealed pack{pileCount === 1 ? '' : 's'}</b>
              {' '}&middot; {ripeBand!.tickets} <JackHofWordmark size={12} /> seat{ripeBand!.tickets === 1 ? '' : 's'} were dealt into this batch
            </>
          ) : pileCount > 0 ? (
            <>
              <b className="text-white">{pileCount} sealed pack{pileCount === 1 ? '' : 's'}</b>
              {' '}&middot; open at draft {liveBand?.toPos}, or instantly if the Jackpot hits
            </>
          ) : (
            <>No packs yet &middot; every paid Banana Zone draft you fill earns 1</>
          )}
        </p>
        {canRip && pileCount > 1 && (
          <button
            onClick={() => openZone(ripeBand!.bandId)}
            disabled={opening}
            className="mt-3 rounded-2xl border border-white/[0.12] px-6 py-2.5 font-bold text-white/80 transition-colors hover:bg-white/[0.04] disabled:opacity-50"
          >
            Open all {pileCount}
          </button>
        )}
      </div>

      {/* ── The vault — dusty sealed packs from before, same as THE DROP's ── */}
      {(dustyBacklog.length > 0 || legacyNights.length > 0) && (
        <div className="mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/45">
            The vault
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-4">
            {dustyBacklog.map((b) => (
              <div key={b.bandId} className="relative text-center">
                <div className="relative">
                  <SealedPack w={84} dusty />
                  <span className="absolute inset-x-0 text-[17px] font-black text-white" style={{ bottom: 36 }}>
                    ×{b.myUnopened}
                  </span>
                </div>
                <button
                  onClick={() => openZone(b.bandId)}
                  disabled={opening}
                  className="mt-2 rounded-lg bg-banana px-4 py-1 text-[11.5px] font-black text-black transition-transform active:scale-[0.97] disabled:opacity-50"
                >
                  RIP
                </button>
              </div>
            ))}
            {legacyNights.map((n) => (
              <div key={n.nightId} className="relative text-center">
                <div className="relative">
                  <SealedPack w={84} dusty />
                  <span
                    className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/[0.14] bg-black/60 px-2 py-0.5 text-[8px] font-extrabold uppercase tracking-[0.1em] text-white/70"
                    style={{ top: 7 }}
                  >
                    The Drop
                  </span>
                  <span className="absolute inset-x-0 text-[17px] font-black text-white" style={{ bottom: 36 }}>
                    ×{n.sealed}
                  </span>
                </div>
                <button
                  onClick={() => openLegacy(n.nightId)}
                  disabled={opening}
                  className="mt-2 rounded-lg bg-banana px-4 py-1 text-[11.5px] font-black text-black transition-transform active:scale-[0.97] disabled:opacity-50"
                >
                  RIP
                </button>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-white/35">Sealed packs never expire &middot; rip them any time</p>
        </div>
      )}

      {seatsWon > 0 && (
        <p className="mt-3 text-center text-[13px] font-black text-white">
          <JackHofWordmark size={15} /> SEAT{seatsWon === 1 ? '' : 'S'} WON: {seatsWon} 🎉
        </p>
      )}

      {reveal && (
        <DropPackReveal
          prize={reveal.prize}
          remaining={queue.length}
          autoOpen={batchMode}
          onDone={onRevealDone}
        />
      )}
    </div>
  );
}
