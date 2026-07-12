'use client';

/**
 * Admin: house-bot fill. STAGING tool to (1) mint a pool of bot wallets that
 * hold real free draft passes, (2) top up a specific league with N of them, and
 * (3) view the bot registry (wallets + token ids) to exclude from prizes.
 *
 * Bots join through the same flow a human does and auto-draft via the existing
 * miss-2 path — they're just idle wallets with default Banana##### identities.
 */

import { useState, useCallback } from 'react';
import { useAdminAuthHeaders } from '@/hooks/admin/useAdminApi';
import { type BotBrainConfig } from '@/lib/botBrainConfig';

type BotRow = { address: string; tokenIds: string[]; passType: string; mintTxHash: string | null };
type SimTeam = { seat: number; picks: string[]; counts: Record<string, number> };

export function BotFillPanel() {
  const getHeaders = useAdminAuthHeaders();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [mintCount, setMintCount] = useState(5);
  const [leagueId, setLeagueId] = useState('');
  const [fillCount, setFillCount] = useState(3);
  const [speed, setSpeed] = useState<'fast' | 'slow'>('fast');
  const [bots, setBots] = useState<BotRow[] | null>(null);

  // Bot Brain tuning — loads on demand, saves to system_config/botBrain,
  // which the onBotTurn Cloud Function reads on every bot pick (no redeploy).
  const [brain, setBrain] = useState<BotBrainConfig | null>(null);
  const [simTeams, setSimTeams] = useState<SimTeam[] | null>(null);

  const call = useCallback(
    async (label: string, fn: () => Promise<Response>) => {
      setBusy(label);
      setMsg(null);
      setErr(null);
      try {
        const res = await fn();
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        return body;
      } catch (e) {
        setErr((e as Error).message);
        return null;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const mint = async () => {
    const headers = await getHeaders();
    const body = await call('mint', () =>
      fetch('/api/admin/bots/mint', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: mintCount }),
      }),
    );
    if (body) setMsg(`Minted ${body.poolAdded} bot(s) with free passes${body.failed?.length ? ` (${body.failed.length} failed)` : ''}.`);
  };

  const fill = async () => {
    if (!leagueId.trim()) { setErr('Enter a leagueId (e.g. 2024-fast-draft-41).'); return; }
    const headers = await getHeaders();
    const body = await call('fill', () =>
      fetch('/api/admin/bots/fill', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId: leagueId.trim(), count: fillCount }),
      }),
    );
    if (body) setMsg(`Added ${body.joined ?? 0} bot(s) to ${body.leagueId}.`);
  };

  const list = async () => {
    const headers = await getHeaders();
    const body = await call('list', () => fetch('/api/admin/bots', { headers }));
    if (body) { setBots(body.bots || []); setMsg(`${body.count} bot wallet(s) in the pool.`); }
  };

  const loadBrain = async () => {
    const headers = await getHeaders();
    const body = await call('brain-load', () => fetch('/api/admin/bots/brain', { headers }));
    if (body) setBrain(body as BotBrainConfig);
  };

  const saveBrain = async () => {
    if (!brain) return;
    const headers = await getHeaders();
    const body = await call('brain-save', () =>
      fetch('/api/admin/bots/brain', {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(brain),
      }),
    );
    if (body) setMsg('Bot brain saved — applies from the next bot pick.');
  };

  const simulate = async () => {
    const headers = await getHeaders();
    const body = await call('brain-sim', () =>
      fetch('/api/admin/bots/brain/simulate', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        // Trial the CURRENT (possibly unsaved) dials so tune → simulate → save.
        body: JSON.stringify(brain ? { config: brain } : {}),
      }),
    );
    if (body) { setSimTeams(body.teams || []); setMsg('Simulated a full 15-round draft with these dials.'); }
  };


  const input = 'rounded-lg bg-bg-tertiary border border-white/10 px-3 py-2 text-sm text-white w-full';
  const btn = 'rounded-lg bg-banana text-black font-semibold px-4 py-2 text-sm disabled:opacity-50';

  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-bg-elevated p-5">
      <h3 className="text-base font-semibold text-white mb-1">House Bots (staging fill)</h3>
      <p className="text-xs text-text-muted mb-4">
        Mint a pool of bot wallets (real free passes), then top up a specific league. Bots auto-draft
        and show as default Banana##### identities. Excluded from prizes via the list below.
      </p>

      {msg && <div className="mb-3 rounded-lg bg-green-500/10 border border-green-500/30 px-3 py-2 text-xs text-green-300">{msg}</div>}
      {err && <div className="mb-3 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-300">{err}</div>}

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Mint pool */}
        <div className="rounded-xl bg-bg-tertiary/50 p-4">
          <div className="text-sm font-medium text-white mb-2">1 · Mint bot pool</div>
          <label className="text-xs text-text-muted">How many (≤10/call)</label>
          <input type="number" min={1} max={10} value={mintCount} onChange={(e) => setMintCount(Number(e.target.value))} className={`${input} mt-1 mb-3`} />
          <button onClick={mint} disabled={busy === 'mint'} className={btn}>{busy === 'mint' ? 'Minting…' : 'Mint bots'}</button>
        </div>

        {/* Fill a draft */}
        <div className="rounded-xl bg-bg-tertiary/50 p-4">
          <div className="text-sm font-medium text-white mb-2">2 · Fill a draft</div>
          <label className="text-xs text-text-muted">League ID</label>
          <input value={leagueId} onChange={(e) => setLeagueId(e.target.value)} placeholder="2024-fast-draft-41" className={`${input} mt-1 mb-2`} />
          <div className="flex gap-2 mb-3">
            <div className="flex-1">
              <label className="text-xs text-text-muted">Bots</label>
              <input type="number" min={1} max={10} value={fillCount} onChange={(e) => setFillCount(Number(e.target.value))} className={`${input} mt-1`} />
            </div>
            <div className="flex-1">
              <label className="text-xs text-text-muted">Speed</label>
              <select value={speed} onChange={(e) => setSpeed(e.target.value as 'fast' | 'slow')} className={`${input} mt-1`}>
                <option value="fast">fast</option>
                <option value="slow">slow</option>
              </select>
            </div>
          </div>
          <button onClick={fill} disabled={busy === 'fill'} className={btn}>{busy === 'fill' ? 'Filling…' : 'Add bots to draft'}</button>
        </div>
      </div>

      {/* Registry */}
      <div className="mt-4">
        <button onClick={list} disabled={busy === 'list'} className="text-xs text-banana hover:underline">
          {busy === 'list' ? 'Loading…' : 'View bot registry (for prize exclusion)'}
        </button>
        {bots && (
          <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-white/10 bg-bg-tertiary/40 p-3 text-xs font-mono text-text-secondary">
            {bots.length === 0 && <div>No bots minted yet.</div>}
            {bots.map((b) => (
              <div key={b.address} className="py-0.5">
                {b.address} · tokens [{b.tokenIds.join(', ')}]
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Bot Brain tuning ─────────────────────────────────────────── */}
      <div className="mt-5 rounded-xl bg-bg-tertiary/50 p-4">
        <div className="flex items-center justify-between mb-1">
          <div className="text-sm font-medium text-white">3 · Bot Brain (how bots pick)</div>
          {!brain && (
            <button onClick={loadBrain} disabled={busy === 'brain-load'} className="text-xs text-banana hover:underline">
              {busy === 'brain-load' ? 'Loading…' : 'Open tuner'}
            </button>
          )}
        </div>
        <p className="text-xs text-text-muted mb-3">
          Bots wait a random delay, then pick near the top of ADP with variance and roster caps.
          Saves apply from the very next bot pick — no deploy. Simulate to preview the teams these
          dials build before saving.
        </p>

        {brain && (
          <>
            <label className="flex items-center gap-2 mb-3 text-sm text-white">
              <input
                type="checkbox"
                checked={brain.enabled}
                onChange={(e) => setBrain({ ...brain, enabled: e.target.checked })}
              />
              Brain enabled (off = bots fall back to the end-of-timer autopilot)
            </label>

            <div className="mb-3 rounded-lg bg-bg-tertiary/60 border border-white/5 px-3 py-2 text-xs text-text-secondary leading-relaxed">
              Built-in behavior: picks land 10–30s into the clock (30–90s in slow drafts), near the
              top of ADP but not always #1. Every bot draws its own team plan per draft — 2–3 QB,
              3–4 RB1, 3–4 WR1, 2–3 TE, 2–3 DST, at most one WR2 (sometimes an RB2, never before
              2 starters) — so no two bot teams look alike.
            </div>

            <div className="flex gap-2">
              <button onClick={saveBrain} disabled={busy === 'brain-save'} className={btn}>
                {busy === 'brain-save' ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={simulate}
                disabled={busy === 'brain-sim'}
                className="rounded-lg bg-bg-tertiary border border-banana/40 text-banana font-semibold px-4 py-2 text-sm disabled:opacity-50"
              >
                {busy === 'brain-sim' ? 'Simulating…' : 'Simulate a draft'}
              </button>
            </div>

            {simTeams && (
              <div className="mt-3 max-h-80 overflow-auto rounded-lg border border-white/10 bg-bg-tertiary/40 p-3 text-xs text-text-secondary space-y-2">
                <div className="text-white/70">Full 15-round draft with these dials — every seat&apos;s team:</div>
                {simTeams.map((t) => (
                  <div key={t.seat}>
                    <span className="text-banana font-medium">Seat {t.seat}</span>
                    <span className="ml-2 text-white/50">
                      ({Object.entries(t.counts).map(([p, n]) => `${n}${p}`).join(' ')})
                    </span>
                    <div className="font-mono text-[11px] text-text-muted break-words">{t.picks.join(', ')}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
