import React from 'react';
import Link from 'next/link';

import Bbb4Summary from './Bbb4Summary';

export const metadata = {
  title: 'Banana Best Ball 4 Team Data | SBS',
  description: 'Download every drafted Banana Best Ball 4 team as CSV or JSON. Full rosters, QB counts and stack data, refreshed hourly.',
};

const CSV_URL = '/api/data/bbb4?format=csv';
const JSON_URL = '/api/data/bbb4?format=json';

/**
 * Public download page for the full BBB4 team dataset. Anyone can open this
 * link; nothing here needs a wallet or login.
 */
export default function Bbb4DataPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-wider text-text-secondary">Open data</p>
        <h1 className="text-3xl font-semibold text-text-primary tracking-tight">Banana Best Ball 4 Team Data</h1>
        <p className="text-text-secondary leading-relaxed">
          Every drafted Banana Best Ball 4 team in one file. Full 15 player rosters by NFL team and position,
          league number, tier, position counts and how many QBs are stacked with a WR or TE from the same team.
          Refreshes every hour as new drafts finish.
        </p>
      </header>

      <div className="flex flex-col sm:flex-row gap-3">
        <a
          href={CSV_URL}
          className="inline-flex items-center justify-center rounded-xl bg-banana px-5 py-3 text-sm font-semibold text-black hover:bg-banana-light transition-colors"
        >
          Download CSV
        </a>
        <a
          href={JSON_URL}
          className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-text-primary hover:bg-white/10 transition-colors"
        >
          Download JSON
        </a>
      </div>

      <Bbb4Summary />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-text-primary">What is in the file</h2>
        <ul className="list-disc pl-5 text-text-secondary leading-relaxed flex flex-col gap-1">
          <li><span className="text-text-primary">token</span> the BBB pass number. Team pages live at sbsfantasy.com/teams and on OpenSea.</li>
          <li><span className="text-text-primary">league</span> and <span className="text-text-primary">level</span> the draft the team came from and its tier.</li>
          <li><span className="text-text-primary">qb_count, rb_count, wr_count, te_count, dst_count</span> roster construction.</li>
          <li><span className="text-text-primary">qbs_stacked</span> how many of the team&apos;s QBs have a WR or TE from the same NFL team on the roster.</li>
          <li><span className="text-text-primary">QB1, RB1, WR1 …</span> one column per roster slot, values like <span className="text-text-primary">DET WR1</span> (NFL team and depth chart slot).</li>
          <li><span className="text-text-primary">roster</span> the full lineup in one cell.</li>
        </ul>
        <p className="text-text-secondary leading-relaxed text-sm">
          Direct links: <a href={CSV_URL} className="underline">CSV</a>, <a href={JSON_URL} className="underline">JSON</a>.
          Tag <a href="https://x.com/SBSFantasy" className="underline" target="_blank" rel="noopener noreferrer">@SBSFantasy</a> if you build something with it.
          Want a team of your own? <Link href="/draft" className="underline">Draft now</Link>.
        </p>
      </section>
    </main>
  );
}
