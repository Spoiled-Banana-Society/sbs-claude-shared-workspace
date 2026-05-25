'use client';

import React, { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
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

      <FounderDraftsRecent />

      <BackfillFounderDrafts schedule={schedule} />
    </div>
  );
}

/**
 * Lists every confirmed founder draft with its participants and a one-
 * click "grant +1 spin to all non-founder participants" button. Boris's
 * workflow: see at a glance which weekly drafts qualified + give the
 * other 9 players in each one their free wheel spin.
 *
 * Each row tracks bulkSpinGrantedAt so we never double-grant. Re-running
 * a row that's already been granted returns 'already_granted' and is a
 * no-op.
 */
function FounderDraftsRecent() {
  const { getAccessToken } = usePrivy();
  const [drafts, setDrafts] = useState<FounderDraftRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [granting, setGranting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch('/api/admin/founder-drafts/list', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const body = (await res.json()) as { drafts?: FounderDraftRow[] };
      setDrafts(body.drafts ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => { void load(); }, [load]);

  const grant = async (draftId: string, nonFounderCount: number) => {
    if (!window.confirm(
      `Grant +1 wheel spin to ${nonFounderCount} non-founder participant${nonFounderCount === 1 ? '' : 's'} of draft ${draftId.slice(0, 16)}…?\n\nIdempotent: re-running is a no-op once granted.`,
    )) return;
    setGranting(draftId);
    setResults((r) => ({ ...r, [draftId]: 'Granting…' }));
    try {
      const token = await getAccessToken();
      const res = await fetch('/api/admin/founder-drafts/grant-spins', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ draftId }),
      });
      const body = (await res.json()) as { ok?: boolean; grantedCount?: number; failedCount?: number; skipped?: string };
      if (!res.ok) throw new Error(`${res.status}`);
      if (body.skipped === 'already_granted') {
        setResults((r) => ({ ...r, [draftId]: '✓ Already granted earlier — no-op' }));
      } else {
        setResults((r) => ({
          ...r,
          [draftId]: `✓ Granted ${body.grantedCount ?? 0}${body.failedCount ? `, ${body.failedCount} failed` : ''}`,
        }));
      }
      // Refresh the list so the bulkSpinGrantedAt timestamp shows.
      void load();
    } catch (e) {
      setResults((r) => ({ ...r, [draftId]: `Error: ${e instanceof Error ? e.message : String(e)}` }));
    } finally {
      setGranting(null);
    }
  };

  return (
    <div className="border-t border-white/[0.06] pt-6 mt-6">
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <h4 className="text-base font-semibold text-white">Recent Founder Drafts</h4>
          <p className="text-xs text-gray-500 mt-0.5">
            Each row is a confirmed founder draft. Hit <span className="text-emerald-300">Grant spins</span> to give every non-founder participant +1 wheel spin.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="text-[11px] text-gray-400 hover:text-white underline underline-offset-2"
        >
          ↻ refresh
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          Failed to load: {error}
        </div>
      )}

      {loading && !drafts && <p className="text-xs text-gray-500">Loading…</p>}

      {drafts && drafts.length === 0 && (
        <p className="text-xs text-gray-500 py-4">
          No founder drafts yet. They&apos;ll appear here automatically when the existing
          <span className="font-mono text-gray-400 mx-1">/api/promos/founder-draft</span>
          validator marks one, or use the backfill tool below for older drafts.
        </p>
      )}

      {drafts && drafts.length > 0 && (
        <ul className="space-y-2">
          {drafts.map((d) => {
            const alreadyGranted = !!d.bulkSpinGrantedAt;
            const isGranting = granting === d.draftId;
            const result = results[d.draftId];
            return (
              <li key={d.draftId} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm text-white font-mono truncate">{d.draftId}</p>
                    <p className="text-[11px] text-gray-500">
                      marked {d.markedAt ? new Date(d.markedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}
                      {' · '}
                      {d.participantCount} player{d.participantCount === 1 ? '' : 's'}
                      {' · '}
                      <span className="text-amber-300">{d.nonFounderCount}</span> non-founder
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {alreadyGranted && (
                      <span className="text-[11px] text-emerald-300">
                        ✓ Spins granted {d.bulkSpinGrantedAt ? new Date(d.bulkSpinGrantedAt).toLocaleDateString() : ''}
                      </span>
                    )}
                    <button
                      onClick={() => void grant(d.draftId, d.nonFounderCount)}
                      disabled={isGranting || alreadyGranted || d.nonFounderCount === 0}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                        alreadyGranted
                          ? 'bg-white/[0.04] text-gray-500 cursor-not-allowed'
                          : 'bg-emerald-500/90 text-black hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed'
                      }`}
                    >
                      {isGranting ? 'Granting…' : alreadyGranted ? '✓ Granted' : `Grant +1 spin × ${d.nonFounderCount}`}
                    </button>
                  </div>
                </div>
                {/* Participant chips */}
                {d.participants.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {d.participants.map((p) => (
                      <a
                        key={p.wallet}
                        href={`/admin?tab=user-lookup&wallet=${encodeURIComponent(p.wallet)}`}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-mono border transition ${
                          p.isFounder
                            ? 'border-banana/40 bg-banana/[0.08] text-banana'
                            : 'border-white/[0.08] text-gray-400 hover:text-white hover:border-white/[0.20]'
                        }`}
                        title={p.wallet}
                      >
                        {p.isFounder && '👑 '}
                        {p.wallet.slice(0, 6)}…{p.wallet.slice(-4)}
                      </a>
                    ))}
                  </div>
                )}
                {result && (
                  <p className="text-[11px] text-gray-400">{result}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface FounderDraftRow {
  draftId: string;
  markedAt: string | null;
  founderWallet: string | null;
  scheduleAt: string | null;
  participants: { wallet: string; isFounder: boolean }[];
  participantCount: number;
  nonFounderCount: number;
  bulkSpinGrantedAt: string | null;
  bulkSpinGrantedBy: string | null;
}

// Backfill historical Founder Drafts that filled before the persistence
// system shipped. Once a draft is marked it stays marked forever, so this
// is a one-time write per draft. Use the wallet + scheduleAt that were
// active at fill time (defaults to the current schedule values for
// convenience — admin can override).
function BackfillFounderDrafts({ schedule }: { schedule: FounderSchedule }) {
  const { getAccessToken } = usePrivy();
  const [draftIds, setDraftIds] = useState('');
  const [founderWallet, setFounderWallet] = useState(schedule.founderWallet);
  const [scheduleAt, setScheduleAt] = useState(schedule.at);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  // Keep defaults in sync with the live schedule until the admin types
  // their own override.
  useEffect(() => {
    setFounderWallet(prev => prev || schedule.founderWallet);
    setScheduleAt(prev => prev || schedule.at);
  }, [schedule.founderWallet, schedule.at]);

  const handleBackfill = async () => {
    setResult(null);
    const ids = draftIds.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
    if (ids.length === 0) {
      setResult('No draft IDs entered.');
      return;
    }
    if (!founderWallet || !scheduleAt) {
      setResult('Founder wallet and schedule time required.');
      return;
    }
    setBusy(true);
    const token = await getAccessToken();
    const successes: string[] = [];
    const failures: string[] = [];
    for (const draftId of ids) {
      try {
        const res = await fetch('/api/admin/founder-drafts/force-mark', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ draftId, founderWallet, scheduleAt }),
        });
        if (res.ok) successes.push(draftId);
        else failures.push(`${draftId} (${res.status})`);
      } catch {
        failures.push(`${draftId} (network)`);
      }
    }
    setBusy(false);
    setResult(`✓ marked: ${successes.join(', ') || 'none'}${failures.length ? ` — failed: ${failures.join(', ')}` : ''}`);
  };

  return (
    <div className="mt-8 pt-6 border-t border-white/10 space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-white">Backfill historical founder drafts</h4>
        <p className="text-[11px] text-gray-500 mt-1">
          Mark existing drafts as Founder permanently. Useful when a draft qualified at fill time
          but wasn&apos;t auto-persisted (e.g. before the persistence system shipped). Once marked,
          a draft stays Founder regardless of future schedule changes.
        </p>
      </div>

      <input
        type="text"
        value={draftIds}
        onChange={(e) => setDraftIds(e.target.value)}
        placeholder="Draft IDs (comma or space separated, e.g. 2024-fast-draft-735, 2024-fast-draft-736)"
        className="w-full bg-bg-elevated text-white px-3 py-2 rounded-md border border-white/10 focus:border-banana outline-none font-mono text-xs"
      />
      <div className="grid grid-cols-2 gap-3">
        <input
          type="text"
          value={founderWallet}
          onChange={(e) => setFounderWallet(e.target.value.toLowerCase())}
          placeholder="Founder wallet (0x…)"
          className="bg-bg-elevated text-white px-3 py-2 rounded-md border border-white/10 focus:border-banana outline-none font-mono text-xs"
        />
        <input
          type="text"
          value={scheduleAt}
          onChange={(e) => setScheduleAt(e.target.value)}
          placeholder="Schedule ISO time"
          className="bg-bg-elevated text-white px-3 py-2 rounded-md border border-white/10 focus:border-banana outline-none font-mono text-xs"
        />
      </div>
      <button
        onClick={handleBackfill}
        disabled={busy || !draftIds.trim()}
        className="px-4 py-1.5 rounded-md bg-cyan-500 text-white text-sm font-bold tracking-wide hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition"
      >
        {busy ? 'Marking…' : 'Mark as Founder'}
      </button>
      {result && <p className="text-[11px] text-gray-400 font-mono break-all">{result}</p>}
    </div>
  );
}
