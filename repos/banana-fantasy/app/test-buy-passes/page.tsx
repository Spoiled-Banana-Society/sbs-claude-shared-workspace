'use client';

/**
 * Buy Draft Passes modal — redesign preview (TEMP, safe to delete).
 *
 * Same three clean layouts as before, but now keeping ALL the real copy:
 * balance line, first-purchase bonus, payment sublabels, the card-fee-credit
 * banner, gas-covered note, "$25 per draft pass", wallet balance, the
 * "Learn how to buy USDC on Base" card, the CTA, Free Entry (Staging), and the
 * Buy-10 promo. Toggle qty / payment to see the contextual copy appear.
 *
 * Live at /test-buy-passes.
 */

import { useState } from 'react';

const PRICE = 25;
const QUICK = [1, 5, 10, 20, 30, 40];
type Pay = 'usdc' | 'card';

/* ── glyphs ─────────────────────────────────────────────────────────── */
function UsdcGlyph({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.7}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M9.5 9.2c0-1 1.1-1.6 2.5-1.6s2.5.6 2.5 1.6-1 1.5-2.5 1.7-2.5.7-2.5 1.7 1.1 1.6 2.5 1.6 2.5-.6 2.5-1.6" strokeLinecap="round" />
    </svg>
  );
}
function CardGlyph({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round">
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="M3 9.5h18M6.5 14.5h4" />
    </svg>
  );
}
function GiftGlyph({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="9" width="17" height="11" rx="1.5" /><path d="M3.5 13h17M12 9v11M12 9S10.5 5 8 5a2 2 0 0 0 0 4zM12 9s1.5-4 4-4a2 2 0 0 1 0 4z" />
    </svg>
  );
}
function BoltGlyph({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6z" /></svg>
  );
}
function Close() {
  return (
    <button className="w-8 h-8 flex items-center justify-center rounded-full text-white/40 hover:text-white hover:bg-white/[0.06] transition-colors">
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
    </button>
  );
}

/* ── shared content blocks (every option uses these so all copy is kept) ─ */
function BalanceLine() {
  return <p className="text-white/40 text-[13px] text-center">You have 0 draft passes</p>;
}
function FirstBonusNote({ qty }: { qty: number }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-2 rounded-xl border border-banana/25 bg-banana/[0.07] px-3 py-2">
        <span className="text-base leading-none mt-0.5">🍌</span>
        <p className="text-[12px] text-white/70 leading-relaxed">
          <span className="font-semibold text-white">First purchase bonus:</span>{' '}
          add <span className="font-semibold text-banana">{Math.max(0, 4 - qty)} more</span> (total 4) to earn a free spin
        </p>
      </div>
      <p className="px-1 text-[11px] leading-relaxed text-white/35">
        And it stacks — complete 4 drafts in a day and earn{' '}
        <span className="font-semibold text-white/55">another free spin</span>. Lots of value to start! 🍌
      </p>
    </div>
  );
}
function PaymentSeg({ pay, setPay }: { pay: Pay; setPay: (p: Pay) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
      {([['usdc', 'USDC', 'USDC on Base'], ['card', 'Card', 'Instant checkout']] as const).map(([k, label, sub]) => (
        <button key={k} onClick={() => setPay(k)} className={`flex items-center justify-center gap-2 py-2.5 rounded-xl transition-colors ${pay === k ? 'bg-white/[0.08] text-white' : 'text-white/50 hover:text-white/80'}`}>
          {k === 'usdc' ? <UsdcGlyph className="w-[18px] h-[18px]" /> : <CardGlyph className="w-[18px] h-[18px]" />}
          <span className="text-[13.5px] font-semibold">{label}</span>
          <span className="text-[11px] text-white/35 hidden sm:inline">· {sub}</span>
        </button>
      ))}
    </div>
  );
}
function CardCreditBanner() {
  return (
    <div className="rounded-xl bg-banana/[0.06] border border-banana/10 p-3">
      <div className="flex items-center gap-2 mb-2">
        <GiftGlyph className="w-4 h-4 text-banana" />
        <p className="text-white/70 text-[12px] font-medium">Your card fee is credited forward — at $25 it&apos;s a draft pass</p>
      </div>
      <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden"><div className="h-full bg-banana rounded-full" style={{ width: '0%' }} /></div>
      <p className="text-white/30 text-[10px] mt-1.5">$0.00 of $25.00 toward your next draft pass — $25.00 to go</p>
    </div>
  );
}
function GasNote() {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-white/40">
      <BoltGlyph className="w-3 h-3 text-banana" />
      <span>Gas fees covered by SBS — you only sign, we pay.</span>
    </div>
  );
}
function LearnUsdcCard() {
  return (
    <div className="rounded-xl bg-banana/[0.06] border border-banana/10 p-3">
      <p className="text-white/60 text-[12px] leading-relaxed">
        Learn how to buy, swap, or bridge <span className="text-white font-semibold">USDC on Base</span>. It&apos;s quick and easy.{' '}
        <a className="text-banana font-semibold hover:brightness-110 whitespace-nowrap">Learn how →</a>
      </p>
    </div>
  );
}
function WalletBalance() {
  return <p className="text-[12px] text-jackpot">Wallet balance: 0.00 USDC (insufficient)</p>;
}
function Cta({ qty }: { qty: number }) {
  return (
    <button className="w-full py-4 rounded-2xl bg-banana text-black text-[16px] font-bold hover:brightness-105 active:scale-[0.99] transition-all">
      Buy {qty} Draft Pass{qty !== 1 ? 'es' : ''}
    </button>
  );
}
function FreeEntry({ qty }: { qty: number }) {
  return (
    <a className="block text-center text-white/35 text-[12px] hover:text-white/60 transition-colors cursor-pointer">
      🧪 Free Entry (Staging) — {qty} Pass{qty !== 1 ? 'es' : ''}
    </a>
  );
}
function PromoFooter() {
  return (
    <div className="flex items-center gap-2.5 px-5 py-3.5 border-t border-white/[0.06]">
      <div className="flex-1">
        <p className="text-white/55 text-[12px]">Promo: Buy 10, get a FREE Banana Wheel spin</p>
        <div className="mt-1.5 h-1 rounded-full bg-white/[0.08] overflow-hidden"><div className="h-full rounded-full bg-banana" style={{ width: '0%' }} /></div>
      </div>
      <span className="text-banana text-[12px] font-semibold tabular-nums">0/10</span>
    </div>
  );
}
function ModalShell({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-[440px] mx-auto rounded-3xl border border-white/[0.07] bg-[#0e0f14] shadow-2xl shadow-black/50 overflow-hidden">{children}</div>;
}

/* ════════ OPTION 1 — Stepper ════════ */
function Option1() {
  const [qty, setQty] = useState(1);
  const [pay, setPay] = useState<Pay>('usdc');
  return (
    <ModalShell>
      <div className="flex items-start justify-between px-5 pt-5 pb-1">
        <div>
          <h3 className="text-white text-[19px] font-bold tracking-tight">Buy Draft Passes</h3>
          <div className="mt-0.5"><BalanceLine /></div>
        </div>
        <Close />
      </div>
      <div className="px-5 pt-4 pb-5 space-y-4">
        <div>
          <div className="flex items-center justify-between rounded-2xl bg-white/[0.03] border border-white/[0.06] p-2">
            <button onClick={() => setQty(q => Math.max(1, q - 1))} className="w-11 h-11 rounded-xl bg-white/[0.05] text-white text-2xl flex items-center justify-center hover:bg-white/[0.09]">−</button>
            <div className="flex flex-col items-center"><span className="text-white text-3xl font-bold tabular-nums leading-none">{qty}</span><span className="text-white/35 text-[11px] mt-1">passes</span></div>
            <button onClick={() => setQty(q => q + 1)} className="w-11 h-11 rounded-xl bg-white/[0.05] text-white text-2xl flex items-center justify-center hover:bg-white/[0.09]">+</button>
          </div>
          <div className="flex gap-1.5 mt-2">
            {QUICK.map(n => <button key={n} onClick={() => setQty(n)} className={`flex-1 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${qty === n ? 'bg-banana text-black' : 'bg-white/[0.04] text-white/55 hover:text-white'}`}>{n}</button>)}
          </div>
        </div>
        <FirstBonusNote qty={qty} />
        <PaymentSeg pay={pay} setPay={setPay} />
        {pay === 'card' ? <CardCreditBanner /> : <GasNote />}
        <div className="flex items-end justify-between">
          <div>
            <p className="text-white/40 text-[12px]">$25 per draft pass</p>
            {pay === 'usdc' && <div className="mt-0.5"><WalletBalance /></div>}
          </div>
          <p className="text-banana text-3xl font-bold tabular-nums">{pay === 'usdc' ? `${qty * PRICE} USDC` : `$${qty * PRICE}`}</p>
        </div>
        {pay === 'usdc' && <LearnUsdcCard />}
        <Cta qty={qty} />
        <FreeEntry qty={qty} />
      </div>
      <PromoFooter />
    </ModalShell>
  );
}

/* ════════ OPTION 2 — Order summary ════════ */
function Option2() {
  const [qty, setQty] = useState(1);
  const [pay, setPay] = useState<Pay>('usdc');
  return (
    <ModalShell>
      <div className="flex items-start justify-between px-5 pt-5 pb-3">
        <div><h3 className="text-white text-[19px] font-bold tracking-tight">Buy Draft Passes</h3><div className="mt-0.5"><BalanceLine /></div></div>
        <Close />
      </div>
      <div className="px-5 pb-5 space-y-4">
        <PaymentSeg pay={pay} setPay={setPay} />
        <div>
          <p className="text-white/35 text-[11px] font-semibold uppercase tracking-[0.08em] mb-2">Quantity</p>
          <div className="grid grid-cols-6 gap-1.5">
            {QUICK.map(n => <button key={n} onClick={() => setQty(n)} className={`py-2.5 rounded-xl text-[14px] font-bold transition-colors ${qty === n ? 'bg-banana text-black' : 'bg-white/[0.04] text-white/55 hover:text-white'}`}>{n}</button>)}
          </div>
        </div>
        <FirstBonusNote qty={qty} />
        {pay === 'card' ? <CardCreditBanner /> : <GasNote />}
        <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-4 space-y-2.5">
          <div className="flex items-center justify-between text-[13px]"><span className="text-white/55">{qty} draft pass{qty !== 1 ? 'es' : ''} × $25</span><span className="tabular-nums font-medium text-white/85">${qty * PRICE}</span></div>
          {pay === 'usdc' && <div className="flex items-center justify-between text-[13px]"><span className="text-white/55">Wallet balance</span><span className="tabular-nums font-medium text-jackpot">0.00 USDC (insufficient)</span></div>}
          <div className="h-px bg-white/[0.07]" />
          <div className="flex items-center justify-between"><span className="text-white font-semibold">Total <span className="text-white/40 text-[12px] font-normal">· $25 per pass</span></span><span className="text-banana text-2xl font-bold tabular-nums">{pay === 'usdc' ? `${qty * PRICE} USDC` : `$${qty * PRICE}`}</span></div>
        </div>
        {pay === 'usdc' && <LearnUsdcCard />}
        <Cta qty={qty} />
        <FreeEntry qty={qty} />
      </div>
      <PromoFooter />
    </ModalShell>
  );
}

/* ════════ OPTION 3 — Hero total ════════ */
function Option3() {
  const [qty, setQty] = useState(1);
  const [pay, setPay] = useState<Pay>('usdc');
  return (
    <ModalShell>
      <div className="flex items-start justify-between px-5 pt-5"><h3 className="text-white text-[17px] font-bold tracking-tight">Buy Draft Passes</h3><Close /></div>
      <div className="text-center pt-2 pb-4">
        <p className="text-banana text-5xl font-bold tabular-nums tracking-tight">{pay === 'usdc' ? `${qty * PRICE}` : `$${qty * PRICE}`}<span className="text-2xl">{pay === 'usdc' ? ' USDC' : ''}</span></p>
        <p className="text-white/40 text-[13px] mt-1">{qty} pass{qty !== 1 ? 'es' : ''} · $25 per draft pass</p>
        <div className="mt-1"><BalanceLine /></div>
      </div>
      <div className="px-5 pb-5 space-y-3">
        <div className="grid grid-cols-6 gap-1.5">
          {QUICK.map(n => <button key={n} onClick={() => setQty(n)} className={`py-2.5 rounded-xl text-[14px] font-bold transition-colors ${qty === n ? 'bg-banana text-black' : 'bg-white/[0.04] text-white/55 hover:text-white'}`}>{n}</button>)}
        </div>
        <FirstBonusNote qty={qty} />
        <PaymentSeg pay={pay} setPay={setPay} />
        {pay === 'card' ? <CardCreditBanner /> : <GasNote />}
        {pay === 'usdc' && <div className="text-center"><WalletBalance /></div>}
        {pay === 'usdc' && <LearnUsdcCard />}
        <Cta qty={qty} />
        <FreeEntry qty={qty} />
      </div>
      <PromoFooter />
    </ModalShell>
  );
}

function Section({ title, blurb, children }: { title: string; blurb: string; children: React.ReactNode }) {
  return (
    <div className="mb-12">
      <h2 className="text-white text-[15px] font-semibold mb-0.5">{title}</h2>
      <p className="text-white/45 text-[12.5px] mb-5 leading-relaxed max-w-lg">{blurb}</p>
      {children}
    </div>
  );
}

export default function TestBuyPasses() {
  return (
    <div className="min-h-screen bg-[#08090c] px-4 sm:px-8 py-10">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-white text-2xl font-bold tracking-tight">Buy Draft Passes — layout options</h1>
        <p className="text-white/45 text-sm mt-1.5 mb-3 leading-relaxed">
          Same three clean layouts — but now keeping <span className="text-white/70">all your copy</span>: balance line,
          first-purchase bonus, payment sublabels, the card-fee-credit banner, gas-covered note, &ldquo;$25 per draft pass,&rdquo;
          wallet balance, the &ldquo;Learn how to buy USDC&rdquo; card, the CTA, Free Entry (Staging), and the Buy-10 promo.
        </p>
        <p className="text-white/35 text-[12px] mb-10">Tip: toggle <span className="text-white/55">USDC ↔ Card</span> to see the contextual copy swap (card-credit banner vs. gas note + the Learn-how card).</p>

        <Section title="Option 1 — Stepper" blurb="A − qty + stepper with quick chips, payment segmented control, total, one CTA. The simplest and most Apple.">
          <Option1 />
        </Section>
        <Section title="Option 2 — Order summary" blurb="Payment up top, quantity chips, then a live line-item summary (passes × $25, balance, total). The most explicit.">
          <Option2 />
        </Section>
        <Section title="Option 3 — Hero total" blurb="The live total leads as a big number; quantity + payment compact beneath. Boldest / most marketing-forward.">
          <Option3 />
        </Section>

        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
          <p className="text-white/70 text-sm font-medium mb-1">Pick one</p>
          <p className="text-white/45 text-[12.5px] leading-relaxed">Tell me 1, 2, or 3 and I&apos;ll wire it into the real Buy Passes modal — keeping every piece of working logic (USDC / card / free-entry / promo credit) underneath.</p>
        </div>
      </div>
    </div>
  );
}
