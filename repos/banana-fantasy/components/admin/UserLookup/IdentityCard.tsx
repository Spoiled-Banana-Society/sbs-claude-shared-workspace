'use client';

/**
 * Identity card: who is this person? Wallet, name, email, signup date,
 * KYC status, banned, balance counters all at a glance.
 */

import type { UserLookupIdentity } from '@/hooks/admin/useUserLookup';

function shortHex(w: string) {
  if (!w) return '—';
  const hex = w.replace(/^0x/i, '');
  return hex.length <= 10 ? `0x${hex}` : `0x${hex.slice(0, 6)}…${hex.slice(-4)}`;
}

function fmtDate(v: string | null) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function timeAgo(v: string | null) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export function IdentityCard({
  identity,
  walletShort,
}: {
  identity: UserLookupIdentity | null;
  walletShort: string;
}) {
  if (!identity) {
    return (
      <div className="rounded-xl border border-gray-700 bg-gray-900/40 p-4 text-sm text-gray-400">
        No user record found for{' '}
        <span className="font-mono text-gray-300">{walletShort}</span>. They may not have
        signed in yet — most counters and notification prefs only exist once a user logs
        in for the first time.
      </div>
    );
  }

  // Prefer the user's chosen displayName (set on the Profile page, lives in
  // the Go owner doc) over the auto-generated username. The Firestore mirror
  // doesn't always carry displayName, so the user-lookup endpoint also fetches
  // it from /owner/{wallet} server-side before responding.
  const name = identity.displayName || identity.username || 'No display name';
  const isPlaceholder = !identity.username && !identity.displayName;
  const kycLabel =
    identity.kycStatus === 'approved'
      ? '✅ KYC approved'
      : identity.kycStatus
        ? `KYC: ${identity.kycStatus}`
        : 'KYC: not started';

  return (
    <section className="rounded-xl border border-gray-700 bg-gray-900/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          {/* PFP from the Go owner profile. Falls back to a 🍌 placeholder
              when the user hasn't set one. Renders a round 48px avatar to
              match the rest of SBS profile chrome. */}
          {identity.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={identity.avatar}
              alt={name}
              className="h-12 w-12 shrink-0 rounded-full border border-white/10 object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/5 text-xl">
              🍌
            </div>
          )}
          <div className="min-w-0">
            <h3
              className={`text-lg font-semibold ${
                isPlaceholder ? 'text-gray-500 italic' : 'text-white'
              }`}
              title={name}
            >
              {name}
              {identity.blueCheckVerified && (
                <span className="ml-2 text-sky-400" title="Blue-check verified">
                  ✓
                </span>
              )}
            </h3>
            <p className="mt-1 font-mono text-xs text-gray-400" title={identity.walletAddress}>
              {shortHex(identity.walletAddress)}
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(identity.walletAddress)}
                className="ml-2 text-gray-500 hover:text-gray-300"
                title="Copy full wallet"
              >
                copy
              </button>
            </p>
            {identity.email && (
              <p className="mt-0.5 text-sm text-gray-300">{identity.email}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          {identity.banned && (
            <span className="rounded-md bg-red-500/15 px-2 py-0.5 font-semibold text-red-300 ring-1 ring-red-500/30">
              BANNED
            </span>
          )}
          <span
            className={`rounded-md px-2 py-0.5 ring-1 ${
              identity.kycStatus === 'approved'
                ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30'
                : 'bg-gray-700/40 text-gray-300 ring-gray-600'
            }`}
          >
            {kycLabel}
          </span>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 md:grid-cols-6">
        <Stat label="Free drafts" value={identity.balance.freeDrafts} highlight />
        <Stat label="Paid passes" value={identity.balance.draftPasses} />
        <Stat label="Wheel spins" value={identity.balance.wheelSpins} />
        <Stat label="JP entries" value={identity.balance.jackpotEntries} />
        <Stat label="HOF entries" value={identity.balance.hofEntries} />
        <Stat label="Card purchases" value={identity.balance.cardPurchaseCount} />
      </dl>

      {/* Account money — credits sitting on the Go side that haven't
          been withdrawn yet. Renders only when there's money in the
          account (avoids visual noise for the typical $0 user). */}
      {(identity.account.availableCreditUsd > 0
        || identity.account.pendingCreditUsd > 0
        || identity.account.numWithdrawalsLifetime > 0) && (
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <Stat
            label="Available credit"
            value={`$${identity.account.availableCreditUsd.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`}
            highlight
          />
          <Stat
            label="Pending credit"
            value={`$${identity.account.pendingCreditUsd.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`}
          />
          <Stat
            label="ETH credit"
            value={identity.account.availableEthCredit.toFixed(4)}
          />
          <Stat
            label="Withdrawals (lifetime)"
            value={identity.account.numWithdrawalsLifetime}
          />
        </dl>
      )}

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-400">
        <div>
          Signed up:{' '}
          <span className="text-gray-200">{fmtDate(identity.createdAt)}</span>
        </div>
        {identity.lastActiveAt && (
          <div>
            Last active:{' '}
            <span className="text-gray-200">{timeAgo(identity.lastActiveAt)}</span>{' '}
            <span className="text-gray-500">({fmtDate(identity.lastActiveAt)})</span>
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number | string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-md border border-gray-800 bg-gray-950/40 px-2.5 py-2">
      <dt className="text-[10px] uppercase tracking-wider text-gray-500">{label}</dt>
      <dd
        className={`mt-0.5 text-base font-semibold ${
          highlight ? 'text-[#F3E216]' : 'text-white'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
