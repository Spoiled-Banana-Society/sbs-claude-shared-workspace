'use client';

import React, { useEffect, useState } from 'react';
import { useFounderSchedule } from '@/hooks/useFounderSchedule';
import type { FounderSchedule } from '@/lib/founderDraft';

// Admin-only editor for the singleton founder-schedule doc.
// Renders inside /admin → Founder tab.

function isoToDatetimeLocal(iso: string): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  // datetime-local takes "YYYY-MM-DDTHH:mm" in local browser time.
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function datetimeLocalToIso(local: string): string {
  if (!local) return '';
  const ms = Date.parse(local);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toISOString();
}

export function FounderScheduleEditor({ enabled }: { enabled: boolean }) {
  const { schedule, loaded, saving, saveSchedule } = useFounderSchedule();
  const [draft, setDraft] = useState<FounderSchedule>(schedule);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loaded) setDraft(schedule);
  }, [loaded, schedule]);

  if (!enabled) return null;

  const handleSave = async () => {
    setError(null);
    const ok = await saveSchedule(draft);
    if (ok) setSavedAt(Date.now());
    else setError('Save failed — likely not admin or network error.');
  };

  const dirty =
    draft.at !== schedule.at ||
    draft.dayLabel !== schedule.dayLabel ||
    draft.founderWallet !== schedule.founderWallet ||
    draft.windowMinutes !== schedule.windowMinutes ||
    draft.active !== schedule.active;

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h3 className="text-base font-semibold text-white mb-1">Founder Draft schedule</h3>
        <p className="text-xs text-gray-500">
          Sets the next founder draft event. The homepage shows a countdown banner when active. The
          draft-room flags drafts as Founder when their start time falls within the window AND the
          founder&apos;s wallet is in the draft order.
        </p>
      </div>

      <label className="block">
        <span className="text-xs font-bold uppercase tracking-wider text-gray-400 block mb-1.5">
          Event time (your local timezone)
        </span>
        <input
          type="datetime-local"
          value={isoToDatetimeLocal(draft.at)}
          onChange={(e) => setDraft({ ...draft, at: datetimeLocalToIso(e.target.value) })}
          className="w-full bg-bg-elevated text-white px-3 py-2 rounded-md border border-white/10 focus:border-banana outline-none"
        />
        {draft.at && (
          <p className="text-[11px] text-gray-500 mt-1 font-mono">{draft.at}</p>
        )}
      </label>

      <label className="block">
        <span className="text-xs font-bold uppercase tracking-wider text-gray-400 block mb-1.5">
          Day label (shown on homepage banner)
        </span>
        <input
          type="text"
          value={draft.dayLabel}
          onChange={(e) => setDraft({ ...draft, dayLabel: e.target.value })}
          placeholder="Thursday at 6 PM PT"
          maxLength={80}
          className="w-full bg-bg-elevated text-white px-3 py-2 rounded-md border border-white/10 focus:border-banana outline-none"
        />
      </label>

      <label className="block">
        <span className="text-xs font-bold uppercase tracking-wider text-gray-400 block mb-1.5">
          Founder wallet (gets the FOUNDER pill on their draft)
        </span>
        <input
          type="text"
          value={draft.founderWallet}
          onChange={(e) => setDraft({ ...draft, founderWallet: e.target.value.toLowerCase() })}
          placeholder="0x…"
          className="w-full bg-bg-elevated text-white px-3 py-2 rounded-md border border-white/10 focus:border-banana outline-none font-mono text-sm"
        />
      </label>

      <label className="block">
        <span className="text-xs font-bold uppercase tracking-wider text-gray-400 block mb-1.5">
          Window minutes (drafts that fill within ±N minutes of event time count)
        </span>
        <input
          type="number"
          min={0}
          max={240}
          value={draft.windowMinutes}
          onChange={(e) => setDraft({ ...draft, windowMinutes: Number(e.target.value) || 0 })}
          className="w-32 bg-bg-elevated text-white px-3 py-2 rounded-md border border-white/10 focus:border-banana outline-none"
        />
      </label>

      <label className="flex items-center gap-2 text-sm text-white">
        <input
          type="checkbox"
          checked={draft.active}
          onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
          className="w-4 h-4"
        />
        <span>Active — when off, no drafts get tagged as Founder regardless of time/wallet match.</span>
      </label>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="px-5 py-2 rounded-md bg-banana text-black font-bold tracking-wide hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {savedAt && !dirty && <span className="text-xs text-green-400">Saved</span>}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  );
}
