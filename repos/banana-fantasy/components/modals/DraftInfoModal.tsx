'use client';

/**
 * Draft info modal — opened from the (i) next to the "Drafts" heading.
 * Three tabs: How it Works (incl. draft types), Contest details, and FAQ.
 * Clean obsidian styling to match the rest of the app.
 */

import { useState } from 'react';
import { mockFAQSections } from '@/lib/faqContent';
import type { Contest } from '@/types';

type Tab = 'how' | 'contest' | 'faq';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const HOW = [
  { t: '10 Players', d: 'Join a lobby — the draft starts instantly when it fills.' },
  { t: 'Snake Draft', d: 'Fast (30s) or slow (8hr) picks — your choice.' },
  { t: 'Team Positions', d: 'Draft “DAL WR1” and each week you get the highest-scoring Dallas wide receiver. CeeDee scores 22? You get 22. Pickens drops 30? You get 30 — always the top performer.' },
  { t: 'Best Ball', d: 'No managing needed. Draft once, best scorers auto-selected weekly.' },
];
const TYPES: { word: string; pct: string; color: string; d: string }[] = [
  { word: 'Pro', pct: '94%', color: '#a855f7', d: 'Standard draft. Compete for the $100K GTD Prize Pool.' },
  { word: 'Hall of Fame', pct: '5%', color: '#D4AF37', d: 'Bonus prize pool on top of standard rewards.' },
  { word: 'Jackpot', pct: '1%', color: '#ef4444', d: 'Win your league and skip straight to the finals.' },
];

export function DraftInfoModal({ isOpen, onClose, contest }: { isOpen: boolean; onClose: () => void; contest: Contest | null }) {
  const [tab, setTab] = useState<Tab>('how');
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-start sm:items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-lg my-8 rounded-3xl border border-white/[0.08] bg-[#0e0f14] shadow-2xl shadow-black/50" onClick={e => e.stopPropagation()}>
        {/* header + tabs */}
        <div className="px-5 pt-5 pb-0">
          <div className="flex items-center justify-between">
            <h2 className="text-white text-[18px] font-bold tracking-tight">Banana Best Ball IV</h2>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-white/40 hover:text-white hover:bg-white/[0.06] transition-colors">
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
          <div className="mt-4 inline-flex items-center gap-1 rounded-full bg-white/[0.05] p-1">
            {([['how', 'How it Works'], ['contest', 'Contest'], ['faq', 'FAQ']] as [Tab, string][]).map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)} className={`px-3.5 py-1.5 rounded-full text-[12.5px] font-semibold transition-colors ${tab === k ? 'bg-white text-black' : 'text-white/55 hover:text-white/85'}`}>{label}</button>
            ))}
          </div>
        </div>

        <div className="px-5 py-5 max-h-[70vh] overflow-y-auto">
          {tab === 'how' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {HOW.map(c => (
                  <div key={c.t} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5">
                    <h4 className="text-white text-[13.5px] font-semibold tracking-tight">{c.t}</h4>
                    <p className="text-white/50 text-[12px] mt-1 leading-relaxed">{c.d}</p>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-white/35 text-[11px] font-semibold uppercase tracking-[0.1em] mb-2.5">Draft types</p>
                <div className="space-y-2">
                  {TYPES.map(t => (
                    <div key={t.word} className="flex items-start gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5">
                      <span className="mt-0.5 h-2 w-2 rounded-full shrink-0" style={{ background: t.color, boxShadow: `0 0 8px ${t.color}` }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="text-white text-[13.5px] font-semibold">{t.word}</span>
                          <span className="text-[12px] font-bold tabular-nums" style={{ color: t.color }}>{t.pct}</span>
                        </div>
                        <p className="text-white/50 text-[12px] mt-0.5 leading-relaxed">{t.d}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-white/30 text-[11px] mt-2.5 leading-relaxed">Every 100 paid drafts contains exactly 94 Pro, 5 HOF, and 1 Jackpot — guaranteed distribution, not random odds.</p>
              </div>
            </div>
          )}

          {tab === 'contest' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2.5">
                <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
                  <p className="text-white/40 text-[11px] uppercase tracking-wider">Prize pool</p>
                  <p className="text-banana text-2xl font-bold mt-1">{fmt(contest?.prizePool ?? 100000)} <span className="text-white/30 text-[12px] font-medium">GTD</span></p>
                </div>
                <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
                  <p className="text-white/40 text-[11px] uppercase tracking-wider">1st place</p>
                  <p className="text-success text-2xl font-bold mt-1">{fmt(contest?.topPrize ?? 25000)}</p>
                </div>
                <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
                  <p className="text-white/40 text-[11px] uppercase tracking-wider">Entry</p>
                  <p className="text-white text-2xl font-bold mt-1">{fmt(contest?.entryFee ?? 25)}</p>
                </div>
                <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
                  <p className="text-white/40 text-[11px] uppercase tracking-wider">Entries</p>
                  <p className="text-white text-2xl font-bold mt-1 tabular-nums">{(contest?.currentEntries ?? 0).toLocaleString()}</p>
                </div>
              </div>
              <p className="text-white/45 text-[12.5px] leading-relaxed">
                <span className="text-banana font-medium">{fmt(contest?.prizePool ?? 100000)} guaranteed minimum.</span> Enter as many drafts as you want — more teams, more paths to the playoffs. Top finishers advance through playoffs for the grand prize.
              </p>
              {contest?.rosterFormat && contest.rosterFormat.length > 0 && (
                <div>
                  <p className="text-white/35 text-[11px] font-semibold uppercase tracking-[0.1em] mb-2">Roster</p>
                  <div className="flex flex-wrap gap-1.5">
                    {contest.rosterFormat.map((s, i) => (
                      <span key={i} className="rounded-lg bg-white/[0.04] border border-white/[0.06] px-2.5 py-1 text-[12px] text-white/70 font-medium">{s.count}× {s.position}</span>
                    ))}
                  </div>
                </div>
              )}

              {contest?.prizeBreakdown && contest.prizeBreakdown.length > 0 && (
                <div>
                  <p className="text-white/35 text-[11px] font-semibold uppercase tracking-[0.1em] mb-2">Prize breakdown</p>
                  <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
                    {contest.prizeBreakdown.map((p, i) => {
                      const prevSection = i > 0 ? contest.prizeBreakdown[i - 1].section : undefined;
                      const showSection = p.section && p.section !== prevSection;
                      return (
                        <div key={i}>
                          {showSection && <div className="px-4 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-white/35">{p.section}</div>}
                          <div className={`flex items-center justify-between px-4 py-2 text-[12.5px] ${i > 0 && !showSection ? 'border-t border-white/[0.04]' : ''}`}>
                            <span className="text-white/60">{p.place}</span>
                            <span className="text-white/90 font-medium tabular-nums">{fmt(p.amount)}{p.note ? <span className="text-white/35 text-[11px] font-normal ml-1">{p.note}</span> : null}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {contest?.scoringRules && contest.scoringRules.length > 0 && (
                <div>
                  <p className="text-white/35 text-[11px] font-semibold uppercase tracking-[0.1em] mb-2">Scoring</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {contest.scoringRules.slice(0, 6).map((r, i) => (
                      <div key={i} className="flex items-center justify-between rounded-lg bg-white/[0.03] border border-white/[0.06] px-2.5 py-1.5 text-[12px]">
                        <span className="text-white/55">{r.action}</span>
                        <span className={`font-medium tabular-nums ${r.points >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{r.points >= 0 ? '+' : ''}{r.points}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'faq' && (
            <div className="space-y-5">
              {mockFAQSections.map(section => (
                <div key={section.id}>
                  <p className="text-white/35 text-[11px] font-semibold uppercase tracking-[0.1em] mb-2">{section.title}</p>
                  <div className="space-y-1.5">
                    {section.items.map((item, i) => <FaqItem key={i} q={item.question} a={item.answer} />)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="text-white text-[13px] font-medium">{q}</span>
        <svg viewBox="0 0 24 24" className={`w-4 h-4 shrink-0 text-white/40 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && <p className="px-4 pb-3.5 -mt-0.5 text-white/55 text-[12.5px] leading-relaxed">{a}</p>}
    </div>
  );
}
