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

import { WithdrawalsPanel } from '@/components/admin/WithdrawalsPanel';
import { OnrampAttemptsViewer } from '@/components/admin/OnrampAttemptsViewer';
import { OfframpAttemptsViewer } from '@/components/admin/OfframpAttemptsViewer';
import { PromosPanel } from '@/components/admin/PromosPanel';
import { ContractTreasuryPanel } from '@/components/admin/ContractTreasuryPanel';
import { SubTabBar, useSubTab, type SubTabItem } from '@/components/admin/SubTabBar';

type MoneySub = 'withdrawals' | 'onramps' | 'offramps' | 'promos' | 'treasury';
const SUB_KEYS = ['withdrawals', 'onramps', 'offramps', 'promos', 'treasury'] as const;

export function MoneyTab({ enabled }: { enabled: boolean }) {
  const sub = useSubTab<MoneySub>(SUB_KEYS, 'treasury');

  const items: SubTabItem<MoneySub>[] = [
    // Money slimmed to Treasury only (Boris 2026-08-28, cost cleanup).
    // Withdrawals/Onramps/Offramps/Promos panels still render via their sub
    // keys if ever deep-linked — only the sub-nav entries are gone.
    { key: 'treasury', label: 'Treasury' },
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
      {sub === 'treasury' && <ContractTreasuryPanel enabled={enabled} />}
    </div>
  );
}
