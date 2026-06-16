'use client';

/**
 * TEMP mock (/test-buy-success-btn) — compares the current post-purchase
 * "success" button vs a cleaner proposed version. Delete before prod.
 */

import React from 'react';

function Panel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-white/40 text-xs uppercase tracking-widest mb-3">{label}</p>
      <div className="rounded-2xl bg-[#111216] border border-white/10 p-5">{children}</div>
    </div>
  );
}

export default function TestBuySuccessBtn() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white px-4 py-10">
      <div className="max-w-md mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-bold">Post-purchase button — now vs proposed</h1>
          <p className="text-white/50 text-sm mt-1">The button you tap right after a pass purchase goes through.</p>
        </div>

        {/* NOW */}
        <Panel label="Now">
          <button className="w-full py-5 rounded-2xl font-bold text-xl bg-banana text-black shadow-lg shadow-banana/20">
            <span className="flex items-center justify-center gap-2">
              <span>✓ Purchase complete — Join a Draft</span>
              <span aria-hidden>→</span>
            </span>
          </button>
        </Panel>

        {/* SHIPPED — exact live version (responsive: shorter on mobile) */}
        <Panel label="Shipped (live)">
          {/* subtle confirmation, separate from the action */}
          <div className="flex items-center justify-center gap-2 mb-5">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.8 10A10 10 0 1 1 17 3.3" /><path d="m9 11 3 3L22 4" />
            </svg>
            <span className="text-emerald-400 text-sm font-semibold">Payment complete</span>
          </div>
          {/* clean, single-purpose CTA — matches the real button exactly */}
          <button className="mx-auto block w-fit min-w-[220px] px-8 py-3 rounded-xl font-bold text-base sm:text-lg shadow-lg shadow-banana/20 bg-banana text-black hover:brightness-110 transition-all">
            <span className="flex items-center justify-center gap-2">
              Start Drafting
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
            </span>
          </button>
        </Panel>

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-white/60 text-sm">
            Now live in the buy modal: the confirmation (&ldquo;Payment complete&rdquo;) is a small green line,
            and the button does ONE job — &ldquo;Start Drafting ›&rdquo;. Shorter rectangle
            (py-3.5 mobile / py-4 desktop, was py-5), smaller text on mobile so it fits cleanly, clean chevron.
          </p>
        </div>
      </div>
    </div>
  );
}
