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

type BotRow = { address: string; tokenIds: string[]; passType: string; mintTxHash: string | null };

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
        body: JSON.stringify({ leagueId: leagueId.trim(), count: fillCount, speed }),
      }),
    );
    if (body) setMsg(`Added ${body.go?.botsAdded ?? body.attempted} bot(s) to ${body.leagueId}.`);
  };

  const list = async () => {
    const headers = await getHeaders();
    const body = await call('list', () => fetch('/api/admin/bots', { headers }));
    if (body) { setBots(body.bots || []); setMsg(`${body.count} bot wallet(s) in the pool.`); }
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
    </div>
  );
}
