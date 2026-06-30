'use client';

/**
 * Standalone notification settings page. The same settings also live as
 * the "Notifications" tab on /profile — this route stays as a direct link
 * and as the Telegram-link return target. Both render one shared component.
 */

import { NotificationSettings } from '@/components/notifications/NotificationSettings';
import { DraftSectionLinks } from '@/components/layout/DraftSectionLinks';

export default function NotificationSettingsPage() {
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      {/* Page title + cross-links to the sibling pre-draft pages. Lives here
          (not in NotificationSettings) because that component is also embedded
          in the Profile "Notifications" tab, which shouldn't get this header. */}
      <div className="mb-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">Draft Alerts</h1>
        <DraftSectionLinks active="alerts" />
      </div>
      <NotificationSettings />
    </main>
  );
}
