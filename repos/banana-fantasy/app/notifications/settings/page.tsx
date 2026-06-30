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

      {/* SBS Draft Bot — for folks who don't want to enter yet but want to
          watch how close drafts are to filling, so they can time their entry.
          Just a link out to the X bot; touches no notification system/flow. */}
      <p className="mb-2.5 ml-1 mt-9 text-[11px] font-semibold uppercase tracking-[0.09em] text-text-muted">
        Track drafts live
      </p>
      <a
        href="https://x.com/sbsdraftbot"
        target="_blank"
        rel="noopener noreferrer"
        className="group block glass-card transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-banana/40"
      >
        <div className="flex items-center gap-4 p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/sbs-draft-bot.png"
            alt="SBS Draft Bot"
            className="h-14 w-14 shrink-0 rounded-2xl border border-white/10 object-cover"
          />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold leading-tight text-white">Watch drafts fill, live</p>
            <p className="mt-1 text-[12.5px] leading-snug text-text-muted">
              Not ready to draft yet? <span className="text-white/80">@SBSDraftBot</span> posts every draft on X as it fills — see which are close and jump in at the right moment.
            </p>
          </div>
          <span className="shrink-0 self-center whitespace-nowrap text-[13px] font-semibold text-banana group-hover:underline">
            Follow&nbsp;→
          </span>
        </div>
      </a>
    </main>
  );
}
