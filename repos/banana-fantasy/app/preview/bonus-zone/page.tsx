'use client';

/**
 * BONUS ZONE — every visual, with mock data, regardless of the switch.
 * /preview/bonus-zone[?tier=1|2|0][&pos=N]
 *
 * Richard's review page (2026-08-22): the header pill in both cuts, the promo
 * card (spotlight + long + mini), the modal body, the entry modal lines, the
 * My Drafts row glyph states, the leave dialog warning, the bells, the X /
 * Discord bot line, and the payout bell. Nothing here reads Firestore.
 */

import React, { useMemo, useState } from 'react';
import type { Promo } from '@/types';
import { PromoLongCard, PromoSpotlight } from '@/components/promos/PromoCards';
import { PromoMiniCard } from '@/components/promos/PromoMiniCard';
import {
  BonusZonePill,
  BonusZoneTooltipSection,
  BonusZoneLadder,
  BonusPendingGlyph,
  BonusZoneEntryLine,
  BonusZoneConfirmLine,
  BonusLeaveWarning,
  BonusZoneModalContent,
  bonusLockedToastCopy,
  type BonusZoneViewLike,
  type BonusZoneStatusLike,
} from '@/components/bonusZone/BonusZoneUI';
import { promoRules } from '@/lib/promoTheme';

const T1 = 20;
const T2 = 40;
const T3 = 60;

function viewFor(position: number): BonusZoneViewLike {
  const tier: 1 | 2 | 3 | null = position <= T1 ? 1 : position <= T2 ? 2 : position <= T3 ? 3 : null;
  return {
    enabled: true,
    tier,
    label: tier === 1 ? 'Buy 1 Get 1' : tier === 2 ? 'Buy 2 Get 1' : tier === 3 ? 'Buy 3 Get 1' : null,
    position,
    draftsLeftInTier: tier === 1 ? T1 - position + 1 : tier === 2 ? T2 - position + 1 : tier === 3 ? T3 - position + 1 : 0,
    draftsLeftInZone: Math.max(0, T3 - position + 1),
    tier1Through: T1,
    tier2Through: T2,
    tier3Through: T3,
  };
}

const RULES =
  '• The Jackpot window counts up from 1 after every Jackpot hit. The Bonus Zone is the first 60 drafts of every window.\n'
  + '• Drafts 1 to 20: Buy 1 Get 1. Every paid draft you enter earns a free draft when it fills.\n'
  + '• Drafts 21 to 40: Buy 2 Get 1. Every paid draft earns half a free draft.\n'
  + '• Drafts 41 to 60: Buy 3 Get 1. Every paid draft earns a third of a free draft.\n'
  + '• Halves and thirds add up inside the same window and pay out the moment they make a whole free draft. Leftovers are lost when the Jackpot hits.\n'
  + '• Draft 61 and up: no bonus. The Jackpot odds sell themselves from here.\n'
  + '• Your tier locks the moment you take a seat and pays when the draft fills. Leave the lobby and nothing pays. Re-enter and you lock a fresh tier at wherever the counter is then.\n'
  + '• Paid passes only. Free passes never earn free drafts. Passes bought with the First Purchase promo do not count.\n'
  + '• Fast and slow drafts both count. Wheel drafts and private leagues do not.\n'
  + '• Free drafts land in your passes automatically. No claim button, no limit.';

function promoFor(view: BonusZoneViewLike, rich: boolean): Promo {
  return {
    id: 'bonus-zone',
    type: 'bonus-zone',
    title: 'Bonus Zone → FREE DRAFTS',
    description: 'Jackpot just hit? That is the best time to draft. Early in every Jackpot window, paid drafts earn free drafts.',
    ctaText: 'Draft now',
    ctaLink: '/draft',
    progressCurrent: 0,
    progressMax: 1,
    isNew: true,
    featured: true,
    modalContent: {
      title: 'Bonus Zone → FREE DRAFTS',
      explanation: RULES,
      bonusZone: {
        tier: view.tier,
        label: view.label,
        position: view.position,
        draftsLeftInTier: view.draftsLeftInTier,
        draftsLeftInZone: view.draftsLeftInZone,
        tier1Through: T1,
        tier2Through: T2,
        tier3Through: T3,
        eligiblePasses: rich ? 3 : 5,
        paidPasses: 5,
        pending: rich
          ? [
              { draftId: '2026-fast-draft-712', tier: 1, label: 'Buy 1 Get 1', credit: 1, eligible: true, reason: 'post_launch' },
              { draftId: '2026-slow-draft-131', tier: 2, label: 'Buy 2 Get 1', credit: 0.5, eligible: true, reason: 'grandfathered' },
              { draftId: '2026-fast-draft-713', tier: 1, label: 'Buy 1 Get 1', credit: 1, eligible: false, reason: 'pre_launch' },
            ]
          : [],
        unitsThisWindow: rich ? 3 : 0,
        earned: rich ? 4 : 0,
        history: rich
          ? [
              { draftId: '2026-fast-draft-709', label: 'Buy 1 Get 1', status: 'paid', settledAtIso: '2026-08-22T18:02:00Z' },
              { draftId: '2026-fast-draft-704', label: 'Buy 2 Get 1', status: 'half', settledAtIso: '2026-08-22T16:40:00Z', unitsAfter: 3 },
              { draftId: '2026-fast-draft-701', label: 'Buy 1 Get 1', status: 'paid', settledAtIso: '2026-08-22T15:11:00Z' },
            ]
          : [],
      },
    },
  };
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-[11px] font-extrabold tracking-[2.5px] text-emerald-300">{title}</h2>
        {note && <p className="text-[12px] text-white/45 mt-0.5">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Frame({ children, label, w }: { children: React.ReactNode; label: string; w?: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-bold tracking-[1.5px] text-white/35">{label}</p>
      <div className={`rounded-2xl border border-white/[0.08] bg-[#0b0b0f] p-4 ${w ?? ''}`}>{children}</div>
    </div>
  );
}

/** A faithful copy of the live JACKPOT / HOF pills so the new one can be judged next to them. */
function LanePills({ view }: { view: BonusZoneViewLike }) {
  const jpLeft = 100 - view.position + 1;
  const jpPct = (1 / jpLeft) * 100;
  const hofPct = (3 / jpLeft) * 100;
  const pill = (tag: string, cls: string, textCls: string, pct: number, rem: number, left: number) => (
    <div className={`flex flex-col items-center justify-center shrink-0 gap-[2px] rounded-[9px] lg:rounded-[10px] border px-2 py-[5px] lg:py-[6px] w-[68px] lg:w-[82px] ${cls}`}>
      <span className={`text-[8px] lg:text-[9.5px] font-extrabold tracking-[0.07em] leading-none ${textCls}`}>{tag}</span>
      <div className="mt-[3px] flex items-baseline gap-1 leading-none">
        <span className={`text-[10.5px] lg:text-[12.5px] font-extrabold tabular-nums ${textCls}`}>{pct.toFixed(2)}%</span>
        <span className="text-[8px] lg:text-[9.5px] font-bold tabular-nums text-white/85"><span className="text-white">{rem}</span>/{left}</span>
      </div>
    </div>
  );
  return (
    <div className="flex flex-row items-center gap-[3px] lg:gap-1.5">
      <BonusZonePill view={view} />
      {pill('JACKPOT', 'border-red-500/40 bg-red-500/[0.06]', 'text-red-400', jpPct, 1, jpLeft)}
      {pill('HOF', 'border-[#D4AF37]/40 bg-[#D4AF37]/[0.06]', 'text-[#e6c35c]', hofPct, 3, jpLeft)}
    </div>
  );
}

function Bell({ title, message, link }: { title: string; message: string; link: string }) {
  return (
    <div className="flex gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3">
      <div className="mt-0.5 h-8 w-8 shrink-0 rounded-full bg-emerald-400/15 text-emerald-300 grid place-items-center text-sm">✦</div>
      <div className="min-w-0">
        <p className="text-[13.5px] font-bold text-white leading-snug">{title}</p>
        <p className="text-[12.5px] text-white/65 leading-snug mt-0.5">{message}</p>
        <p className="text-[10.5px] text-white/35 mt-1">{link}</p>
      </div>
    </div>
  );
}

function DraftRowMock({ name, lock, count }: { name: string; lock: { tier: 1 | 2 | 3; label: string; credit: number; eligible: boolean; reason: string } | null; count: number }) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02]">
      <div className="flex items-center justify-between gap-1 sm:gap-2 px-3 sm:px-5 py-3">
        <div className="min-w-0 flex-shrink sm:w-28 sm:flex-shrink-0 flex items-center gap-1">
          <span className="block text-white/80 font-medium whitespace-nowrap truncate text-xs sm:text-base">{name}</span>
          {lock && <BonusPendingGlyph lock={lock} />}
          <span className="inline-flex flex-shrink-0 text-banana/70">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3 sm:w-3.5 sm:h-3.5"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" /></svg>
          </span>
        </div>
        <div className="sm:w-16 flex-shrink-0 text-center text-white/60 text-xs sm:text-sm">30s</div>
        <div className="sm:w-20 flex-shrink-0 text-center text-white/40 text-xs sm:text-sm">Unrevealed</div>
        <div className="sm:w-20 flex-shrink-0 text-center text-white/40 text-xs sm:text-sm">R1 P1</div>
        <div className="sm:w-24 flex-shrink-0 text-center text-white/80 text-xs sm:text-sm tabular-nums">{count}/10 Filling</div>
        <button className="shrink-0 rounded-lg bg-banana px-3 py-1.5 text-[11px] font-bold text-black">Enter</button>
      </div>
    </div>
  );
}

export default function BonusZonePreviewPage() {
  const [pos, setPos] = useState(12);
  const [rich, setRich] = useState(true);
  const view = useMemo(() => viewFor(pos), [pos]);
  const promo = useMemo(() => promoFor(view, rich), [view, rich]);
  const t1Lock = { tier: 1 as const, label: 'Buy 1 Get 1', credit: 1, eligible: true, reason: 'post_launch' };
  const t3Lock = { tier: 3 as const, label: 'Buy 3 Get 1', credit: 1 / 3, eligible: true, reason: 'post_launch' };
  const t2Lock = { tier: 2 as const, label: 'Buy 2 Get 1', credit: 0.5, eligible: true, reason: 'grandfathered' };
  const badLock = { tier: 1 as const, label: 'Buy 1 Get 1', credit: 1, eligible: false, reason: 'pre_launch' };
  const status: BonusZoneStatusLike = { enabled: true, view, passes: { paidTotal: 5, eligibleCount: rich ? 3 : 5, ineligibleReasons: rich ? { pre_launch: 2 } : {} }, unitsThisWindow: rich ? 3 : 0 };
  const statusNone: BonusZoneStatusLike = { enabled: true, view, passes: { paidTotal: 4, eligibleCount: 0, ineligibleReasons: { pre_launch: 3, first_purchase: 1 } }, unitsThisWindow: 0 };
  const noop = () => {};

  return (
    <main className="min-h-screen bg-[#08080b] text-white px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-5xl space-y-10">
        <header className="space-y-3">
          <p className="text-[11px] font-extrabold tracking-[3px] text-emerald-300">BONUS ZONE · PREVIEW · MOCK DATA · SWITCH IS OFF</p>
          <h1 className="text-3xl font-black tracking-tight">Every visual, down to the inch</h1>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3">
            <label className="text-[12px] text-white/60">Window position of the next draft</label>
            <input type="range" min={1} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} className="w-56 accent-emerald-400" />
            <span className="text-[13px] font-bold tabular-nums">{pos} · {view.label ?? 'zone closed'}{view.tier ? ` · ${view.draftsLeftInTier} left` : ''}</span>
            <div className="flex gap-1.5 ml-auto">
              {[['Fresh hit', 1], ['Mid BOGO', 12], ['Last BOGO', 20], ['B2G1', 30], ['B3G1', 50], ['Closed', 75]].map(([l, p]) => (
                <button key={String(l)} onClick={() => setPos(Number(p))} className={`rounded-full px-3 py-1 text-[11px] font-bold ${pos === p ? 'bg-emerald-400 text-black' : 'bg-white/[0.08] text-white/70'}`}>{l}</button>
              ))}
              <button onClick={() => setRich((r) => !r)} className="rounded-full px-3 py-1 text-[11px] font-bold bg-white/[0.08] text-white/70">{rich ? 'User with history' : 'Brand new user'}</button>
            </div>
          </div>
        </header>

        <Section title="1 · HEADER PILLS" note="The green pill sits left of JACKPOT. It hides when the zone is closed (70+). Desktop cut and phone cut.">
          <div className="grid gap-4 md:grid-cols-2">
            <Frame label="DESKTOP (lg) — hover card below">
              <div className="flex items-center justify-between rounded-xl bg-[#111116] px-4 py-3">
                <span className="text-white/40 text-sm">SBS</span>
                <LanePills view={view} />
              </div>
              <div className="mt-3 w-[250px] rounded-lg border border-white/10 bg-[#15151a] p-3">
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="text-sm font-semibold">Draft #{817 + pos}</span>
                  <span className="text-[10.5px] text-white/40">rolling windows</span>
                </div>
                <BonusZoneTooltipSection view={view} />
                <div className="mb-2.5">
                  <div className="flex items-baseline justify-between"><span className="text-[11.5px] font-bold text-red-400">JACKPOT · 1/{100 - pos + 1}</span><span className="text-[12px] font-semibold text-red-400">{((1 / (100 - pos + 1)) * 100).toFixed(2)}%</span></div>
                  <p className="text-[10.5px] text-white/50">1 Jackpot somewhere in the next {100 - pos + 1} drafts. Resets every time it hits.</p>
                </div>
              </div>
            </Frame>
            <Frame label="PHONE (375px)" w="max-w-[375px]">
              <div className="flex items-center justify-between rounded-xl bg-[#111116] px-3 py-2.5">
                <span className="text-white/40 text-xs">☰</span>
                <div className="flex flex-row items-center gap-[3px]">
                  <BonusZonePill view={view} compact />
                  <div className="flex flex-col items-center justify-center gap-[2px] rounded-[9px] border px-2 py-[5px] w-[68px] border-red-500/40 bg-red-500/[0.06]"><span className="text-[8px] font-extrabold text-red-400">JACKPOT</span><span className="text-[10.5px] font-extrabold text-red-400">{((1 / (100 - pos + 1)) * 100).toFixed(2)}%</span></div>
                  <div className="flex flex-col items-center justify-center gap-[2px] rounded-[9px] border px-2 py-[5px] w-[68px] border-[#D4AF37]/40 bg-[#D4AF37]/[0.06]"><span className="text-[8px] font-extrabold text-[#e6c35c]">HOF</span><span className="text-[10.5px] font-extrabold text-[#e6c35c]">{((3 / (100 - pos + 1)) * 100).toFixed(2)}%</span></div>
                </div>
              </div>
            </Frame>
          </div>
        </Section>

        <Section title="2 · PROMO CARD" note="Replaces Jackpot Hit. Pinned to the top of /promos for everyone without a new user or First Purchase card. Spotlight, long card, mini (home carousel / drafting sidebar).">
          <div className="grid gap-4">
            <Frame label="SPOTLIGHT">
              <PromoSpotlight promo={promo} wallet={null} isClaimed={false} hasVisibleClaim={false} onOpenModal={noop} onClaim={noop} />
            </Frame>
            <div className="grid gap-4 md:grid-cols-[1fr_260px]">
              <Frame label="LONG CARD (open)">
                <PromoLongCard promo={promo} index={0} wallet={null} isClaimed={false} hasVisibleClaim={false} onOpenModal={noop} onClaim={noop} defaultOpen />
              </Frame>
              <Frame label="MINI">
                <PromoMiniCard promo={promo} wallet={null} isClaimed={false} hasVisibleClaim={false} onOpen={noop} onClaim={noop} />
              </Frame>
            </div>
            <Frame label="THE LADDER ON ITS OWN (card indicator)">
              <BonusZoneLadder view={view} pending={rich ? 2 : 0} units={rich ? 3 : 0} />
            </Frame>
          </div>
        </Section>

        <Section title="3 · FULL DETAILS MODAL" note="Body of the promo modal: live state, your numbers, locks still filling, paid out, rules.">
          <Frame label="MODAL BODY" w="max-w-[520px]">
            <BonusZoneModalContent data={promo.modalContent.bonusZone} rules={promoRules(promo)} />
          </Frame>
        </Section>

        <Section title="4 · ENTERING" note="Under the Paid Draft Pass row in the entry modal, then the confirm line on the speed step. Three cases: all passes qualify, some qualify, none qualify.">
          <div className="grid gap-4 md:grid-cols-3">
            <Frame label="ALL PASSES QUALIFY">
              <div className="rounded-xl border-2 border-banana/30 bg-banana/5 p-5">
                <div className="flex items-center justify-between"><div><p className="font-semibold">Paid Draft Pass</p><BonusZoneEntryLine status={{ ...status, passes: { paidTotal: 5, eligibleCount: 5, ineligibleReasons: {} }, unitsThisWindow: 0 }} buyingSeat={false} firstPurchaseApplies={false} /></div><p className="text-3xl font-bold text-banana">5</p></div>
              </div>
            </Frame>
            <Frame label="SOME QUALIFY (+ half banked)">
              <div className="rounded-xl border-2 border-banana/30 bg-banana/5 p-5">
                <div className="flex items-center justify-between"><div><p className="font-semibold">Paid Draft Pass</p><BonusZoneEntryLine status={status} buyingSeat={false} firstPurchaseApplies={false} /></div><p className="text-3xl font-bold text-banana">5</p></div>
              </div>
            </Frame>
            <Frame label="NONE QUALIFY">
              <div className="rounded-xl border-2 border-banana/30 bg-banana/5 p-5">
                <div className="flex items-center justify-between"><div><p className="font-semibold">Paid Draft Pass</p><BonusZoneEntryLine status={statusNone} buyingSeat={false} firstPurchaseApplies={false} /></div><p className="text-3xl font-bold text-banana">4</p></div>
              </div>
            </Frame>
            <Frame label="BUYING THE $25 SEAT (no First Purchase)">
              <div className="rounded-xl border-2 border-banana/30 bg-banana/5 p-5">
                <div className="flex items-center justify-between"><div><p className="font-semibold">Join Draft</p><p className="text-white/40 text-sm">From your $75.00 balance</p><BonusZoneEntryLine status={status} buyingSeat firstPurchaseApplies={false} /></div><p className="text-3xl font-bold text-banana">$25</p></div>
              </div>
            </Frame>
            <Frame label="BUYING THE $25 SEAT (First Purchase applies → no line)">
              <div className="rounded-xl border-2 border-banana/30 bg-banana/5 p-5">
                <div className="flex items-center justify-between"><div><p className="font-semibold">Join Draft</p><p className="text-white/40 text-sm">From your $75.00 balance</p><p className="text-banana/70 text-xs mt-0.5">Buy 1, get 2 drafts free</p><BonusZoneEntryLine status={status} buyingSeat firstPurchaseApplies /></div><p className="text-3xl font-bold text-banana">$25</p></div>
              </div>
            </Frame>
            <Frame label="SPEED STEP CONFIRM LINE">
              <div className="text-center">
                <h2 className="text-2xl font-bold">Choose Draft Speed</h2>
                <p className="text-white/50 text-sm">Using <span className="text-banana font-semibold">Paid Draft Pass</span></p>
                <BonusZoneConfirmLine status={status} />
              </div>
            </Frame>
          </div>
        </Section>

        <Section title="5 · AFTER YOU TAKE THE SEAT" note="What the server says back the instant the seat is taken (toast copy), and the My Drafts row while the lobby fills.">
          <div className="grid gap-4 md:grid-cols-3">
            {[t1Lock, t2Lock, t3Lock, badLock].map((l, i) => {
              const c = bonusLockedToastCopy(l);
              return (
                <Frame key={i} label={['TOAST · BUY 1 GET 1', 'TOAST · BUY 2 GET 1', 'TOAST · BUY 3 GET 1', 'TOAST · PASS NOT ELIGIBLE'][i]}>
                  <div className={`rounded-xl border px-4 py-3 ${l.eligible ? 'border-emerald-400/30 bg-emerald-400/[0.07]' : 'border-white/10 bg-white/[0.04]'}`}>
                    <p className="text-[13.5px] font-bold">{c.title}</p>
                    <p className="text-[12.5px] text-white/65 mt-0.5">{c.message}</p>
                  </div>
                </Frame>
              );
            })}
          </div>
          <Frame label="MY DRAFTS ROWS — green ticket = pending, slashed = not eligible, plane = auto pick (existing)">
            <div className="space-y-2">
              <DraftRowMock name="Draft Lobby" lock={t1Lock} count={7} />
              <DraftRowMock name="Draft Lobby" lock={t2Lock} count={3} />
              <DraftRowMock name="Draft Lobby" lock={t3Lock} count={6} />
              <DraftRowMock name="Draft Lobby" lock={badLock} count={5} />
              <DraftRowMock name="Draft Lobby" lock={null} count={9} />
            </div>
          </Frame>
        </Section>

        <Section title="6 · LEAVING" note="Both leave dialogs (draft room + My Drafts) get this line under the usual text when the seat holds an eligible lock.">
          <Frame label="LEAVE DRAFT?" w="max-w-sm">
            <h3 className="text-xl font-bold mb-2">Leave Draft?</h3>
            <p className="text-white/60 mb-6">Are you sure you want to leave <span className="text-white font-medium">BBB #861</span>? Your draft pass will be returned.</p>
            <BonusLeaveWarning lock={t1Lock} />
            <div className="flex gap-3">
              <button className="flex-1 px-4 py-3 bg-transparent border border-white/50 text-white font-medium rounded-xl">Cancel</button>
              <button className="flex-1 px-4 py-3 bg-red-500 text-white font-medium rounded-xl">Leave Draft</button>
            </div>
          </Frame>
        </Section>

        <Section title="7 · BELLS" note="Broadcast bells (replace the 10 spin / 5 spin Jackpot Watch bells) and the two personal payout bells.">
          <div className="grid gap-3 md:grid-cols-2">
            <Bell title="🟢 Jackpot hit. Bonus Zone is ON: Buy 1 Get 1" message="Every paid draft you enter in the next 20 drafts earns a FREE draft when it fills. Then Buy 2 Get 1 through draft 40 and Buy 3 Get 1 through 60. Tap for the rules." link="/promos?promo=bonus-zone · everyone" />
            <Bell title="🟢 Bonus Zone: Buy 2 Get 1" message="Every 2 paid drafts you enter in the next 20 drafts earn a FREE draft when they fill. Drops to Buy 3 Get 1 at draft 41. Tap for the rules." link="/promos?promo=bonus-zone · everyone" />
            <Bell title="🟢 Bonus Zone: Buy 3 Get 1, last call" message="Every 3 paid drafts you enter in the next 20 drafts earn a FREE draft when they fill. The zone closes at draft 60 of the window. Tap for the rules." link="/promos?promo=bonus-zone · everyone" />
            <Bell title="🟢 Bonus Zone: your free draft landed" message="Your Buy 1 Get 1 draft filled, so your free draft pass is in your passes now. Use it on any draft." link="/promos?promo=bonus-zone · the drafter" />
            <Bell title="🟢 Bonus Zone: 1 of 2 toward a free draft" message="Your Buy 2 Get 1 draft filled. One more Buy 2 Get 1 draft before the Jackpot hits and the free draft is yours." link="/promos?promo=bonus-zone · the drafter" />
          </div>
        </Section>

        <Section title="8 · X / DISCORD BOT" note="The fill bot's second line gains the zone on filling lobbies only. The just-filled ping never carries it.">
          <Frame label="FILL BOT POST" w="max-w-md">
            <pre className="whitespace-pre-wrap font-sans text-[13.5px] leading-relaxed text-white/85">{`3 more to fill BBB #${817 + pos}

✅ HOF - ${((3 / (100 - pos + 1)) * 100).toFixed(2)}% Jackpot - ${((1 / (100 - pos + 1)) * 100).toFixed(2)}%${view.tier ? `\n🟢 BONUS ZONE: ${view.label} · ${view.draftsLeftInTier} ${view.draftsLeftInTier === 1 ? 'draft' : 'drafts'} left` : ''}`}</pre>
          </Frame>
        </Section>

        <Section title="9 · THE SWITCH" note="Nothing above renders on the live site until the switch is flipped.">
          <Frame label="HOW IT GOES LIVE" w="max-w-2xl">
            <ol className="list-decimal pl-5 space-y-1.5 text-[13px] text-white/75">
              <li><code className="text-emerald-300">node scripts/_bonus-zone-toggle.mjs</code> shows the config and what the pill would say right now.</li>
              <li><code className="text-emerald-300">node scripts/_bonus-zone-toggle.mjs --on</code> enables it and stamps the launch time. Passes bought from that instant qualify; the 19 grandfathered passes qualify already. Cutoffs are config: <code className="text-emerald-300">--tiers 20 40 60</code>.</li>
              <li>Within 20 seconds: the header pill appears, the promo card replaces Jackpot Hit, entries start locking, the bot line shows, and the next Jackpot hit sends the Buy 1 Get 1 bell.</li>
              <li><code className="text-emerald-300">--off</code> hides everything again. Locks already pending still pay at fill only if the switch is on, so turn it off only between windows.</li>
            </ol>
          </Frame>
        </Section>
      </div>
    </main>
  );
}
