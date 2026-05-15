'use client';

import { useEffect, useState } from 'react';

interface PeriodSummary {
  periodNumber: number;
  status: 'requested' | 'fulfilled' | 'active' | 'closed' | 'revealed';
  spinCount: number;
  maxSpins: number;
  saltHash: string;
  merkleRoot: string | null;
  vrfRandomness: string | null;
  salt: string | null;
  commitTxHash: string | null;
  rootCommitTxHash: string | null;
  revealTxHash: string | null;
}

interface ResponseData {
  active: boolean;
  period: PeriodSummary | null;
  contractAddress: string | null;
}

function shortHex(h: string | null | undefined, chars = 6): string {
  if (!h) return '—';
  return `${h.slice(0, 2 + chars)}…${h.slice(-chars)}`;
}

/**
 * Top-of-/banana-wheel banner showing the current spin-verification
 * period's state. Hidden if no period exists (pre-bootstrap). Three
 * visual states by `period.status`:
 *   - active (default): blue/emerald — accepting spins, every result
 *     verified instantly via Merkle proof
 *   - fulfilled / requested: amber — period is preparing (admin
 *     finalizing)
 *   - revealed: emerald — period closed, salt published, full audit
 *     available
 */
export function WheelProofBanner() {
  const [data, setData] = useState<ResponseData | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/wheel/period', { cache: 'no-store' });
        if (!res.ok) return;
        const body = (await res.json()) as ResponseData;
        if (!cancelled) setData(body);
      } catch {
        // Banner is decorative — silent fail.
      }
    }
    load();
    const id = setInterval(load, 30_000); // refresh every 30s for spinCount
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!data || !data.period) return null;
  const p = data.period;

  const palette = (() => {
    switch (p.status) {
      case 'active':
        return { ring: 'border-emerald-500/30', bg: 'from-emerald-500/[0.08] to-emerald-700/[0.03]', dot: 'bg-emerald-400', icon: '✓', copy: 'Verified by Chainlink VRF' };
      case 'revealed':
        return { ring: 'border-emerald-500/30', bg: 'from-emerald-500/[0.08] to-emerald-700/[0.03]', dot: 'bg-emerald-400', icon: '✓', copy: 'Verified by Chainlink VRF · salt revealed' };
      case 'closed':
        return { ring: 'border-blue-500/30', bg: 'from-blue-500/[0.08] to-blue-700/[0.03]', dot: 'bg-blue-400', icon: '◌', copy: 'Verified by Chainlink VRF · reveal pending' };
      case 'fulfilled':
        return { ring: 'border-amber-500/30', bg: 'from-amber-500/[0.08] to-amber-700/[0.03]', dot: 'bg-amber-400', icon: '🎲', copy: 'Committing Merkle root on-chain…' };
      case 'requested':
      default:
        return { ring: 'border-amber-500/30', bg: 'from-amber-500/[0.08] to-amber-700/[0.03]', dot: 'bg-amber-400', icon: '🎲', copy: 'Randomizing with Chainlink VRF…' };
    }
  })();

  const pct = Math.min(100, Math.round((p.spinCount / p.maxSpins) * 100));

  return (
    <div className={`rounded-2xl border ${palette.ring} bg-gradient-to-r ${palette.bg} px-4 py-3 mb-4 backdrop-blur-md`}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`inline-block w-2 h-2 rounded-full ${palette.dot} animate-pulse`} />
          <div className="min-w-0">
            <div className="text-white text-[13px] font-semibold tracking-tight">
              <span aria-hidden className="mr-1.5">{palette.icon}</span>
              {palette.copy}
            </div>
            <div className="text-white/55 text-[11px] mt-0.5">
              {p.spinCount.toLocaleString()} / {p.maxSpins.toLocaleString()} spins this round · on-chain Merkle root locks every outcome before you spin
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <a
            href="/wheel-batches"
            className="text-white/55 hover:text-banana text-[11px] font-semibold underline-offset-2 hover:underline"
          >
            view receipts
          </a>
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-white/55 hover:text-white text-[11px] font-semibold underline-offset-2 hover:underline"
          >
            {open ? 'hide proof' : 'view proof'} →
          </button>
        </div>
      </div>

      <div className="mt-2 w-full h-1 bg-white/10 rounded-full overflow-hidden">
        <div className={`h-full ${palette.dot.replace('bg-', 'bg-')}`} style={{ width: `${pct}%` }} />
      </div>

      {open && (
        <div className="mt-3 pt-3 border-t border-white/10 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-[11px]">
          <Row label="Status" value={p.status} />
          <Row label="Round" value={`#${p.periodNumber}`} />
          <Row label="Salt hash" value={shortHex(p.saltHash)} />
          <Row label="Merkle root" value={shortHex(p.merkleRoot)} />
          <Row label="VRF randomness" value={shortHex(p.vrfRandomness)} />
          <Row label="Salt (post-reveal)" value={p.salt ? shortHex(p.salt) : 'sealed'} />
          {data.contractAddress && (
            <Row
              label="Contract"
              value={(
                <a
                  href={`https://basescan.org/address/${data.contractAddress}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-banana hover:underline"
                >
                  {shortHex(data.contractAddress, 4)}
                </a>
              )}
            />
          )}
          {p.commitTxHash && (
            <Row
              label="Commit tx"
              value={(
                <a
                  href={`https://basescan.org/tx/${p.commitTxHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-banana hover:underline"
                >
                  {shortHex(p.commitTxHash, 4)}
                </a>
              )}
            />
          )}
          {p.rootCommitTxHash && (
            <Row
              label="Root tx"
              value={(
                <a
                  href={`https://basescan.org/tx/${p.rootCommitTxHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-banana hover:underline"
                >
                  {shortHex(p.rootCommitTxHash, 4)}
                </a>
              )}
            />
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center gap-2">
      <span className="text-white/40">{label}</span>
      <span className="text-white/80 font-mono">{value}</span>
    </div>
  );
}
