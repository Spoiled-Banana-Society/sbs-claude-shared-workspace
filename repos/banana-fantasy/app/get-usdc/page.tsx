'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';

// Manual "Add network" details for Base, in case it isn't in MetaMask's preset list.
const BASE_NETWORK: { label: string; value: string; copy?: boolean }[] = [
  { label: 'Network name', value: 'Base' },
  { label: 'RPC URL', value: 'https://mainnet.base.org', copy: true },
  { label: 'Chain ID', value: '8453', copy: true },
  { label: 'Currency symbol', value: 'ETH' },
  { label: 'Block explorer', value: 'https://basescan.org' },
];

// MetaMask network-switch steps differ between the browser extension and the
// phone app — keep them separate so neither audience gets the wrong UI labels.
const METAMASK_STEPS: Record<'desktop' | 'mobile', React.ReactNode[]> = {
  desktop: [
    <>Open the MetaMask extension and click the <span className="text-text-primary font-semibold">network selector</span> in the top-left corner.</>,
    <>Pick <span className="text-banana font-semibold">Base</span> from the list — recent MetaMask versions include it by default.</>,
    <>Don&apos;t see it? Click <span className="text-text-primary font-semibold">Add a custom network</span> and enter the details below.</>,
  ],
  mobile: [
    <>Open the MetaMask app and tap the <span className="text-text-primary font-semibold">network selector</span> at the top of the screen.</>,
    <>Tap <span className="text-banana font-semibold">Base</span> if it&apos;s listed. If not, tap <span className="text-text-primary font-semibold">Add network</span> — Base is in the popular list.</>,
    <>To use SBS on your phone with MetaMask, open this site inside <span className="text-text-primary font-semibold">MetaMask&apos;s built-in browser</span> (menu → Browser). Or skip all of this and log in here with email — that wallet is already on Base.</>,
  ],
};

// Inline icons keep this page dependency-free (no icon-name typos can break the build).
function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function ExternalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard unavailable (e.g. insecure context) — silently no-op
    }
  };
  return (
    <button
      onClick={onCopy}
      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-banana/10 text-banana hover:bg-banana/20 transition-colors text-sm font-semibold flex-shrink-0"
      aria-label={`Copy ${label}`}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function StepList({ steps }: { steps: React.ReactNode[] }) {
  return (
    <ol className="space-y-3">
      {steps.map((step, idx) => (
        <li key={idx} className="flex gap-3 text-sm text-text-secondary leading-relaxed">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-banana/10 text-banana font-semibold text-xs flex items-center justify-center mt-0.5">
            {idx + 1}
          </span>
          <span className="flex-1">{step}</span>
        </li>
      ))}
    </ol>
  );
}

interface Method {
  emoji: string;
  tag: string;
  title: string;
  best: string;
  steps: React.ReactNode[];
  link?: { label: string; href: string };
}

const METHODS: Method[] = [
  {
    emoji: '⚡',
    tag: 'Fastest · Recommended',
    title: 'Swap your ETH to USDC on Base with Relay',
    best: 'Best if you hold ETH (or any crypto) in your own wallet — Mainnet ETH converts in one step, no separate bridge needed.',
    steps: [
      <>Open <span className="text-banana font-semibold">relay.link</span> and connect the wallet that holds your crypto.</>,
      <>Set <span className="text-text-primary font-semibold">From</span> to what you have — for example <span className="text-text-primary font-semibold">ETH on Ethereum</span>.</>,
      <>Set <span className="text-text-primary font-semibold">To</span> to <span className="text-banana font-semibold">USDC on Base</span>.</>,
      <>Enter the amount, review the quote, confirm.</>,
      <>Your USDC lands on Base in seconds. You&apos;re ready to draft.</>,
    ],
    link: { label: 'Open Relay', href: 'https://relay.link' },
  },
  {
    emoji: '🏦',
    tag: 'Using an exchange',
    title: 'Go through Coinbase',
    best: 'Best if your funds sit on Coinbase, or you want to buy USDC with a bank transfer first.',
    steps: [
      <>Have crypto on Coinbase? <span className="text-text-primary font-semibold">Convert it to USDC.</span> Starting from zero? <span className="text-text-primary font-semibold">Buy USDC</span> with a card or bank transfer.</>,
      <>Choose <span className="text-text-primary font-semibold">Send / Withdraw</span> and select <span className="text-text-primary font-semibold">USDC</span>.</>,
      <>For the network, pick <span className="text-banana font-semibold">Base</span> — this is the part that matters.</>,
      <>Paste <span className="text-text-primary font-semibold">your wallet address</span> (shown above — same address you use on Ethereum) and confirm.</>,
      <>USDC arrives on Base, usually within a minute.</>,
    ],
  },
  {
    emoji: '💳',
    tag: 'Simplest',
    title: 'Buy USDC directly with a card',
    best: 'Best if you just want USDC outright, no other crypto involved.',
    steps: [
      <><span className="text-text-primary font-semibold">In MetaMask:</span> tap <span className="text-text-primary font-semibold">Buy</span>, choose <span className="text-text-primary font-semibold">USDC</span> on the <span className="text-banana font-semibold">Base</span> network, pay with a card.</>,
      <><span className="text-text-primary font-semibold">In Coinbase Wallet:</span> tap <span className="text-text-primary font-semibold">Buy</span>, choose <span className="text-text-primary font-semibold">USDC on Base</span>, pay with a card.</>,
      <>Either way, the USDC lands straight in your wallet on Base.</>,
    ],
  },
];

// "What changed" comparison — last season on Mainnet vs this season on Base.
const CHANGES: { label: string; before: string; after: string }[] = [
  { label: 'Network', before: 'Ethereum Mainnet', after: 'Base' },
  { label: 'You pay with', before: 'ETH', after: 'USDC' },
  { label: 'Gas fees on SBS', before: 'You paid them', after: 'On us' },
];

export default function GetUsdcPage() {
  const { walletAddress } = useAuth();
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');

  // Default the MetaMask instructions to the device the user is actually on.
  useEffect(() => {
    if (typeof navigator !== 'undefined' && /iPhone|iPad|Android|Mobi/i.test(navigator.userAgent)) {
      setDevice('mobile');
    }
  }, []);

  return (
    <div className="w-full px-4 sm:px-8 lg:px-12 py-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <p className="text-banana font-semibold text-sm uppercase tracking-widest mb-2">New this season</p>
          <h1 className="text-3xl sm:text-4xl font-bold text-text-primary mb-3">We&apos;ve moved to Base</h1>
          <p className="text-text-secondary leading-relaxed max-w-xl mx-auto">
            Drafts are now <span className="text-text-primary font-semibold">$25 USDC</span> on the{' '}
            <span className="text-text-primary font-semibold">Base</span> network — same game, way smoother.
            Everything you need is on this page, and it takes about two minutes.
          </p>
        </div>

        {/* What changed — returning player comparison */}
        <div className="glass-card p-5 sm:p-6 mb-8">
          <p className="text-xs font-mono text-text-muted uppercase tracking-wider mb-4">Played with us on Mainnet? Here&apos;s what changed</p>
          <div className="grid grid-cols-3 gap-3">
            {CHANGES.map((c) => (
              <div key={c.label} className="text-center">
                <p className="text-[11px] text-text-muted uppercase tracking-wider mb-1.5">{c.label}</p>
                <p className="text-text-muted text-xs sm:text-sm line-through decoration-text-muted/50">{c.before}</p>
                <p className="text-banana font-semibold text-sm sm:text-base mt-0.5">{c.after}</p>
              </div>
            ))}
          </div>
        </div>

        {/* No-crypto escape hatch */}
        <div className="rounded-xl border border-banana/30 bg-banana/[0.06] p-4 mb-10 text-sm text-text-secondary leading-relaxed">
          <span className="text-banana font-semibold">Want zero setup?</span> Pay with a debit card
          right at checkout — no USDC needed at all. Card purchases carry a processing fee, but{' '}
          <span className="text-text-primary font-semibold">every dollar of it is credited back to you</span> — at $25
          in credit you get a draft pass, same as one you bought (it counts as paid for promos). You can watch it fill live at checkout.{' '}
          <Link href="/buy-drafts" className="text-banana font-semibold hover:brightness-110">Buy a pass →</Link>
        </div>

        {/* STEP 1 — wallet on Base */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <span className="flex-shrink-0 w-8 h-8 rounded-full bg-banana text-black font-bold text-sm flex items-center justify-center">1</span>
            <h2 className="text-2xl font-bold text-text-primary">Get your wallet on Base</h2>
          </div>
          <p className="text-text-secondary text-sm leading-relaxed mb-5">
            Base uses the same address as Ethereum — your wallet just needs to point at the right network. Find yours below.
          </p>

          <div className="space-y-4">
            {/* Email / social login */}
            <div className="glass-card p-5 sm:p-6">
              <div className="flex items-start gap-4">
                <span className="text-3xl leading-none flex-shrink-0">✉️</span>
                <div className="min-w-0">
                  <h3 className="text-lg font-bold text-text-primary">I log in with email or social</h3>
                  <p className="text-text-secondary text-sm mt-1 leading-relaxed">
                    <span className="text-banana font-semibold">You&apos;re already done.</span> Your SBS wallet lives on
                    Base automatically — nothing to switch, nothing to add. Grab your address in
                    Step&nbsp;2 if you want to send USDC to it.
                  </p>
                </div>
              </div>
            </div>

            {/* Coinbase Wallet */}
            <div className="glass-card p-5 sm:p-6">
              <div className="flex items-start gap-4">
                <span className="text-3xl leading-none flex-shrink-0">🔵</span>
                <div className="min-w-0">
                  <h3 className="text-lg font-bold text-text-primary">I use Coinbase Wallet</h3>
                  <p className="text-text-secondary text-sm mt-1 leading-relaxed">
                    Base is <span className="text-text-primary font-semibold">built in</span> — Coinbase created the
                    network. On desktop or phone, just make sure Base is the selected network when you connect. No setup.
                  </p>
                </div>
              </div>
            </div>

            {/* MetaMask — device-aware */}
            <div className="glass-card p-5 sm:p-6">
              <div className="flex items-start gap-4 mb-4">
                <span className="text-3xl leading-none flex-shrink-0">🦊</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <h3 className="text-lg font-bold text-text-primary">I use MetaMask</h3>
                    {/* Desktop / Mobile toggle */}
                    <div className="flex rounded-lg bg-bg-tertiary/60 border border-bg-tertiary p-0.5">
                      {(['desktop', 'mobile'] as const).map((d) => (
                        <button
                          key={d}
                          onClick={() => setDevice(d)}
                          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                            device === d ? 'bg-banana text-black' : 'text-text-muted hover:text-text-secondary'
                          }`}
                        >
                          {d === 'desktop' ? '🖥 Desktop' : '📱 Mobile'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="text-text-muted text-sm mt-1 leading-relaxed">
                    MetaMask opens on Ethereum Mainnet by default — switch it to Base (about 30 seconds).
                  </p>
                </div>
              </div>

              <StepList steps={METAMASK_STEPS[device]} />

              {/* Manual network details */}
              <div className="mt-5 rounded-lg border border-bg-tertiary bg-bg-tertiary/40 p-4">
                <p className="text-xs text-text-muted uppercase tracking-wider mb-3">Add Base manually</p>
                <dl className="space-y-2.5 text-sm">
                  {BASE_NETWORK.map((row) => (
                    <div key={row.label} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
                      <dt className="text-text-muted w-36 flex-shrink-0">{row.label}</dt>
                      <dd className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="text-text-primary font-mono break-all">{row.value}</span>
                        {row.copy && <CopyButton value={row.value} label={row.label} />}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </div>
        </div>

        {/* STEP 2 — your address */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <span className="flex-shrink-0 w-8 h-8 rounded-full bg-banana text-black font-bold text-sm flex items-center justify-center">2</span>
            <h2 className="text-2xl font-bold text-text-primary">Know your Base address</h2>
          </div>
          <div className="glass-card p-6">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">👛</span>
              <h3 className="text-lg font-semibold text-text-primary">Your Base wallet address</h3>
            </div>
            {walletAddress ? (
              <>
                <p className="text-text-secondary text-sm mb-3 leading-relaxed">
                  This is where you send USDC. It&apos;s the same address on every network — what matters is
                  picking <span className="text-banana font-semibold">Base</span> as the network when you send.
                </p>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-bg-tertiary/60 border border-bg-tertiary rounded-lg p-3">
                  <code className="text-text-primary text-sm break-all font-mono flex-1">{walletAddress}</code>
                  <CopyButton value={walletAddress} label="wallet address" />
                </div>
              </>
            ) : (
              <p className="text-text-secondary text-sm leading-relaxed">
                <Link href="/" className="text-banana font-semibold hover:brightness-110">Log in</Link>{' '}
                to see your personal Base wallet address here — it&apos;s the address you&apos;ll send USDC to.
              </p>
            )}
          </div>
        </div>

        {/* STEP 3 — get USDC */}
        <div className="flex items-center gap-3 mb-4">
          <span className="flex-shrink-0 w-8 h-8 rounded-full bg-banana text-black font-bold text-sm flex items-center justify-center">3</span>
          <h2 className="text-2xl font-bold text-text-primary">Get USDC on Base</h2>
        </div>
        <p className="text-text-secondary text-sm leading-relaxed mb-5">
          Pick whichever fits where your money is today. Everything you do <span className="text-text-primary font-semibold">on SBS</span> is
          gas-free — we cover it. Outside swaps and bridges (Relay, Coinbase) charge their own small network fee, shown in their quote.
        </p>

        <div className="space-y-6">
          {METHODS.map((m, i) => (
            <div key={m.title} className="glass-card p-6 sm:p-7">
              <div className="flex items-start gap-4 mb-4">
                <span className="text-3xl leading-none flex-shrink-0">{m.emoji}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono text-text-muted uppercase tracking-wider">Option {i + 1}</span>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-banana bg-banana/10 px-2 py-0.5 rounded-full">{m.tag}</span>
                  </div>
                  <h3 className="text-xl font-bold text-text-primary mt-1">{m.title}</h3>
                  <p className="text-text-muted text-sm mt-1 leading-relaxed">{m.best}</p>
                </div>
              </div>

              <StepList steps={m.steps} />

              {m.link && (
                <a
                  href={m.link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 mt-5 px-4 py-2 bg-banana text-black font-semibold rounded-lg hover:brightness-110 transition-all text-sm"
                >
                  {m.link.label}
                  <ExternalIcon />
                </a>
              )}
            </div>
          ))}
        </div>

        {/* Safety notes */}
        <div className="rounded-xl border border-yellow-400/30 bg-yellow-400/[0.08] p-5 mt-10">
          <h2 className="text-base font-semibold text-yellow-100 mb-3 flex items-center gap-2">
            <span>⚠️</span> A few things to double-check
          </h2>
          <ul className="space-y-2 text-sm text-yellow-100/90 leading-relaxed">
            <li>• Always send USDC on the <span className="font-semibold">Base</span> network. Sending on the wrong network can lose your funds.</li>
            <li>• If you&apos;re unsure, send a small test amount first, confirm it arrives, then send the rest.</li>
            <li>• You never need ETH to play — every transaction on SBS (minting, marketplace) is gas-free. Only outside swaps and bridges carry their own small fees.</li>
          </ul>
        </div>

        {/* Why we moved — the TL;DR */}
        <div className="glass-card p-6 sm:p-7 mt-10">
          <h2 className="text-xl font-bold text-text-primary mb-4 flex items-center gap-2">
            <span>🍌</span> Why we moved — the TL;DR
          </h2>
          <ul className="space-y-2 text-sm text-text-secondary leading-relaxed">
            <li>• <span className="text-text-primary font-semibold">$25 is $25</span> — entries are priced in dollars now, not ETH. No price swings.</li>
            <li>• <span className="text-text-primary font-semibold">Prize pools hold their value</span> — $100K in USDC stays $100K, all season long.</li>
            <li>• <span className="text-text-primary font-semibold">Transactions are instant</span> — mints, sales, and payouts confirm in seconds on Base.</li>
            <li>• <span className="text-text-primary font-semibold">Zero gas on SBS</span> — we cover every fee for minting and the marketplace.</li>
            <li>• <span className="text-text-primary font-semibold">Getting here is cheap too</span> — swapping or bridging into Base costs cents and takes seconds, anywhere you do it.</li>
          </ul>
          <p className="text-text-muted text-sm mt-4">The game, made better for you.</p>
        </div>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-10">
          <Link
            href="/buy-drafts"
            className="px-8 py-3.5 bg-banana text-black font-bold rounded-xl hover:brightness-110 transition-all shadow-lg shadow-banana/20 w-full sm:w-auto text-center"
          >
            Buy Draft Passes →
          </Link>
          <Link
            href="/faq#base-usdc"
            className="px-8 py-3.5 border border-bg-tertiary text-text-secondary font-semibold rounded-xl hover:text-text-primary hover:border-text-muted transition-all w-full sm:w-auto text-center"
          >
            Base using USDC FAQ
          </Link>
        </div>
      </div>
    </div>
  );
}
