'use client';

import { useEffect, useState } from 'react';

/**
 * Polls /api/batches/{batchNumber}/proof every few seconds and reports
 * whether the batch's randomness is ready to be revealed in UI.
 *
 * "Ready" means one of:
 *   - status == 'fulfilled' (vrf or vrf-commit: positions locked privately)
 *   - status == 'revealed'  (commit-reveal or vrf-commit: math fully public)
 *   - status == 'pre-launch' (legacy batch, no proof — don't gate)
 *
 * "Not ready" means status is 'requested' / 'pending' / missing — the
 * Chainlink coordinator hasn't yet delivered the random number, so we
 * don't yet know which positions are JP/HOF.
 *
 * The slot-machine reveal in the draft room must NOT spin until ready,
 * otherwise it would either show a wrong type or have to retroactively
 * change. Pre-request optimization usually means the batch is ready
 * by the time a draft fills, but in fast-fill scenarios the lobby may
 * have to wait briefly for VRF.
 */

type ProofStatus =
  | 'pending'
  | 'committed'
  | 'revealed'
  | 'requested'
  | 'fulfilled'
  | 'merkleCommitted'
  | 'pre-launch';

type ProofVariant = 'commit-reveal' | 'vrf' | 'vrf-commit' | 'vrf-commit-merkle';

export interface BatchProofReadyState {
  ready: boolean;
  status: ProofStatus | null;
  variant: ProofVariant | null;
  /** Seconds since this hook started polling. Useful for an overlay countdown. */
  secondsElapsed: number;
  /** On-chain proof tx hashes, surfaced for the lobby verification badge. */
  vrfRequestTxHash?: string;
  vrfFulfilledAt?: number;
  commitTxHashVrf?: string;
  revealSaltTxHash?: string;
  saltHash?: string;
  vrfCoordinator?: string;
  error: string | null;
}

const POLL_INTERVAL_MS = 4000;

export function useBatchProofReady(batchNumber: number | null): BatchProofReadyState {
  const [state, setState] = useState<BatchProofReadyState>({
    ready: false,
    status: null,
    variant: null,
    secondsElapsed: 0,
    error: null,
  });

  useEffect(() => {
    if (batchNumber == null || batchNumber < 1) return;

    let cancelled = false;
    const startedAt = Date.now();

    const poll = async () => {
      try {
        const res = await fetch(`/api/batches/${batchNumber}/proof`);
        if (!res.ok) {
          if (!cancelled) {
            setState((prev) => ({
              ...prev,
              error: `proof: ${res.status}`,
              secondsElapsed: Math.floor((Date.now() - startedAt) / 1000),
            }));
          }
          return;
        }
        const body = await res.json();
        if (cancelled) return;

        const status = body.status as ProofStatus | undefined;
        const variant = (body.variant as ProofVariant | undefined) ?? 'commit-reveal';

        // For vrf and vrf-commit: 'fulfilled' or 'revealed' means we have
        // enough info to compute (or in vrf-commit's case, to know the
        // positions are locked even if the salt is sealed).
        // For commit-reveal: only 'revealed' is fully verifiable.
        // 'pre-launch' batches skip the gate entirely — there's no proof
        // to wait for.
        const ready =
          status === 'pre-launch' ||
          status === 'fulfilled' ||
          status === 'revealed' ||
          // Merkle: 'merkleCommitted' (the new terminal-for-active state)
          // means root is on-chain and per-draft proofs can be served.
          status === 'merkleCommitted' ||
          // On commit-reveal, 'committed' is also fine to proceed — slots
          // are derived server-side immediately.
          (variant === 'commit-reveal' && status === 'committed');

        setState({
          ready,
          status: status ?? null,
          variant,
          secondsElapsed: Math.floor((Date.now() - startedAt) / 1000),
          vrfRequestTxHash: body.vrfRequestTxHash,
          vrfFulfilledAt: body.vrfFulfilledAt,
          commitTxHashVrf: body.commitTxHashVrf,
          revealSaltTxHash: body.revealSaltTxHash,
          saltHash: body.saltHash,
          vrfCoordinator: body.vrfCoordinator,
          error: null,
        });
      } catch (err) {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            error: (err as Error).message,
            secondsElapsed: Math.floor((Date.now() - startedAt) / 1000),
          }));
        }
      }
    };

    void poll();
    const interval = setInterval(() => {
      void poll();
      // keep secondsElapsed ticking even between fetches
      setState((prev) => ({ ...prev, secondsElapsed: Math.floor((Date.now() - startedAt) / 1000) }));
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [batchNumber]);

  // Tick secondsElapsed every second for smooth countdown UI even when
  // we're not fetching.
  useEffect(() => {
    if (state.ready || batchNumber == null) return;
    const startedAt = Date.now() - state.secondsElapsed * 1000;
    const tick = setInterval(() => {
      setState((prev) => {
        if (prev.ready) return prev;
        return { ...prev, secondsElapsed: Math.floor((Date.now() - startedAt) / 1000) };
      });
    }, 1000);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ready, batchNumber]);

  return state;
}
