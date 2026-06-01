'use client';

/**
 * Identity card: who is this person? Wallet, name, email, signup date,
 * KYC status, banned, balance counters all at a glance.
 */

import { useState } from 'react';
import type { UserLookupIdentity } from '@/hooks/admin/useUserLookup';

/**
 * The default GCS bucket path follows `<bucket>/<wallet>.jpg`. Every user
 * resolves to a URL whether or not they uploaded — uploads serve the
 * custom PFP, non-uploads 404 and the browser onError swaps to a
 * deterministic colored-initial fallback so admins still see SOMETHING
 * recognizable. Was relying solely on the Go API's `pfp.imageUrl` field
 * which only populated AFTER the env-var fix; now we have a belt-and-
 * suspenders avatar source.
 */
const PFP_BUCKET_URL = 'https://storage.googleapis.com/sbs-staging-pfps';

function deriveAvatarUrl(wallet: string): string {
  return `${PFP_BUCKET_URL}/${wallet.toLowerCase()}.jpg`;
}

function Avatar({ src, fallbackWallet }: { src: string | null; fallbackWallet: string }) {
  const [errored, setErrored] = useState(false);
  // Three-tier fallback:
  //   1. Go-API-returned pfp.imageUrl (uploaded custom PFP)
  //   2. Derived GCS URL pattern (works even when Go fetch was offline)
  //   3. onError → /banana-profile.png (the default banana shown
  //      everywhere else in-app — Boris's spec: "default should be
  //      their banana default image, not a letter circle.")
  const url = errored ? '/banana-profile.png' : (src || deriveAvatarUrl(fallbackWallet));
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={url}
      alt=""
      className="h-12 w-12 shrink-0 rounded-full border border-white/10 object-cover bg-gray-900"
      loading="lazy"
      onError={() => setErrored(true)}
    />
  );
}

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
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 text-sm text-gray-400">
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
    <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      {/* Owner-profile fetch diagnostic. Renders only when the Go owner
          endpoint returned no displayName/avatar. Tells the admin
          exactly why instead of leaving them guessing at a silent
          🍌 placeholder. */}
      {identity.ownerFetchDiagnostic && !identity.displayName && (
        <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/[0.05] px-3 py-2 text-[11px] text-amber-300">
          ⚠️ Owner profile unavailable: {identity.ownerFetchDiagnostic}
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          {/* PFP — three-tier fallback so we ALWAYS show something
              recognizable: Go-API URL → derived GCS pattern → colored
              initial circle. */}
          <Avatar src={identity.avatar} fallbackWallet={identity.walletAddress} />
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
          <ActivityPill lastActiveAt={identity.lastActiveAt} />
        </div>
      </div>

      {/* Available balances (decrement on use). Labels say "available"
          so a 0 reads as "they have none left" rather than "they've
          never had any" — Boris's confusion when his consumed-spins
          showed 0 was real. The lifetime totals (spins done, promos
          claimed, etc.) live in the Activity section below. */}
      <dl className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 md:grid-cols-6">
        <Stat label="Free drafts left" value={identity.balance.freeDrafts} highlight />
        <Stat label="Paid passes left" value={identity.balance.draftPasses} />
        <Stat label="Spins left" value={identity.balance.wheelSpins} />
        <Stat label="JP entries left" value={identity.balance.jackpotEntries} />
        <Stat label="HOF entries left" value={identity.balance.hofEntries} />
        <Stat label="Card fee credit" value={`$${((identity.balance.cardFeeCreditCents || 0) / 100).toFixed(2)}`} />
      </dl>
      <p className="mt-2 text-[10px] text-gray-500">
        Counters above are current balances (decrement when used). Lifetime totals — spins done, promos claimed, draft entries, etc. — live in the Activity section below.
      </p>

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

/**
 * Glanceable activity status. Mirrors the color-coding used in the
 * bottom Users table on the dashboard so admins read the same signal
 * the same way across both surfaces.
 *
 * Buckets:
 *   ≤ 7 days  → emerald "Active"
 *   ≤ 14 days → gray "Recent"
 *   ≤ 30 days → amber "Inactive"
 *   > 30 days → red "Stale"
 *   never     → gray "Never"
 */
function ActivityPill({ lastActiveAt }: { lastActiveAt: string | null }) {
  if (!lastActiveAt) {
    return (
      <span className="rounded-md bg-gray-700/40 px-2 py-0.5 text-gray-400 ring-1 ring-gray-600">
        Never active
      </span>
    );
  }
  const t = Date.parse(lastActiveAt);
  if (!Number.isFinite(t)) return null;
  const days = (Date.now() - t) / 86_400_000;
  const ago = timeAgo(lastActiveAt) ?? '';
  let cls = '';
  let label = '';
  if (days <= 7) {
    cls = 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30';
    label = `Active · ${ago}`;
  } else if (days <= 14) {
    cls = 'bg-gray-700/40 text-gray-300 ring-gray-600';
    label = `Recent · ${ago}`;
  } else if (days <= 30) {
    cls = 'bg-amber-500/10 text-amber-300 ring-amber-500/30';
    label = `Inactive · ${ago}`;
  } else {
    cls = 'bg-red-500/10 text-red-300 ring-red-500/30';
    label = `Stale · ${ago}`;
  }
  return (
    <span className={`rounded-md px-2 py-0.5 ring-1 ${cls}`} title={fmtDate(lastActiveAt)}>
      {label}
    </span>
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
