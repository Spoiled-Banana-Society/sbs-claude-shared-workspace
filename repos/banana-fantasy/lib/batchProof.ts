/**
 * Pure functions for SBS draft-batch fairness proof.
 *
 * Constraint: every 100 drafts contains exactly 94 Pro, 5 HOF, 1 Jackpot.
 *
 * On-chain proof (rolling out):
 *   1. At batch start, server generates 32-byte serverSeed.
 *   2. seedHash = keccak256(serverSeed).
 *   3. Server submits commit(batchNumber, seedHash) to BBB4BatchProof contract on Base.
 *   4. The 5 HOF + 1 Jackpot positions within the batch are derived
 *      deterministically from serverSeed via deriveBatchSlots(serverSeed, batchNumber).
 *   5. Server submits reveal(batchNumber, serverSeed) when batch closes.
 *   6. Anyone can re-run deriveBatchSlots on the revealed seed and verify it
 *      matches the contract's stored hash and the on-chain HOF/Jackpot
 *      assignments.
 *
 * This file is the canonical client-side implementation. The Go API runs
 * the byte-equivalent computation server-side; if the two ever disagree,
 * the proof has failed.
 */

const BATCH_SIZE = 100;
const HOF_COUNT = 5;
const JACKPOT_COUNT = 1;

export interface BatchSlots {
  hofPositions: number[];     // 0-indexed positions within batch (length 5)
  jackpotPositions: number[]; // 0-indexed positions within batch (length 1)
}

export interface DraftLocator {
  draftNumber: number;        // 1-indexed global draft number (BBB #N)
  batchNumber: number;        // 1-indexed batch number
  positionInBatch: number;    // 0-indexed position within batch (0..99)
  batchStartDraftNumber: number; // 1-indexed
}

/**
 * Parse a draft id like "2024-fast-draft-164" or "2024-slow-draft-12" into
 * the global draft number. Returns null if unparseable.
 */
export function parseDraftNumber(draftId: string): number | null {
  const match = /draft-(\d+)$/.exec(draftId);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

export function locateDraft(draftNumber: number): DraftLocator {
  const batchNumber = Math.floor((draftNumber - 1) / BATCH_SIZE) + 1;
  const batchStartDraftNumber = (batchNumber - 1) * BATCH_SIZE + 1;
  const positionInBatch = (draftNumber - 1) % BATCH_SIZE;
  return { draftNumber, batchNumber, positionInBatch, batchStartDraftNumber };
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error('Invalid hex length');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256(key: Uint8Array, message: string): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto subtle unavailable in this runtime');
  const cryptoKey = await subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

/**
 * Deterministically derive the HOF + Jackpot slot positions for a batch
 * from the revealed server seed. Run client-side and server-side; the two
 * must produce identical output.
 *
 * Algorithm:
 *   1. For each i in [0, 6): byte tag i=0 ⇒ jackpot, i=1..5 ⇒ hof.
 *   2. position_i = uint64( first 8 bytes of HMAC-SHA256(seed, "slot:" + batchNumber + ":" + i) ) % 100.
 *   3. Collision handling: if position_i was already chosen for a different
 *      tag, increment by 1 (mod 100) until we find a free slot. Iterate at
 *      most 100 times.
 *
 * The HMAC + collision walk is portable to Go (crypto/hmac + crypto/sha256)
 * and Solidity verifiers. No floating point, no biased modulo (modulo bias
 * over uint64 is ~2^64/100 — negligible).
 */
export async function deriveBatchSlots(
  serverSeedHex: string,
  batchNumber: number,
): Promise<BatchSlots> {
  const seed = hexToBytes(serverSeedHex);
  const taken = new Set<number>();
  const positions: number[] = [];
  const totalSlots = HOF_COUNT + JACKPOT_COUNT;

  for (let i = 0; i < totalSlots; i++) {
    const tag = `slot:${batchNumber}:${i}`;
    const mac = await hmacSha256(seed, tag);

    let raw = 0n;
    for (let b = 0; b < 8; b++) raw = (raw << 8n) | BigInt(mac[b]);
    let position = Number(raw % BigInt(BATCH_SIZE));

    let walks = 0;
    while (taken.has(position) && walks < BATCH_SIZE) {
      position = (position + 1) % BATCH_SIZE;
      walks++;
    }
    if (taken.has(position)) {
      throw new Error(`Could not place slot ${i} after ${BATCH_SIZE} walks`);
    }

    taken.add(position);
    positions.push(position);
  }

  return {
    jackpotPositions: positions.slice(0, JACKPOT_COUNT),
    hofPositions: positions.slice(JACKPOT_COUNT),
  };
}

/**
 * Combine a server-side salt with on-chain VRF randomness into the seed
 * used by the vrf-commit hybrid. Mirrors the Go-side `CombinedSeed` —
 * `sha256(salt || randomness)`. The result is a 32-byte hex string ready
 * to feed into deriveBatchSlots.
 *
 * Mixing both sources means neither party alone can predetermine the
 * outcome: SBS can't grind seeds (VRF entropy is bound on-chain), and the
 * public can't peek (salt is hidden until reveal).
 */
export async function combinedSeedHex(saltHex: string, randomnessHex: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto subtle unavailable in this runtime');
  const salt = hexToBytes(saltHex);
  const randomness = hexToBytes(randomnessHex);
  const merged = new Uint8Array(salt.length + randomness.length);
  merged.set(salt, 0);
  merged.set(randomness, salt.length);
  const digest = await subtle.digest('SHA-256', merged as BufferSource);
  return bytesToHex(new Uint8Array(digest));
}

/**
 * SHA-256 of a hex-encoded seed. The on-chain commit is keccak256, but we
 * also publish a SHA-256 alongside for browser-native verification without
 * pulling a keccak library.
 */
export async function sha256Hex(hex: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto subtle unavailable in this runtime');
  const digest = await subtle.digest('SHA-256', hexToBytes(hex) as BufferSource);
  return bytesToHex(new Uint8Array(digest));
}

export function classifyDraftType(
  positionInBatch: number,
  slots: BatchSlots,
): 'jackpot' | 'hof' | 'pro' {
  if (slots.jackpotPositions.includes(positionInBatch)) return 'jackpot';
  if (slots.hofPositions.includes(positionInBatch)) return 'hof';
  return 'pro';
}
