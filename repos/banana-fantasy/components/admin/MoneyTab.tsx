'use client';

/**
 * Money — consolidated financial-movement tab.
 *
 * Sub-tabs: Withdrawals · Onramps · Offramps · Promos.
 *
 * Built in Phase 3 of the admin overhaul (May 2026). Replaces four
 * separate top-level tabs that all live in the same mental bucket
 * (USDC in/out, credit purchases, promo discounts). Nothing about
 * the underlying panels changes — they're just hosted here.
 *
 * Deep-link via `?tab=money&sub=onramps` (etc). Legacy `?tab=onramps`
 * URLs auto-redirect at the admin-page level so old bookmarks survive.
 */

import { useAdminNotifications } from '@/hooks/admin/useAdminNotifications';
import { useAdminAuthHeaders } from '@/hooks/admin/useAdminApi';
import { WithdrawalsPanel } from '@/components/admin/WithdrawalsPanel';
import { OnrampAttemptsViewer } from '@/components/admin/OnrampAttemptsViewer';
import { OfframpAttemptsViewer } from '@/components/admin/OfframpAttemptsViewer';
import { PromosPanel } from '@/components/admin/PromosPanel';
import { SubTabBar, useSubTab, type SubTabItem } from '@/components/admin/SubTabBar';

type MoneySub = 'withdrawals' | 'onramps' | 'offramps' | 'promos';
const SUB_KEYS = ['withdrawals', 'onramps', 'offramps', 'promos'] as const;

export function MoneyTab({ enabled }: { enabled: boolean }) {
  const sub = useSubTab<MoneySub>(SUB_KEYS, 'withdrawals');
  const { counts } = useAdminNotifications({ enabled, useAuthHeaders: useAdminAuthHeaders });

  const items: SubTabItem<MoneySub>[] = [
    { key: 'withdrawals', label: 'Withdrawals', badge: counts.withdrawals },
    { key: 'onramps', label: 'Onramps', badge: counts.onramp },
    { key: 'offramps', label: 'Offramps', badge: counts.offramp },
    { key: 'promos', label: 'Promos' },
  ];

  return (
    <div>
      <SubTabBar
        items={items}
        active={sub}
        onChange={() => { /* SubTabBar already updates the URL */ }}
      />
      {sub === 'withdrawals' && <WithdrawalsPanel enabled={enabled} />}
      {sub === 'onramps' && <OnrampAttemptsViewer enabled={enabled} />}
      {sub === 'offramps' && <OfframpAttemptsViewer enabled={enabled} />}
      {sub === 'promos' && <PromosPanel enabled={enabled} />}
    </div>
  );
}
