import React from 'react';
import Link from 'next/link';

import { jackhofWheelSegments } from '@/lib/wheelConfig';

export const metadata = {
  title: 'Banana Wheel — Official Rules | SBS',
  description: 'Official Rules for the SBS Banana Wheel bonus spin promotion. No purchase necessary.',
};

/**
 * Official Rules for the bonus-spin promotion.
 *
 * ⚠️ INCOMPLETE — the bracketed fields below must be filled in by a
 * promotions/gaming attorney before this promotion runs. Sponsor address,
 * governing law, excluded states and the promotion period are placeholders,
 * not legal advice, and the page should not be linked from live surfaces until
 * they are real.
 *
 * The odds table is generated from the live wheel config so it can never drift
 * from what the wheel actually pays — published odds that disagree with the
 * machine are the one error in a rules page that is genuinely dangerous.
 */
export default function OfficialRulesPage() {
  const pct = (p: number) => `${(p * 100).toFixed(p < 0.001 ? 2 : p < 0.01 ? 2 : 2)}%`;

  return (
    <main className="mx-auto max-w-3xl px-5 py-12 flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-wider text-text-secondary">No purchase necessary</p>
        <h1 className="text-3xl font-semibold text-text-primary tracking-tight">
          Banana Wheel Bonus Spin — Official Rules
        </h1>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-text-primary">1. No purchase necessary</h2>
        <p className="text-text-secondary leading-relaxed">
          No purchase is necessary to enter or win, and a purchase does not improve your chance of
          winning. Free spins are available without purchase through promotions — sharing,
          referrals, events, and new-player offers — on the{' '}
          <Link href="/promos" className="underline">Promotions page</Link>.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-text-primary">2. How to enter</h2>
        <p className="text-text-secondary leading-relaxed">
          <strong className="text-text-primary">Free entry:</strong> earn free spins through
          promotions on the <Link href="/promos" className="underline">Promotions page</Link> —
          no purchase required.
        </p>
        <p className="text-text-secondary leading-relaxed">
          <strong className="text-text-primary">With a purchase:</strong> each draft entry purchased
          comes with one free bonus spin. The draft entry is confirmed at the time of purchase and
          does not depend on the spin. The spin can only add to it.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-text-primary">3. Prizes and odds</h2>
        <p className="text-text-secondary leading-relaxed">
          Prizes are draft entries. Prizes have no cash value and are not redeemable for cash.
          A Bonus Spin pays the wedge value less the draft entry already purchased, so a spin
          landing on &quot;1 Draft&quot; awards no additional entry.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-secondary">
                <th className="py-2 pr-4 font-medium">Prize</th>
                <th className="py-2 pr-4 font-medium">Odds per spin</th>
              </tr>
            </thead>
            <tbody className="text-text-primary">
              {jackhofWheelSegments.map((s) => (
                <tr key={s.id} className="border-t border-white/10">
                  <td className="py-2 pr-4">{s.label}</td>
                  <td className="py-2 pr-4 tabular-nums">{pct(s.probability)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-text-secondary">
          Odds shown are those of the current wheel configuration. Each spin outcome is committed in
          advance and independently verifiable — see{' '}
          <Link href="/banana-wheel" className="underline">the wheel&apos;s proof page</Link>.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-text-primary">4. Eligibility</h2>
        <p className="text-text-secondary leading-relaxed">
          Open to registered SBS account holders who are [AGE]+ and legal residents of eligible
          jurisdictions. Void in [EXCLUDED STATES] and where otherwise prohibited.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-text-primary">5. Promotion period</h2>
        <p className="text-text-secondary leading-relaxed">
          The promotion runs from [START DATE] through [END DATE], or until otherwise announced.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-text-primary">6. Winner notification and delivery</h2>
        <p className="text-text-secondary leading-relaxed">
          Prizes are credited to the winning account automatically at the time of the spin. No claim
          is required. Draft entries awarded as prizes are free entries and cannot be sold.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-text-primary">7. Sponsor</h2>
        <p className="text-text-secondary leading-relaxed">
          Spoiled Banana Society, [SPONSOR ADDRESS].
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-text-primary">8. Governing law</h2>
        <p className="text-text-secondary leading-relaxed">
          These rules are governed by the laws of [STATE], without regard to conflict of law
          provisions.
        </p>
      </section>
    </main>
  );
}
