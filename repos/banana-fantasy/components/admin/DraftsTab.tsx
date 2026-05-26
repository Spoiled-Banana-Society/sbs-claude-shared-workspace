'use client';

/**
 * Drafts — consolidated draft-operations tab.
 *
 * Sub-tabs: Active · Completed · Spectate · Founder · Manage.
 *
 * "Manage" (added 2026-05-26) is the search-and-cleanup view: list every
 * draft in the Go API's `drafts` collection, see who's in each, and
 * delete + refund tokens for any ghost/stuck draft. Replaces the
 * one-click "Clear All" + the manual cleanup scripts in Richard's notes.
 */

import { useAdminNotifications } from '@/hooks/admin/useAdminNotifications';
import { useAdminAuthHeaders } from '@/hooks/admin/useAdminApi';
import { SpectateBrowser } from '@/components/admin/SpectateBrowser';
import { CompletedDraftsList } from '@/components/admin/CompletedDraftsList';
import { FounderScheduleEditor } from '@/components/admin/FounderScheduleEditor';
import { AdminDraftManage } from '@/components/admin/AdminDraftManage';
import { SubTabBar, useSubTab, type SubTabItem } from '@/components/admin/SubTabBar';

type DraftsSub = 'active' | 'completed' | 'spectate' | 'founder' | 'manage';
const SUB_KEYS = ['active', 'completed', 'spectate', 'founder', 'manage'] as const;

export function DraftsTab({ enabled }: { enabled: boolean }) {
  const sub = useSubTab<DraftsSub>(SUB_KEYS, 'active');
  const { counts } = useAdminNotifications({ enabled, useAuthHeaders: useAdminAuthHeaders });

  const items: SubTabItem<DraftsSub>[] = [
    { key: 'active', label: 'Active', badge: counts.drafts },
    { key: 'completed', label: 'Completed' },
    { key: 'spectate', label: 'Spectate' },
    { key: 'founder', label: 'Founder' },
    { key: 'manage', label: 'Manage' },
  ];

  return (
    <div>
      <SubTabBar items={items} active={sub} onChange={() => { /* URL handled by SubTabBar */ }} />
      {sub === 'active' && <SpectateBrowser enabled={enabled} />}
      {sub === 'completed' && <CompletedDraftsList enabled={enabled} />}
      {sub === 'spectate' && <SpectateBrowser enabled={enabled} />}
      {sub === 'founder' && <FounderScheduleEditor enabled={enabled} />}
      {sub === 'manage' && <AdminDraftManage enabled={enabled} />}
    </div>
  );
}
