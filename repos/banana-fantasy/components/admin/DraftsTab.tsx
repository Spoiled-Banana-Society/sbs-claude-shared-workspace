'use client';

/**
 * Drafts — consolidated draft-operations tab.
 *
 * Sub-tabs: Active · Completed · Spectate · Founder.
 *
 * Built in Phase 3 of the admin overhaul. Replaces three separate
 * top-level tabs (drafts/spectate/founder) plus surfaces a dedicated
 * "Active" view that previously didn't exist as a first-class screen.
 *
 * "Active" today aliases the Spectate live-drafts list — same data,
 * same poll interval. We keep both as sub-tabs because Boris explicitly
 * wants quick filter access to spectator links separate from the
 * raw active-drafts table.
 */

import { useAdminNotifications } from '@/hooks/admin/useAdminNotifications';
import { useAdminAuthHeaders } from '@/hooks/admin/useAdminApi';
import { SpectateBrowser } from '@/components/admin/SpectateBrowser';
import { CompletedDraftsList } from '@/components/admin/CompletedDraftsList';
import { FounderScheduleEditor } from '@/components/admin/FounderScheduleEditor';
import { SubTabBar, useSubTab, type SubTabItem } from '@/components/admin/SubTabBar';

type DraftsSub = 'active' | 'completed' | 'spectate' | 'founder';
const SUB_KEYS = ['active', 'completed', 'spectate', 'founder'] as const;

export function DraftsTab({ enabled }: { enabled: boolean }) {
  const sub = useSubTab<DraftsSub>(SUB_KEYS, 'active');
  const { counts } = useAdminNotifications({ enabled, useAuthHeaders: useAdminAuthHeaders });

  const items: SubTabItem<DraftsSub>[] = [
    { key: 'active', label: 'Active', badge: counts.drafts },
    { key: 'completed', label: 'Completed' },
    { key: 'spectate', label: 'Spectate' },
    { key: 'founder', label: 'Founder' },
  ];

  return (
    <div>
      <SubTabBar items={items} active={sub} onChange={() => { /* URL handled by SubTabBar */ }} />
      {sub === 'active' && <SpectateBrowser enabled={enabled} />}
      {sub === 'completed' && <CompletedDraftsList enabled={enabled} />}
      {sub === 'spectate' && <SpectateBrowser enabled={enabled} />}
      {sub === 'founder' && <FounderScheduleEditor enabled={enabled} />}
    </div>
  );
}
