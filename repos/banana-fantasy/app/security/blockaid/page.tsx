'use client';

import React, { useState } from 'react';

const SUBMISSION_FIELDS = [
  { label: 'Project', value: 'Spoiled Banana Society (SBS)' },
  { label: 'Contract', value: 'BBB4 Draft Pass NFT' },
  { label: 'Contract Address', value: '0xadf5b9b46616de6d073F226e7b7C532aE2CFFB80' },
  { label: 'Chain', value: 'Base (8453)' },
  { label: 'Token Standard', value: 'ERC-721' },
  { label: 'Contract Type', value: 'Draft Pass NFT (Game Access Token)' },
  {
    label: 'Submission Notes',
    value:
      'BBB4 is used for draft entry in SBS fantasy football drafts. Contract is live on Base Sepolia for launch validation and security review before production rollout.',
  },
] as const;

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // no-op
    }
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="text-[11px] uppercase tracking-[0.15em] text-white/45 mb-1">{label}</div>
      <div className="flex items-start gap-3">
        <p className="text-sm text-white/90 break-all flex-1">{value}</p>
        <button
          onClick={onCopy}
          className="shrink-0 px-2.5 py-1 rounded-md border border-white/20 text-xs text-white/80 hover:bg-white/10 transition-colors"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export default function BlockaidSubmissionPage() {
  return (
    <main className="min-h-screen bg-[#0a0a0c] text-white px-4 py-8 sm:px-6">
      <div className="max-w-3xl mx-auto space-y-5">
        <div>
          <h1 className="text-3xl font-black">Blockaid Allowlist Submission (BBB4)</h1>
          <p className="text-white/60 mt-2 text-sm">
            Copy-ready submission package for backlog task #168. This page is internal operational tooling to accelerate allowlist submission.
          </p>
        </div>

        <div className="space-y-3">
          {SUBMISSION_FIELDS.map((field) => (
            <CopyRow key={field.label} label={field.label} value={field.value} />
          ))}
        </div>

        <div className="rounded-xl border border-yellow-400/30 bg-yellow-400/10 p-3 text-sm text-yellow-100">
          Final action still requires manual submission in Blockaid portal. This page ensures data consistency and reduces copy/paste mistakes.
        </div>
      </div>
    </main>
  );
}
