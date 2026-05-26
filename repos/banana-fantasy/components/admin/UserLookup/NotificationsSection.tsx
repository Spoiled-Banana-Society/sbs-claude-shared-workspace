'use client';

/**
 * Notification state at a glance: which channels are toggled on, what's
 * linked (email/telegram/discord), and every push device with last-
 * activity timestamps. Plus a "Send test ping" action.
 *
 * The push subscription status uses OneSignal v1's `notification_types`,
 * which is unreliable for v2-schema subscriptions — so we show the raw
 * value but mark the actual truth as "did past pings deliver?" (visible
 * in the Errors section as `notifications.push.zero_recipients`).
 */

import {
  isSectionFail,
  type UserLookupNotificationDelivery,
  type UserLookupNotificationDeliveryChannel,
  type UserLookupPushDevice,
  type UserLookupResponse,
} from '@/hooks/admin/useUserLookup';

function fmtAgo(v: string | null) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

const CHANNEL_LABELS: Record<string, { label: string; icon: string }> = {
  push: { label: 'Push', icon: '🔔' },
  email: { label: 'Email', icon: '✉️' },
  telegram: { label: 'Telegram', icon: '✈️' },
  discord: { label: 'Discord', icon: '💬' },
};

const CHANNEL_ORDER = ['push', 'email', 'telegram', 'discord'] as const;

interface Props {
  wallet: string;
  notifications: UserLookupResponse['notifications'];
}

export function NotificationsSection({ wallet, notifications }: Props) {
  const prefs = isSectionFail(notifications.prefs) ? null : notifications.prefs;
  const push = !notifications.push || isSectionFail(notifications.push) ? null : notifications.push;

  return (
    <Card>
      {/* The test-ping button lives in ActionsPanel (uses proper admin
          auth instead of leaking the internal secret to the client). */}
      <Header />
      {/* `wallet` is kept in the API but no longer rendered here directly
          — silence unused warning while keeping the prop for the section. */}
      <span className="sr-only">{wallet}</span>

      {isSectionFail(notifications.prefs) ? (
        <p className="mt-2 text-sm text-red-300">
          Prefs unavailable: {notifications.prefs.reason}
        </p>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          {CHANNEL_ORDER.map((id) => {
            const on = prefs?.channels?.[id] === true;
            const linked =
              id === 'push'
                ? (push?.devices?.length ?? 0) > 0
                : id === 'email'
                  ? !!prefs?.email
                  : id === 'telegram'
                    ? !!prefs?.telegramChatId
                    : id === 'discord'
                      ? !!prefs?.discordId
                      : false;
            return (
              <ChannelChip
                key={id}
                icon={CHANNEL_LABELS[id].icon}
                label={CHANNEL_LABELS[id].label}
                on={on}
                linked={linked}
                detail={
                  id === 'email'
                    ? prefs?.email ?? null
                    : id === 'telegram'
                      ? prefs?.telegramChatId ?? null
                      : id === 'discord'
                        ? prefs?.discordId ?? null
                        : id === 'push'
                          ? `${push?.devices?.length ?? 0} device${
                              push?.devices?.length === 1 ? '' : 's'
                            }`
                          : null
                }
              />
            );
          })}
        </div>
      )}

      {/* Push devices */}
      {!notifications.push ? (
        <p className="mt-4 text-xs text-gray-500">
          OneSignal env vars unset — push device data unavailable.
        </p>
      ) : isSectionFail(notifications.push) ? (
        <p className="mt-4 text-sm text-red-300">
          Push device lookup failed: {notifications.push.reason}
        </p>
      ) : push && push.devices.length > 0 ? (
        <div className="mt-4">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            Push devices ({push.devices.length})
          </h4>
          <ul className="mt-2 space-y-1">
            {push.devices.map((d) => (
              <PushDeviceRow key={d.playerId} device={d} />
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-4 text-xs text-gray-500">
          No push devices subscribed for this wallet.
        </p>
      )}

      <RecentDeliveries activity={notifications.recentDeliveries} />
    </Card>
  );
}

/**
 * Per-wallet delivery activity. Answers "did this user actually get
 * the alert, and which channels fired" without diving into Vercel
 * logs. Sourced from `v2_notification_deliveries` (one doc per
 * dispatcher run per recipient).
 */
function RecentDeliveries({
  activity,
}: {
  activity: UserLookupResponse['notifications']['recentDeliveries'];
}) {
  if (isSectionFail(activity)) {
    return (
      <p className="mt-4 text-sm text-red-300">
        Delivery history unavailable: {activity.reason}
      </p>
    );
  }
  return (
    <div className="mt-4">
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
        Recent delivery attempts {activity.length > 0 && `(${activity.length})`}
      </h4>
      {activity.length === 0 ? (
        <p className="mt-2 text-xs text-gray-500">
          No notification delivery attempts logged for this wallet yet — either
          the user hasn&apos;t been in a draft that fired one, or the Cloud
          Function triggers (`onPickAdvance` / `onDraftFilled`) never reached
          the dispatcher.
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {activity.map((d, i) => (
            <DeliveryRow key={`${d.draftId}-${d.timestamp}-${i}`} delivery={d} />
          ))}
        </ul>
      )}
    </div>
  );
}

const OUTCOME_TONE: Record<UserLookupNotificationDelivery['outcome'], string> = {
  sent: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  muted: 'bg-gray-700/30 text-gray-300 border-gray-700',
  deduped: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
  failed: 'bg-red-500/15 text-red-300 border-red-500/30',
};

const CHANNEL_TONE: Record<UserLookupNotificationDeliveryChannel['status'], string> = {
  sent: 'bg-emerald-500/15 text-emerald-300',
  skipped: 'bg-gray-700/30 text-gray-400',
  failed: 'bg-red-500/15 text-red-300',
};

function DeliveryRow({ delivery }: { delivery: UserLookupNotificationDelivery }) {
  const eventLabel = delivery.event === 'draft.filled' ? 'Draft filled' : 'Your turn';
  // The interesting detail when push goes out but reaches 0 devices.
  const pushChannel = delivery.channels?.find((c) => c.channel === 'push');
  const zeroRecipients =
    pushChannel?.status === 'sent' && (pushChannel.recipients ?? 0) === 0;
  return (
    <li className="rounded-md border border-gray-800 bg-gray-950/40 px-2.5 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${OUTCOME_TONE[delivery.outcome]}`}
          title={`Outcome: ${delivery.outcome}`}
        >
          {delivery.outcome}
        </span>
        <span className="font-medium text-gray-100">{eventLabel}</span>
        {delivery.draftName && (
          <span className="text-gray-400">— {delivery.draftName}</span>
        )}
        <span className="font-mono text-[10px] text-gray-500" title={delivery.draftId}>
          {delivery.draftId.length > 22
            ? `${delivery.draftId.slice(0, 22)}…`
            : delivery.draftId}
        </span>
        {delivery.pickNumber != null && (
          <span className="text-gray-500">pick #{delivery.pickNumber}</span>
        )}
        <span className="ml-auto text-gray-500">{fmtAgo(delivery.timestamp)}</span>
      </div>
      {delivery.channels && delivery.channels.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {delivery.channels.map((c) => (
            <span
              key={c.channel}
              className={`rounded px-1.5 py-0.5 text-[10px] ${CHANNEL_TONE[c.status]}`}
              title={c.reason || (c.recipients != null ? `recipients: ${c.recipients}` : c.status)}
            >
              {c.channel}:{c.status}
              {c.channel === 'push' && c.status === 'sent' && c.recipients != null && (
                <> ({c.recipients})</>
              )}
            </span>
          ))}
        </div>
      )}
      {zeroRecipients && (
        <p className="mt-1 text-[10px] text-amber-300/90">
          ⚠️ Push accepted by OneSignal but reached 0 subscribed devices.
        </p>
      )}
      {delivery.pushStats && (
        <PushDeliveryStats stats={delivery.pushStats} />
      )}
      {delivery.emailDelivery && (
        <EmailDeliveryStatus delivery={delivery.emailDelivery} />
      )}
    </li>
  );
}

/**
 * Real Postmark delivery outcome from the postmark-webhook receiver.
 * Without this we'd only know "Postmark accepted" — which silently
 * lies during sandbox mode or DKIM/SPF misconfiguration.
 */
function EmailDeliveryStatus({
  delivery,
}: {
  delivery: NonNullable<UserLookupNotificationDelivery['emailDelivery']>;
}) {
  const tone =
    delivery.status === 'delivered'
      ? 'text-emerald-300'
      : delivery.status === 'bounced'
        ? 'text-red-300'
        : delivery.status === 'spam'
          ? 'text-amber-300'
          : 'text-gray-400';
  const icon =
    delivery.status === 'delivered'
      ? '✓'
      : delivery.status === 'bounced'
        ? '✗'
        : delivery.status === 'spam'
          ? '⚠'
          : '·';
  const label =
    delivery.status === 'delivered'
      ? 'delivered to inbox'
      : delivery.status === 'bounced'
        ? `bounced${delivery.bounceType ? ` (${delivery.bounceType})` : ''}`
        : delivery.status === 'spam'
          ? 'marked spam by recipient'
          : delivery.recordType || 'unknown';
  return (
    <p
      className={`mt-1 text-[10px] ${tone}`}
      title={delivery.bounceDescription || `Postmark ${delivery.recordType || ''}`}
    >
      {icon} email: {label}
    </p>
  );
}

/**
 * Real post-send OneSignal delivery stats. `recipients` from the send
 * call only proves "OneSignal queued for N devices" — this row shows
 * the real downstream outcome (delivered to device vs APNS/FCM dropped
 * vs OneSignal-side error) fetched per row from /notifications/{id}.
 */
function PushDeliveryStats({
  stats,
}: {
  stats: NonNullable<UserLookupNotificationDelivery['pushStats']>;
}) {
  const { successful, failed, errored, remaining } = stats;
  const allSucceeded = successful > 0 && failed === 0 && errored === 0;
  const partiallyFailed = successful > 0 && (failed > 0 || errored > 0);
  const allFailed = successful === 0 && (failed > 0 || errored > 0);
  const tone = allSucceeded
    ? 'text-emerald-300'
    : allFailed
      ? 'text-red-300'
      : partiallyFailed
        ? 'text-amber-300'
        : 'text-gray-400';
  const icon = allSucceeded
    ? '✓'
    : allFailed
      ? '✗'
      : partiallyFailed
        ? '⚠'
        : '·';
  const parts: string[] = [];
  parts.push(`delivered ${successful}`);
  if (failed > 0) parts.push(`APNS/FCM dropped ${failed}`);
  if (errored > 0) parts.push(`errored ${errored}`);
  if (remaining > 0) parts.push(`in flight ${remaining}`);
  return (
    <p
      className={`mt-1 text-[10px] ${tone}`}
      title="From OneSignal /notifications/{id} — real device-level outcome"
    >
      {icon} push delivery: {parts.join(' · ')}
    </p>
  );
}

function ChannelChip({
  icon,
  label,
  on,
  linked,
  detail,
}: {
  icon: string;
  label: string;
  on: boolean;
  linked: boolean;
  detail: string | null;
}) {
  const tone =
    on && linked
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
      : on && !linked
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
        : 'border-gray-800 bg-gray-950/40 text-gray-400';
  return (
    <div className={`rounded-md border px-2.5 py-2 ${tone}`}>
      <div className="flex items-center gap-1.5 text-xs">
        <span aria-hidden>{icon}</span>
        <span className="font-semibold">{label}</span>
        <span className="ml-auto text-[10px] uppercase tracking-wider opacity-75">
          {on ? 'ON' : 'OFF'}
        </span>
      </div>
      {detail && (
        <p className="mt-1 truncate font-mono text-[11px] opacity-80" title={detail}>
          {detail}
        </p>
      )}
      {on && !linked && (
        <p className="mt-1 text-[10px] text-amber-300/90">⚠️ on but not linked</p>
      )}
    </div>
  );
}

function PushDeviceRow({ device }: { device: UserLookupPushDevice }) {
  // notification_types > 0 in OneSignal v1 indicates subscribed; null/0
  // is the ambiguous case (v2 schema). We mark the row's status but lean
  // on the recipient-count error log as the source of truth.
  const seemsSubscribed =
    !device.invalidIdentifier && (device.notificationTypes ?? 0) > 0;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md border border-gray-800 bg-gray-950/40 px-2.5 py-1.5 text-xs">
      <span className="font-medium text-gray-100">
        {device.deviceTypeName}
        {device.model && (
          <span className="ml-1 text-gray-500">({device.model})</span>
        )}
      </span>
      <span className="text-gray-500">last active {fmtAgo(device.lastActiveAt)}</span>
      <span
        className={`ml-auto rounded px-1.5 text-[10px] uppercase tracking-wider ${
          seemsSubscribed
            ? 'bg-emerald-500/15 text-emerald-300'
            : device.invalidIdentifier
              ? 'bg-red-500/15 text-red-300'
              : 'bg-gray-700/40 text-gray-400'
        }`}
        title={
          device.invalidIdentifier
            ? 'OneSignal marked this device invalid'
            : `notification_types=${device.notificationTypes}`
        }
      >
        {device.invalidIdentifier ? 'invalid' : seemsSubscribed ? 'sub' : 'unknown'}
      </span>
    </li>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      {children}
    </section>
  );
}

function Header({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
        Notifications
      </h3>
      {children}
    </div>
  );
}
