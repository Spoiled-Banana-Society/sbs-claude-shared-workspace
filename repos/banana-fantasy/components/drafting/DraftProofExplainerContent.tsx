'use client';

import { useEffect, useState } from 'react';

/**
 * The inner "Provably Fair" explainer content — header, the 4 verification
 * steps, the trustless footer and the on-chain links. Extracted from
 * DraftProofExplainerModal so the SAME copy renders both inside that desktop
 * (i) modal AND inside the "Verified Fair" info tab. One source of truth.
 *
 * `contractAddress` is optional: when a parent already has it (the desktop
 * banner fetched it) pass it in; when used standalone (the info tab) the
 * component self-fetches the merkle contract address.
 */
export function DraftProofExplainerContent({
  contractAddress,
  showFeedLink = false,
}: {
  contractAddress?: string | null;
  /** Show the "See on-chain proof →" link to /proof-feed. The desktop (i)
   *  modal sets this; the info tab omits it because the live feed is inline. */
  showFeedLink?: boolean;
}) {
  const [addr, setAddr] = useState<string | null>(contractAddress ?? null);

  useEffect(() => {
    // Controlled by parent — mirror the prop.
    if (contractAddress !== undefined) {
      setAddr(contractAddress);
      return;
    }
    // Uncontrolled (info tab) — self-fetch.
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/batch-proof-merkle-contract');
        if (!r.ok) return;
        const body = (await r.json()) as { contractAddress: string | null };
        if (!cancelled) setAddr(body.contractAddress);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [contractAddress]);

  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-400 mb-3">
        Verified Fair
      </div>
      <h2 className="text-[22px] font-semibold text-white tracking-tight leading-tight">
        How draft types are verified
      </h2>
      <p className="text-white/55 text-[13.5px] mt-2 leading-snug">
        Every draft&apos;s type was randomized by Chainlink VRF and locked in before any draft happened.
      </p>

      <div className="mt-5 space-y-5">
        <Step
          num="1"
          title="Chainlink VRF generated the outcomes"
          body="A decentralized oracle supplied the randomness. SBS never saw or chose it."
        />
        <Step
          num="2"
          title="1 in 100 = Jackpot, 5 in 100 = HOF, 94 in 100 = Pro"
          body="Every 100-draft window contains exactly that distribution."
        />
        <Step
          num="3"
          title="The full list was locked in up front"
          body="Every draft type was locked in by Chainlink VRF before any draft happened — and can't be changed afterward."
        />
        <Step
          num="4"
          title="Every draft includes a proof"
          body="When your draft fills, the result comes with its own proof — checked in your browser in milliseconds. That's the green Verified ✓ badge."
        />
      </div>

      <div className="mt-6 pt-5 border-t border-white/[0.07]">
        <p className="text-white/80 text-[13.5px] leading-relaxed">
          <span className="text-emerald-400 font-semibold">Trustless by design.</span>{' '}
          Outcomes are locked in from the start, and anyone can verify them.
        </p>
        {showFeedLink && (
          <a
            href="/proof-feed"
            className="inline-block mt-3 text-banana hover:underline text-[12px] font-medium"
          >
            See the proof →
          </a>
        )}
        {addr && (
          <a
            href={`https://basescan.org/address/${addr}`}
            target="_blank"
            rel="noreferrer"
            className="block mt-2 text-white/40 hover:text-white text-[11px] font-mono"
          >
            Contract: {addr.slice(0, 8)}…{addr.slice(-4)}
          </a>
        )}
      </div>
    </div>
  );
}

function Step({ num, title, body }: { num: string; title: string; body: string }) {
  return (
    <div className="flex gap-3.5">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-white/65 text-[12px] font-semibold">
        {num}
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <h3 className="text-white text-[14.5px] font-semibold mb-1 leading-tight tracking-tight">{title}</h3>
        <p className="text-white/55 text-[13px] leading-relaxed">{body}</p>
      </div>
    </div>
  );
}
