'use client';

import { useCallback, useState } from 'react';
import { fetchJson } from '@/lib/appApiClient';
import { useAuth } from '@/hooks/useAuth';

export type WheelSpinOutcome = {
  spinId: string;
  result: string;
  prize: {
    type: 'draft_pass' | 'discount' | 'merch' | 'nothing' | 'custom';
    value?: number | string;
  };
  angle: number;
  user?: {
    wheelSpins: number;
    freeDrafts: number;
    jackpotEntries: number;
    hofEntries: number;
  };
};

export function useWheel(opts?: { userId?: string }) {
  const { user } = useAuth();
  const userId = opts?.userId ?? user?.id;
  const [history, setHistory] = useState<WheelSpinOutcome[]>([]);

  const spin = useCallback(async (): Promise<WheelSpinOutcome | null> => {
    if (!userId) return null;

    const res = await fetchJson<WheelSpinOutcome>('/api/wheel/spin', {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });

    setHistory((prev) => [res, ...prev]);
    return res;
  }, [userId]);

  return {
    history,
    spin,
    userId,
  };
}
