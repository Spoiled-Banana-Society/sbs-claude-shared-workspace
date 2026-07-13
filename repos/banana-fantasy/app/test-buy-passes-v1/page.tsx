'use client';

/**
 * Buy Draft Passes modal — the ORIGINAL clean v1 (TEMP, safe to delete).
 * Minimal copy version, kept so it can be compared against /test-buy-passes
 * (the copy-folded-in "mix"). Live at /test-buy-passes-v1.
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
function PaymentSeg({ pay, setPay }: { pay: Pay; setPay: (p: Pay) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
      {([['usdc', 'USDC', 'on Base'], ['card', 'Card', 'instant']] as const).map(([k, label, sub]) => (
        <button key={k} onClick={() => setPay(k)} className={`flex items-center justify-center gap-2 py-2.5 rounded-xl transition-colors ${pay === k ? 'bg-white/[0.08] text-white' : 'text-white/50 hover:text-white/80'}`}>
          {k === 'usdc' ? <UsdcGlyph className="w-[18px] h-[18px]" /> : <CardGlyph className="w-[18px] h-[18px]" />}
          <span className="text-[13.5px] font-semibold">{label}</span><span className="text-[11px] text-white/35">· {sub}</span>
        </button>
      ))}
    </div>
  );
}
function PromoRow() {
  return (
    <div className="flex items-center gap-2.5 px-5 py-3.5 border-t border-white/[0.06]">
      <div className="flex-1"><p className="text-white/55 text-[12px]">Buy 10, get a free Banana Wheel spin</p><div className="mt-1.5 h-1 rounded-full bg-white/[0.08] overflow-hidden"><div className="h-full rounded-full bg-banana" style={{ width: '0%' }} /></div></div>
      <span className="text-banana text-[12px] font-semibold tabular-nums">0/10</span>
    </div>
  );
}
const total = (qty: number, pay: Pay) => (pay === 'usdc' ? `${qty * PRICE} USDC` : `$${qty * PRICE}`);

function Option1() {
  const [qty, setQty] = useState(1); const [pay, setPay] = useState<Pay>('usdc');
  return (
    <ModalShell>
      <div className="flex items-start justify-between px-5 pt-5 pb-1">
        <div><h3 className="text-white text-[19px] font-bold tracking-tight">Buy Draft Passes</h3><p className="text-white/40 text-[12.5px] mt-0.5">You have 0 passes · $25 each</p></div>
        <Close />
      </div>
      <div className="px-5 pt-4 pb-5 space-y-5">
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
          <div><p className="text-white/40 text-[12px]">Total</p><p className="text-white text-[15px] mt-0.5">Balance <span className="text-white/45">0.00 USDC</span></p></div>
          <p className="text-banana text-3xl font-bold tabular-nums">{total(qty, pay)}</p>
        </div>
        <button className="w-full py-4 rounded-2xl bg-banana text-black text-[16px] font-bold hover:brightness-105 active:scale-[0.99] transition-all">Buy {qty} Pass{qty !== 1 ? 'es' : ''} · {total(qty, pay)}</button>
        <div className="flex items-center justify-center gap-4 text-[12px]"><a className="text-white/40 hover:text-white/70 cursor-pointer">How to get USDC →</a><a className="text-white/30 hover:text-white/60 cursor-pointer">Free entry (staging)</a></div>
      </div>
      <PromoRow />
    </ModalShell>
  );
}
function Line({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return <div className="flex items-center justify-between text-[13px]"><span className="text-white/55">{label}</span><span className={`tabular-nums font-medium ${muted ? 'text-white/40' : 'text-white/85'}`}>{value}</span></div>;
}
function Option2() {
  const [qty, setQty] = useState(1); const [pay, setPay] = useState<Pay>('usdc');
  return (
    <ModalShell>
      <div className="flex items-center justify-between px-5 pt-5 pb-4"><h3 className="text-white text-[19px] font-bold tracking-tight">Buy Draft Passes</h3><Close /></div>
      <div className="px-5 pb-5 space-y-4">
        <PaymentSeg pay={pay} setPay={setPay} />
        <div><p className="text-white/35 text-[11px] font-semibold uppercase tracking-[0.08em] mb-2">Quantity</p><div className="grid grid-cols-6 gap-1.5">{QUICK.map(n => <button key={n} onClick={() => setQty(n)} className={`py-2.5 rounded-xl text-[14px] font-bold transition-colors ${qty === n ? 'bg-banana text-black' : 'bg-white/[0.04] text-white/55 hover:text-white'}`}>{n}</button>)}</div></div>
        <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-4 space-y-2.5">
          <Line label={`${qty} draft pass${qty !== 1 ? 'es' : ''} × $${PRICE}`} value={`$${qty * PRICE}`} />
          <Line label="Wallet balance" value="0.00 USDC" muted />
          <div className="h-px bg-white/[0.07]" />
          <div className="flex items-center justify-between"><span className="text-white font-semibold">Total</span><span className="text-banana text-2xl font-bold tabular-nums">{total(qty, pay)}</span></div>
        </div>
        <button className="w-full py-4 rounded-2xl bg-banana text-black text-[16px] font-bold hover:brightness-105 active:scale-[0.99] transition-all">Buy {qty} Pass{qty !== 1 ? 'es' : ''}</button>
        <a className="block text-center text-white/35 text-[12px] hover:text-white/60 cursor-pointer">Free entry (staging)</a>
      </div>
      <PromoRow />
    </ModalShell>
  );
}
function Option3() {
  const [qty, setQty] = useState(1); const [pay, setPay] = useState<Pay>('usdc');
  return (
    <ModalShell>
      <div className="flex items-center justify-between px-5 pt-5"><h3 className="text-white text-[17px] font-bold tracking-tight">Buy Draft Passes</h3><Close /></div>
      <div className="text-center pt-3 pb-5"><p className="text-banana text-5xl font-bold tabular-nums tracking-tight">{total(qty, pay)}</p><p className="text-white/40 text-[13px] mt-1">{qty} pass{qty !== 1 ? 'es' : ''} · $25 each</p></div>
      <div className="px-5 pb-5 space-y-3">
        <div className="grid grid-cols-6 gap-1.5">{QUICK.map(n => <button key={n} onClick={() => setQty(n)} className={`py-2.5 rounded-xl text-[14px] font-bold transition-colors ${qty === n ? 'bg-banana text-black' : 'bg-white/[0.04] text-white/55 hover:text-white'}`}>{n}</button>)}</div>
        <PaymentSeg pay={pay} setPay={setPay} />
        <p className="text-center text-white/40 text-[12px]">Balance 0.00 USDC · <a className="text-banana hover:underline cursor-pointer">get USDC →</a></p>
        <button className="w-full py-4 rounded-2xl bg-banana text-black text-[16px] font-bold hover:brightness-105 active:scale-[0.99] transition-all">Buy {qty} Pass{qty !== 1 ? 'es' : ''}</button>
        <a className="block text-center text-white/35 text-[12px] hover:text-white/60 cursor-pointer">Free entry (staging)</a>
      </div>
      <PromoRow />
    </ModalShell>
  );
}
function Section({ title, blurb, children }: { title: string; blurb: string; children: React.ReactNode }) {
  return <div className="mb-12"><h2 className="text-white text-[15px] font-semibold mb-0.5">{title}</h2><p className="text-white/45 text-[12.5px] mb-5 leading-relaxed max-w-lg">{blurb}</p>{children}</div>;
}
export default function TestBuyPassesV1() {
  return (
    <div className="min-h-screen bg-[#08090c] px-4 sm:px-8 py-10">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-white text-2xl font-bold tracking-tight">Buy Draft Passes — ORIGINAL v1 (minimal copy)</h1>
        <p className="text-white/45 text-sm mt-1.5 mb-10 leading-relaxed">The first clean version. Compare with <a href="/test-buy-passes" className="text-banana hover:underline">/test-buy-passes</a> (the one with the copy folded in).</p>
        <Section title="Option 1 — Stepper" blurb="− qty + with quick chips, payment segmented, clean total, one CTA."><Option1 /></Section>
        <Section title="Option 2 — Order summary" blurb="Payment, quantity chips, live order-summary card."><Option2 /></Section>
        <Section title="Option 3 — Hero total" blurb="Big live total leads; quantity + payment beneath."><Option3 /></Section>
      </div>
    </div>
  );
}
