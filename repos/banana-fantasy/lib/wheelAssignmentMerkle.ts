/**
 * Merkle tree over (spinIndex, walletAddress) leaves for the wheel
 * assignment journal. Mirrors lib/wheelMerkle.ts (which trees outcomes)
 * — same hashing convention, same tree shape, same proof format — so
 * the browser-side verifier can reuse `verifyMerkleProof()`.
 *
 * Leaf shape:
 *   keccak256(abi.encode(uint32 spinIndex, address wallet))
 *
 * The uint32 width matches the on-chain contract (`fromIndex`/`toIndex`
 * are uint32). Wallets are normalized to lowercase before abi-encoding
 * so the canonical form on-chain and off-chain matches byte-for-byte.
 */

import { keccak256, encodeAbiParameters, type Hex } from 'viem';

export interface AssignmentLeafInput {
  spinIndex: number;
  wallet: string;
}

export function assignmentLeafHash(spinIndex: number, wallet: string): Hex {
  const addr = wallet.startsWith('0x') ? wallet : `0x${wallet}`;
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    throw new Error(`assignmentLeafHash: invalid wallet ${wallet}`);
  }
  return keccak256(
    encodeAbiParameters(
      [{ type: 'uint32' }, { type: 'address' }],
      [spinIndex, addr.toLowerCase() as `0x${string}`],
    ),
  );
}

/**
 * Direction-agnostic pair hash. Matches lib/wheelMerkle.nodeHash exactly
 * — sort then concat — so any verifier already using wheelMerkle works
 * on assignment proofs without modification.
 */
function nodeHash(a: Hex, b: Hex): Hex {
  return keccak256(
    a.toLowerCase() < b.toLowerCase()
      ? encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [a, b])
      : encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [b, a]),
  );
}

export interface AssignmentMerkleTree {
  leaves: Hex[];
  layers: Hex[][];
  root: Hex;
}

export function buildAssignmentMerkleTree(entries: AssignmentLeafInput[]): AssignmentMerkleTree {
  if (entries.length === 0) {
    throw new Error('Cannot build assignment Merkle tree with 0 entries');
  }
  const leaves: Hex[] = entries.map((e) => assignmentLeafHash(e.spinIndex, e.wallet));
  return rebuildAssignmentTreeFromLeaves(leaves);
}

/**
 * Rebuild a tree from pre-computed leaves. Used by the per-spin proof
 * endpoint, which has the leaves persisted on the batch doc and skips
 * the leaf-hashing step.
 */
export function rebuildAssignmentTreeFromLeaves(leaves: Hex[]): AssignmentMerkleTree {
  if (leaves.length === 0) {
    throw new Error('Cannot rebuild assignment tree with 0 leaves');
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
  return { leaves, layers, root: layers[layers.length - 1][0] };
}

export function getAssignmentMerkleProof(
  tree: AssignmentMerkleTree,
  leafIndex: number,
): Hex[] {
  if (leafIndex < 0 || leafIndex >= tree.leaves.length) {
    throw new Error(`assignment leafIndex ${leafIndex} out of range`);
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
