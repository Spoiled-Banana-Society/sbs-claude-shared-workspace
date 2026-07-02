'use client';

/**
 * Shared tabbed contest info — How it Works / Contest / FAQ (+ VRF on mobile).
 * Rendered by BOTH the ⓘ DraftInfoModal and the contest-card ContestDetailsModal
 * so the two popups are the exact same thing. The Contest tab is the shared
 * ContestDetailsBody (prize pool, breakdown, scoring, roster, odds).
 */

import { useState } from 'react';
import Link from 'next/link';
import { useWallets } from '@privy-io/react-auth';
import { mockFAQSections } from '@/lib/faqContent';
import { ContestDetailsBody } from './ContestDetailsBody';
import { DraftProofExplainerContent } from '@/components/drafting/DraftProofExplainerContent';
import { ProofFeedLive } from '@/components/drafting/ProofFeedLive';
import type { Contest } from '@/types';

type Tab = 'how' | 'contest' | 'faq' | 'vrf';

const HOW = [
  { t: '10 Players', d: 'Join a lobby — the draft starts instantly when 10 people join.' },
  { t: 'Snake Draft', d: 'Fast (30s) or slow (8hr) picks — your choice.' },
  { t: 'Team Positions', d: 'Draft “DAL WR1” and each week you get the highest-scoring Dallas wide receiver. CeeDee scores 22? You get 22. Pickens drops 30? You get 30 — always the top performer.' },
  { t: 'Best Ball', d: 'No managing needed. Draft once, best scorers auto-selected weekly.' },
  { t: 'Regular Season (Weeks 1–14)', d: 'Points are CUMULATIVE — your team stacks points every week. The top 2 in your draft pod advance to the playoffs.' },
  { t: 'Playoffs (Weeks 15–17)', d: 'Week 15 — new pod of 10, top 2 advance. Week 16 — new pod of 10, top 2 advance. Week 17 — Finals pod plays for the grand prize. (Jackpot winners skip straight to the finals.)' },
];
const TYPES: { word: string; pct: string; color: string; d: string }[] = [
  { word: 'Pro', pct: '94%', color: '#a855f7', d: 'Standard draft. Compete for the $100K GTD Prize Pool.' },
  { word: 'Hall of Fame', pct: '5%', color: '#D4AF37', d: 'Bonus prize pool on top of standard rewards.' },
  { word: 'Jackpot', pct: '1%', color: '#ef4444', d: 'Win your league and skip straight to the finals.' },
];

export function ContestInfoTabs({ contest }: { contest: Contest | null }) {
  const [tab, setTab] = useState<Tab>('contest');

  // Audience filter — same rule as app/faq/page.tsx. Without it this modal
  // showed BOTH the web2 and web3 variants of dual-audience questions (the
  // duplicate "Can I trade or drop players?" bug). Confirmed web2 = embedded
  // Privy wallet only; default-safe: logged-out / any external wallet → web3.
  const { wallets, ready: walletsReady } = useWallets();
  const isWeb2 = walletsReady && wallets.length > 0 && wallets.every((w) => w.walletClientType === 'privy');
  const hideAudience = isWeb2 ? 'web3' : 'web2';
  const faqSections = mockFAQSections
    .filter((section) => section.audience !== hideAudience)
    .map((section) => ({ ...section, items: section.items.filter((item) => item.audience !== hideAudience) }))
    .filter((section) => section.items.length > 0);

  return (
    <div>
      {/* tab bar */}
      <div className="inline-flex max-w-full overflow-x-auto banner-no-scrollbar items-center gap-1 rounded-full bg-white/[0.05] p-1 mb-5">
        {([['contest', 'Contest'], ['how', 'How it Works'], ['faq', 'FAQ'], ['vrf', 'Verified Fair']] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`shrink-0 px-3.5 py-1.5 rounded-full text-[12.5px] font-semibold transition-colors ${tab === k ? 'bg-white text-black' : 'text-white/55 hover:text-white/85'}`}>{label}</button>
        ))}
      </div>

      {tab === 'how' && (
        <div className="space-y-5">
          <div className="space-y-2">
            {HOW.map((c, i) => (
              <div key={c.t} className="flex items-start gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-banana/15 text-banana text-[11px] font-bold tabular-nums">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <h4 className="text-white text-[13.5px] font-semibold tracking-tight">{c.t}</h4>
                  <p className="text-white/50 text-[12px] mt-0.5 leading-relaxed">{c.d}</p>
                </div>
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
        contest
          ? <ContestDetailsBody contest={contest} />
          : <p className="text-white/50 text-[13px]">Contest details are loading…</p>
      )}

      {tab === 'faq' && (
        <div className="space-y-5">
          {faqSections.map(section => (
            <div key={section.id}>
              <p className="text-white/35 text-[11px] font-semibold uppercase tracking-[0.1em] mb-2">{section.title}</p>
              <div className="space-y-1.5">
                {section.items.map((item, i) => <FaqItem key={i} q={item.question} a={item.answer} link={item.link} />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Verified Fair — identical VRF explainer + the SAME real-time live feed
          desktop shows (the (i) banner modal + /proof-feed), now in-tab so every
          user (incl. mobile, where the desktop sidebar card is hidden) gets it.
          ProofFeedLive's SSE only connects while this tab is mounted. */}
      {tab === 'vrf' && (
        <div className="space-y-6">
          <DraftProofExplainerContent />
          <div>
            <p className="text-white/35 text-[11px] font-semibold uppercase tracking-[0.1em] mb-3">Live draft feed</p>
            <ProofFeedLive />
          </div>
        </div>
      )}
    </div>
  );
}

function FaqItem({ q, a, link }: { q: string; a: string; link?: { label: string; href: string } }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="text-white text-[13px] font-medium">{q}</span>
        <svg viewBox="0 0 24 24" className={`w-4 h-4 shrink-0 text-white/40 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="px-4 pb-3.5 -mt-0.5">
          <p className="text-white/55 text-[12.5px] leading-relaxed whitespace-pre-line">{a}</p>
          {link && (
            <Link href={link.href} className="inline-flex items-center gap-1.5 mt-2.5 px-3 py-1.5 rounded-lg bg-banana text-black text-[12px] font-semibold hover:brightness-110 transition-all">
              {link.label}
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
