'use client';

/**
 * Top-level User Lookup panel. Orchestrates the search input, the
 * consolidated API call, and the section components. Reads `?wallet=`
 * from the URL so cross-tab WalletLink navigation lands populated;
 * picks/clears keep the URL in sync so admins can deep-link to a
 * specific user.
 */

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  isSectionFail,
  useUserLookup,
} from '@/hooks/admin/useUserLookup';
import { UserSearchInput } from './UserSearchInput';
import { HealthSummary } from './HealthSummary';
import { NotesSection } from './NotesSection';
import { IdentityCard } from './IdentityCard';
import { NotificationsSection } from './NotificationsSection';
import { PassesDraftsSection } from './PassesDraftsSection';
import { PaymentsSection } from './PaymentsSection';
import { KycSection } from './KycSection';
import { ErrorsSection } from './ErrorsSection';
import { AuditSection } from './AuditSection';
import { ActivitySection } from './ActivitySection';
import { TeamsLeaguesSection } from './TeamsLeaguesSection';
import { ActionsPanel } from './ActionsPanel';

const WALLET_REGEX = /^0x[0-9a-fA-F]{40}$/;

export function UserLookupPanel({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // SINGLE source of truth: the URL. Killed the local useState + the
  // urlWallet→state sync useEffect that fought each other and caused
  // Boris's "Clear needs two clicks" bug — the state cleared on click 1
  // but the URL hadn't updated yet, then the sync useEffect saw the
  // still-present urlWallet and re-set the state from it on the next
  // render. With URL as the only source, Clear deletes the URL param
  // → next render reads empty → done in one click.
  const urlWallet = searchParams?.get('wallet')?.toLowerCase() ?? '';
  const wallet = WALLET_REGEX.test(urlWallet) ? urlWallet : '';

  const setWalletAndUrl = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '');
      params.set('tab', 'user-lookup');
      if (next) params.set('wallet', next);
      else params.delete('wallet');
      router.replace(`/admin?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const lookup = useUserLookup(wallet || null, enabled);

  return (
    <div className="space-y-4">
      {/* Search header */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
        <h2 className="text-base font-semibold text-white">User Lookup</h2>
        <p className="mb-3 mt-0.5 text-xs text-gray-400">
          Search by wallet, username, or email to see everything historical
          about one user — notifications, payments, drafts, KYC, errors, notes,
          actions.
        </p>
        <UserSearchInput
          value={wallet}
          onPick={(w) => setWalletAndUrl(w)}
          onClear={() => setWalletAndUrl('')}
        />
      </div>

      {/* Empty state intentionally removed — the search input above
          already carries a placeholder, so a second copy of the same
          instruction underneath was redundant. */}

      {/* Loading */}
      {wallet && lookup.isLoading && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 text-center text-sm text-gray-400">
          Loading user data…
        </div>
      )}

      {/* Error */}
      {wallet && lookup.error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          Lookup failed: {lookup.error.message}
        </div>
      )}

      {/* Data */}
      {wallet && lookup.data && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
          {/* Reading order: who → what they've done → where money went →
              admin support context → admin audit trail.
                1. HealthSummary — banner: anything broken right now?
                2. IdentityCard — name, pfp, status pills, balances
                3. ActivitySection — lifetime tiles + Promos|Wheel +
                   timeline (the MOST IMPORTANT block — answers "what
                   has this user actually done?" at a glance)
                4. Drafts — list of every draft they entered
                5. Payments — onramps / offramps / withdrawals
                6. Notes + Notifications (2-col) — admin context
                7. KYC + Errors (2-col) — issue surfaces
                8. Audit — admin actions on this wallet */}
          <div className="min-w-0 space-y-4">
            <HealthSummary
              status={lookup.data.healthSummary.status}
              issues={lookup.data.healthSummary.issues}
            />
            <IdentityCard
              identity={
                isSectionFail(lookup.data.identity) ? null : lookup.data.identity
              }
              walletShort={lookup.data.walletShort}
            />
            <ActivitySection
              activity={lookup.data.activity}
              promoState={lookup.data.promoState}
            />
            <TeamsLeaguesSection teams={lookup.data.teams} />
            <PassesDraftsSection drafts={lookup.data.drafts} />
            <PaymentsSection payments={lookup.data.payments} />
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <NotesSection wallet={wallet} notes={lookup.data.notes} />
              <NotificationsSection
                wallet={wallet}
                notifications={lookup.data.notifications}
              />
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <KycSection kyc={lookup.data.kyc} wallet={wallet} />
              <ErrorsSection errors={lookup.data.errors} wallet={wallet} />
            </div>
            <AuditSection audit={lookup.data.audit} />
          </div>

          {/* Sticky actions sidebar (desktop) / footer (mobile) */}
          <div>
            <ActionsPanel
              wallet={wallet}
              banned={
                !isSectionFail(lookup.data.identity) &&
                lookup.data.identity?.banned === true
              }
              kycApproved={
                !isSectionFail(lookup.data.identity) &&
                lookup.data.identity?.kycStatus === 'approved'
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}
