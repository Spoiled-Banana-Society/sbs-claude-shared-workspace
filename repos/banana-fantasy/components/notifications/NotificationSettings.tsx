'use client';

/**
 * Notification settings — Apple-style grouped settings.
 *
 * Two groups:
 *   • "What to tell me about" — which draft events to be alerted on.
 *   • "How to reach me" — channels. Each row's switch is the single
 *     control: flipping it on runs the connect flow (push permission /
 *     email / Telegram link / Discord OAuth); flipping it off turns the
 *     channel off. The status line reflects on/off live.
 *
 * Reads/writes /api/notifications/profile. Rendered inside the Profile
 * "Notifications" tab, so it fills the tab width and carries no chrome.
 */

import { useState, useEffect, useCallback } from 'react';
import type { IconType } from 'react-icons';
import { IoNotifications, IoMail, IoAmericanFootball, IoTime, IoFlash } from 'react-icons/io5';
import { FaTelegramPlane, FaDiscord } from 'react-icons/fa';
import { usePrivy } from '@privy-io/react-auth';
import { useAuth } from '@/hooks/useAuth';
import { usePushSubscription } from '@/hooks/usePushSubscription';
import { reportClientError } from '@/lib/clientErrors';
import { clientLog } from '@/lib/clientLog';
import { LOG_SOURCES } from '@/lib/logSources';

type ChannelId = 'push' | 'email' | 'telegram' | 'discord';
type EventId = 'draftFilled' | 'pickSlow' | 'pickFast';

interface Prefs {
  walletAddress: string;
  email?: string;
  telegramChatId?: string;
  discordId?: string;
  channels: Partial<Record<ChannelId, boolean>>;
  events?: Partial<Record<EventId, boolean>>;
}

/** Visual identity for a row's icon: which glyph, which tile gradient. */
interface Tile {
  Icon: IconType;
  grad: string;
  /** Dark glyph for light (banana) tiles, white otherwise. */
  dark?: boolean;
}

const CHANNEL_META: Record<ChannelId, { label: string; blurb: string; tile: Tile }> = {
  push: {
    label: 'Home screen & push',
    blurb: 'Browser and installed-app notifications.',
    tile: { Icon: IoNotifications, grad: 'from-[#fbbf24] to-[#f59e0b]', dark: true },
  },
  email: {
    label: 'Email',
    blurb: 'A reliable backup, straight to your inbox.',
    tile: { Icon: IoMail, grad: 'from-[#0a84ff] to-[#0060df]' },
  },
  telegram: {
    label: 'Telegram',
    blurb: 'Instant — the most reliable channel.',
    tile: { Icon: FaTelegramPlane, grad: 'from-[#2aabee] to-[#1d93d2]' },
  },
  discord: {
    label: 'Discord',
    blurb: 'Pinged in the SBS Discord server.',
    tile: { Icon: FaDiscord, grad: 'from-[#5865f2] to-[#4752c4]' },
  },
};

const EVENT_META: Record<EventId, { label: string; blurb: string; tile: Tile }> = {
  draftFilled: {
    label: 'A draft I joined fills up',
    blurb: 'All 10 spots are in — the draft starts.',
    tile: { Icon: IoAmericanFootball, grad: 'from-[#fbbf24] to-[#f59e0b]', dark: true },
  },
  pickSlow: {
    label: 'My pick — slow drafts',
    blurb: 'Long pick clock. You stepped away — get pinged.',
    tile: { Icon: IoTime, grad: 'from-[#30d158] to-[#28b14c]' },
  },
  pickFast: {
    label: 'My pick — fast drafts',
    blurb: 'Quick pick clock. Most players watch live.',
    tile: { Icon: IoFlash, grad: 'from-[#ff9f0a] to-[#f08000]' },
  },
};
const EVENT_ORDER: EventId[] = ['draftFilled', 'pickSlow', 'pickFast'];
const CHANNEL_ORDER: ChannelId[] = ['push', 'email', 'telegram', 'discord'];

export function NotificationSettings() {
  const { user } = useAuth();
  const { getAccessToken } = usePrivy();
  const push = usePushSubscription();

  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [emailInput, setEmailInput] = useState('');
  const [editingEmail, setEditingEmail] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState<ChannelId | null>(null);

  const authedFetch = useCallback(
    async (url: string, opts: RequestInit = {}) => {
      const token = await getAccessToken();
      return fetch(url, {
        ...opts,
        headers: {
          'Content-Type': 'application/json',
          ...(opts.headers || {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
    },
    [getAccessToken],
  );

  const loadProfile = useCallback(async () => {
    try {
      const res = await authedFetch('/api/notifications/profile');
      if (!res.ok) throw new Error(`GET profile ${res.status}`);
      const d = await res.json();
      setPrefs(d.prefs as Prefs);
      setEmailInput((d.prefs as Prefs).email || '');
    } catch (err) {
      // Tell the user plainly, and surface it in the admin Logs tab.
      setBanner('Couldn’t load your notification settings — check your connection and reload.');
      reportClientError({
        source: LOG_SOURCES.notifications.SETTINGS_READ_FAILED,
        message: 'failed to load notification settings',
        route: 'notifications-settings',
        context: { error: String(err) },
      });
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    if (user?.walletAddress) loadProfile();
    else setLoading(false);
  }, [user?.walletAddress, loadProfile]);

  // Surface the result of the Discord OAuth round-trip.
  useEffect(() => {
    const flag = new URLSearchParams(window.location.search).get('discord');
    if (flag === 'linked') setBanner('Discord connected.');
    else if (flag === 'error') {
      setBanner('Discord connection failed — please try connecting again.');
      reportClientError({
        source: LOG_SOURCES.notifications.CHANNEL_CONNECT_FAILED,
        message: 'discord oauth callback returned error',
        route: 'notifications-settings',
      });
    }
  }, []);

  const channelOn = (id: ChannelId) => !!prefs?.channels?.[id];
  // Events default to ON — only an explicit false counts as off.
  const eventOn = (id: EventId) => prefs?.events?.[id] !== false;
  const channelLinked = (id: ChannelId): boolean => {
    if (id === 'push') return push.state === 'connected';
    if (id === 'email') return !!prefs?.email;
    if (id === 'telegram') return !!prefs?.telegramChatId;
    return !!prefs?.discordId;
  };

  // Report a settings-page failure to the admin Logs tab (with the wallet).
  const reportIssue = (source: string, message: string, context?: Record<string, unknown>) =>
    reportClientError({
      source,
      message,
      route: 'notifications-settings',
      actor: user?.walletAddress,
      context,
    });

  // ── Writes ─────────────────────────────────────────────────────────
  const patchChannel = async (id: ChannelId, on: boolean) => {
    const prev = !!prefs?.channels?.[id];
    setBusy(id);
    setPrefs((p) => (p ? { ...p, channels: { ...p.channels, [id]: on } } : p)); // optimistic
    clientLog('notifications', 'channel-toggle', { channel: id, on });
    try {
      const res = await authedFetch('/api/notifications/profile', {
        method: 'PUT',
        body: JSON.stringify({ channels: { [id]: on } }),
      });
      if (!res.ok) throw new Error(`PUT profile ${res.status}`);
      setPrefs((await res.json()).prefs as Prefs);
    } catch (err) {
      // Roll the switch back so the UI never lies about what was saved.
      setPrefs((p) => (p ? { ...p, channels: { ...p.channels, [id]: prev } } : p));
      setBanner(
        `Couldn’t save that — ${CHANNEL_META[id].label} stayed ${prev ? 'on' : 'off'}. Check your connection and try again.`,
      );
      reportIssue(LOG_SOURCES.notifications.SETTINGS_SAVE_FAILED, `channel toggle save failed: ${id}`, {
        channel: id,
        requested: on,
        error: String(err),
      });
    } finally {
      setBusy(null);
    }
  };

  const setEvent = async (id: EventId, on: boolean) => {
    const prev = prefs?.events?.[id];
    setPrefs((p) => (p ? { ...p, events: { ...p.events, [id]: on } } : p));
    clientLog('notifications', 'event-toggle', { event: id, on });
    try {
      const res = await authedFetch('/api/notifications/profile', {
        method: 'PUT',
        body: JSON.stringify({ events: { [id]: on } }),
      });
      if (!res.ok) throw new Error(`PUT profile ${res.status}`);
      setPrefs((await res.json()).prefs as Prefs);
    } catch (err) {
      setPrefs((p) => (p ? { ...p, events: { ...p.events, [id]: prev } } : p));
      setBanner(`Couldn’t save that — “${EVENT_META[id].label}” didn’t change. Try again.`);
      reportIssue(LOG_SOURCES.notifications.SETTINGS_SAVE_FAILED, `event toggle save failed: ${id}`, {
        event: id,
        requested: on,
        error: String(err),
      });
    }
  };

  const saveEmail = async () => {
    setBusy('email');
    clientLog('notifications', 'email-save', {});
    try {
      const res = await authedFetch('/api/notifications/profile', {
        method: 'PUT',
        body: JSON.stringify({ email: emailInput.trim(), channels: { email: true } }),
      });
      if (!res.ok) throw new Error(`PUT profile ${res.status}`);
      setPrefs((await res.json()).prefs as Prefs);
      setEditingEmail(false);
      setBanner('Email saved — check Spam for the first alert and mark it “Not spam.”');
    } catch (err) {
      setBanner('Couldn’t save your email — check your connection and try again.');
      reportIssue(LOG_SOURCES.notifications.SETTINGS_SAVE_FAILED, 'email save failed', {
        error: String(err),
      });
    } finally {
      setBusy(null);
    }
  };

  // Push: the switch IS the subscription — on subscribes, off unsubscribes.
  const togglePush = async (on: boolean) => {
    clientLog('notifications', 'push-toggle', { on });
    const r = on ? await push.connect() : await push.disconnect();
    if (!r.ok) {
      setBanner(r.error || 'Push action failed — please try again.');
      reportIssue(
        LOG_SOURCES.notifications.CHANNEL_CONNECT_FAILED,
        `push ${on ? 'connect' : 'disconnect'} failed`,
        { action: on ? 'connect' : 'disconnect', error: r.error },
      );
      return;
    }
    setBanner(on ? 'Push notifications are on for this device.' : 'Push notifications turned off.');
    // Keep the server pref in step with the subscription.
    authedFetch('/api/notifications/profile', {
      method: 'PUT',
      body: JSON.stringify({ channels: { push: on } }),
    })
      .then(async (res) => {
        if (res.ok) setPrefs((await res.json()).prefs as Prefs);
      })
      .catch(() => {});
  };

  const connectTelegram = async () => {
    setBusy('telegram');
    clientLog('notifications', 'telegram-connect', {});
    try {
      const res = await authedFetch('/api/notifications/link/telegram');
      if (!res.ok) throw new Error(`link/telegram ${res.status}`);
      window.open((await res.json()).url, '_blank', 'noopener');
      setBanner('Open Telegram, tap Start, then press “Check connection.”');
    } catch (err) {
      setBanner('Telegram isn’t available right now — please try again in a moment.');
      reportIssue(
        LOG_SOURCES.notifications.CHANNEL_CONNECT_FAILED,
        'telegram link request failed',
        { error: String(err) },
      );
    } finally {
      setBusy(null);
    }
  };

  const connectDiscord = async () => {
    setBusy('discord');
    clientLog('notifications', 'discord-connect', {});
    try {
      const res = await authedFetch('/api/notifications/link/discord');
      if (!res.ok) throw new Error(`link/discord ${res.status}`);
      window.location.href = (await res.json()).url; // OAuth; callback links + enables
    } catch (err) {
      setBanner('Discord isn’t available right now — please try again in a moment.');
      reportIssue(
        LOG_SOURCES.notifications.CHANNEL_CONNECT_FAILED,
        'discord link request failed',
        { error: String(err) },
      );
      setBusy(null);
    }
  };

  // Telegram: flipping on with no linked chat opens the bot; the webhook
  // finishes the link. Flipping off just turns the channel off.
  const toggleTelegram = (on: boolean) => {
    if (on && !channelLinked('telegram')) connectTelegram();
    patchChannel('telegram', on);
  };

  // Discord: flipping on with no linked account starts OAuth (the callback
  // links it and turns the channel on). Flipping off turns it off.
  const toggleDiscord = (on: boolean) => {
    if (on && !channelLinked('discord')) {
      connectDiscord();
      return;
    }
    patchChannel('discord', on);
  };

  if (!user?.walletAddress) {
    return (
      <div className="py-16 text-center text-sm text-text-secondary">
        <p>Sign in to choose how you hear about your drafts.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <header className="mb-6">
        <h2 className="text-[24px] font-bold tracking-[-0.02em] text-white">Draft alerts</h2>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-text-secondary">
          Choose what you want to know about, and how you want to hear it — turn on as
          many channels as you like.
        </p>
      </header>

      {banner && (
        <div className="mb-5 flex items-start gap-2.5 rounded-2xl border border-banana/20 bg-banana/[0.07] px-4 py-3">
          <IoNotifications className="mt-[1px] shrink-0 text-[15px] text-banana" />
          <span className="text-[13px] leading-relaxed text-banana/95">{banner}</span>
          <button
            onClick={() => setBanner(null)}
            className="-mr-1 ml-auto shrink-0 self-center rounded-full px-1.5 text-[15px] leading-none text-banana/50 transition-colors hover:text-banana"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-7">
          {[3, 4].map((n) => (
            <div key={n}>
              <div className="mb-2.5 ml-1 h-3 w-32 animate-pulse rounded bg-white/[0.06]" />
              <div className="glass-card overflow-hidden">
                {Array.from({ length: n }).map((_, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-3 px-4 py-3.5 ${i > 0 ? 'border-t border-white/[0.05]' : ''}`}
                  >
                    <div className="h-[30px] w-[30px] animate-pulse rounded-[8px] bg-white/[0.06]" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3.5 w-40 animate-pulse rounded bg-white/[0.06]" />
                      <div className="h-2.5 w-52 animate-pulse rounded bg-white/[0.04]" />
                    </div>
                    <div className="h-[31px] w-[51px] animate-pulse rounded-full bg-white/[0.06]" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-7">
          {/* ─── What to tell me about ─── */}
          <section>
            <SectionLabel>What to tell me about</SectionLabel>
            <Group>
              {EVENT_ORDER.map((id, i) => (
                <Row
                  key={id}
                  first={i === 0}
                  tile={EVENT_META[id].tile}
                  label={EVENT_META[id].label}
                  blurb={EVENT_META[id].blurb}
                  control={<Switch on={eventOn(id)} onToggle={(v) => setEvent(id, v)} />}
                />
              ))}
            </Group>
            <Caption>
              Each event is sent to every channel you turn on below.
            </Caption>
          </section>

          {/* ─── How to reach me ─── */}
          <section>
            <SectionLabel>How to reach me</SectionLabel>
            <Group>
              {CHANNEL_ORDER.map((id, i) => {
                const meta = CHANNEL_META[id];
                const linked = channelLinked(id);
                const on = id === 'push' ? push.state === 'connected' : channelOn(id);
                const rowBusy =
                  busy === id ||
                  (id === 'push' && (push.state === 'loading' || push.busy));

                // Status line — never says "Connected" while the row is off.
                let status: { tone: 'on' | 'off' | 'action'; text: string };
                if (id === 'push') {
                  status =
                    push.state === 'loading'
                      ? { tone: 'off', text: 'Checking…' }
                      : on
                        ? { tone: 'on', text: 'On for this device' }
                        : { tone: 'off', text: 'Off' };
                } else if (!on) {
                  status = { tone: 'off', text: 'Off' };
                } else if (linked) {
                  status = {
                    tone: 'on',
                    text: id === 'email' ? `On · ${prefs?.email}` : 'Connected',
                  };
                } else {
                  status = {
                    tone: 'action',
                    text:
                      id === 'telegram'
                        ? 'Open Telegram and tap Start to finish'
                        : 'Finishing sign-in…',
                  };
                }

                // The switch's on/off handler per channel.
                const onToggle = (v: boolean) => {
                  if (id === 'push') togglePush(v);
                  else if (id === 'email') patchChannel('email', v);
                  else if (id === 'telegram') toggleTelegram(v);
                  else toggleDiscord(v);
                };
                // Email can't be switched on until an address is saved.
                const switchDisabled = rowBusy || (id === 'email' && !linked);

                // Email shows its address field while off / unset / editing.
                const showEmailField = id === 'email' && (!on || editingEmail);

                return (
                  <Row
                    key={id}
                    first={i === 0}
                    tile={meta.tile}
                    label={meta.label}
                    blurb={meta.blurb}
                    status={<StatusLine tone={status.tone} text={status.text} />}
                    control={<Switch on={on} disabled={switchDisabled} onToggle={onToggle} />}
                  >
                    {showEmailField && (
                      <div>
                        <div className="flex gap-2">
                          <input
                            type="email"
                            value={emailInput}
                            onChange={(e) => setEmailInput(e.target.value)}
                            placeholder="you@example.com"
                            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/40 px-3.5 py-2 text-[13.5px] text-white placeholder-text-muted outline-none transition-colors focus:border-banana/50"
                          />
                          <PillButton
                            onClick={saveEmail}
                            busy={busy === 'email'}
                            disabled={!emailInput.trim()}
                          >
                            {linked ? 'Update' : 'Save'}
                          </PillButton>
                        </div>
                        <p className="mt-2 text-[11.5px] leading-relaxed text-text-muted">
                          {linked
                            ? 'Saving a new address turns email alerts back on.'
                            : 'Your first alert may land in Spam — open it and tap “Not spam.”'}
                        </p>
                      </div>
                    )}
                    {id === 'email' && on && !editingEmail && (
                      <TextAction onClick={() => setEditingEmail(true)}>
                        Change email address
                      </TextAction>
                    )}
                    {id === 'telegram' && on && !linked && (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                        <TextAction onClick={connectTelegram}>Open Telegram again</TextAction>
                        <TextAction onClick={loadProfile}>Check connection</TextAction>
                      </div>
                    )}
                    {id === 'discord' && on && !linked && (
                      <TextAction onClick={connectDiscord}>Try connecting again</TextAction>
                    )}
                  </Row>
                );
              })}
            </Group>
            <Caption>
              Turn a channel off any time — it stays linked, so flipping it back on is
              instant.
            </Caption>
          </section>
        </div>
      )}
    </div>
  );
}

/* ── Building blocks ───────────────────────────────────────────────── */

/** Small uppercase section header, iOS-settings style. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2.5 ml-1 text-[11px] font-semibold uppercase tracking-[0.09em] text-text-muted">
      {children}
    </p>
  );
}

/** Footnote under a group, iOS-settings style. */
function Caption({ children }: { children: React.ReactNode }) {
  return <p className="ml-1 mt-2.5 text-[11.5px] leading-relaxed text-text-muted">{children}</p>;
}

/** A grouped card. Rows inside carry their own inset hairline dividers. */
function Group({ children }: { children: React.ReactNode }) {
  return <div className="glass-card overflow-hidden">{children}</div>;
}

/** Apple-Settings colored icon tile: white (or dark) glyph on a tinted gradient. */
function IconTile({ Icon, grad, dark }: Tile) {
  return (
    <div
      className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] bg-gradient-to-b ${grad} shadow-[0_1px_2px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.25)]`}
    >
      <Icon className={`text-[16px] ${dark ? 'text-black/80' : 'text-white'}`} />
    </div>
  );
}

/** One settings row: tinted icon, label + blurb (+ status), right-hand control. */
function Row({
  first,
  tile,
  label,
  blurb,
  status,
  control,
  children,
}: {
  first?: boolean;
  tile: Tile;
  label: string;
  blurb: string;
  status?: React.ReactNode;
  control: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div>
      {/* Inset hairline — starts where the text starts, iOS-style. */}
      {!first && <div className="ml-[58px] h-px bg-white/[0.055]" />}
      <div className="flex items-center gap-3 px-4 py-3.5">
        <IconTile {...tile} />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium leading-tight text-white">{label}</p>
          <p className="mt-[3px] text-[12.5px] leading-snug text-text-muted">{blurb}</p>
          {status}
        </div>
        <div className="shrink-0 pl-1">{control}</div>
      </div>
      {children && <div className="space-y-2 pb-4 pl-[58px] pr-4">{children}</div>}
    </div>
  );
}

/** Live status line: green "on" / amber "needs action" / muted "off". */
function StatusLine({ tone, text }: { tone: 'on' | 'off' | 'action'; text: string }) {
  const dot =
    tone === 'on'
      ? 'bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.7)]'
      : tone === 'action'
        ? 'bg-amber-400 shadow-[0_0_5px_rgba(251,191,36,0.65)]'
        : 'bg-white/20';
  const txt =
    tone === 'on' ? 'text-emerald-400' : tone === 'action' ? 'text-amber-400' : 'text-text-muted';
  return (
    <p className="mt-[5px] flex items-center gap-1.5 text-[11.5px] font-medium">
      <span className={`h-[6px] w-[6px] shrink-0 rounded-full ${dot}`} />
      <span className={txt}>{text}</span>
    </p>
  );
}

/** iOS-style switch — precise proportions, soft knob shadow, spring travel. */
function Switch({
  on,
  onToggle,
  disabled,
}: {
  on: boolean;
  onToggle: (on: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onToggle(!on)}
      className={`relative h-[31px] w-[51px] shrink-0 rounded-full outline-none transition-colors duration-300 ease-out focus-visible:ring-2 focus-visible:ring-banana/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary disabled:cursor-not-allowed disabled:opacity-50 ${
        on
          ? 'bg-banana shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]'
          : 'bg-white/[0.14] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]'
      }`}
    >
      <span
        className={`absolute left-[2px] top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.35),0_1px_2px_rgba(0,0,0,0.3)] transition-transform duration-300 ease-[cubic-bezier(0.34,1.42,0.64,1)] ${
          on ? 'translate-x-[20px]' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

/** Primary action — the banana-filled "Save"/"Update" pill. */
function PillButton({
  children,
  onClick,
  busy,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className="shrink-0 rounded-full bg-gradient-to-b from-[#fbbf24] to-[#f59e0b] px-4 py-[7px] text-[13px] font-semibold text-[#1a1a1f] shadow-[0_2px_8px_rgba(251,191,36,0.28)] outline-none transition-all duration-150 hover:from-[#fcc63a] hover:to-[#fbbf24] hover:shadow-[0_2px_12px_rgba(251,191,36,0.4)] focus-visible:ring-2 focus-visible:ring-banana/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:shadow-[0_2px_8px_rgba(251,191,36,0.28)]"
    >
      {busy ? '…' : children}
    </button>
  );
}

/** Quiet inline text action, used inside an expanded row. */
function TextAction({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[12px] font-medium text-text-secondary underline decoration-white/20 underline-offset-[3px] outline-none transition-colors hover:text-white focus-visible:text-white"
    >
      {children}
    </button>
  );
}
