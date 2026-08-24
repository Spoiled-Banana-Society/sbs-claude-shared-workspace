'use client';

// This wallet's ZONE PACKS at a glance — the sealed count and how many are
// openable RIGHT NOW — for the promo card faces (spotlight + home mini card).
// The pack ROOM (ripping) stays inside the promo modal (ZonePacks.tsx); this
// hook only powers the "×7" badge, the "7 PACKS SEALED" line and the Open
// button, so it stays deliberately tiny: one status fetch, re-pulled on the
// user-event stream ping (their fill just landed), on focus, and on a slow
// interval. While the zone-drop switch is dark the API returns enabled:false
// and everything here reads zero — the surfaces render pack-free.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useStreamRefetch } from '@/hooks/useStreamRefetch';

interface BandLite {
  status: 'earning' | 'locked';
  revealAtMs: number | null;
  myUnopened: number;
}
interface StatusLite { enabled: boolean; bands?: BandLite[]; backlog?: BandLite[] }

export interface ZonePacksSummary {
  loaded: boolean;
  /** Unopened packs across the window + backlog (the ×N badge). */
  sealed: number;
  /** How many of those are openable right now (locked band, past reveal). */
  openable: number;
}

const openableNow = (b: BandLite) =>
  b.status === 'locked' && (b.revealAtMs === null || Date.now() >= b.revealAtMs);

export function useZonePacks(wallet: string | null | undefined): ZonePacksSummary {
  const [state, setState] = useState<ZonePacksSummary>({ loaded: false, sealed: 0, openable: 0 });
  const dead = useRef(false);

  const pull = useCallback(async () => {
    if (!wallet) { setState({ loaded: true, sealed: 0, openable: 0 }); return; }
    try {
      const res = await fetch(`/api/zone-drop/status?wallet=${wallet}`, { cache: 'no-store' });
      const d = (await res.json()) as StatusLite;
      const all = [...(d.bands ?? []), ...(d.backlog ?? [])];
      const sealed = d.enabled ? all.reduce((n, b) => n + (b.myUnopened || 0), 0) : 0;
      const openable = d.enabled
        ? all.filter(openableNow).reduce((n, b) => n + (b.myUnopened || 0), 0)
        : 0;
      if (!dead.current) setState({ loaded: true, sealed, openable });
    } catch { /* keep the last good state — decoration only */ }
  }, [wallet]);

  useEffect(() => {
    dead.current = false;
    void pull();
    const onFocus = () => { void pull(); };
    window.addEventListener('focus', onFocus);
    const t = setInterval(() => { void pull(); }, 90_000);
    return () => { dead.current = true; window.removeEventListener('focus', onFocus); clearInterval(t); };
  }, [pull]);

  useStreamRefetch(wallet ?? null, () => { void pull(); });

  return state;
}
