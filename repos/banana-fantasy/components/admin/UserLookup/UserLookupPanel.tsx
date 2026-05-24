'use client';

/**
 * Top-level User Lookup panel. Orchestrates the search input, the
 * consolidated API call, and the section components. Reads `?wallet=`
 * from the URL so cross-tab WalletLink navigation lands populated;
 * picks/clears keep the URL in sync so admins can deep-link to a
 * specific user.
 */

import { useCallback, useEffect, useState } from 'react';
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
import { ActionsPanel } from './ActionsPanel';

const WALLET_REGEX = /^0x[0-9a-fA-F]{40}$/;

export function UserLookupPanel({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlWallet = searchParams?.get('wallet')?.toLowerCase() ?? '';
  const [wallet, setWallet] = useState<string>(
    WALLET_REGEX.test(urlWallet) ? urlWallet : '',
  );

  // Keep state in sync if the URL changes (cross-tab navigation drops a
  // ?wallet= param when the user clicks a WalletLink elsewhere).
  useEffect(() => {
    if (urlWallet && urlWallet !== wallet && WALLET_REGEX.test(urlWallet)) {
      setWallet(urlWallet);
    }
  }, [urlWallet, wallet]);

  const setWalletAndUrl = useCallback(
    (next: string) => {
      setWallet(next);
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
      <div className="rounded-xl border border-gray-700 bg-gray-900/40 p-4">
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
        <div className="rounded-xl border border-gray-700 bg-gray-900/40 p-6 text-center text-sm text-gray-400">
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
          {/* Main column */}
          <div className="min-w-0 space-y-4">
            <HealthSummary
              status={lookup.data.healthSummary.status}
              issues={lookup.data.healthSummary.issues}
            />
            <NotesSection wallet={wallet} notes={lookup.data.notes} />
            <IdentityCard
              identity={
                isSectionFail(lookup.data.identity) ? null : lookup.data.identity
              }
              walletShort={lookup.data.walletShort}
            />
            <NotificationsSection
              wallet={wallet}
              notifications={lookup.data.notifications}
            />
            <ActivitySection activity={lookup.data.activity} />
            <PassesDraftsSection drafts={lookup.data.drafts} />
            <PaymentsSection payments={lookup.data.payments} />
            <KycSection kyc={lookup.data.kyc} wallet={wallet} />
            <ErrorsSection errors={lookup.data.errors} wallet={wallet} />
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
