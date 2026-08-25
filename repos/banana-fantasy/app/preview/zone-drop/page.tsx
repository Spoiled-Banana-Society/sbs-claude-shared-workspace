'use client';

/**
 * ZONE PACKS — the REAL surfaces with mock data, regardless of the switch.
 * /preview/zone-drop
 *
 * Richard's review page (2026-08-23, refreshed 8/25 for INSTANT mode): this
 * renders the actual production components — the header pill + phone strip,
 * the Banana Zone promo card from /promos, and tapping it opens the GENUINE
 * PromoModal with the pack room inside (ZonePacksPreviewContext feeds it
 * mock state instead of the API). Tap the pile in the modal and the first
 * rip plays the real JackHOF seat reveal; the rest are empties.
 * Nothing here reads Firestore or can award anything.
 *
 * Mock state = the 8/25 design: zone 1 to 30 (Buy 1 Get 1 Spin, 3 seats)
 * + 31 to 60 (Buy 2 Get 1 Spin, 7 seats); window at draft 12, one seat has
 * landed so far (2 still hidden), you hold 2 packs ready to rip + 1 being
 * dealt this second.
 */

import React, { useMemo, useState } from 'react';
import type { Promo } from '@/types';
import { PromoLongCard } from '@/components/promos/PromoCards';
import { PromoModal } from '@/components/modals/PromoModal';
import { BonusZonePill, BonusZoneMobileBar, type BonusZoneViewLike } from '@/components/bonusZone/BonusZoneUI';
import { ZonePacksPreviewContext, type ZonePacksPreviewData } from '@/components/bonusZone/ZonePacks';

const T1 = 30; const T2 = 60;
const SEATS_1 = 3; const SEATS_2 = 7;
const POSITION = 12;
const DEALT_1 = 1;

const EXPLANATION =
  'THE BANANA ZONE\n'
  + `• The Jackpot window counts up from 1 after every Jackpot hit. The Banana Zone is the first ${T2} drafts of every window.\n`
  + `• Drafts 1 to ${T1}: Buy 1 Get 1 Spin. Every paid draft you enter earns a Free Spin when it fills.\n`
  + `• Drafts ${T1 + 1} to ${T2}: Buy 2 Get 1 Spin. Every paid draft earns half a Free Spin.\n`
  + '• Halves add up inside the same window. The moment they make a whole spin, you get it. Leftovers are lost when the Jackpot hits.\n'
  + `• Draft ${T2 + 1} and up: no bonus. The Jackpot odds sell themselves from here.\n`
  + '\n'
  + '📦 PACKS AND JACKHOF SEATS\n'
  + '• Fill a paid draft in the zone and you get 1 pack. It opens right here, the moment the draft fills. No waiting.\n'
  + `• ${SEATS_1} JackHOF seats are hidden in drafts 1 to ${T1}. ${SEATS_2} more are hidden in drafts ${T1 + 1} to ${T2}. That is ${SEATS_1 + SEATS_2} seats every window, one full JackHOF league.\n`
  + '• Every pack can hold a JackHOF seat. The counter shows how many seats have been found so far and how many are still hidden in the drafts ahead.\n'
  + '• Which drafts hold a seat was decided before the window began, from randomness committed on chain. Nobody knows which drafts they are until they fill. When one of them fills, the seat lands in one of its packs.\n'
  + '• More paid drafts = more packs = more shots at a seat.\n'
  + '• Jackpot hits early? Every seat still hidden lands in the packs of the draft that hit. A hit never voids a seat.\n'
  + '• Packs never expire.\n'
  + '\n'
  + '• Your tier is set by the position the draft FILLS at, not where you enter. Leave the lobby and nothing pays.\n'
  + '• Paid passes only. Free passes earn no spins and no packs. Passes bought with the First Purchase promo do not count.\n'
  + '• Fast and slow drafts both count. Wheel drafts and private leagues do not.';

export default function ZonePacksPreviewPage() {
  const [modalOpen, setModalOpen] = useState(true);

  // What the header stream would carry right now (packSeatsLeft = countdown).
  const headerView: BonusZoneViewLike = {
    enabled: true, tier: 1, label: 'Buy 1 Get 1 Spin', position: POSITION,
    draftsLeftInTier: T1 - POSITION + 1, draftsLeftInZone: T2 - POSITION + 1,
    tier1Through: T1, tier2Through: T2, tier3Through: T2,
    packSeats: SEATS_1, packSeatsLeft: SEATS_1 - DEALT_1,
  };

  // The promo exactly as /api/promos would stamp it post-flip.
  const promo = useMemo(() => ({
    id: 'bonus-zone',
    type: 'bonus-zone',
    title: 'Banana Zone → FREE SPINS',
    description: `Jackpot just hit? Enter the Banana Zone — paid draft fills earn Free Spins and Packs you open the moment your draft fills, with ${SEATS_1 + SEATS_2} JackHOF seats hidden inside the Packs.\nJackHOF — win the league and go straight to the Finals, plus you compete for added prizes.`,
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
        tier: 1 as const,
        label: 'Buy 1 Get 1 Spin',
        position: POSITION,
        draftsLeftInTier: T1 - POSITION + 1,
        draftsLeftInZone: T2 - POSITION + 1,
        tier1Through: T1,
        tier2Through: T2,
        tier3Through: T2,
        packBands: [{ from: 1, to: T1, seats: SEATS_1, dealt: DEALT_1 }, { from: T1 + 1, to: T2, seats: SEATS_2, dealt: 0 }],
        packsInstant: true,
        eligiblePasses: 2,
        paidPasses: 2,
        pending: [
          { draftId: '2026-fast-draft-912', tier: 1 as const, label: 'Buy 1 Get 1 Spin', credit: 6, eligible: true, reason: '' },
        ],
        unitsThisWindow: 0,
        earned: 2,
        history: [
          { draftId: '2026-fast-draft-907', label: 'Buy 1 Get 1 Spin', status: 'paid', settledAtIso: new Date(Date.now() - 3 * 3600e3).toISOString(), unitsAfter: 0 },
        ],
      },
    },
  }) as unknown as Promo, []);

  // Pack-room state: band 1 live at draft 12 (1 seat landed, 2 hidden), you
  // hold 2 packs ready + 1 being dealt; band 2 up next.
  const previewData = useMemo<ZonePacksPreviewData>(() => ({
    zone: {
      enabled: true,
      windowStart: 901,
      position: POSITION,
      bands: [
        {
          bandId: '901__b1', band: 1, fromPos: 1, toPos: T1, tickets: SEATS_1,
          status: 'earning', packCount: 108, revealAtMs: null,
          winners: [{ userId: '0xabc' }], myPacks: 3, myUnopened: 3,
          myUnopenedIds: ['m1', 'm2', 'm3'],
          mode: 'instant', seatsDealt: DEALT_1, seatsLeft: SEATS_1 - DEALT_1,
          myReady: 2, myReadyIds: ['m1', 'm2'], myWaiting: 1,
        },
        {
          bandId: '901__b2', band: 2, fromPos: T1 + 1, toPos: T2, tickets: SEATS_2,
          status: 'earning', packCount: 0, revealAtMs: null,
          winners: [], myPacks: 0, myUnopened: 0, myUnopenedIds: [],
          mode: 'instant', seatsDealt: 0, seatsLeft: SEATS_2, myReady: 0, myReadyIds: [], myWaiting: 0,
        },
      ],
      backlog: [],
    },
    legacy: null,
  }), []);

  return (
    <ZonePacksPreviewContext.Provider value={previewData}>
      <main className="min-h-screen px-6 py-10 max-w-3xl mx-auto">
        <div className="rounded-xl border border-banana/30 bg-banana/[0.06] px-4 py-2.5 text-[13px] text-banana/90">
          PREVIEW · INSTANT PACKS (8/25). Zone 1 to 30 (3 seats) + 31 to 60 (7 seats), window at draft 12,
          one seat already landed. The REAL header pill, strip, card and modal with mock data. Tap the pile
          in the modal: first rip = JackHOF seat, after that empties. Nothing here is live.
        </div>

        <section className="mt-10" data-testid="preview-header">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/45">
            Header · desktop pill (left) and phone strip (below)
          </h2>
          <div className="mt-4 flex items-center gap-4">
            <BonusZonePill view={headerView} compact />
            <span className="text-[12px] text-white/40">← found / left, counts down as seats land</span>
          </div>
          <div className="mt-4 max-w-[430px] overflow-hidden rounded-xl border border-white/[0.08] bg-[#0b0b0f]">
            <BonusZoneMobileBar view={headerView} />
          </div>
        </section>

        <section className="mt-10" data-testid="preview-card">
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

        <section className="mt-10" data-testid="preview-bells">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/45">Bells</h2>
          <div className="mt-4 space-y-3">
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
              <p className="text-[13px] font-bold text-white">📦 Your pack is ready</p>
              <p className="mt-1 text-[12px] leading-relaxed text-white/55">
                Your Banana Zone draft filled and your pack is ready to rip. 1 of 3 JackHOF seats found so far in drafts 1 to 30, 2 still hidden in drafts 13 to 30. Every paid draft you fill = 1 more pack.
              </p>
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
              <p className="text-[13px] font-bold text-white">📦 Jackpot hit. Your pack is loaded</p>
              <p className="mt-1 text-[12px] leading-relaxed text-white/55">
                The Jackpot hit on your draft. Every JackHOF seat still hidden in this batch landed in this draft&rsquo;s packs. Rip yours now.
              </p>
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
              <p className="text-[13px] font-bold text-white">🍌 Jackpot hit. Banana Zone is ON: Buy 1 Get 1 Spin + 3 JackHOF seats</p>
              <p className="mt-1 text-[12px] leading-relaxed text-white/55">
                Every paid draft that fills in the next 30 drafts earns a FREE SPIN. 3 JackHOF seats are hidden in drafts 1 to 30,
                and packs open the moment your draft fills. Then Buy 2 Get 1 Spin through draft 60. Tap for the rules.
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
