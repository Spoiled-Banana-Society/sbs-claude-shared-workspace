'use client';

/**
 * Standalone notification settings page. The same settings also live as
 * the "Notifications" tab on /profile — this route stays as a direct link
 * and as the Telegram-link return target. Both render one shared component.
 */

import { NotificationSettings } from '@/components/notifications/NotificationSettings';

export default function NotificationSettingsPage() {
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <NotificationSettings />
    </main>
  );
}
