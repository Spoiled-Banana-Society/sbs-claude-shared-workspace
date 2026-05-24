'use client';

/**
 * Audit — consolidated history-of-changes tab.
 *
 * Sub-tabs: Admin Actions · User Signups · KYC Attempts · Full Audit Log.
 *
 * Built in Phase 3 of the admin overhaul. Replaces three separate
 * top-level tabs (activity/audit/kyc) and groups them under one
 * "who did what, when" mental model.
 */

import { useAdminNotifications } from '@/hooks/admin/useAdminNotifications';
import { useAdminAuthHeaders } from '@/hooks/admin/useAdminApi';
import { RecentActivity } from '@/components/admin/RecentActivity';
import { UserActivity } from '@/components/admin/UserActivity';
import { KycAttemptsViewer } from '@/components/admin/KycAttemptsViewer';
import { AuditLog } from '@/components/admin/AuditLog';
import { SubTabBar, useSubTab, type SubTabItem } from '@/components/admin/SubTabBar';

type AuditSub = 'admin-actions' | 'user-signups' | 'kyc' | 'full-log';
const SUB_KEYS = ['admin-actions', 'user-signups', 'kyc', 'full-log'] as const;

export function AuditTab({ enabled }: { enabled: boolean }) {
  const sub = useSubTab<AuditSub>(SUB_KEYS, 'admin-actions');
  const { counts } = useAdminNotifications({ enabled, useAuthHeaders: useAdminAuthHeaders });

  const items: SubTabItem<AuditSub>[] = [
    { key: 'admin-actions', label: 'Admin Actions' },
    { key: 'user-signups', label: 'User Signups' },
    { key: 'kyc', label: 'KYC Attempts', badge: counts.kyc },
    { key: 'full-log', label: 'Full Audit Log' },
  ];

  return (
    <div>
      <SubTabBar items={items} active={sub} onChange={() => { /* URL handled by SubTabBar */ }} />
      {sub === 'admin-actions' && <RecentActivity enabled={enabled} />}
      {sub === 'user-signups' && <UserActivity enabled={enabled} />}
      {sub === 'kyc' && <KycAttemptsViewer enabled={enabled} />}
      {sub === 'full-log' && <AuditLog enabled={enabled} />}
    </div>
  );
}
