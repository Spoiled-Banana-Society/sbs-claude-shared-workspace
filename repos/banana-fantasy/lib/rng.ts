import crypto from 'node:crypto';

const FLOAT_BYTES = 6; // 48 bits of precision
const FLOAT_DIVISOR = 2 ** (FLOAT_BYTES * 8);

export function generateSeed(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function generateNonce(bytes = 8): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function generateServerSeed(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function generateClientSeed(identity?: string): string {
  const random = crypto.randomBytes(16).toString('hex');
  if (!identity) return random;
  return crypto.createHash('sha256').update(`${identity}:${random}`).digest('hex');
}

export function hashServerSeed(serverSeed: string): string {
  return crypto.createHash('sha256').update(serverSeed).digest('hex');
}

export function computeResult(serverSeed: string, clientSeed: string, nonce: number): string {
  return crypto
    .createHmac('sha256', serverSeed)
    .update(`${clientSeed}:${nonce}`)
    .digest('hex');
}

export function resultToIndex(hash: string, modulo: number): number {
  if (modulo <= 0 || !Number.isFinite(modulo)) return 0;
  const normalized = hash.startsWith('0x') ? hash : `0x${hash}`;
  const value = BigInt(normalized);
  return Number(value % BigInt(modulo));
}

export function seededRandomFloat(seed: string): number {
  const hash = crypto.createHash('sha256').update(seed).digest();
  const slice = hash.subarray(0, FLOAT_BYTES);
  let value = 0;
  for (const byte of slice) {
    // `* 256`, NOT `<< 8`: JS bit-shift is 32-bit, so accumulating FLOAT_BYTES=6
    // (48-bit) bytes overflowed after 4 bytes — `value` went tiny/negative and the
    // roll was ~0, so pickWeighted ALWAYS returned the first wedge (wheel paid
    // 1 Draft 100% of the time). Multiplication stays exact up to 2^53 (53-bit safe).
    value = value * 256 + byte;
  }
  return value / FLOAT_DIVISOR;
}

export function assertProbabilitySum(values: number[], epsilon = 1e-6) {
  const sum = values.reduce((acc, v) => acc + v, 0);
  if (Math.abs(sum - 1) > epsilon) {
    throw new Error(`Probabilities must sum to 1. Received ${sum}`);
  }
}

export function pickWeighted<T>(
  items: Array<{ value: T; probability: number }>,
  seed: string,
): { value: T; index: number; roll: number } {
  if (!items.length) throw new Error('No items provided');
  const probabilities = items.map((item) => item.probability);
  assertProbabilitySum(probabilities);
  for (const p of probabilities) {
    if (p < 0) throw new Error('Probabilities must be >= 0');
  }

  const roll = seededRandomFloat(seed);
  let cumulative = 0;
  for (let i = 0; i < items.length; i += 1) {
    cumulative += items[i].probability;
    if (roll < cumulative || i === items.length - 1) {
      return { value: items[i].value, index: i, roll };
    }
  }

  return { value: items[items.length - 1].value, index: items.length - 1, roll };
}

// Future: add HMAC-based commit-reveal (server commit + client reveal) for public verification.
