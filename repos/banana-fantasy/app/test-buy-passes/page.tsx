'use client';

/**
 * Buy Draft Passes modal — redesign preview (TEMP, safe to delete).
 *
 * Back to the cleaner v1 layouts, with the essential copy folded in as SLIM
 * one-liners (used once, not repeated banners) so it stays airy and flows.
 * Toggle USDC ↔ Card to see the one contextual line swap.
 *
 * Live at /test-buy-passes.
 */

import { useState } from 'react';

const PRICE = 25;
const QUICK = [1, 5, 10, 20, 30, 40];
type Pay = 'usdc' | 'card';

function UsdcGlyph({ className = '' }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.7}><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9.5 9.2c0-1 1.1-1.6 2.5-1.6s2.5.6 2.5 1.6-1 1.5-2.5 1.7-2.5.7-2.5 1.7 1.1 1.6 2.5 1.6 2.5-.6 2.5-1.6" strokeLinecap="round" /></svg>;
}
function CardGlyph({ className = '' }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round"><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="M3 9.5h18M6.5 14.5h4" /></svg>;
}
function Close() {
  return <button className="w-8 h-8 flex items-center justify-center rounded-full text-white/40 hover:text-white hover:bg-white/[0.06] transition-colors"><svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg></button>;
}
function ModalShell({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-[440px] mx-auto rounded-3xl border border-white/[0.07] bg-[#0e0f14] shadow-2xl shadow-black/50 overflow-hidden">{children}</div>;
}

/* ── slim shared bits (each appears once, one line, never a big banner) ── */
function PaymentSeg({ pay, setPay }: { pay: Pay; setPay: (p: Pay) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
      {([['usdc', 'USDC', 'on Base'], ['card', 'Card', 'instant']] as const).map(([k, label, sub]) => (
        <button key={k} onClick={() => setPay(k)} className={`flex items-center justify-center gap-2 py-2.5 rounded-xl transition-colors ${pay === k ? 'bg-white/[0.08] text-white' : 'text-white/50 hover:text-white/80'}`}>
          {k === 'usdc' ? <UsdcGlyph className="w-[18px] h-[18px]" /> : <CardGlyph className="w-[18px] h-[18px]" />}
          <span className="text-[13.5px] font-semibold">{label}</span>
          <span className="text-[11px] text-white/35">· {sub}</span>
        </button>
      ))}
    </div>
  );
}
// one contextual line that swaps with the payment method
function CtxLine({ pay }: { pay: Pay }) {
  return pay === 'card'
    ? <p className="text-center text-[11.5px] text-white/45">🎁 Card fees credit forward — at $25 it becomes a free draft pass.</p>
    : <p className="text-center text-[11.5px] text-white/45">⚡ Gas covered by SBS — you just sign, we pay.</p>;
}
function BonusLine() {
  return <p className="text-center text-[11.5px] text-banana/80">🍌 Buy 4 to earn a free spin — stacks with 4 drafts a day.</p>;
}
function UsdcLearn() {
  return <p className="text-center text-[11.5px] text-white/40">Short on USDC on Base? <a className="text-banana font-semibold hover:brightness-110 cursor-pointer">Learn how →</a></p>;
}
function FreeEntry({ qty }: { qty: number }) {
  return <a className="block text-center text-white/30 text-[12px] hover:text-white/60 transition-colors cursor-pointer">🧪 Free Entry (Staging) — {qty} Pass{qty !== 1 ? 'es' : ''}</a>;
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
function Cta({ qty }: { qty: number }) {
  return <button className="w-full py-4 rounded-2xl bg-banana text-black text-[16px] font-bold hover:brightness-105 active:scale-[0.99] transition-all">Buy {qty} Draft Pass{qty !== 1 ? 'es' : ''}</button>;
}
const total = (qty: number, pay: Pay) => (pay === 'usdc' ? `${qty * PRICE} USDC` : `$${qty * PRICE}`);

/* ════════ OPTION 1 — Stepper ════════ */
function Option1() {
  const [qty, setQty] = useState(1);
  const [pay, setPay] = useState<Pay>('usdc');
  return (
    <ModalShell>
      <div className="flex items-start justify-between px-5 pt-5 pb-1">
        <div>
          <h3 className="text-white text-[19px] font-bold tracking-tight">Buy Draft Passes</h3>
          <p className="text-white/40 text-[13px] mt-0.5">You have 0 draft passes · $25 each</p>
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
          <div className="flex gap-1.5 mt-2">{QUICK.map(n => <button key={n} onClick={() => setQty(n)} className={`flex-1 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${qty === n ? 'bg-banana text-black' : 'bg-white/[0.04] text-white/55 hover:text-white'}`}>{n}</button>)}</div>
        </div>
        <PaymentSeg pay={pay} setPay={setPay} />
        <div className="flex items-end justify-between">
          <div>
            <p className="text-white/40 text-[12px]">Total</p>
            {pay === 'usdc' && <p className="text-[12px] text-jackpot mt-0.5">Balance 0.00 USDC (insufficient)</p>}
          </div>
          <p className="text-banana text-3xl font-bold tabular-nums">{total(qty, pay)}</p>
        </div>
        <CtxLine pay={pay} />
        <Cta qty={qty} />
        <BonusLine />
        {pay === 'usdc' && <UsdcLearn />}
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
        <div><h3 className="text-white text-[19px] font-bold tracking-tight">Buy Draft Passes</h3><p className="text-white/40 text-[13px] mt-0.5">You have 0 draft passes · $25 each</p></div>
        <Close />
      </div>
      <div className="px-5 pb-5 space-y-4">
        <PaymentSeg pay={pay} setPay={setPay} />
        <div>
          <p className="text-white/35 text-[11px] font-semibold uppercase tracking-[0.08em] mb-2">Quantity</p>
          <div className="grid grid-cols-6 gap-1.5">{QUICK.map(n => <button key={n} onClick={() => setQty(n)} className={`py-2.5 rounded-xl text-[14px] font-bold transition-colors ${qty === n ? 'bg-banana text-black' : 'bg-white/[0.04] text-white/55 hover:text-white'}`}>{n}</button>)}</div>
        </div>
        <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-4 space-y-2.5">
          <div className="flex items-center justify-between text-[13px]"><span className="text-white/55">{qty} draft pass{qty !== 1 ? 'es' : ''} × $25</span><span className="tabular-nums font-medium text-white/85">${qty * PRICE}</span></div>
          {pay === 'usdc' && <div className="flex items-center justify-between text-[13px]"><span className="text-white/55">Wallet balance</span><span className="tabular-nums font-medium text-jackpot">0.00 USDC (low)</span></div>}
          <div className="h-px bg-white/[0.07]" />
          <div className="flex items-center justify-between"><span className="text-white font-semibold">Total</span><span className="text-banana text-2xl font-bold tabular-nums">{total(qty, pay)}</span></div>
        </div>
        <CtxLine pay={pay} />
        <Cta qty={qty} />
        <BonusLine />
        {pay === 'usdc' && <UsdcLearn />}
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
        <p className="text-banana text-5xl font-bold tabular-nums tracking-tight">{total(qty, pay)}</p>
        <p className="text-white/40 text-[13px] mt-1">{qty} pass{qty !== 1 ? 'es' : ''} · $25 each · you have 0</p>
      </div>
      <div className="px-5 pb-5 space-y-3.5">
        <div className="grid grid-cols-6 gap-1.5">{QUICK.map(n => <button key={n} onClick={() => setQty(n)} className={`py-2.5 rounded-xl text-[14px] font-bold transition-colors ${qty === n ? 'bg-banana text-black' : 'bg-white/[0.04] text-white/55 hover:text-white'}`}>{n}</button>)}</div>
        <PaymentSeg pay={pay} setPay={setPay} />
        <CtxLine pay={pay} />
        {pay === 'usdc' && <p className="text-center text-[12px] text-jackpot">Balance 0.00 USDC (insufficient)</p>}
        <Cta qty={qty} />
        <BonusLine />
        {pay === 'usdc' && <UsdcLearn />}
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
        <p className="text-white/45 text-sm mt-1.5 mb-10 leading-relaxed">
          Clean v1 layouts, with the key copy folded in as slim one-liners (each used once — no big repeated banners):
          balance + $25/pass in the header, one contextual line that swaps with payment (card-credit vs. gas), wallet balance,
          a slim &ldquo;get USDC&rdquo; link, the first-purchase bonus, Free Entry, and the Buy-10 promo. Toggle USDC ↔ Card to see it.
        </p>

        <Section title="Option 1 — Stepper" blurb="− qty + with quick chips, payment toggle, clean total, one CTA. Simplest and most Apple.">
          <Option1 />
        </Section>
        <Section title="Option 2 — Order summary" blurb="Payment + quantity, then a compact line-item summary. Most explicit.">
          <Option2 />
        </Section>
        <Section title="Option 3 — Hero total" blurb="The live total leads as a big number; quantity + payment beneath. Boldest.">
          <Option3 />
        </Section>

        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
          <p className="text-white/70 text-sm font-medium mb-1">Pick one</p>
          <p className="text-white/45 text-[12.5px] leading-relaxed">Tell me 1, 2, or 3 and I&apos;ll wire it into the real modal — keeping every bit of working logic (USDC / card / free-entry / promo credit) underneath.</p>
        </div>
      </div>
    </div>
  );
}
