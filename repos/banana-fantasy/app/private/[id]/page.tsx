'use client';

/**
 * /private/[id] — password-gated PRIVATE league page (ticket-3338 groups,
 * e.g. KFFL). This URL is handed out by the group's commissioner and is the
 * ONLY surface that knows private leagues exist: nothing on the public site
 * links here, and every fetch behind it requires the league password
 * (checked server-side in the Go API — the password never rides a URL).
 *
 * The join button rides useEnterDraft (the single battle-tested entry flow:
 * join-first, branded overlay, retries, bookkeeping, /draft-room navigation)
 * with a privateLeague target, so a private seat behaves exactly like a
 * public one from the moment it's taken.
 *
 * Paid passes only — the group buys passes from the site like everyone else.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { usePrivy } from '@privy-io/react-auth';
import { useEnterDraft } from '@/hooks/useEnterDraft';
import { JoiningLobbyOverlay } from '@/components/drafting/JoiningLobbyOverlay';
import { getPrivateLeagueInfo, type PrivateLeagueInfo } from '@/lib/api/leagues';
import { setActivePrivateLeague, clearActivePrivateLeague } from '@/lib/privateLeagueSession';
import { ApiError } from '@/lib/api/client';

const POLL_MS = 15_000;
const pwStorageKey = (id: string) => `sbs-private-pw:${id}`;

function levelChip(level: string) {
  const l = (level || '').toLowerCase();
  if (l === 'jackpot') return { label: 'Jackpot', cls: 'text-jackpot border-jackpot/40 bg-jackpot/10' };
  if (l === 'hall of fame') return { label: 'HOF', cls: 'text-hof border-hof/40 bg-hof/10' };
  if (l === 'jackhof') return { label: 'JackHOF', cls: 'text-hof border-jackpot/40 bg-jackpot/10' };
  return { label: 'Pro', cls: 'text-pro border-pro/40 bg-pro/10' };
}

function shortHash(h: string) {
  return h.length > 18 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h;
}

export default function PrivateLeaguePage() {
  const params = useParams<{ id: string }>();
  const privateId = String(params?.id ?? '').toLowerCase();

  const { user } = useAuth();
  const { ready: privyReady, authenticated: privyAuthed, getAccessToken } = usePrivy();
  const getAccessTokenRef = useRef(getAccessToken);
  useEffect(() => { getAccessTokenRef.current = getAccessToken; }, [getAccessToken]);
  const { joiningLobby, joinError, clearJoinError, enterDraftWithPassType } = useEnterDraft();
  // Commissioner? (league AdminWallets or SBS site admin) → show the admin
  // link. Tjbonitz "lost" the admin page 8/15 because it was linked nowhere.
  const [isCommissioner, setIsCommissioner] = useState(false);

  // '' = not yet authed. Only a password the server ACCEPTED lands here.
  const [authedPassword, setAuthedPassword] = useState('');
  const [pwInput, setPwInput] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [booting, setBooting] = useState(true); // trying a stored password on mount
  const [info, setInfo] = useState<PrivateLeagueInfo | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  // One auth/refresh routine, stashed in a ref so the poll effect keeps
  // scalar-only deps (Rule #0 — no fetch-bearing effect may depend on an
  // unstable callback identity).
  const tryPassword = useCallback(async (pw: string, opts?: { silent?: boolean }) => {
    if (!privateId || !pw) return false;
    try {
      const data = await getPrivateLeagueInfo(privateId, pw);
      setInfo(data);
      setAuthedPassword(pw);
      setPwError(null);
      try { localStorage.setItem(pwStorageKey(privateId), pw); } catch { /* private mode */ }
      // Remember this league as the member's join target: from here on, every
      // "Enter Draft" anywhere on the site routes into it (with a visible
      // public escape hatch in the entry modal). See lib/privateLeagueSession.
      setActivePrivateLeague({
        id: privateId,
        name: data.name || 'Private league',
        draftType: data.draftType === 'slow' ? 'slow' : data.draftType === 'both' ? 'both' : 'fast',
      });
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        if (!opts?.silent) setPwError('Incorrect password.');
        // A stored password that stopped working must not keep auto-retrying.
        try { localStorage.removeItem(pwStorageKey(privateId)); } catch { /* ignore */ }
        clearActivePrivateLeague();
        setAuthedPassword('');
      } else if (err instanceof ApiError && err.status === 404) {
        if (!opts?.silent) setPwError('This league does not exist. Check the link with your commissioner.');
      } else if (!opts?.silent) {
        setPwError('Could not reach the league right now — try again in a moment.');
      }
      return false;
    }
  }, [privateId]);
  const tryPasswordRef = useRef(tryPassword);
  useEffect(() => { tryPasswordRef.current = tryPassword; }, [tryPassword]);

  // One cheap auth-only probe per (login, league). Scalar deps only (Rule #0);
  // the token getter lives in a ref. A 401/403 is the normal "not you" answer.
  useEffect(() => {
    if (!privyReady || !privyAuthed || !privateId) { setIsCommissioner(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessTokenRef.current();
        if (!token) return;
        const res = await fetch(`/api/private-league/${privateId}/admin?probe=1`, {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!cancelled) setIsCommissioner(res.ok);
      } catch { /* not a commissioner as far as this page can tell */ }
    })();
    return () => { cancelled = true; };
  }, [privyReady, privyAuthed, privateId]);

  // Auto-unlock with a stored password.
  useEffect(() => {
    if (!privateId) { setBooting(false); return; }
    let stored = '';
    try { stored = localStorage.getItem(pwStorageKey(privateId)) ?? ''; } catch { /* ignore */ }
    if (!stored) { setBooting(false); return; }
    void tryPasswordRef.current(stored, { silent: true }).finally(() => setBooting(false));
  }, [privateId]);

  // Refresh the fill state while unlocked. Scalar deps only.
  const authed = authedPassword !== '';
  useEffect(() => {
    if (!authed) return;
    const id = setInterval(() => { void tryPasswordRef.current(authedPassword, { silent: true }); }, POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- authedPassword is the scalar gate; the routine lives in a ref
  }, [authed, authedPassword, privateId]);

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pwInput.trim() || checking) return;
    setChecking(true);
    await tryPassword(pwInput);
    setChecking(false);
  };

  const paidPasses = user?.draftPasses ?? 0;
  const freePasses = user?.freeDrafts ?? 0;
  // Lanes this league offers. 'both' (8/15) = a fast lane AND a slow lane,
  // each with its own filling draft; older backends only send draftType.
  const lanes: Array<'fast' | 'slow'> = info?.lanes && info.lanes.length > 0
    ? info.lanes
    : info?.draftType === 'both' ? ['fast', 'slow'] : [info?.draftType === 'slow' ? 'slow' : 'fast'];
  const currentDraftFor = (lane: 'fast' | 'slow') =>
    info?.currentDrafts?.[lane] ?? (lane === lanes[0] ? info?.currentDraft : undefined) ?? null;
  const alreadySeated = false; // server rejects a dupe seat with a clear message

  // Paid or free both seat you — the password is the gate (Richard 8/15).
  const handleJoin = (passType: 'paid' | 'free', lane: 'fast' | 'slow') => {
    if (!info || !authedPassword) return;
    void enterDraftWithPassType(passType, lane, { id: privateId, password: authedPassword });
  };

  const copyHash = (hash: string) => {
    try { void navigator.clipboard.writeText(hash); } catch { /* ignore */ }
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash((h) => (h === hash ? null : h)), 1500);
  };

  // ——— Locked ———
  if (!authed) {
    return (
      <main className="min-h-screen bg-[#0a0a0f] flex items-center justify-center px-4">
        <div className="glass-card w-full max-w-sm rounded-2xl border border-white/10 p-8 text-center">
          <div className="text-4xl mb-4 select-none" aria-hidden="true">🔒</div>
          <h1 className="text-white text-xl font-semibold mb-1">Private League</h1>
          <p className="text-white/50 text-sm mb-6">
            {booting ? 'Checking your access…' : 'Enter the league password from your commissioner.'}
          </p>
          {!booting && (
            <form onSubmit={submitPassword} className="space-y-3">
              <input
                type="password"
                autoComplete="off"
                value={pwInput}
                onChange={(e) => { setPwInput(e.target.value); setPwError(null); }}
                placeholder="League password"
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-white text-center placeholder:text-white/30 focus:outline-none focus:border-[#fbbf24]/60"
              />
              {pwError && <p className="text-red-400 text-xs">{pwError}</p>}
              <button
                type="submit"
                disabled={checking || !pwInput.trim()}
                className="w-full rounded-xl bg-[#fbbf24] text-black font-semibold py-3 disabled:opacity-40 transition-opacity"
              >
                {checking ? 'Checking…' : 'Continue'}
              </button>
            </form>
          )}
        </div>
      </main>
    );
  }

  // ——— Unlocked ———
  const laneLabel = (lane: 'fast' | 'slow') =>
    lane === 'slow' ? 'Slow draft · 8h per pick' : 'Fast draft · 30s per pick · ~30 min';

  return (
    <main className="min-h-screen bg-[#0a0a0f] px-4 pt-10 pb-24">
      <JoiningLobbyOverlay show={joiningLobby} error={joinError} onDismiss={clearJoinError} />
      <div className="max-w-lg mx-auto space-y-6">
        <header>
          <p className="text-[#fbbf24] text-[11px] font-semibold tracking-[0.2em] uppercase mb-1">Private League</p>
          <h1 className="text-white text-3xl font-bold">{info?.name}</h1>
          <p className="text-white/40 text-sm mt-1">
            {lanes.length > 1 ? 'Fast and slow drafts' : lanes[0] === 'slow' ? 'Slow drafts · 8h per pick' : 'Fast drafts · 30s per pick · ~30 min'} · 10 seats
            {info ? ` · ${info.draftsFilled} drafted` : ''}
          </p>
          {isCommissioner && (
            <Link
              href={`/private/${privateId}/admin`}
              className="inline-flex items-center gap-1.5 mt-3 rounded-lg border border-[#fbbf24]/40 bg-[#fbbf24]/10 px-3 py-1.5 text-[#fbbf24] text-xs font-semibold hover:bg-[#fbbf24]/20 transition-colors"
            >
              Commissioner tools →
            </Link>
          )}
        </header>

        {/* Current draft + join — one card per lane */}
        {lanes.map((lane) => {
          const cur = currentDraftFor(lane);
          const seats = cur?.numPlayers ?? 0;
          const fillPct = Math.min(100, Math.max(0, (seats / 10) * 100));
          const currentName = cur?.displayName || (lanes.length > 1 ? `${info?.name ?? 'Next'} · ${lane === 'slow' ? 'Slow' : 'Fast'}` : info?.name || 'Next draft');
          return (
            <section key={lane} className="glass-card rounded-2xl border border-white/10 p-5">
              <div className="flex items-baseline justify-between mb-1">
                <h2 className="text-white font-semibold">{currentName}</h2>
                <span className="text-white/60 text-sm tabular-nums">{seats}/10 seats</span>
              </div>
              <p className={`text-xs mb-3 ${lane === 'slow' ? 'text-blue-300/80' : 'text-yellow-300/80'}`}>{laneLabel(lane)}</p>
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden mb-5">
                <div className="h-full rounded-full bg-white" style={{ width: `${fillPct}%` }} />
              </div>
              {!user?.walletAddress ? (
                <p className="text-white/50 text-sm text-center">Log in to take a seat.</p>
              ) : user.draftBlocked ? (
                <p className="text-white/50 text-sm text-center">Drafting is disabled on this account.</p>
              ) : paidPasses > 0 || freePasses > 0 ? (
                <div className="space-y-2">
                  {paidPasses > 0 && (
                    <button
                      onClick={() => handleJoin('paid', lane)}
                      disabled={joiningLobby || alreadySeated}
                      className="w-full rounded-xl bg-[#fbbf24] text-black font-semibold py-3 disabled:opacity-40 transition-opacity"
                    >
                      Enter with a Draft Pass · {paidPasses} available
                    </button>
                  )}
                  {freePasses > 0 && (
                    <button
                      onClick={() => handleJoin('free', lane)}
                      disabled={joiningLobby || alreadySeated}
                      className={`w-full rounded-xl font-semibold py-3 disabled:opacity-40 transition-opacity ${
                        paidPasses > 0
                          ? 'border border-green-500/50 text-green-400'
                          : 'bg-[#fbbf24] text-black'
                      }`}
                    >
                      Enter with a Free Draft Pass · {freePasses} available
                    </button>
                  )}
                </div>
              ) : (
                <Link
                  href="/buy-drafts"
                  className="block w-full rounded-xl border border-[#fbbf24]/50 text-[#fbbf24] text-center font-semibold py-3"
                >
                  Get a Draft Pass to enter
                </Link>
              )}
              <p className="text-white/35 text-xs text-center mt-3">
                The draft starts the moment the 10th seat fills.
              </p>
            </section>
          );
        })}

        {/* League drafts */}
        {info && info.drafts.length > 0 && (
          <section className="glass-card rounded-2xl border border-white/10 p-5">
            <h2 className="text-white font-semibold mb-3">League drafts</h2>
            <ul className="divide-y divide-white/5">
              {[...info.drafts]
                .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { numeric: true }))
                .map((d) => {
                  const chip = levelChip(d.level);
                  return (
                    <li key={d.draftId} className="flex items-center justify-between py-2.5">
                      <span className="text-white/85 text-sm">
                        {d.displayName}
                        {lanes.length > 1 && d.draftType && (
                          <span className={`ml-2 text-[10px] uppercase tracking-wide ${d.draftType === 'slow' ? 'text-blue-300/70' : 'text-yellow-300/70'}`}>{d.draftType}</span>
                        )}
                      </span>
                      <span className="flex items-center gap-2">
                        {d.filled ? (
                          <span className={`text-[11px] px-2 py-0.5 rounded-full border ${chip.cls}`}>{chip.label}</span>
                        ) : (
                          <span className="text-white/45 text-xs tabular-nums">{d.numPlayers}/10 filling</span>
                        )}
                      </span>
                    </li>
                  );
                })}
            </ul>
          </section>
        )}

        {/* Provably fair */}
        {info && (
          <section className="glass-card rounded-2xl border border-white/10 p-5">
            <h2 className="text-white font-semibold mb-1">Provably fair</h2>
            <p className="text-white/50 text-xs leading-relaxed mb-4">
              Your league runs its own batch of {info.batchSize} drafts with {info.jackpotPer100}{' '}
              <span className="text-jackpot">Jackpot</span> and {info.hofPer100}{' '}
              <span className="text-hof">HOF</span> draft positions, fixed before the first draft fills.
              The commitment below is the SHA-256 hash of the secret that decides those positions — published
              up front so they can&apos;t be moved. When a batch completes, the secret is revealed here and
              anyone can re-derive the positions and check the hash.
            </p>
            {info.batches.length === 0 ? (
              <p className="text-white/40 text-xs">The commitment appears when your first draft fills.</p>
            ) : (
              <ul className="space-y-3">
                {info.batches
                  .sort((a, b) => a.batch - b.batch)
                  .map((b) => (
                    <li key={b.batch} className="rounded-xl bg-white/[0.03] border border-white/5 p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-white/80 text-sm font-medium">Batch {b.batch}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${b.revealed ? 'text-emerald-400 border-emerald-400/40 bg-emerald-400/10' : 'text-white/50 border-white/15 bg-white/5'}`}>
                          {b.revealed ? 'Revealed' : 'Sealed'}
                        </span>
                      </div>
                      <button
                        onClick={() => copyHash(b.commitHash)}
                        className="font-mono text-[11px] text-white/55 hover:text-white/85 transition-colors break-all text-left"
                        title="Copy commitment hash"
                      >
                        {copiedHash === b.commitHash ? 'Copied ✓' : shortHash(b.commitHash)}
                      </button>
                      {b.revealed && (
                        <div className="mt-2 pt-2 border-t border-white/5 space-y-1">
                          <p className="font-mono text-[11px] text-white/55 break-all">secret: {b.saltHex}</p>
                          <p className="text-xs text-white/60">
                            {/* Go reveals positions WITHIN the batch (1..100); convert to
                                absolute draft numbers so they match the "#N" draft names
                                for batch 2+ as well. */}
                            <span className="text-jackpot">Jackpot</span> at draft{' '}
                            {(b.batch - 1) * info.batchSize + (b.jackpotPosition ?? 0)} ·{' '}
                            <span className="text-hof">HOF</span> at{' '}
                            {b.hofPositions?.map((p) => (b.batch - 1) * info.batchSize + p).join(', ')}
                          </p>
                        </div>
                      )}
                    </li>
                  ))}
              </ul>
            )}
          </section>
        )}

        <p className="text-white/25 text-[11px] text-center">
          This page is private — only people with this link and the password can see it.
        </p>
      </div>
    </main>
  );
}
