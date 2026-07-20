// Browser-side Merkle proof verification for the vrf-commit-merkle
// draft batch variant. Mirrors batchproof.go's merkle.go module: the
// leaf hash and node hash MUST produce byte-identical output to the
// Go implementation, otherwise verification fails.
//
// Leaf format: keccak256( abi.encode(uint256 positionInBatch, bytes32 draftTypeHash) )
// where draftTypeHash = keccak256(bytes(draftType)).

import { keccak256, encodeAbiParameters, toHex, type Hex } from 'viem';

export type DraftType = 'pro' | 'hof' | 'jackpot';

/**
 * Compute the leaf hash a draft would have in the round's Merkle tree.
 * `position` is positionInRound (0..9999) for the vrf-commit-merkle
 * variant, matching the Go `LeafHash(positionInRound, draftType)`.
 */
export function leafHashForDraft(position: number, draftType: DraftType): Hex {
  const draftTypeHash = keccak256(toHex(draftType));
  return keccak256(
    encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'bytes32' }],
      [BigInt(position), draftTypeHash],
    ),
  );
}

function nodeHash(a: Hex, b: Hex): Hex {
  return keccak256(
    a.toLowerCase() < b.toLowerCase()
      ? encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [a, b])
      : encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [b, a]),
  );
}

export function verifyDraftMerkleProof(input: {
  /** positionInRound (0..9999) for the merkle round this draft belongs to. */
  position: number;
  draftType: DraftType;
  proof: Hex[];
  root: Hex;
}): boolean {
  const expectedLeaf = leafHashForDraft(input.position, input.draftType);
  let computed: Hex = expectedLeaf;
  for (const sibling of input.proof) {
    computed = nodeHash(computed, sibling);
  }
  return computed.toLowerCase() === input.root.toLowerCase();
}

/**
 * Server-side: rebuild the proof path for a single position given the
 * full 100-leaf array. Mirrors batchproof Go's MerkleTree.GetMerkleProof.
 */
export function buildDraftMerkleProof(leaves: Hex[], position: number): Hex[] {
  if (position < 0 || position >= leaves.length) {
    throw new Error(`position ${position} out of range`);
  }
  const layers: Hex[][] = [leaves.slice()];
  while (layers[layers.length - 1].length > 1) {
    const current = layers[layers.length - 1];
    const next: Hex[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i];
      const right = i + 1 < current.length ? current[i + 1] : current[i];
      next.push(nodeHash(left, right));
    }
    layers.push(next);
  }
  const proof: Hex[] = [];
  let idx = position;
  for (let level = 0; level < layers.length - 1; level += 1) {
    const layer = layers[level];
    const siblingIdx = idx % 2 === 1 ? idx - 1 : idx + 1;
    const sibling = siblingIdx < layer.length ? layer[siblingIdx] : layer[idx];
    proof.push(sibling);
    idx = Math.floor(idx / 2);
  }
  return proof;
}

// ── Rolling-era lane proofs ─────────────────────────────────────────────
// Leaf format (lane eras): keccak256(utf8("<lane>:<cycle>:<p0>[,<p1>…]"))
// with positions in DERIVATION order. Tree = same sorted-pair keccak as the
// round tree above. Mirrors Go batchproof.LaneLeafHash byte-for-byte.

export function laneLeafHash(lane: 'jp' | 'hof', cycle: number, positions: number[]): Hex {
  return keccak256(toHex(`${lane}:${cycle}:${positions.join(',')}`));
}

/** Verify a completed lane window's published positions against its era's
 *  on-chain Merkle root — the browser-side check for the rolling system. */
export function verifyLaneCycleProof(input: {
  lane: 'jp' | 'hof';
  cycle: number;
  positions: number[];
  proof: Hex[];
  root: Hex;
}): boolean {
  let computed: Hex = laneLeafHash(input.lane, input.cycle, input.positions);
  for (const sibling of input.proof) {
    computed = nodeHash(computed, sibling);
  }
  return computed.toLowerCase() === input.root.toLowerCase();
}
