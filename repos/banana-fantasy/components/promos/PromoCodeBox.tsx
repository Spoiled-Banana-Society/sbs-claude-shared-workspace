'use client';

// Promo code entry (lib/promoCode.ts). Ships dark: renders NOTHING unless
// /api/promo-code/status says a code is live, so pre-launch nobody sees a box.
// Never displays the code itself — the user types what the post told them.
// States: logged out → "log in to apply"; eligible → input + Apply; redeemed →
// applied badge (spins pending on the X verify claim, or already credited).

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { clientLog } from '@/lib/clientLog';

interface Status {
  active: boolean;
  endsAtMs?: number;
  spins?: number;
  redeemed?: boolean;
  granted?: boolean;
  eligible?: boolean;
}

export function PromoCodeBox({ compact = false }: { compact?: boolean }) {
  const { user, isLoggedIn, setShowLoginModal, refreshBalance } = useAuth();
  const wallet = user?.walletAddress?.toLowerCase() ?? '';
  const [status, setStatus] = useState<Status | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // One fetch per wallet change — no polling, no self-refresh loop.
  useEffect(() => {
    let alive = true;
    const q = wallet ? `?wallet=${wallet}` : '';
    fetch(`/api/promo-code/status${q}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Status | null) => { if (alive && d) setStatus(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, [wallet]);

  const apply = useCallback(async () => {
    if (!isLoggedIn || !wallet) { setShowLoginModal(true); return; }
    const c = code.trim();
    if (!c) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/promo-code/redeem', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: wallet, code: c }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg({ kind: 'err', text: (d as { error?: string }).error || 'That code did not work' });
        clientLog('promo', 'promo_code_rejected', { code: c, status: r.status });
        return;
      }
      const res = d as { spins: number; spinsNow: number; spinsOnClaim: number };
      clientLog('promo', 'promo_code_applied', { code: c, ...res });
      setStatus((s) => ({ ...(s ?? { active: true }), redeemed: true, granted: res.spinsNow > 0, spins: res.spins }));
      setMsg({
        kind: 'ok',
        text: res.spinsNow > 0
          ? `Code applied. ${res.spinsNow} more Free Spins added to your wheel.`
          : `Code applied. Verify with X below and your Free Spin becomes ${res.spins} Free Spins.`,
      });
      if (res.spinsNow > 0) void refreshBalance?.();
    } catch {
      setMsg({ kind: 'err', text: 'Something went wrong, try again' });
    } finally {
      setBusy(false);
    }
  }, [code, isLoggedIn, wallet, setShowLoginModal, refreshBalance]);

  if (!status) return null;
  const redeemed = status.redeemed === true;
  if (!status.active && !redeemed) return null;
  if (status.active && !redeemed && isLoggedIn && status.eligible === false) return null;

  const spins = status.spins ?? 4;
  const pad = compact ? 'px-3 py-2.5' : 'px-4 py-3.5';

  if (redeemed) {
    return (
      <div className={`rounded-2xl border border-banana/40 bg-banana/[.07] ${pad} text-white`}>
        <p className="text-[13px] font-extrabold">
          🍌 Promo code applied: <span className="text-banana">{spins} Free Spins</span>
        </p>
        <p className="mt-0.5 text-[12px] text-white/75">
          {status.granted
            ? 'Your spins are on the Banana Wheel. Every spin pays at least 1 Free Draft.'
            : 'Verify with X on the New Player card and claim. Every spin pays at least 1 Free Draft.'}
        </p>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border border-white/[.14] bg-white/[.04] ${pad} text-white`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-[13px] font-extrabold">Have a promo code?</p>
          <p className="text-[12px] text-white/70">New players: enter it here for {spins} Free Spins.</p>
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); void apply(); }}
        >
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="CODE"
            maxLength={20}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="w-[128px] rounded-full bg-black/40 border border-white/20 px-3.5 py-2 text-[13px] font-bold tracking-[2px] text-white placeholder:text-white/30 placeholder:tracking-[2px] focus:outline-none focus:border-banana"
          />
          <button
            type="submit"
            disabled={busy || (isLoggedIn && !code.trim())}
            className="rounded-full bg-banana px-4 py-2 text-[12px] font-extrabold text-black disabled:opacity-50 hover:-translate-y-px active:scale-[.97] transition-transform"
          >
            {!isLoggedIn ? 'Log in to apply' : busy ? 'Applying…' : 'Apply'}
          </button>
        </form>
      </div>
      {msg && (
        <p className={`mt-2 text-[12px] font-semibold ${msg.kind === 'ok' ? 'text-banana' : 'text-red-400'}`}>{msg.text}</p>
      )}
    </div>
  );
}
