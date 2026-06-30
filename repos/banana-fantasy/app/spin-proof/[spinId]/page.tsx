'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

import { verifySpinProof } from '@/lib/wheelMerkleClient';
import { wheelSegments } from '@/lib/wheelConfig';

interface ProofData {
  spinId: string;
  result: string;
  timestamp: string;
  verifiable: boolean;
  reason?: string;
  periodNumber?: number;
  spinIndex?: number;
  period?: {
    status: 'requested' | 'fulfilled' | 'active' | 'closed' | 'revealed';
    saltHash: string;
    salt: string | null;
    vrfRandomness: string | null;
    merkleRoot: string | null;
    spinCount: number;
    maxSpins: number;
    commitTxHash: string | null;
    rootCommitTxHash: string | null;
    revealTxHash: string | null;
  };
  contractAddress?: string | null;
  proof?: { leaf: `0x${string}`; path: Array<`0x${string}`>; root: `0x${string}` } | null;
}

export default function SpinProofPage() {
  const params = useParams<{ spinId: string }>();
  const spinId = params?.spinId;
  const [data, setData] = useState<ProofData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState<'pending' | 'verified' | 'failed' | 'unverifiable'>('pending');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError(null);
      try {
        const res = await fetch(`/api/wheel/proof/${spinId}`, { cache: 'no-store' });
        const body = (await res.json()) as ProofData;
        if (!res.ok) {
          setError((body as { error?: string }).error || `Request failed (${res.status})`);
          return;
        }
        if (cancelled) return;
        setData(body);

        if (!body.verifiable) {
          setVerified('unverifiable');
          return;
        }
        if (!body.proof) {
          setVerified('pending');
          return;
        }
        const ok = verifySpinProof({
          spinIndex: body.spinIndex!,
          segmentId: body.result,
          proof: body.proof.path,
          root: body.proof.root,
        });
        setVerified(ok ? 'verified' : 'failed');
      } catch (err) {
        setError((err as Error).message);
      }
    }
    if (spinId) load();
    return () => { cancelled = true; };
  }, [spinId]);

  const segment = data ? wheelSegments.find((s) => s.id === data.result) : null;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-8">
        <Link href="/banana-wheel" className="text-banana hover:underline text-sm">← Banana Wheel</Link>
        <h1 className="text-[28px] font-semibold text-white tracking-tight mt-2">Spin verification</h1>
        <p className="text-white/60 text-sm mt-1">Cryptographic proof that the outcome was locked in before the spin happened — no SBS shenanigans possible.</p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-300 text-sm">{error}</div>
      )}

      {!data && !error && (
        <div className="text-white/50 text-sm">Loading proof…</div>
      )}

      {data && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-bg-secondary/80 backdrop-blur-md p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <div className="text-white/40 text-[11px] uppercase tracking-wider mb-1">Outcome</div>
                <div className="text-white text-[22px] font-semibold" style={{ color: segment?.color ?? '#fff' }}>
                  {segment?.label ?? data.result}
                </div>
                <div className="text-white/40 text-[11px] mt-1">
                  Spin {data.spinId.slice(0, 8)}… · {new Date(data.timestamp).toLocaleString()}
                </div>
              </div>
              <VerificationBadge state={verified} />
            </div>

            {!data.verifiable && (
              <p className="text-amber-300/80 text-[13px] bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                {data.reason ?? 'This spin pre-dates the wheel verification system.'}
              </p>
            )}

            {data.verifiable && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-[12px] mt-4">
                <KV label="Round" value={`#${data.periodNumber}`} />
                <KV label="Spin index" value={`${data.spinIndex} of ${data.period?.maxSpins ?? '?'}`} />
                <KV label="Round status" value={<StatusPill status={data.period?.status ?? 'requested'} />} />
                <KV label="Spins used" value={`${data.period?.spinCount ?? 0} / ${data.period?.maxSpins ?? 0}`} />
              </div>
            )}
          </div>

          {data.verifiable && (
            <div className="rounded-2xl border border-white/10 bg-bg-secondary/60 backdrop-blur-md p-6 space-y-3">
              <h2 className="text-white text-sm font-semibold tracking-tight">Cryptographic chain of custody</h2>
              <p className="text-white/50 text-[12px]">
                These transactions lock the outcome before any spin happens. Anyone can re-derive every result once the salt is revealed.
              </p>

              <div className="space-y-2 text-[12px]">
                <Link2
                  label="Wheel proof contract"
                  href={data.contractAddress ? `https://basescan.org/address/${data.contractAddress}` : null}
                  display={data.contractAddress ?? '—'}
                />
                <Link2
                  label="Commit + VRF request tx"
                  href={data.period?.commitTxHash ? `https://basescan.org/tx/${data.period.commitTxHash}` : null}
                  display={data.period?.commitTxHash ?? '—'}
                />
                <Link2
                  label="Merkle root commit tx"
                  href={data.period?.rootCommitTxHash ? `https://basescan.org/tx/${data.period.rootCommitTxHash}` : null}
                  display={data.period?.rootCommitTxHash ?? 'pending'}
                />
                <Link2
                  label="Salt reveal tx"
                  href={data.period?.revealTxHash ? `https://basescan.org/tx/${data.period.revealTxHash}` : null}
                  display={data.period?.revealTxHash ?? 'sealed until round close'}
                />
              </div>

              <h3 className="text-white text-[12px] font-semibold mt-4">Hashes</h3>
              <div className="space-y-1.5 text-[11px] font-mono">
                <KVMono label="Salt hash" value={data.period?.saltHash ?? '—'} />
                <KVMono label="Merkle root" value={data.period?.merkleRoot ?? 'pending'} />
                <KVMono label="VRF randomness" value={data.period?.vrfRandomness ?? 'pending'} />
                <KVMono label="Salt" value={data.period?.salt ?? '🔒 sealed until reveal'} />
              </div>

              {data.proof && (
                <>
                  <h3 className="text-white text-[12px] font-semibold mt-4">Outcome proof for this spin</h3>
                  <div className="space-y-1.5 text-[11px] font-mono">
                    <KVMono label="Leaf" value={data.proof.leaf} />
                    <KVMono label="Root" value={data.proof.root} />
                    <div className="text-white/40">Path ({data.proof.path.length} hashes)</div>
                    {data.proof.path.map((h, i) => (
                      <div key={i} className="text-white/60 truncate">{i}: {h}</div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {data.verifiable && (
            <AssignmentProofSection spinId={data.spinId} />
          )}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────────────────── Assignment proof (NEW) */

interface AssignmentProofPayload {
  ok: true;
  spinId: string;
  verifiable: boolean;
  pending?: boolean;
  periodNumber?: number;
  spinIndex?: number;
  wallet?: string;
  batchSize?: number;
  positionInBatch?: number;
  contractAddress?: string | null;
  reason?: string;
  batch?: {
    batchIndex: number;
    fromIndex: number;
    toIndex: number;
    count: number;
    root: string;
    txHash: string;
    committedAt: number;
  };
  proof?: { leaf: string; path: string[]; root: string };
}

function AssignmentProofSection({ spinId }: { spinId: string }) {
  const [data, setData] = useState<AssignmentProofPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = { cancelled: false };
    async function load() {
      try {
        const res = await fetch(`/api/wheel/assignment-proof/${spinId}`, { cache: 'no-store' });
        const body = (await res.json()) as AssignmentProofPayload & { error?: string };
        if (!res.ok) {
          if (!ctrl.cancelled) setError(body.error ?? `Request failed (${res.status})`);
          return;
        }
        if (!ctrl.cancelled) setData(body);
      } catch (err) {
        if (!ctrl.cancelled) setError((err as Error).message);
      }
    }
    load();
    return () => {
      ctrl.cancelled = true;
    };
  }, [spinId]);

  if (error) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/[0.04] p-6 text-red-300 text-[12px]">
        Assignment proof unavailable: {error}
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="rounded-2xl border border-white/10 bg-bg-secondary/60 backdrop-blur-md p-6 space-y-3">
      <h2 className="text-white text-sm font-semibold tracking-tight">
        Assignment verification
      </h2>
      <p className="text-white/50 text-[12px] leading-relaxed">
        Confirms that <span className="font-mono text-white/70">{data.wallet?.slice(0, 6)}…{data.wallet?.slice(-4)}</span>{' '}
        was assigned spinIndex {data.spinIndex} in order. Every {data.batchSize ?? 100} spins,
        the wallet→spinIndex assignments are bundled and committed — reordering
        or skipping would be visible to anyone.
      </p>

      {data.pending && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-200 text-[12px]">
          <p className="font-semibold mb-1">⏳ Batch committing soon</p>
          <p className="text-amber-100/80 leading-relaxed">
            This spin sits in the next pending batch (position{' '}
            <span className="font-mono">{data.positionInBatch}</span> of{' '}
            <span className="font-mono">{data.batchSize}</span>). The commit
            happens automatically as soon as the batch fills (every {data.batchSize} spins),
            typically within minutes. Refresh to recheck.
          </p>
        </div>
      )}

      {data.verifiable && data.batch && data.proof && (
        <>
          <div className="space-y-2 text-[12px]">
            <Link2
              label="Journal contract"
              href={data.contractAddress ? `https://basescan.org/address/${data.contractAddress}` : null}
              display={data.contractAddress ?? '—'}
            />
            <Link2
              label="Batch commit tx"
              href={`https://basescan.org/tx/${data.batch.txHash}`}
              display={data.batch.txHash}
            />
            <KV label="Batch" value={`#${data.batch.batchIndex} (spins ${data.batch.fromIndex.toLocaleString()}–${data.batch.toIndex.toLocaleString()})`} />
            <KV label="Committed" value={new Date(data.batch.committedAt).toLocaleString()} />
          </div>

          <h3 className="text-white text-[12px] font-semibold mt-4">Assignment Merkle proof</h3>
          <div className="space-y-1.5 text-[11px] font-mono">
            <KVMono label="Leaf" value={data.proof.leaf} />
            <KVMono label="Merkle root" value={data.proof.root} />
            <div className="text-white/40">Path ({data.proof.path.length} hashes)</div>
            {data.proof.path.map((h, i) => (
              <div key={i} className="text-white/60 truncate">{i}: {h}</div>
            ))}
          </div>
        </>
      )}

      {!data.verifiable && !data.pending && (
        <p className="text-white/40 text-[12px]">{data.reason ?? 'Not verifiable.'}</p>
      )}
    </div>
  );
}

function VerificationBadge({ state }: { state: 'pending' | 'verified' | 'failed' | 'unverifiable' }) {
  switch (state) {
    case 'verified':
      return (
        <div className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 text-[12px] font-semibold">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          Verified
        </div>
      );
    case 'failed':
      return <div className="shrink-0 px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/40 text-red-300 text-[12px] font-semibold">⚠ Proof failed</div>;
    case 'unverifiable':
      return <div className="shrink-0 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/40 text-amber-300 text-[12px] font-semibold">Pre-VRF</div>;
    default:
      return <div className="shrink-0 px-3 py-1.5 rounded-full bg-white/5 border border-white/20 text-white/60 text-[12px] font-semibold">…</div>;
  }
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    requested: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    fulfilled: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    active: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    closed: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
    revealed: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
  };
  return <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wider ${colors[status] ?? colors.requested}`}>{status}</span>;
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center gap-3">
      <span className="text-white/40">{label}</span>
      <span className="text-white/90">{value}</span>
    </div>
  );
}

function KVMono({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-white/40 shrink-0">{label}:</span>
      <span className="text-white/80 break-all">{value}</span>
    </div>
  );
}

function Link2({ label, href, display }: { label: string; href: string | null; display: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-white/40">{label}</span>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="text-banana hover:underline truncate font-mono">{display}</a>
      ) : (
        <span className="text-white/40 font-mono truncate">{display}</span>
      )}
    </div>
  );
}
