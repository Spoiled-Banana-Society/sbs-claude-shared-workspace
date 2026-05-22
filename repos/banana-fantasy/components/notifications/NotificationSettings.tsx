'use client';

/**
 * Notification settings — Apple-style grouped settings.
 *
 * Two groups: which events to be told about, and which channels to be
 * reached on. Each channel can be connected (push permission / email /
 * Telegram / Discord) and independently toggled. Reads/writes
 * /api/notifications/profile.
 *
 * Rendered both as the Profile "Notifications" tab and the standalone
 * /notifications/settings page, so it carries no page chrome of its own.
 */

import { useState, useEffect, useCallback } from 'react';
import type { IconType } from 'react-icons';
import { IoNotifications, IoMail, IoAmericanFootball, IoTime, IoFlash } from 'react-icons/io5';
import { FaTelegramPlane, FaDiscord } from 'react-icons/fa';
import { usePrivy } from '@privy-io/react-auth';
import { useAuth } from '@/hooks/useAuth';
import { usePushSubscription } from '@/hooks/usePushSubscription';

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
      if (res.ok) {
        const d = await res.json();
        setPrefs(d.prefs as Prefs);
        setEmailInput((d.prefs as Prefs).email || '');
      }
    } catch {
      /* leave prefs null — UI shows a retry */
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
    else if (flag === 'error') setBanner('Discord connection failed — please try again.');
  }, []);

  const channelOn = (id: ChannelId) => !!prefs?.channels?.[id];
  // Events default to ON — only an explicit false counts as off.
  const eventOn = (id: EventId) => prefs?.events?.[id] !== false;

  const setChannel = async (id: ChannelId, on: boolean) => {
    setBusy(id);
    // Optimistic.
    setPrefs((p) => (p ? { ...p, channels: { ...p.channels, [id]: on } } : p));
    try {
      const res = await authedFetch('/api/notifications/profile', {
        method: 'PUT',
        body: JSON.stringify({ channels: { [id]: on } }),
      });
      if (res.ok) setPrefs((await res.json()).prefs as Prefs);
    } finally {
      setBusy(null);
    }
  };

  const setEvent = async (id: EventId, on: boolean) => {
    setPrefs((p) => (p ? { ...p, events: { ...p.events, [id]: on } } : p));
    const res = await authedFetch('/api/notifications/profile', {
      method: 'PUT',
      body: JSON.stringify({ events: { [id]: on } }),
    });
    if (res.ok) setPrefs((await res.json()).prefs as Prefs);
  };

  const saveEmail = async () => {
    setBusy('email');
    try {
      const res = await authedFetch('/api/notifications/profile', {
        method: 'PUT',
        body: JSON.stringify({ email: emailInput, channels: { email: true } }),
      });
      if (res.ok) {
        setPrefs((await res.json()).prefs as Prefs);
        setBanner('Email saved — check Spam for the first alert and mark it “Not spam.”');
      }
    } finally {
      setBusy(null);
    }
  };

  const handlePush = async () => {
    const wasConnected = push.state === 'connected';
    const r = wasConnected ? await push.disconnect() : await push.connect();
    if (!r.ok) setBanner(r.error || 'Push action failed — please try again.');
    else setBanner(wasConnected ? 'Push disconnected.' : 'Push connected on this device.');
  };

  const connectTelegram = async () => {
    setBusy('telegram');
    try {
      const res = await authedFetch('/api/notifications/link/telegram');
      if (res.ok) {
        window.open((await res.json()).url, '_blank', 'noopener');
        setBanner('Tap Start in Telegram, then press “Check connection.”');
      } else {
        setBanner('Telegram is not configured yet.');
      }
    } finally {
      setBusy(null);
    }
  };

  const connectDiscord = async () => {
    setBusy('discord');
    try {
      const res = await authedFetch('/api/notifications/link/discord');
      if (res.ok) window.location.href = (await res.json()).url;
      else setBanner('Discord is not configured yet.');
    } finally {
      setBusy(null);
    }
  };

  if (!user?.walletAddress) {
    return (
      <div className="mx-auto max-w-[560px] py-16 text-center text-sm text-text-secondary">
        <p>Sign in to choose how you hear about your drafts.</p>
      </div>
    );
  }

  // Per-channel connection state + the action that connects it.
  const channelConnected = (id: ChannelId): boolean => {
    if (id === 'push') return push.state === 'connected';
    if (id === 'email') return !!prefs?.email;
    if (id === 'telegram') return !!prefs?.telegramChatId;
    return !!prefs?.discordId;
  };
  const connectAction = (id: ChannelId) =>
    id === 'push' ? handlePush : id === 'telegram' ? connectTelegram : connectDiscord;

  return (
    <div className="mx-auto max-w-[560px]">
      {/* Header */}
      <header className="mb-6">
        <h2 className="text-[26px] font-bold tracking-[-0.02em] text-white">Draft alerts</h2>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-text-secondary">
          Choose what you want to know about, and how you want to hear it — connect as
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
          {[2, 3].map((n) => (
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
              Events stay on until you switch them off. Each one still needs at least one
              connected channel below.
            </Caption>
          </section>

          {/* ─── How to reach me ─── */}
          <section>
            <SectionLabel>How to reach me</SectionLabel>
            <Group>
              {CHANNEL_ORDER.map((id, i) => {
                const meta = CHANNEL_META[id];
                const connected = channelConnected(id);
                const rowBusy =
                  busy === id ||
                  (id === 'push' && push.state === 'loading') ||
                  (id === 'push' && push.busy);

                // Right-hand control: a toggle once connected, else a Connect button.
                let control: React.ReactNode;
                if (id === 'email' && !connected) {
                  control = null; // The email input sits in the row body instead.
                } else if (connected) {
                  control = (
                    <div className="flex items-center gap-3">
                      <GhostButton onClick={connectAction(id)} busy={rowBusy}>
                        {id === 'push' ? 'Turn off' : id === 'email' ? 'Change' : 'Reconnect'}
                      </GhostButton>
                      <Switch
                        on={channelOn(id)}
                        disabled={rowBusy}
                        onToggle={(v) => setChannel(id, v)}
                      />
                    </div>
                  );
                } else {
                  control = (
                    <PillButton onClick={connectAction(id)} busy={rowBusy}>
                      Connect
                    </PillButton>
                  );
                }

                return (
                  <Row
                    key={id}
                    first={i === 0}
                    tile={meta.tile}
                    label={meta.label}
                    blurb={meta.blurb}
                    status={
                      <StatusLine connected={connected} detail={id === 'email' ? prefs?.email : undefined} />
                    }
                    control={control}
                  >
                    {id === 'email' && !connected && (
                      <div>
                        <div className="flex gap-2">
                          <input
                            type="email"
                            value={emailInput}
                            onChange={(e) => setEmailInput(e.target.value)}
                            placeholder="you@example.com"
                            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/40 px-3.5 py-2 text-[13.5px] text-white placeholder-text-muted outline-none transition-colors focus:border-banana/50"
                          />
                          <PillButton onClick={saveEmail} busy={busy === 'email'} disabled={!emailInput.trim()}>
                            Save
                          </PillButton>
                        </div>
                        <p className="mt-2 text-[11.5px] leading-relaxed text-text-muted">
                          Your first alert may land in <span className="text-text-secondary">Spam</span> —
                          open it and tap <span className="text-text-secondary">“Not spam.”</span>
                        </p>
                      </div>
                    )}
                    {id === 'telegram' && !connected && (
                      <button
                        onClick={loadProfile}
                        className="text-[12px] font-medium text-text-secondary underline decoration-white/20 underline-offset-[3px] transition-colors hover:text-white"
                      >
                        Already pressed Start? Check connection
                      </button>
                    )}
                  </Row>
                );
              })}
            </Group>
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
  return (
    <p className="ml-1 mt-2.5 text-[11.5px] leading-relaxed text-text-muted">{children}</p>
  );
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
        {control && <div className="shrink-0 pl-1">{control}</div>}
      </div>
      {children && <div className="pb-4 pl-[58px] pr-4">{children}</div>}
    </div>
  );
}

/** Green-dot "Connected" / muted "Not connected" line. */
function StatusLine({ connected, detail }: { connected: boolean; detail?: string }) {
  return (
    <p className="mt-[5px] flex items-center gap-1.5 text-[11.5px] font-medium">
      <span
        className={`h-[6px] w-[6px] rounded-full ${
          connected ? 'bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.7)]' : 'bg-white/20'
        }`}
      />
      {connected ? (
        <span className="text-emerald-400">
          Connected
          {detail ? <span className="font-normal text-text-muted"> · {detail}</span> : ''}
        </span>
      ) : (
        <span className="text-text-muted">Not connected</span>
      )}
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

/** Primary action — the banana-filled "Connect"/"Save" pill. */
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
      className="rounded-full bg-gradient-to-b from-[#fbbf24] to-[#f59e0b] px-4 py-[7px] text-[13px] font-semibold text-[#1a1a1f] shadow-[0_2px_8px_rgba(251,191,36,0.28)] outline-none transition-all duration-150 hover:from-[#fcc63a] hover:to-[#fbbf24] hover:shadow-[0_2px_12px_rgba(251,191,36,0.4)] focus-visible:ring-2 focus-visible:ring-banana/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:shadow-[0_2px_8px_rgba(251,191,36,0.28)]"
    >
      {busy ? '…' : children}
    </button>
  );
}

/** Quiet text action — used for "Reconnect"/"Turn off"/"Change". */
function GhostButton({
  children,
  onClick,
  busy,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="rounded-full px-1 text-[12.5px] font-semibold text-text-secondary outline-none transition-colors duration-150 hover:text-white focus-visible:ring-2 focus-visible:ring-white/20 disabled:opacity-40"
    >
      {busy ? '…' : children}
    </button>
  );
}
