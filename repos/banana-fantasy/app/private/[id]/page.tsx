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
import { useEnterDraft } from '@/hooks/useEnterDraft';
import { JoiningLobbyOverlay } from '@/components/drafting/JoiningLobbyOverlay';
import { getPrivateLeagueInfo, type PrivateLeagueInfo } from '@/lib/api/leagues';
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
  const { joiningLobby, joinError, clearJoinError, enterDraftWithPassType } = useEnterDraft();

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
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        if (!opts?.silent) setPwError('Incorrect password.');
        // A stored password that stopped working must not keep auto-retrying.
        try { localStorage.removeItem(pwStorageKey(privateId)); } catch { /* ignore */ }
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
  const speed = (info?.draftType === 'slow' ? 'slow' : 'fast') as 'fast' | 'slow';
  const seats = info?.currentDraft?.numPlayers ?? 0;
  const alreadySeated = false; // server rejects a dupe seat with a clear message

  const handleJoin = () => {
    if (!info || !authedPassword) return;
    void enterDraftWithPassType('paid', speed, { id: privateId, password: authedPassword });
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
  const currentName = info?.currentDraft?.displayName || info?.name || 'Next draft';
  const fillPct = Math.min(100, Math.max(0, (seats / 10) * 100));

  return (
    <main className="min-h-screen bg-[#0a0a0f] px-4 pt-10 pb-24">
      <JoiningLobbyOverlay show={joiningLobby} error={joinError} onDismiss={clearJoinError} />
      <div className="max-w-lg mx-auto space-y-6">
        <header>
          <p className="text-[#fbbf24] text-[11px] font-semibold tracking-[0.2em] uppercase mb-1">Private League</p>
          <h1 className="text-white text-3xl font-bold">{info?.name}</h1>
          <p className="text-white/40 text-sm mt-1">
            {speed === 'fast' ? 'Fast drafts · 30s per pick · ~30 min' : 'Slow drafts · 8h per pick'} · 10 seats
            {info ? ` · ${info.draftsFilled} drafted` : ''}
          </p>
        </header>

        {/* Current draft + join */}
        <section className="glass-card rounded-2xl border border-white/10 p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-white font-semibold">{currentName}</h2>
            <span className="text-white/60 text-sm tabular-nums">{seats}/10 seats</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden mb-5">
            <div className="h-full rounded-full bg-white" style={{ width: `${fillPct}%` }} />
          </div>
          {!user?.walletAddress ? (
            <p className="text-white/50 text-sm text-center">Log in to take a seat.</p>
          ) : paidPasses > 0 ? (
            <button
              onClick={handleJoin}
              disabled={joiningLobby || alreadySeated}
              className="w-full rounded-xl bg-[#fbbf24] text-black font-semibold py-3 disabled:opacity-40 transition-opacity"
            >
              Enter with a Draft Pass · {paidPasses} available
            </button>
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
                      <span className="text-white/85 text-sm">{d.displayName}</span>
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
                            <span className="text-jackpot">Jackpot</span> at draft {b.jackpotPosition} ·{' '}
                            <span className="text-hof">HOF</span> at {b.hofPositions?.join(', ')}
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
