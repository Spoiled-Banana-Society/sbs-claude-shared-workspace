// Minimal Merkle tree for Banana Wheel spin outcomes. Leaves are
// keccak256-hashed (spinIndex, outcomeId) pairs so they can be verified
// in Solidity (or any keccak256-compatible environment) without an
// external dependency. Tree is built once per period (up to 100k leaves)
// at period-open time; proof generation is O(log n) per spin.

import { keccak256, encodeAbiParameters, toHex, type Hex } from 'viem';
import { pickWeighted } from './rng';
import { wheelSegments, type WheelSegment } from './wheelConfig';
import { createHash } from 'node:crypto';

/**
 * The seed each spin's outcome is derived from. Concatenates the period's
 * private salt with the on-chain VRF randomness, plus the spin's position
 * within the period. SHA-256 because that matches the existing batch-proof
 * `combinedSeedHex` helper — keeps both systems on the same hash.
 */
export function spinSeedHex(saltHex: string, vrfHex: string, spinIndex: number): string {
  const saltClean = saltHex.startsWith('0x') ? saltHex.slice(2) : saltHex;
  const vrfClean = vrfHex.startsWith('0x') ? vrfHex.slice(2) : vrfHex;
  const indexHex = BigInt(spinIndex).toString(16).padStart(16, '0');
  const concatHex = saltClean + vrfClean + indexHex;
  const buf = Buffer.from(concatHex, 'hex');
  return '0x' + createHash('sha256').update(buf).digest('hex');
}

/**
 * Deterministically picks the wheel segment for spin `spinIndex` in a period.
 * Uses the same `pickWeighted` helper the existing spin route uses, so the
 * probability distribution is unchanged. Verifiable: anyone with (salt, vrf)
 * can re-derive every outcome.
 */
export function deriveSpinOutcome(
  saltHex: string,
  vrfHex: string,
  spinIndex: number,
  // MUST be the period's committed segmentsSnapshot when deriving inside a
  // period — never the deployed static config, which may be a newer
  // generation than the one the period's Merkle root was built from.
  segments: WheelSegment[] = wheelSegments,
) {
  const seed = spinSeedHex(saltHex, vrfHex, spinIndex);
  const { value, index, roll } = pickWeighted(
    segments.map((s) => ({ value: s, probability: s.probability })),
    seed,
  );
  return { segment: value, segmentIndex: index, roll, seed };
}

/**
 * Leaf hash for the Merkle tree. Solidity-compatible:
 *   keccak256(abi.encode(uint256 spinIndex, bytes32 segmentIdHash))
 * where segmentIdHash = keccak256(bytes(segmentId)). Using the keccak hash
 * of the segment id (not the raw string) keeps leaves fixed-length and
 * easy to verify in a contract or another client.
 */
export function leafHash(spinIndex: number, segmentId: string): Hex {
  const segmentIdHash = keccak256(toHex(segmentId));
  return keccak256(
    encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'bytes32' }],
      [BigInt(spinIndex), segmentIdHash],
    ),
  );
}

/**
 * Pair-hash for an internal node. Sorts the pair so the Merkle proof is
 * direction-agnostic (matches OpenZeppelin's `MerkleProof.processProof`).
 */
function nodeHash(a: Hex, b: Hex): Hex {
  return keccak256(
    a.toLowerCase() < b.toLowerCase()
      ? encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [a, b])
      : encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [b, a]),
  );
}

export interface MerkleTree {
  leaves: Hex[];
  layers: Hex[][];
  root: Hex;
}

/**
 * Builds a Merkle tree over the given leaves. Single-leaf tree returns the
 * leaf as root. Odd-out leaves are duplicated up the next layer (standard
 * convention; matches OpenZeppelin StandardMerkleTree without sorted leaves).
 */
export function buildMerkleTree(leaves: Hex[]): MerkleTree {
  if (leaves.length === 0) throw new Error('Cannot build Merkle tree with 0 leaves');
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
  return { leaves, layers, root: layers[layers.length - 1][0] };
}

/**
 * Generates the proof for a single leaf. Returns the sibling hashes from
 * leaf level up to (but not including) the root. Verifying side
 * reconstructs the root by sequentially hashing leaf with each sibling.
 */
export function getMerkleProof(tree: MerkleTree, leafIndex: number): Hex[] {
  if (leafIndex < 0 || leafIndex >= tree.leaves.length) {
    throw new Error(`leafIndex ${leafIndex} out of range`);
  }
  const proof: Hex[] = [];
  let index = leafIndex;
  for (let level = 0; level < tree.layers.length - 1; level += 1) {
    const layer = tree.layers[level];
    const isRight = index % 2 === 1;
    const siblingIndex = isRight ? index - 1 : index + 1;
    const sibling = siblingIndex < layer.length ? layer[siblingIndex] : layer[index];
    proof.push(sibling);
    index = Math.floor(index / 2);
  }
  return proof;
}

/**
 * Verifies a proof matches the given root. Used by the browser to confirm
 * "this outcome was in the original committed tree, SBS didn't fake it."
 */
export function verifyMerkleProof(leaf: Hex, proof: Hex[], root: Hex): boolean {
  let computed: Hex = leaf;
  for (const sibling of proof) {
    computed = nodeHash(computed, sibling);
  }
  return computed.toLowerCase() === root.toLowerCase();
}
