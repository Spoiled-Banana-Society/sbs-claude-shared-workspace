'use client';

/**
 * /private/[id]/admin — commissioner view for ONE private league
 * (ticket-3338, KFFL). Server-gated: /api/private-league/[id]/admin only
 * answers for wallets on the league config's AdminWallets list (or SBS site
 * admins). The page itself holds no secrets — a stranger loading it gets a
 * 403 and an access message, nothing else.
 *
 * Rule #0: the fetch effect refs getAccessToken (Privy hook identity churns
 * per render) and keeps scalar-only deps.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';

interface MemberRow {
  wallet: string;
  name: string | null;
  used: number;
  allowed: number;
}
interface SeatRow {
  wallet: string;
  name: string | null;
  tokenId: string;
}
interface DraftRow {
  draftId: string;
  label: string;
  numPlayers: number;
  filled: boolean;
  seats: SeatRow[];
}
interface AdminView {
  id: string;
  name: string;
  draftType: 'fast' | 'slow';
  defaultEntries: number;
  members: MemberRow[];
  drafts: DraftRow[];
  viewer: { wallet: string; siteAdmin: boolean };
}

const shortWallet = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;
const memberLabel = (m: { wallet: string; name: string | null }) => m.name ?? shortWallet(m.wallet);

export default function PrivateLeagueAdminPage() {
  const params = useParams<{ id: string }>();
  const leagueId = String(params?.id ?? '').toLowerCase();

  const { ready, authenticated, login, getAccessToken } = usePrivy();
  const getAccessTokenRef = useRef(getAccessToken);
  useEffect(() => { getAccessTokenRef.current = getAccessToken; }, [getAccessToken]);

  const [view, setView] = useState<AdminView | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyWallet, setBusyWallet] = useState<string | null>(null);
  const [addWallet, setAddWallet] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [newPw, setNewPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!leagueId) return;
    try {
      const token = await getAccessTokenRef.current();
      const res = await fetch(`/api/private-league/${leagueId}/admin`, {
        cache: 'no-store',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (res.status === 401 || res.status === 403) { setDenied(true); setView(null); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDenied(false);
      setError(null);
      setView((await res.json()) as AdminView);
    } catch {
      setError('Could not load the league right now — try again in a moment.');
    } finally {
      setLoading(false);
    }
  }, [leagueId]);
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) { setLoading(false); return; }
    setLoading(true);
    void loadRef.current();
  }, [ready, authenticated, leagueId]);

  const bump = async (wallet: string, delta: 1 | -1) => {
    if (busyWallet) return;
    setBusyWallet(wallet);
    setAddError(null);
    try {
      const token = await getAccessTokenRef.current();
      const res = await fetch(`/api/private-league/${leagueId}/admin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ wallet, delta }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setAddError(typeof data?.error === 'string' ? data.error : 'Could not update entries — try again.');
        return;
      }
      setView(data as AdminView);
      setAddWallet('');
    } catch {
      setAddError('Could not update entries — try again.');
    } finally {
      setBusyWallet(null);
    }
  };

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const pw = newPw.trim();
    if (pw.length < 6 || pwBusy) {
      setPwMsg({ ok: false, text: 'Password must be at least 6 characters.' });
      return;
    }
    setPwBusy(true);
    setPwMsg(null);
    try {
      const token = await getAccessTokenRef.current();
      const res = await fetch(`/api/private-league/${leagueId}/admin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ action: 'setPassword', newPassword: pw }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setPwMsg({ ok: false, text: typeof data?.error === 'string' ? data.error : 'Could not change the password — try again.' });
        return;
      }
      setNewPw('');
      setPwMsg({ ok: true, text: 'Password changed. Share the new one with your members — they enter it next time they open the league page.' });
    } catch {
      setPwMsg({ ok: false, text: 'Could not change the password — try again.' });
    } finally {
      setPwBusy(false);
    }
  };

  const submitAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const w = addWallet.trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(w)) {
      setAddError('Enter a full wallet address (0x…, 42 characters).');
      return;
    }
    void bump(w, 1);
  };

  const card = 'glass-card rounded-2xl border border-white/10 p-5';

  let body: React.ReactNode;
  if (!ready || loading) {
    body = <p className="text-white/50 text-sm text-center py-16">Loading…</p>;
  } else if (!authenticated) {
    body = (
      <div className={`${card} text-center`}>
        <p className="text-white/70 text-sm mb-4">Log in with your commissioner wallet to manage this league.</p>
        <button onClick={login} className="rounded-xl bg-[#fbbf24] text-black font-semibold px-6 py-3">Log in</button>
      </div>
    );
  } else if (denied) {
    body = (
      <div className={`${card} text-center`}>
        <div className="text-4xl mb-3 select-none" aria-hidden="true">🔒</div>
        <p className="text-white/70 text-sm">
          This wallet doesn&apos;t have commissioner access to this league. Make sure you&apos;re logged in with
          the wallet you gave SBS.
        </p>
      </div>
    );
  } else if (error || !view) {
    body = <p className="text-red-400 text-sm text-center py-16">{error ?? 'Something went wrong.'}</p>;
  } else {
    body = (
      <>
        {/* Members & entries */}
        <section className={card}>
          <div className="flex items-baseline justify-between mb-1">
            <h2 className="text-white font-semibold">Members &amp; entries</h2>
            <span className="text-white/40 text-xs">{view.defaultEntries} entry each by default</span>
          </div>
          <p className="text-white/40 text-xs mb-4">
            When someone pays you for another entry, hit +1 next to them. They&apos;ll be able to take one more
            seat with their own draft pass.
          </p>
          {view.members.length === 0 ? (
            <p className="text-white/40 text-sm py-4 text-center">No one has joined yet.</p>
          ) : (
            <ul className="divide-y divide-white/5">
              {view.members.map((m) => (
                <li key={m.wallet} className="flex items-center justify-between py-2.5 gap-3">
                  <div className="min-w-0">
                    <p className="text-white/85 text-sm truncate">{memberLabel(m)}</p>
                    <p className="text-white/35 text-[11px] font-mono">{shortWallet(m.wallet)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs tabular-nums ${m.used >= m.allowed ? 'text-white/80' : 'text-white/50'}`}>
                      {m.used} used / {m.allowed} allowed
                    </span>
                    <button
                      onClick={() => void bump(m.wallet, -1)}
                      disabled={busyWallet !== null || m.allowed <= 0}
                      className="w-8 h-8 rounded-lg border border-white/15 text-white/70 disabled:opacity-30"
                      aria-label={`Remove an entry from ${memberLabel(m)}`}
                    >
                      −
                    </button>
                    <button
                      onClick={() => void bump(m.wallet, 1)}
                      disabled={busyWallet !== null}
                      className="w-8 h-8 rounded-lg bg-[#fbbf24] text-black font-semibold disabled:opacity-40"
                      aria-label={`Add an entry for ${memberLabel(m)}`}
                    >
                      +
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={submitAdd} className="mt-4 pt-4 border-t border-white/5 flex gap-2">
            <input
              value={addWallet}
              onChange={(e) => { setAddWallet(e.target.value); setAddError(null); }}
              placeholder="0x… wallet — grant an extra entry before they join"
              className="flex-1 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-white text-sm font-mono placeholder:text-white/25 placeholder:font-sans focus:outline-none focus:border-[#fbbf24]/60"
            />
            <button
              type="submit"
              disabled={busyWallet !== null || !addWallet.trim()}
              className="rounded-xl bg-white/10 text-white text-sm font-semibold px-4 disabled:opacity-40"
            >
              +1 entry
            </button>
          </form>
          {addError && <p className="text-red-400 text-xs mt-2">{addError}</p>}
        </section>

        {/* Leagues */}
        <section className={card}>
          <h2 className="text-white font-semibold mb-3">Leagues</h2>
          {view.drafts.length === 0 ? (
            <p className="text-white/40 text-sm py-4 text-center">
              The first league appears when someone takes a seat.
            </p>
          ) : (
            <ul className="space-y-4">
              {view.drafts.map((d) => (
                <li key={d.draftId} className="rounded-xl bg-white/[0.03] border border-white/5 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-white/90 text-sm font-medium">{d.label}</span>
                    <span className="text-white/50 text-xs tabular-nums">
                      {d.filled ? 'Drafted' : `${d.numPlayers}/10 filling`}
                    </span>
                  </div>
                  {d.seats.length > 0 && (
                    <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
                      {d.seats.map((s) => (
                        <li key={`${d.draftId}-${s.tokenId}`} className="text-white/60 text-xs truncate">
                          {memberLabel(s)}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        {/* League password */}
        <section className={card}>
          <h2 className="text-white font-semibold mb-1">League password</h2>
          <p className="text-white/40 text-xs mb-4">
            If the password gets out, change it here. Seats already taken are unaffected — members just
            enter the new password the next time they open the league page to join another draft.
          </p>
          <form onSubmit={submitPassword} className="flex gap-2">
            <input
              type="text"
              autoComplete="off"
              value={newPw}
              onChange={(e) => { setNewPw(e.target.value); setPwMsg(null); }}
              placeholder="New league password"
              className="flex-1 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-[#fbbf24]/60"
            />
            <button
              type="submit"
              disabled={pwBusy || newPw.trim().length < 6}
              className="rounded-xl bg-white/10 text-white text-sm font-semibold px-4 disabled:opacity-40"
            >
              {pwBusy ? 'Saving…' : 'Change'}
            </button>
          </form>
          {pwMsg && (
            <p className={`text-xs mt-2 ${pwMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{pwMsg.text}</p>
          )}
        </section>
      </>
    );
  }

  return (
    <main className="min-h-screen bg-[#0a0a0f] px-4 pt-10 pb-24">
      <div className="max-w-lg mx-auto space-y-6">
        <header>
          <p className="text-[#fbbf24] text-[11px] font-semibold tracking-[0.2em] uppercase mb-1">
            Commissioner view
          </p>
          <h1 className="text-white text-3xl font-bold">{view?.name ?? 'Private League'}</h1>
          {view && (
            <p className="text-white/40 text-sm mt-1">
              {view.draftType === 'fast' ? 'Fast drafts' : 'Slow drafts'} · members join at{' '}
              <span className="text-white/60">/private/{view.id}</span>
            </p>
          )}
        </header>
        {body}
        <p className="text-white/25 text-[11px] text-center">
          Only this league&apos;s commissioners can see this page.
        </p>
      </div>
    </main>
  );
}
