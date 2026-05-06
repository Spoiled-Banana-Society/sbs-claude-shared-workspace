'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { EMPTY_SCHEDULE, type FounderSchedule } from '@/lib/founderDraft';

// Reads + writes the singleton founder-schedule doc.
//
// Read is public (homepage banner needs it). saveSchedule requires the
// caller to be an admin per /api/admin/founder-schedule POST gate —
// non-admin saves return 403 and we revert.

export interface UseFounderScheduleResult {
  schedule: FounderSchedule;
  loaded: boolean;
  saving: boolean;
  saveSchedule: (next: FounderSchedule) => Promise<boolean>;
  refresh: () => Promise<void>;
}

export function useFounderSchedule(): UseFounderScheduleResult {
  const { getAccessToken } = usePrivy();
  const [schedule, setSchedule] = useState<FounderSchedule>(EMPTY_SCHEDULE);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchSchedule = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/founder-schedule');
      if (!res.ok) throw new Error(`${res.status}`);
      const data = (await res.json()) as { schedule?: FounderSchedule };
      setSchedule(data.schedule ?? EMPTY_SCHEDULE);
    } catch {
      setSchedule(EMPTY_SCHEDULE);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void fetchSchedule();
  }, [fetchSchedule]);

  const saveSchedule = useCallback(async (next: FounderSchedule): Promise<boolean> => {
    setSaving(true);
    const previous = schedule;
    setSchedule(next); // optimistic
    try {
      const token = await getAccessToken();
      const res = await fetch('/api/admin/founder-schedule', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = (await res.json()) as { schedule?: FounderSchedule };
      if (data.schedule) setSchedule(data.schedule);
      return true;
    } catch (err) {
      console.warn('[founderSchedule] save failed — reverting', err);
      setSchedule(previous);
      return false;
    } finally {
      setSaving(false);
    }
  }, [schedule, getAccessToken]);

  return { schedule, loaded, saving, saveSchedule, refresh: fetchSchedule };
}
