'use client';

/**
 * /preview/promos — the /promos page exactly as a REGULAR user sees it
 * (Richard 2026-08-23): no new-user welcome, no first-purchase, no returning
 * variant, no admin-only cards. Read-only — claims and CTAs that mutate are
 * no-ops. Uses the live public payloads: /api/promos (default templates) and
 * /api/bonus-zone/status (live zone tier), so the card set and order match
 * what a logged-in regular account gets from the shared filter.
 */

import React, { useEffect, useMemo, useState } from 'react';
import type { Promo } from '@/types';
import { filterAndSortVisiblePromos } from '@/lib/promoFilter';
import { PromoSpotlight, PromoLongCard } from '@/components/promos/PromoCards';
import { PromoModal } from '@/components/modals/PromoModal';

export default function PreviewRegularPromosPage() {
  const [promos, setPromos] = useState<Promo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<Promo | null>(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const [pRes, bzRes] = await Promise.all([
          fetch('/api/promos', { cache: 'no-store' }),
          fetch('/api/bonus-zone/status', { cache: 'no-store' }),
        ]);
        const list = (await pRes.json()) as Promo[];
        const bz = await bzRes.json().catch(() => null) as
          { enabled?: boolean; view?: Record<string, unknown> } | null;
        const idx = list.findIndex((p) => p.type === 'bonus-zone');
        if (bz?.enabled && bz.view && idx !== -1) {
          // Same stamp shape /api/promos puts on a logged-in payload, with a
          // clean slate for the per-wallet fields.
          list[idx].modalContent.bonusZone = {
            ...(bz.view as object),
            eligiblePasses: null,
            paidPasses: null,
            pending: [],
            unitsThisWindow: 0,
            earned: 0,
            history: [],
          } as never;
        } else if (bz && !bz.enabled && idx !== -1) {
          // Switch off → the server strips the card for regular users.
          list.splice(idx, 1);
        }
        if (!dead) setPromos(list);
      } catch { /* preview only — leave the page empty on failure */ }
      if (!dead) setLoaded(true);
    })();
    return () => { dead = true; };
  }, []);

  // A regular established account: welcome spin used, first purchase done,
  // flags loaded, not a BB3 holder, not an admin.
  const visible = useMemo(() => filterAndSortVisiblePromos(promos, {
    isBB3Holder: false,
    newUserPromoClaimed: true,
    hasSpunWheel: true,
    firstPurchaseBonusGranted: true,
    firstPurchasePromoUnlocked: true,
    flagsKnown: true,
    isLoggedIn: true,
    hasVisibleClaim: () => false,
    isAdminPreview: false,
  }), [promos]);

  const spot = visible[0] ?? null;
  const longs = visible.slice(1);

  return (
    <div className="w-full min-h-screen px-4 sm:px-8 lg:px-12 py-10 sm:py-14 max-w-5xl mx-auto">
      <div className="mb-6 rounded-xl border border-banana/30 bg-banana/[0.06] px-4 py-2.5 text-[13px] text-banana/90">
        PREVIEW · /promos as a regular user sees it — no new user, returning, or first purchase cards. Buttons here don&apos;t claim anything.
      </div>

      <div className="mb-10 sm:mb-14">
        <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Promos</h1>
        <p className="text-white/40 text-sm sm:text-base mt-2">Earn free spins, drafts, and entries.</p>
      </div>

      {!loaded && (
        <div>
          <div className="h-56 rounded-[24px] bg-white/[0.03] animate-pulse" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 mt-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-[168px] rounded-[20px] bg-white/[0.02] animate-pulse" />
            ))}
          </div>
        </div>
      )}

      {loaded && spot && (
        <PromoSpotlight
          promo={spot}
          wallet={null}
          isClaimed={false}
          hasVisibleClaim={false}
          onOpenModal={() => setSelected(spot)}
          onClaim={() => {}}
        />
      )}

      {loaded && longs.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 mt-4">
          {longs.map((promo, i) => (
            <PromoLongCard
              key={promo.id}
              promo={promo}
              index={i}
              wallet={null}
              isClaimed={false}
              hasVisibleClaim={false}
              onOpenModal={() => setSelected(promo)}
              onClaim={() => {}}
            />
          ))}
        </div>
      )}

      {loaded && visible.length === 0 && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-16 text-center">
          <p className="text-white/45 text-sm">Couldn&apos;t load the promo payload.</p>
        </div>
      )}

      <PromoModal
        isOpen={!!selected}
        onClose={() => setSelected(null)}
        promo={selected}
        onClaim={() => setSelected(null)}
        isPromoClaimed={false}
      />
    </div>
  );
}
