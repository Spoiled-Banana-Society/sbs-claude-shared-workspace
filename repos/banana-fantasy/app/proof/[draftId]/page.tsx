'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AnimatedEllipsis } from '@/components/ui/AnimatedEllipsis';
import {
  classifyDraftType,
  combinedSeedHex,
  deriveBatchSlots,
  locateDraft,
  parseDraftNumber,
  sha256Hex,
  type BatchSlots,
} from '@/lib/batchProof';

type ProofStatus =
  | 'pending'
  | 'committed'
  | 'revealed'
  | 'requested'
  | 'fulfilled'
  | 'pre-launch';

type ProofVariant = 'commit-reveal' | 'vrf' | 'vrf-commit';

interface BatchProofPayload {
  batchNumber: number;
  status: ProofStatus;
  variant?: ProofVariant;

  // Legacy commit-reveal
  seedHash?: string;
  commitTxHash?: string;
  commitBlock?: number;
  committedAt?: number;
  serverSeed?: string;
  revealTxHash?: string;
  revealedAt?: number;

  // VRF v2.5
  vrfRequestId?: string;
  vrfRequestTxHash?: string;
  vrfRequestBlock?: number;
  vrfRequestedAt?: number;
  vrfRandomness?: string; // 0x-prefixed 32-byte seed (after coordinator callback)
  vrfFulfilledAt?: number;
  vrfCoordinator?: string;

  // VRF + commit hybrid (vrf-commit). Salt is hidden until reveal.
  saltHash?: string;          // public from commit time
  serverSalt?: string;        // gated until status=='revealed'
  commitTxHashVrf?: string;   // tx that submitted requestRandomnessAndCommit
  revealSaltTxHash?: string;

  // Common (gated until publicly verifiable)
  jackpotPositions?: number[];
  hofPositions?: number[];
  preLaunchNote?: string;
}

const BASESCAN_TX = (hash: string) =>
  `https://basescan.org/tx/${hash.startsWith('0x') ? hash : '0x' + hash}`;
const BASESCAN_BLOCK = (block: number) => `https://basescan.org/block/${block}`;
const BASESCAN_ADDRESS = (addr: string) => `https://basescan.org/address/${addr}`;

export default function ProofPage() {
  const params = useParams();
  const draftId = typeof params?.draftId === 'string' ? params.draftId : '';
  const draftNumber = useMemo(() => parseDraftNumber(draftId), [draftId]);
  const locator = useMemo(() => (draftNumber ? locateDraft(draftNumber) : null), [draftNumber]);

  const [proof, setProof] = useState<BatchProofPayload | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const [recomputed, setRecomputed] = useState<BatchSlots | null>(null);
  const [recomputeError, setRecomputeError] = useState<string | null>(null);
  const [hashMatch, setHashMatch] = useState<boolean | null>(null);

  useEffect(() => {
    if (!locator) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/batches/${locator.batchNumber}/proof`);
        if (!res.ok) {
          if (cancelled) return;
          setProofError(`Could not load proof for batch #${locator.batchNumber} (HTTP ${res.status})`);
          return;
        }
        const body = (await res.json()) as BatchProofPayload;
        if (!cancelled) setProof(body);
      } catch (err) {
        if (!cancelled) setProofError((err as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [locator]);

  // Recompute slot positions in-browser once randomness is publicly
  // verifiable. Three sources of seed depending on variant:
  //   - commit-reveal: server seed revealed via reveal() at end of batch.
  //   - vrf:           VRF randomness landed via coordinator callback.
  //   - vrf-commit:    sha256(salt || vrf_randomness) — both halves now public.
  useEffect(() => {
    if (!proof || !locator) return;
    const variant: ProofVariant =
      proof.variant === 'vrf' ? 'vrf'
      : proof.variant === 'vrf-commit' ? 'vrf-commit'
      : 'commit-reveal';

    let cancelled = false;
    (async () => {
      try {
        let seedHex: string | undefined;
        if (variant === 'vrf' && proof.status === 'fulfilled') {
          seedHex = proof.vrfRandomness;
        } else if (variant === 'commit-reveal' && proof.status === 'revealed') {
          seedHex = proof.serverSeed;
        } else if (variant === 'vrf-commit' && proof.status === 'revealed' && proof.serverSalt && proof.vrfRandomness) {
          seedHex = await combinedSeedHex(proof.serverSalt, proof.vrfRandomness);
        }
        if (!seedHex) return;

        const slots = await deriveBatchSlots(seedHex, locator.batchNumber);
        if (cancelled) return;
        setRecomputed(slots);

        if (variant === 'commit-reveal' && proof.seedHash) {
          // Cross-check sha256(seed) for native browser verification.
          // (Chain commit uses keccak256; backend stores both hashes.)
          const sha = await sha256Hex(seedHex);
          setHashMatch(sha.toLowerCase() === proof.seedHash.toLowerCase().replace(/^0x/, ''));
        }
      } catch (err) {
        if (!cancelled) setRecomputeError((err as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [proof, locator]);

  if (!locator) {
    return (
      <div className="w-full px-4 sm:px-8 lg:px-12 py-8 max-w-3xl mx-auto">
        <h1 className="text-2xl font-semibold text-white mb-2">Proof unavailable</h1>
        <p className="text-white/60">Could not parse a draft number from <code className="font-mono">{draftId}</code>.</p>
        <Link href="/drafting" className="inline-block mt-6 text-banana hover:underline">← Back to drafts</Link>
      </div>
    );
  }

  const variant: ProofVariant =
    proof?.variant === 'vrf' ? 'vrf'
    : proof?.variant === 'vrf-commit' ? 'vrf-commit'
    : 'commit-reveal';
  const isVRF = variant === 'vrf';
  const isVRFCommit = variant === 'vrf-commit';
  const showsVRFBadge = isVRF || isVRFCommit;
  const isPubliclyVerifiable =
    isVRF ? proof?.status === 'fulfilled' : proof?.status === 'revealed';
  // Mid-flight = math is locked but positions are still hidden from the public.
  const isMidFlight =
    isVRF ? proof?.status === 'requested'
    : isVRFCommit ? (proof?.status === 'requested' || proof?.status === 'fulfilled')
    : proof?.status === 'committed';
  const lastDraftInBatch = ((locator.batchNumber - 1) * 100) + 100;

  return (
    <div className="w-full px-4 sm:px-8 lg:px-12 py-8 max-w-3xl mx-auto space-y-6">
      <div>
        <Link href="/drafting" className="text-xs text-white/50 hover:text-white/80">← Back</Link>
        <h1 className="text-2xl font-semibold text-white mt-2">
          Provably Fair · BBB #{locator.batchStartDraftNumber}–#{locator.batchStartDraftNumber + 99}
        </h1>
        <p className="text-sm text-white/60 mt-1">
          Batch #{locator.batchNumber} — randomization for drafts BBB #{locator.batchStartDraftNumber} through BBB #{locator.batchStartDraftNumber + 99}.
          Viewing from BBB #{locator.draftNumber}.
        </p>
        {proof && proof.status !== 'pre-launch' && (
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {showsVRFBadge && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-semibold rounded-full bg-blue-500/[0.08] border border-blue-400/30 text-blue-200 uppercase tracking-wider">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" /> Powered by Chainlink VRF v2.5
              </span>
            )}
            {isVRFCommit && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-semibold rounded-full bg-emerald-500/[0.08] border border-emerald-400/30 text-emerald-200 uppercase tracking-wider">
                + Salt commit/reveal
              </span>
            )}
            {!showsVRFBadge && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-semibold rounded-full bg-white/[0.05] border border-white/15 text-white/70 uppercase tracking-wider">
                Commit · Reveal
              </span>
            )}
          </div>
        )}
      </div>

      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-3">
        <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Distribution rule</h2>
        <p className="text-sm text-white/70 leading-relaxed">
          Every 100 drafts contains exactly{' '}
          <span className="font-semibold text-purple-300">94 Pro</span>,{' '}
          <span className="font-semibold text-hof">5 HOF</span>,{' '}
          and <span className="font-semibold text-red-400">1 Jackpot</span>.
          {isVRFCommit ? (
            <> The 6 special slot positions come from two sources of entropy mixed together: a random number from{' '}
            <strong className="text-white">Chainlink VRF</strong> and a SBS-side salt whose hash is committed
            before the batch starts. The salt stays hidden during the batch — so the slot positions are locked in
            but no one can compute them. When the batch closes, the salt is revealed and anyone can re-derive every
            position via{' '}
            <code className="font-mono text-white/80 bg-white/5 px-1 rounded">HMAC-SHA256(sha256(salt || randomness), &quot;slot:&quot; + batchNumber + &quot;:&quot; + i)</code>.</>
          ) : isVRF ? (
            <> The 6 special slot positions are derived from a 32-byte random number delivered by{' '}
            <strong className="text-white">Chainlink VRF</strong>. Slot positions derive deterministically from{' '}
            <code className="font-mono text-white/80 bg-white/5 px-1 rounded">HMAC-SHA256(randomness, &quot;slot:&quot; + batchNumber + &quot;:&quot; + i)</code>.</>
          ) : (
            <> Slot positions are derived from a server seed whose hash is committed before the batch starts; the
            seed is revealed after the batch closes via{' '}
            <code className="font-mono text-white/80 bg-white/5 px-1 rounded">HMAC-SHA256(seed, &quot;slot:&quot; + batchNumber + &quot;:&quot; + i)</code>.</>
          )}
        </p>
        <p className="text-xs text-white/40">
          See <Link href="/how-it-works#fairness" className="text-banana hover:underline">/how-it-works#fairness</Link>{' '}
          for the full algorithm. Client-side verification implementation:{' '}
          <code className="font-mono">lib/batchProof.ts</code>.
        </p>
      </section>

      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-3">
        <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
          {isVRFCommit ? 'Verifiable randomness + salt commit' : isVRF ? 'Verifiable randomness request' : 'Provably-fair commit'}
        </h2>

        {proofError && (
          <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{proofError}</p>
        )}

        {!proof && !proofError && (
          <p className="text-xs text-white/50">Loading…</p>
        )}

        {proof?.status === 'pre-launch' && (
          <div className="text-sm text-white/70 leading-relaxed">
            <p className="mb-2">
              <span className="inline-block px-2 py-0.5 text-[10px] font-semibold rounded bg-white/10 text-white/70 uppercase tracking-wider mr-2">Pre-launch</span>
              This batch predates the provably-fair proof system.
            </p>
            <p className="text-xs text-white/50">
              The 94/5/1 distribution constraint was enforced in code for this batch, but no cryptographic proof
              was published yet. Every batch from the rollout date forward carries a full verifiable proof anyone
              can independently verify here.
            </p>
            {proof.preLaunchNote && (
              <p className="text-[11px] text-white/40 mt-2 italic">{proof.preLaunchNote}</p>
            )}
          </div>
        )}

        {proof?.status === 'pending' && (
          <p className="text-sm text-white/70">
            {isVRF
              ? 'Submitting requestRandomness to the Chainlink VRF coordinator. This page will update once the request lands on Base (typically within ~10 seconds of batch start).'
              : 'Commit transaction is being submitted. This page will show the proof once the commit lands on Base (typically within ~10 seconds of batch start).'}
          </p>
        )}

        {isMidFlight && (
          <p className="text-xs text-amber-200/80 bg-amber-500/[0.06] border border-amber-500/20 rounded-lg px-3 py-2 mb-2">
            <span className="font-semibold">Slot positions are sealed</span> until this batch closes (BBB #{lastDraftInBatch}).
            {' '}
            {isVRFCommit ? (
              <>Chainlink VRF has delivered, and the salt was committed at the same moment. The 6 positions are
              locked in but the salt stays sealed until BBB #{lastDraftInBatch} fills — so no one can compute
              which draft is which type during the batch. After close, the salt is revealed and anyone can
              re-derive every position.</>
            ) : isVRF ? (
              <>Once Chainlink VRF delivers, anyone can recompute the 6 special slot positions in their
              browser.</>
            ) : (
              <>The hash below proves the outcome is locked in — but the seed stays sealed until the batch
              closes.</>
            )}
          </p>
        )}

        {/* Legacy commit-reveal details */}
        {!isVRF && (proof?.status === 'committed' || proof?.status === 'revealed') && (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-xs">
            <dt className="text-white/50">Commit tx</dt>
            <dd className="font-mono text-white break-all">
              {proof.commitTxHash ? (
                <a href={BASESCAN_TX(proof.commitTxHash)} target="_blank" rel="noreferrer" className="text-blue-300 hover:text-blue-200 underline">
                  {proof.commitTxHash}
                </a>
              ) : '—'}
            </dd>

            {proof.commitBlock && (
              <>
                <dt className="text-white/50">Block</dt>
                <dd className="font-mono text-white">
                  <a href={BASESCAN_BLOCK(proof.commitBlock)} target="_blank" rel="noreferrer" className="text-blue-300 hover:text-blue-200 underline">
                    {proof.commitBlock.toLocaleString()}
                  </a>
                </dd>
              </>
            )}

            <dt className="text-white/50">Seed hash (keccak256)</dt>
            <dd className="font-mono text-white break-all">{proof.seedHash || '—'}</dd>
          </dl>
        )}

        {/* VRF+commit hybrid details */}
        {isVRFCommit && (proof?.status === 'requested' || proof?.status === 'fulfilled' || proof?.status === 'revealed') && (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-xs">
            <dt className="text-white/50">Commit + request tx</dt>
            <dd className="font-mono text-white break-all">
              {proof?.commitTxHashVrf || proof?.vrfRequestTxHash ? (
                <a
                  href={BASESCAN_TX((proof.commitTxHashVrf || proof.vrfRequestTxHash) as string)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-300 hover:text-blue-200 underline"
                >
                  {proof.commitTxHashVrf || proof.vrfRequestTxHash}
                </a>
              ) : '—'}
            </dd>

            {proof?.vrfRequestBlock && (
              <>
                <dt className="text-white/50">Block</dt>
                <dd className="font-mono text-white">
                  <a href={BASESCAN_BLOCK(proof.vrfRequestBlock)} target="_blank" rel="noreferrer" className="text-blue-300 hover:text-blue-200 underline">
                    {proof.vrfRequestBlock.toLocaleString()}
                  </a>
                </dd>
              </>
            )}

            <dt className="text-white/50">Salt hash (keccak256)</dt>
            <dd className="font-mono text-white break-all">{proof?.saltHash || '—'}</dd>

            {proof?.vrfRequestId && (
              <>
                <dt className="text-white/50">VRF request ID</dt>
                <dd className="font-mono text-white break-all">{proof.vrfRequestId}</dd>
              </>
            )}

            {proof?.vrfCoordinator && (
              <>
                <dt className="text-white/50">Coordinator</dt>
                <dd className="font-mono text-white break-all">
                  <a href={BASESCAN_ADDRESS(proof.vrfCoordinator)} target="_blank" rel="noreferrer" className="text-blue-300 hover:text-blue-200 underline">
                    {proof.vrfCoordinator}
                  </a>
                </dd>
              </>
            )}

            {proof?.vrfFulfilledAt ? (
              <>
                <dt className="text-white/50">Randomness</dt>
                <dd className="font-mono text-white break-all">
                  {proof.vrfRandomness || <span className="text-white/40">awaiting…</span>}
                </dd>
              </>
            ) : null}

            <dt className="text-white/50">Status</dt>
            <dd>
              {proof?.status === 'revealed' || proof?.status === 'fulfilled' ? (
                <span className="text-emerald-300">✓ Done randomizing — verified by Chainlink VRF</span>
              ) : (
                <span className="text-amber-300">⏳ Randomizing<AnimatedEllipsis /></span>
              )}
            </dd>
          </dl>
        )}

        {/* VRF request details */}
        {isVRF && (proof?.status === 'requested' || proof?.status === 'fulfilled') && (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-xs">
            <dt className="text-white/50">Request tx</dt>
            <dd className="font-mono text-white break-all">
              {proof.vrfRequestTxHash ? (
                <a href={BASESCAN_TX(proof.vrfRequestTxHash)} target="_blank" rel="noreferrer" className="text-blue-300 hover:text-blue-200 underline">
                  {proof.vrfRequestTxHash}
                </a>
              ) : '—'}
            </dd>

            {proof.vrfRequestBlock && (
              <>
                <dt className="text-white/50">Block</dt>
                <dd className="font-mono text-white">
                  <a href={BASESCAN_BLOCK(proof.vrfRequestBlock)} target="_blank" rel="noreferrer" className="text-blue-300 hover:text-blue-200 underline">
                    {proof.vrfRequestBlock.toLocaleString()}
                  </a>
                </dd>
              </>
            )}

            {proof.vrfRequestId && (
              <>
                <dt className="text-white/50">VRF request ID</dt>
                <dd className="font-mono text-white break-all">{proof.vrfRequestId}</dd>
              </>
            )}

            {proof.vrfCoordinator && (
              <>
                <dt className="text-white/50">Coordinator</dt>
                <dd className="font-mono text-white break-all">
                  <a href={BASESCAN_ADDRESS(proof.vrfCoordinator)} target="_blank" rel="noreferrer" className="text-blue-300 hover:text-blue-200 underline">
                    {proof.vrfCoordinator}
                  </a>
                </dd>
              </>
            )}

            <dt className="text-white/50">Status</dt>
            <dd>
              {proof.status === 'fulfilled' ? (
                <span className="text-emerald-300">✓ Fulfilled</span>
              ) : (
                <span className="text-amber-300">⏳ Awaiting coordinator callback<AnimatedEllipsis /></span>
              )}
            </dd>
          </dl>
        )}
      </section>

      {/* Reveal / fulfillment recomputation panel */}
      {isPubliclyVerifiable && (
        <section className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] p-5 space-y-3">
          <h2 className="text-sm font-semibold text-emerald-200 uppercase tracking-wider">
            {isVRFCommit ? 'Reveal · live recomputation'
              : isVRF ? 'Fulfillment · live recomputation'
              : 'Reveal · live recomputation'}
          </h2>

          {isVRFCommit && (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-xs">
              <dt className="text-white/50">Reveal salt tx</dt>
              <dd className="font-mono text-white break-all">
                {proof?.revealSaltTxHash ? (
                  <a href={BASESCAN_TX(proof.revealSaltTxHash)} target="_blank" rel="noreferrer" className="text-blue-300 hover:text-blue-200 underline">
                    {proof.revealSaltTxHash}
                  </a>
                ) : '—'}
              </dd>

              <dt className="text-white/50">Server salt</dt>
              <dd className="font-mono text-white break-all">{proof?.serverSalt}</dd>

              <dt className="text-white/50">VRF randomness</dt>
              <dd className="font-mono text-white break-all">{proof?.vrfRandomness}</dd>

              <dt className="text-white/50">Combined seed</dt>
              <dd className="font-mono text-white/60 break-all">
                sha256(salt || randomness) — derived in your browser
              </dd>

              <dt className="text-white/50">Source of trust</dt>
              <dd className="text-emerald-300">
                ✓ Chainlink VRF (entropy) + salt commit (timing) verified
              </dd>
            </dl>
          )}

          {!isVRFCommit && (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-xs">
            {!isVRF && (
              <>
                <dt className="text-white/50">Reveal tx</dt>
                <dd className="font-mono text-white break-all">
                  {proof?.revealTxHash ? (
                    <a href={BASESCAN_TX(proof.revealTxHash)} target="_blank" rel="noreferrer" className="text-blue-300 hover:text-blue-200 underline">
                      {proof.revealTxHash}
                    </a>
                  ) : '—'}
                </dd>

                <dt className="text-white/50">Server seed</dt>
                <dd className="font-mono text-white break-all">{proof?.serverSeed}</dd>

                <dt className="text-white/50">Hash check</dt>
                <dd>
                  {hashMatch === null ? <span className="text-white/40">computing…</span>
                    : hashMatch ? <span className="text-emerald-300">✓ sha256(seed) matches commit hash</span>
                    : <span className="text-red-300">⚠ hash mismatch</span>}
                </dd>
              </>
            )}

            {isVRF && (
              <>
                <dt className="text-white/50">VRF randomness</dt>
                <dd className="font-mono text-white break-all">{proof?.vrfRandomness}</dd>

                {proof?.vrfFulfilledAt ? (
                  <>
                    <dt className="text-white/50">Fulfilled at</dt>
                    <dd className="font-mono text-white">
                      {new Date(proof.vrfFulfilledAt * 1000).toUTCString()}
                    </dd>
                  </>
                ) : null}

                <dt className="text-white/50">Source of trust</dt>
                <dd className="text-emerald-300">
                  ✓ Chainlink VRF coordinator · cryptographic proof verified
                </dd>
              </>
            )}
          </dl>
          )}

          {recomputeError && (
            <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{recomputeError}</p>
          )}

          {recomputed && (
            <div className="space-y-2">
              <p className="text-xs text-white/60">
                Re-derived from the {isVRFCommit ? 'revealed salt + verifiable randomness' : isVRF ? 'verifiable randomness' : 'revealed seed'} in your browser:
              </p>
              <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-xs">
                <dt className="text-white/50">Jackpot slot(s)</dt>
                <dd className="font-mono text-white">
                  {recomputed.jackpotPositions.map((p) => (
                    <span key={p} className={`mr-2 ${p === locator.positionInBatch ? 'text-red-300 font-semibold' : ''}`}>
                      {p}{p === locator.positionInBatch ? ' ← this draft' : ''}
                    </span>
                  ))}
                </dd>
                <dt className="text-white/50">HOF slots</dt>
                <dd className="font-mono text-white">
                  {recomputed.hofPositions.map((p) => (
                    <span key={p} className={`mr-2 ${p === locator.positionInBatch ? 'text-hof font-semibold' : ''}`}>
                      {p}{p === locator.positionInBatch ? ' ← this draft' : ''}
                    </span>
                  ))}
                </dd>
                <dt className="text-white/50">This draft</dt>
                <dd>
                  <span className="text-white">Position {locator.positionInBatch} → </span>
                  <span className="font-semibold" style={{
                    color: classifyDraftType(locator.positionInBatch, recomputed) === 'jackpot' ? '#ef4444'
                      : classifyDraftType(locator.positionInBatch, recomputed) === 'hof' ? '#D4AF37'
                      : '#a855f7',
                  }}>
                    {classifyDraftType(locator.positionInBatch, recomputed).toUpperCase()}
                  </span>
                </dd>
              </dl>

              {proof?.jackpotPositions && proof?.hofPositions && (
                <p className="text-[11px] text-white/40">
                  Backend-published positions:{' '}
                  jackpot=[{proof.jackpotPositions.join(',')}] hof=[{proof.hofPositions.join(',')}].
                  Your recomputation must match these.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-2">
        <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Why this is real proof</h2>
        <ul className="text-xs text-white/60 space-y-1.5 leading-relaxed list-disc list-inside">
          {isVRFCommit ? (
            <>
              <li><strong className="text-white/80">Chainlink VRF</strong> is the same oracle network Polymarket, Aave, and OpenSea use to produce verifiable randomness.</li>
              <li>The random number is requested before any draft in the batch fills — the timestamp is public.</li>
              <li>The salt is hashed and committed at the same moment, then sealed until the batch closes — so positions are locked in but can&apos;t be computed during the batch.</li>
              <li>When the batch closes, the salt is revealed. The contract verifies <code className="font-mono">keccak256(salt) == saltHash</code> from the original commit. Tampering would fail this check.</li>
              <li>After reveal, anyone can re-derive every position in their browser via <code className="font-mono">HMAC-SHA256(sha256(salt || randomness), tag)</code>.</li>
            </>
          ) : isVRF ? (
            <>
              <li><strong className="text-white/80">Chainlink VRF</strong> is the same oracle network Polymarket, Aave, and OpenSea use to produce verifiable randomness.</li>
              <li>The randomness request is submitted before any draft in the batch fills — the timestamp is public.</li>
              <li>Chainlink returns the random number with a cryptographic proof. The contract verifies the proof before accepting.</li>
              <li>The randomness is bound to the batch number permanently — it can&apos;t be retried.</li>
              <li>Slot derivation is deterministic; the recomputation above runs in your browser using the same algorithm we use server-side.</li>
            </>
          ) : (
            <>
              <li>The seed&apos;s hash is published before any draft in the batch fills — the timestamp is public.</li>
              <li>Anyone can read the commit and verify when it landed.</li>
              <li>Reveal must hash to the committed value — math, not trust.</li>
              <li>Slot derivation is deterministic; the recomputation above runs in your browser, no server call needed.</li>
              <li>If we ever published a different seed than the one we committed, the hash check above would say <span className="text-red-300">⚠ hash mismatch</span>.</li>
            </>
          )}
        </ul>
      </section>
    </div>
  );
}
