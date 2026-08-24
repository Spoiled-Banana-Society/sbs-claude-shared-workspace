'use client';

/**
 * ZONE PACKS — the REAL surfaces with mock data, regardless of the switch.
 * /preview/zone-drop
 *
 * Richard's review page (2026-08-23): this renders the actual production
 * components — the Banana Zone promo card from /promos, and tapping it opens
 * the GENUINE PromoModal with the pack room inside (ZonePacksPreviewContext
 * feeds it mock state instead of the API). Tap the pile in the modal and the
 * first rip plays the real JackHOF seat reveal; the rest are empties.
 * Nothing here reads Firestore or can award anything.
 */

import React, { useMemo, useState } from 'react';
import type { Promo } from '@/types';
import { PromoLongCard } from '@/components/promos/PromoCards';
import { PromoModal } from '@/components/modals/PromoModal';
import { ZonePacksPreviewContext, type ZonePacksPreviewData } from '@/components/bonusZone/ZonePacks';

const T1 = 25; const T2 = 50;

const EXPLANATION =
  'THE BANANA ZONE\n'
  + `• The Jackpot window counts up from 1 after every Jackpot hit. The Banana Zone is the first ${T2} drafts of every window.\n`
  + `• Drafts 1 to ${T1}: Buy 1 Get 1 Spin. Every paid draft you enter earns a Free Spin when it fills.\n`
  + `• Drafts ${T1 + 1} to ${T2}: Buy 2 Get 1 Spin. Every paid draft earns half a Free Spin.\n`
  + '• Halves add up inside the same window. The moment they make a whole spin, you get it. Leftovers are lost when the Jackpot hits.\n'
  + `• Draft ${T2 + 1} and up: no bonus. The Jackpot odds sell themselves from here.\n`
  + '\n'
  + '📦 PACKS\n'
  + '• Every paid draft that fills in the zone also earns 1 sealed pack. Open your packs right here on this card.\n'
  + `• The packs from drafts 1 to ${T1} hide 6 JACKHOF SEATS.\n`
  + `• The packs from drafts ${T1 + 1} to ${T2} hide 4 JACKHOF SEATS.\n`
  + `• Packs unlock the moment their batch is done: draft ${T1} fills and the first batch opens, draft ${T2} fills and the second opens. No waiting for a set time.\n`
  + '• Seats are dealt from randomness committed before the batch began. Opening only reveals what was already decided.\n'
  + '• Jackpot hits early? The live batch opens immediately with the packs it has. A hit never voids anything.\n'
  + '• Sealed packs never expire.\n'
  + '\n'
  + '• Your tier is set by the position the draft FILLS at, not where you enter. Leave the lobby and nothing pays.\n'
  + '• Paid passes only. Free passes earn no spins and no packs. Passes bought with the First Purchase promo do not count.\n'
  + '• Fast and slow drafts both count. Wheel drafts and private leagues do not.';

export default function ZonePacksPreviewPage() {
  const [modalOpen, setModalOpen] = useState(true);

  // The promo exactly as /api/promos would stamp it post-flip.
  const promo = useMemo(() => ({
    id: 'bonus-zone',
    type: 'bonus-zone',
    title: 'Banana Zone → FREE SPINS',
    description: 'Jackpot just hit? Enter the Banana Zone — every paid draft you enter earns Free Spins, and the packs hide JackHOF seats.',
    ctaText: 'Draft now',
    ctaLink: '/draft',
    backgroundColor: '#2a2a35',
    progressCurrent: 0,
    progressMax: 1,
    isNew: true,
    featured: true,
    claimable: false,
    claimCount: 0,
    modalContent: {
      title: 'Banana Zone → FREE SPINS',
      explanation: EXPLANATION,
      bonusZone: {
        tier: 2 as const,
        label: 'Buy 2 Get 1 Spin',
        position: 31,
        draftsLeftInTier: 20,
        draftsLeftInZone: 20,
        tier1Through: T1,
        tier2Through: T2,
        tier3Through: T2,
        packBands: [{ from: 1, to: T1, seats: 6 }, { from: T1 + 1, to: T2, seats: 4 }],
        eligiblePasses: 2,
        paidPasses: 2,
        pending: [
          { draftId: '2026-fast-draft-812', tier: 2 as const, label: 'Buy 2 Get 1 Spin', credit: 3, eligible: true, reason: '' },
        ],
        unitsThisWindow: 3,
        earned: 4,
        history: [
          { draftId: '2026-fast-draft-799', label: 'Buy 1 Get 1 Spin', status: 'paid', settledAtIso: new Date(Date.now() - 3 * 3600e3).toISOString(), unitsAfter: 0 },
        ],
      },
    },
  }) as unknown as Promo, []);

  // Pack-room state: batch 1 done (your 3 packs openable NOW), batch 2 live.
  const previewData = useMemo<ZonePacksPreviewData>(() => ({
    zone: {
      enabled: true,
      windowStart: 867,
      position: 31,
      bands: [
        {
          bandId: '867__b1', band: 1, fromPos: 1, toPos: T1, tickets: 6,
          status: 'locked', packCount: 248, revealAtMs: Date.now() - 60_000,
          winners: null, myPacks: 3, myUnopened: 3,
          myUnopenedIds: ['m1', 'm2', 'm3'],
        },
        {
          bandId: '867__b2', band: 2, fromPos: T1 + 1, toPos: T2, tickets: 4,
          status: 'earning', packCount: 61, revealAtMs: null,
          winners: null, myPacks: 1, myUnopened: 1, myUnopenedIds: ['m4'],
        },
      ],
      backlog: [],
    },
    legacy: {
      status: 'settled',
      nightId: '2026-08-23',
      you: { sealed: 2 },
      previous: [],
    },
  }), []);

  return (
    <ZonePacksPreviewContext.Provider value={previewData}>
      <main className="min-h-screen px-6 py-10 max-w-3xl mx-auto">
        <div className="rounded-xl border border-banana/30 bg-banana/[0.06] px-4 py-2.5 text-[13px] text-banana/90">
          PREVIEW · the REAL card and the REAL modal, mock data. The modal opens by itself — tap the
          pile inside it: first rip = JackHOF seat, after that empties. The &ldquo;The Drop ×2&rdquo;
          vault pack shows how leftover Drop packs surface. Nothing here is live.
        </div>

        <section className="mt-10">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/45">
            The card on /promos — tap it, then &ldquo;Full details&rdquo; reopens the modal
          </h2>
          <div className="mt-4">
            <PromoLongCard
              promo={promo}
              index={0}
              wallet={null}
              isClaimed={false}
              hasVisibleClaim={false}
              onOpenModal={() => setModalOpen(true)}
              onClaim={() => {}}
            />
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="mt-4 w-full rounded-2xl bg-banana py-4 text-base font-black text-black"
          >
            OPEN THE MODAL — what users legit see
          </button>
        </section>

        <section className="mt-10">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/45">Bells</h2>
          <div className="mt-4 space-y-3">
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
              <p className="text-[13px] font-bold text-white">📦 Pack earned — Banana Zone</p>
              <p className="mt-1 text-[12px] leading-relaxed text-white/55">
                Your Banana Zone draft filled and earned a sealed pack. 6 JackHOF seats are hiding in
                the packs from drafts 1 to 25. You hold 3 packs in this batch. Packs open the moment
                draft 25 fills.
              </p>
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
              <p className="text-[13px] font-bold text-white">📦 Your packs are ready</p>
              <p className="mt-1 text-[12px] leading-relaxed text-white/55">
                Drafts 1 to 25 are done. 6 JackHOF seats are sealed in this batch&rsquo;s packs and
                yours open RIGHT NOW. Rip them.
              </p>
            </div>
          </div>
        </section>

        <PromoModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          promo={promo}
          onClaim={() => setModalOpen(false)}
          isPromoClaimed={false}
        />
      </main>
    </ZonePacksPreviewContext.Provider>
  );
}
