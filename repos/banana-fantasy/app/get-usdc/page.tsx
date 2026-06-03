'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';

const USDC_BASE_CONTRACT = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// Manual "Add network" details for Base, in case it isn't in MetaMask's preset list.
const BASE_NETWORK: { label: string; value: string; copy?: boolean }[] = [
  { label: 'Network name', value: 'Base' },
  { label: 'RPC URL', value: 'https://mainnet.base.org', copy: true },
  { label: 'Chain ID', value: '8453', copy: true },
  { label: 'Currency symbol', value: 'ETH' },
  { label: 'Block explorer', value: 'https://basescan.org' },
];

const METAMASK_BASE_STEPS: React.ReactNode[] = [
  <>Open MetaMask and tap the <span className="text-text-primary font-semibold">network dropdown</span> at the top-left (it usually says &ldquo;Ethereum Mainnet&rdquo;).</>,
  <>If you see <span className="text-banana font-semibold">Base</span> in the list, just tap it — you&apos;re done.</>,
  <>Not there? Tap <span className="text-text-primary font-semibold">Add network</span>, find <span className="text-banana font-semibold">Base</span> in the popular networks, and tap <span className="text-text-primary font-semibold">Add</span>.</>,
  <>Still not listed? Tap <span className="text-text-primary font-semibold">Add a network manually</span> and enter the details below.</>,
];

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
    tag: 'Fastest',
    title: 'Swap to USDC on Base with Relay',
    best: 'Best if you already hold ETH or other crypto in your own wallet (MetaMask, Coinbase Wallet, etc.).',
    steps: [
      <>Open <span className="text-banana font-semibold">relay.link</span> and connect the wallet that holds your crypto.</>,
      <>Set <span className="text-text-primary font-semibold">From</span> to the coin and network you have (for example ETH on Ethereum, Arbitrum, or Optimism).</>,
      <>Set <span className="text-text-primary font-semibold">To</span> to <span className="text-text-primary font-semibold">USDC on Base</span>.</>,
      <>Enter the amount, review the quote, and confirm the swap.</>,
      <>Your USDC lands in your wallet on Base — usually within seconds. You&apos;re ready to buy a pass.</>,
    ],
    link: { label: 'Open Relay', href: 'https://relay.link' },
  },
  {
    emoji: '🏦',
    tag: 'Using an exchange',
    title: 'Go through Coinbase',
    best: 'Best if you keep your funds on Coinbase, or want to sell other crypto for USDC first.',
    steps: [
      <>Already have crypto on Coinbase? <span className="text-text-primary font-semibold">Sell or convert it to USDC.</span> Don&apos;t have any? <span className="text-text-primary font-semibold">Buy USDC</span> with a card or bank transfer.</>,
      <>Choose <span className="text-text-primary font-semibold">Send / Withdraw</span> and select <span className="text-text-primary font-semibold">USDC</span>.</>,
      <>For the network, pick <span className="text-banana font-semibold">Base</span> — this is the important part.</>,
      <>Paste <span className="text-text-primary font-semibold">your Base wallet address</span> (shown above) as the destination and confirm.</>,
      <>USDC arrives in your wallet on Base, ready to use.</>,
    ],
  },
  {
    emoji: '💳',
    tag: 'Simplest',
    title: 'Buy USDC directly with a card',
    best: 'Best if you just want to buy USDC outright, no other crypto needed.',
    steps: [
      <><span className="text-text-primary font-semibold">In MetaMask:</span> tap <span className="text-text-primary font-semibold">Buy</span>, choose <span className="text-text-primary font-semibold">USDC</span> on the <span className="text-banana font-semibold">Base</span> network, and pay with a card. It lands straight in your MetaMask wallet.</>,
      <><span className="text-text-primary font-semibold">On Coinbase:</span> tap <span className="text-text-primary font-semibold">Buy</span>, choose <span className="text-text-primary font-semibold">USDC</span>, pay with a card or bank, then withdraw it to <span className="text-banana font-semibold">Base</span> using your address above.</>,
      <>Either way you end up with USDC on Base — that&apos;s all you need to enter a draft.</>,
    ],
  },
];

export default function GetUsdcPage() {
  const { walletAddress } = useAuth();

  return (
    <div className="w-full px-4 sm:px-8 lg:px-12 py-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <p className="text-banana font-semibold text-sm uppercase tracking-widest mb-2">Funding Your Wallet</p>
          <h1 className="text-3xl sm:text-4xl font-bold text-text-primary mb-3">How to get USDC on Base</h1>
          <p className="text-text-secondary leading-relaxed max-w-xl mx-auto">
            Drafts cost <span className="text-text-primary font-semibold">$25 in USDC</span> on the{' '}
            <span className="text-text-primary font-semibold">Base</span> network. If you&apos;re holding ETH or
            other crypto, here are three easy ways to get USDC into your wallet.
          </p>
        </div>

        {/* No-gas reassurance */}
        <div className="rounded-xl border border-banana/30 bg-banana/[0.06] p-4 mb-8 text-sm text-text-secondary leading-relaxed">
          <span className="text-banana font-semibold">Good news:</span> we cover the network &ldquo;gas&rdquo; fees
          for you, so you don&apos;t need any ETH to play. You only ever need <span className="text-text-primary font-semibold">USDC on Base</span>.
        </div>

        {/* Your wallet address */}
        <div className="glass-card p-6 mb-10">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xl">👛</span>
            <h2 className="text-lg font-semibold text-text-primary">Your Base wallet address</h2>
          </div>
          {walletAddress ? (
            <>
              <p className="text-text-secondary text-sm mb-3 leading-relaxed">
                This is where you send USDC. Always send on the <span className="text-banana font-semibold">Base</span> network.
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

        {/* Switch MetaMask to Base — sits right under the wallet address */}
        <div className="glass-card p-6 sm:p-7 mb-10">
          <div className="flex items-start gap-4 mb-4">
            <span className="text-3xl leading-none flex-shrink-0">🦊</span>
            <div className="min-w-0">
              <span className="text-xs font-mono text-text-muted uppercase tracking-wider">Quick setup</span>
              <h3 className="text-xl font-bold text-text-primary mt-1">Switching MetaMask to the Base network</h3>
              <p className="text-text-muted text-sm mt-1 leading-relaxed">
                MetaMask opens on Ethereum Mainnet by default. Switch it to Base so you can see your USDC and use your wallet here.
              </p>
            </div>
          </div>

          <ol className="space-y-3">
            {METAMASK_BASE_STEPS.map((step, idx) => (
              <li key={idx} className="flex gap-3 text-sm text-text-secondary leading-relaxed">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-banana/10 text-banana font-semibold text-xs flex items-center justify-center mt-0.5">
                  {idx + 1}
                </span>
                <span className="flex-1">{step}</span>
              </li>
            ))}
          </ol>

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

        {/* Methods */}
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

              <ol className="space-y-3">
                {m.steps.map((step, idx) => (
                  <li key={idx} className="flex gap-3 text-sm text-text-secondary leading-relaxed">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-banana/10 text-banana font-semibold text-xs flex items-center justify-center mt-0.5">
                      {idx + 1}
                    </span>
                    <span className="flex-1">{step}</span>
                  </li>
                ))}
              </ol>

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
            <li>• You don&apos;t need ETH for gas — we cover it. You only need USDC.</li>
            <li>
              • To add USDC manually in your wallet, the contract on Base is:
              <span className="mt-2 flex flex-col sm:flex-row sm:items-center gap-2 bg-black/20 rounded-lg p-2">
                <code className="text-yellow-100 text-xs break-all font-mono flex-1">{USDC_BASE_CONTRACT}</code>
                <CopyButton value={USDC_BASE_CONTRACT} label="USDC contract address" />
              </span>
            </li>
          </ul>
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
            href="/faq"
            className="px-8 py-3.5 border border-bg-tertiary text-text-secondary font-semibold rounded-xl hover:text-text-primary hover:border-text-muted transition-all w-full sm:w-auto text-center"
          >
            Back to FAQ
          </Link>
        </div>
      </div>
    </div>
  );
}
