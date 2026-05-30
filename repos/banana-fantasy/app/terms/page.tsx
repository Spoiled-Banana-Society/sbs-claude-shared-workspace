'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

/* ────────── Types ────────── */

interface Section {
  id: string;
  title: string;
  content: React.ReactNode;
}

/* ────────── Sections ────────── */

const LAST_UPDATED = 'February 13, 2026';

function buildSections(): Section[] {
  return [
    {
      id: 'acceptance',
      title: '1. Acceptance of Terms',
      content: (
        <>
          <p>
            By accessing or using the Spoiled Banana Society platform (&quot;SBS,&quot; &quot;Platform,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;),
            including the website at sbsfantasy.com and all related services, you agree to be bound by these Terms of Service
            (&quot;Terms&quot;). If you do not agree, do not access or use the Platform.
          </p>
          <p>
            We reserve the right to modify these Terms at any time. Changes take effect upon posting to this page.
            Your continued use of the Platform after changes constitutes acceptance of the revised Terms.
            We will make reasonable efforts to notify users of material changes via email or in-app notification.
          </p>
        </>
      ),
    },
    {
      id: 'eligibility',
      title: '2. Eligibility',
      content: (
        <>
          <p>You must meet <strong>all</strong> of the following to use the Platform:</p>
          <ul>
            <li>Be at least <strong>18 years of age</strong> (or the age of majority in your jurisdiction, whichever is greater).</li>
            <li>Have the legal capacity to enter into a binding agreement.</li>
            <li>Not be located in a jurisdiction where participation in fantasy sports contests is prohibited by applicable law.</li>
            <li>Not have been previously banned or suspended from the Platform.</li>
          </ul>
          <p>
            By creating an account, you represent and warrant that you meet all eligibility requirements.
            We reserve the right to verify your identity and age at any time and to suspend accounts that do not comply.
          </p>
        </>
      ),
    },
    {
      id: 'accounts',
      title: '3. Account Creation & Security',
      content: (
        <>
          <p>
            Accounts are created by connecting a compatible cryptocurrency wallet through our authentication provider (Privy).
            Each user may maintain only <strong>one (1) account</strong>. Multi-accounting is strictly prohibited and may result
            in forfeiture of prizes and permanent suspension.
          </p>
          <p>
            You are solely responsible for maintaining the security of your wallet and account credentials.
            SBS is not liable for any loss or damage arising from unauthorized access to your account.
            You agree to notify us immediately at{' '}
            <a href="mailto:team@sbsfantasy.com" className="text-[#F3E216] hover:underline">
              team@sbsfantasy.com
            </a>{' '}
            if you suspect unauthorized use.
          </p>
        </>
      ),
    },
    {
      id: 'drafts',
      title: '4. Draft Passes & Entry Fees',
      content: (
        <>
          <p>
            Participation in best ball drafts requires a <strong>Draft Pass</strong>. Draft Passes may be obtained by:
          </p>
          <ul>
            <li>Purchasing them directly through the Platform using supported payment methods.</li>
            <li>Receiving free passes through promotions, referral bonuses, or the Banana Wheel.</li>
            <li>Earning them as prizes from completed contests.</li>
          </ul>
          <p>
            <strong>All Draft Pass purchases are final.</strong> Refunds are issued only at our sole discretion in cases of
            technical failure that prevented participation in a draft. Entry fees collected from Draft Pass purchases fund
            the prize pools for each contest.
          </p>
          <p>
            The Platform charges a <strong>rake</strong> (service fee) on each draft entry, which is disclosed on the draft
            lobby page before you join. Prize pool distributions are displayed before draft entry.
          </p>
        </>
      ),
    },
    {
      id: 'prizes',
      title: '5. Prize Distribution',
      content: (
        <>
          <p>
            Prizes are distributed according to the payout structure displayed for each contest type.
            The Platform offers several prize mechanisms:
          </p>
          <ul>
            <li><strong>Standard Payouts:</strong> Based on final standings at the end of the NFL season.</li>
            <li><strong>Jackpot Drafts:</strong> Special high-value prize pools triggered within batches of 100 drafts.</li>
            <li><strong>Hall of Fame (HOF) Entries:</strong> Bonus competition entries awarded within draft batches.</li>
            <li><strong>Banana Wheel Prizes:</strong> Instant prizes from the Banana Wheel spin feature.</li>
          </ul>
          <p>
            Prizes are credited to your account balance. Withdrawals are subject to identity verification and
            processing times. We reserve the right to withhold prizes pending investigation of potential Terms violations.
          </p>
        </>
      ),
    },
    {
      id: 'rng',
      title: '6. Provably Fair RNG',
      content: (
        <>
          <p>
            SBS uses a <strong>provably fair random number generation (RNG) system</strong> for draft order determination,
            Banana Wheel spins, Jackpot selection, and Hall of Fame entry selection. Our system operates on a
            cryptographic <strong>commit-reveal scheme</strong> using HMAC-SHA256:
          </p>
          <ol>
            <li><strong>Commit Phase:</strong> Before each random event, the server generates a cryptographic seed and publishes a hash commitment (SHA-256 of the seed).</li>
            <li><strong>Reveal Phase:</strong> After the event, the original seed is revealed. Anyone can verify that hashing the revealed seed produces the published commitment.</li>
            <li><strong>Deterministic Output:</strong> The random outcome is deterministically derived from the seed, meaning the result was fixed at commit time and could not be altered after the fact.</li>
          </ol>
          <p>
            Verification is available for all RNG events via our public API endpoint. Each event is stored with its
            commitment hash, revealed seed, and computed result for independent audit. We believe transparency in
            randomness is essential to fair competition.
          </p>
        </>
      ),
    },
    {
      id: 'conduct',
      title: '7. Prohibited Conduct',
      content: (
        <>
          <p>You agree <strong>not</strong> to:</p>
          <ul>
            <li>Create or operate multiple accounts (multi-accounting).</li>
            <li>Use bots, scripts, or automated tools to interact with the Platform or gain an unfair advantage.</li>
            <li>Collude with other users to manipulate draft outcomes or standings.</li>
            <li>Exploit bugs, glitches, or vulnerabilities — report them to us instead.</li>
            <li>Engage in money laundering, fraud, or any illegal activity through the Platform.</li>
            <li>Harass, threaten, or abuse other users or SBS staff.</li>
            <li>Circumvent geographic restrictions, age verification, or access controls.</li>
            <li>Reverse-engineer, decompile, or attempt to extract the source code of the Platform.</li>
          </ul>
          <p>
            Violation of these rules may result in account suspension, prize forfeiture, and permanent ban at our sole discretion.
          </p>
        </>
      ),
    },
    {
      id: 'ip',
      title: '8. Intellectual Property',
      content: (
        <>
          <p>
            All content on the Platform — including but not limited to text, graphics, logos, the &quot;Spoiled Banana Society&quot;
            brand, user interface designs, software code, and the Banana Wheel — is the property of SBS or its licensors
            and is protected by intellectual property laws.
          </p>
          <p>
            You are granted a limited, non-exclusive, non-transferable, revocable license to access and use the Platform
            for personal, non-commercial purposes. You may not reproduce, distribute, modify, create derivative works of,
            or publicly display any Platform content without our prior written consent.
          </p>
          <p>
            NFL player names, team names, and statistical data are used under fair use for fantasy sports purposes and
            remain the property of their respective owners.
          </p>
        </>
      ),
    },
    {
      id: 'liability',
      title: '9. Limitation of Liability',
      content: (
        <>
          <p>
            THE PLATFORM IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT WARRANTIES OF ANY KIND,
            EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
            PURPOSE, OR NON-INFRINGEMENT.
          </p>
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, SBS AND ITS OFFICERS, DIRECTORS, EMPLOYEES, AND AGENTS
            SHALL NOT BE LIABLE FOR:
          </p>
          <ul>
            <li>Any indirect, incidental, special, consequential, or punitive damages.</li>
            <li>Loss of profits, data, or goodwill.</li>
            <li>Unauthorized access to or alteration of your transmissions or data.</li>
            <li>Any third-party conduct on the Platform.</li>
            <li>Service interruptions, bugs, or errors.</li>
          </ul>
          <p>
            Our total liability for any claim arising from your use of the Platform shall not exceed the amount
            you paid to SBS in the twelve (12) months preceding the claim.
          </p>
        </>
      ),
    },
    {
      id: 'disputes',
      title: '10. Dispute Resolution',
      content: (
        <>
          <p>
            Any dispute, claim, or controversy arising out of or relating to these Terms or the Platform shall be resolved
            through the following process:
          </p>
          <ol>
            <li>
              <strong>Informal Resolution:</strong> Contact us at{' '}
              <a href="mailto:team@sbsfantasy.com" className="text-[#F3E216] hover:underline">
                team@sbsfantasy.com
              </a>{' '}
              with a detailed description. We will attempt to resolve the dispute informally within thirty (30) days.
            </li>
            <li>
              <strong>Binding Arbitration:</strong> If informal resolution fails, the dispute shall be resolved by binding
              arbitration administered by a mutually agreed-upon arbitration service. The arbitration shall be conducted
              in English. The arbitrator&apos;s decision shall be final and enforceable in any court of competent jurisdiction.
            </li>
            <li>
              <strong>Class Action Waiver:</strong> You agree that disputes will be resolved on an individual basis.
              You waive any right to participate in a class action lawsuit or class-wide arbitration.
            </li>
          </ol>
        </>
      ),
    },
    {
      id: 'privacy',
      title: '11. Privacy',
      content: (
        <>
          <p>
            We take your privacy seriously. Here is a summary of our data practices:
          </p>
          <ul>
            <li><strong>Data Collected:</strong> Wallet address, email (if provided for verification), draft history, transaction records, and usage analytics.</li>
            <li><strong>How We Use It:</strong> To operate the Platform, process transactions, prevent fraud, improve our services, and communicate with you about your account.</li>
            <li><strong>Third Parties:</strong> We share data only with essential service providers (authentication, analytics, payment processing) and as required by law. We do not sell your personal data.</li>
            <li><strong>Blockchain Data:</strong> Wallet addresses and on-chain transactions are inherently public. SBS is not responsible for data visible on public blockchains.</li>
            <li><strong>Data Retention:</strong> We retain account data for the duration of your account and for a reasonable period thereafter for legal and operational purposes.</li>
            <li><strong>Your Rights:</strong> You may request deletion of your account and associated data by contacting us. Certain data may be retained as required by law.</li>
          </ul>
          <p>
            A comprehensive Privacy Policy may be published separately. In the event of conflict, the standalone Privacy Policy governs.
          </p>
        </>
      ),
    },
    {
      id: 'contact',
      title: '12. Contact Information',
      content: (
        <>
          <p>For questions, concerns, or support requests:</p>
          <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4 mt-3 space-y-2">
            <p><strong>Spoiled Banana Society</strong></p>
            <p>
              Email:{' '}
              <a href="mailto:team@sbsfantasy.com" className="text-[#F3E216] hover:underline">
                team@sbsfantasy.com
              </a>
            </p>
            <p>
              Discord:{' '}
              <a href="https://discord.gg/spoiledbanana" target="_blank" rel="noopener noreferrer" className="text-[#F3E216] hover:underline">
                discord.gg/spoiledbanana
              </a>
            </p>
            <p>
              Twitter:{' '}
              <a href="https://twitter.com/SpoiledBananaNF" target="_blank" rel="noopener noreferrer" className="text-[#F3E216] hover:underline">
                @SpoiledBananaNF
              </a>
            </p>
          </div>
        </>
      ),
    },
  ];
}

/* ────────── Component ────────── */

export default function TermsPage() {
  const sections = useMemo(() => buildSections(), []);
  const [activeId, setActiveId] = useState(sections[0].id);
  const [openMobile, setOpenMobile] = useState<string | null>(null);

  // Intersection observer for scroll-spy
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 },
    );

    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [sections]);

  const scrollTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const toggleMobile = useCallback((id: string) => {
    setOpenMobile((prev) => (prev === id ? null : id));
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200">
      {/* Hero */}
      <div className="border-b border-gray-800 bg-gradient-to-b from-gray-900 to-gray-950">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-[#F3E216] transition-colors mb-6">
            ← Back to SBS
          </Link>
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3">Terms of Service</h1>
          <p className="text-gray-400">
            Last updated: {LAST_UPDATED}
          </p>
          <p className="text-sm text-gray-500 mt-2 max-w-2xl">
            Please read these Terms of Service carefully before using the Spoiled Banana Society platform.
            By accessing or using our services, you agree to be bound by these terms.
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-10">
          {/* Desktop TOC sidebar */}
          <aside className="hidden lg:block">
            <nav className="sticky top-24" aria-label="Table of contents">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Contents</h2>
              <ul className="space-y-1">
                {sections.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => scrollTo(s.id)}
                      className={`w-full text-left px-3 py-1.5 rounded-md text-sm transition-colors ${
                        activeId === s.id
                          ? 'text-[#F3E216] bg-[#F3E216]/10 font-medium'
                          : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
                      }`}
                    >
                      {s.title}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>

          {/* Content */}
          <main>
            {/* Desktop: all sections visible */}
            <div className="hidden lg:block space-y-12">
              {sections.map((s) => (
                <section
                  key={s.id}
                  id={s.id}
                  className="scroll-mt-24 prose prose-invert prose-sm max-w-none
                    prose-headings:text-white prose-headings:font-semibold
                    prose-p:text-gray-300 prose-p:leading-relaxed prose-p:mb-4
                    prose-li:text-gray-300 prose-li:leading-relaxed
                    prose-ul:list-disc prose-ul:pl-5 prose-ul:space-y-1.5 prose-ul:mb-4
                    prose-ol:list-decimal prose-ol:pl-5 prose-ol:space-y-1.5 prose-ol:mb-4
                    prose-strong:text-white prose-a:text-[#F3E216] prose-a:no-underline hover:prose-a:underline"
                >
                  <h2 className="text-xl font-semibold text-white mb-4 pb-2 border-b border-gray-800">{s.title}</h2>
                  {s.content}
                </section>
              ))}
            </div>

            {/* Mobile: collapsible accordion */}
            <div className="lg:hidden space-y-2">
              {sections.map((s) => {
                const isOpen = openMobile === s.id;
                return (
                  <div key={s.id} id={s.id} className="scroll-mt-20 rounded-xl border border-gray-800 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggleMobile(s.id)}
                      className="w-full flex items-center justify-between px-4 py-3.5 text-left bg-gray-900/60 hover:bg-gray-800/60 transition-colors"
                      aria-expanded={isOpen}
                    >
                      <span className="text-sm font-medium text-white">{s.title}</span>
                      <svg
                        className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {isOpen && (
                      <div className="px-4 py-4 bg-gray-950/50 text-sm
                        prose prose-invert prose-sm max-w-none
                        prose-p:text-gray-300 prose-p:leading-relaxed prose-p:mb-3
                        prose-li:text-gray-300 prose-li:leading-relaxed
                        prose-ul:list-disc prose-ul:pl-5 prose-ul:space-y-1 prose-ul:mb-3
                        prose-ol:list-decimal prose-ol:pl-5 prose-ol:space-y-1 prose-ol:mb-3
                        prose-strong:text-white prose-a:text-[#F3E216]"
                      >
                        {s.content}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Bottom note */}
            <div className="mt-12 rounded-xl border border-gray-800 bg-gray-900/40 p-6 text-center">
              <p className="text-sm text-gray-400">
                Questions about these terms? Reach out to{' '}
                <a href="mailto:team@sbsfantasy.com" className="text-[#F3E216] hover:underline">
                  team@sbsfantasy.com
                </a>
              </p>
              <div className="flex items-center justify-center gap-4 mt-4">
                <Link href="/" className="text-sm text-gray-500 hover:text-gray-300 transition-colors">
                  Home
                </Link>
                <span className="text-gray-700">·</span>
                <Link href="/faq" className="text-sm text-gray-500 hover:text-gray-300 transition-colors">
                  FAQ
                </Link>
                <span className="text-gray-700">·</span>
                <Link href="/about/genesis" className="text-sm text-gray-500 hover:text-gray-300 transition-colors">
                  About
                </Link>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
