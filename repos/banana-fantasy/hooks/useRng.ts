'use client';

import { useCallback, useState } from 'react';
import { fetchJson } from '@/lib/appApiClient';
import { useAuth } from '@/hooks/useAuth';

export type RngSpinType = 'wheel' | 'slot' | 'jackpot' | 'hof';

export interface RngSeedData {
  commitId: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  resultHash: string;
}

export interface RngSpinResponse {
  spinType: RngSpinType;
  result: unknown;
  commitId: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  resultHash: string;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return toHex(signature);
}

async function sha256Hex(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return toHex(digest);
}

export function useRng() {
  const { user } = useAuth();
  const [result, setResult] = useState<RngSpinResponse | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [serverSeedHash, setServerSeedHash] = useState<string | null>(null);
  const [isVerified, setIsVerified] = useState(false);

  const requestSpin = useCallback(
    async (
      spinType: RngSpinType,
      opts?: { userId?: string; clientSeed?: string; pool?: string[] },
    ): Promise<RngSpinResponse | null> => {
      const userId = opts?.userId ?? user?.id;
      if (!userId) return null;

      setIsSpinning(true);
      setIsVerified(false);

      try {
        const res = await fetchJson<RngSpinResponse>('/api/rng/spin', {
          method: 'POST',
          body: JSON.stringify({
            userId,
            spinType,
            clientSeed: opts?.clientSeed,
            pool: opts?.pool,
          }),
        });

        setResult(res);
        setServerSeedHash(res.serverSeedHash);
        return res;
      } finally {
        setIsSpinning(false);
      }
    },
    [user?.id],
  );

  const verifySpin = useCallback(async (seedData: RngSeedData): Promise<boolean> => {
    if (!seedData?.commitId) return false;

    setIsVerifying(true);
    try {
      const reveal = await fetchJson<{ commitId: string; serverSeed: string; serverSeedHash: string }>(
        '/api/rng/reveal',
        {
          method: 'POST',
          body: JSON.stringify({ commitId: seedData.commitId }),
        },
      );

      const expectedHash = await hmacSha256Hex(reveal.serverSeed, `${seedData.clientSeed}:${seedData.nonce}`);
      const computedSeedHash = await sha256Hex(reveal.serverSeed);

      const matches =
        expectedHash === seedData.resultHash &&
        computedSeedHash === seedData.serverSeedHash &&
        reveal.serverSeedHash === seedData.serverSeedHash;

      setIsVerified(matches);
      return matches;
    } finally {
      setIsVerifying(false);
    }
  }, []);

  return {
    result,
    isSpinning,
    isVerifying,
    serverSeedHash,
    isVerified,
    requestSpin,
    verifySpin,
  };
}
