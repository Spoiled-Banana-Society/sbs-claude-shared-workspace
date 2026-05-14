// Browser-side Merkle proof verification for the Banana Wheel. Receives
// the leaf + proof path returned by /api/wheel/spin and confirms the
// outcome against the on-chain root the contract published when the
// period opened. Mirrors lib/wheelMerkle.ts but uses viem's keccak256
// only (no Node crypto — keeps the bundle slim).

import { keccak256, encodeAbiParameters, toHex, type Hex } from 'viem';

function nodeHash(a: Hex, b: Hex): Hex {
  return keccak256(
    a.toLowerCase() < b.toLowerCase()
      ? encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [a, b])
      : encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [b, a]),
  );
}

export function leafHashClient(spinIndex: number, segmentId: string): Hex {
  const segmentIdHash = keccak256(toHex(segmentId));
  return keccak256(
    encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'bytes32' }],
      [BigInt(spinIndex), segmentIdHash],
    ),
  );
}

export function verifyMerkleProofClient(leaf: Hex, proof: Hex[], root: Hex): boolean {
  let computed: Hex = leaf;
  for (const sibling of proof) {
    computed = nodeHash(computed, sibling);
  }
  return computed.toLowerCase() === root.toLowerCase();
}

/** Convenience: given a spin response payload, verify the proof end-to-end. */
export function verifySpinProof(input: {
  spinIndex: number;
  segmentId: string;
  proof: Hex[];
  root: Hex;
}): boolean {
  const expectedLeaf = leafHashClient(input.spinIndex, input.segmentId);
  return verifyMerkleProofClient(expectedLeaf, input.proof, input.root);
}
