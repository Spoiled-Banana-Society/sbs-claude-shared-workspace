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

const CHANNEL_META: Record<ChannelId, { label: string; emoji: string; blurb: string }> = {
  push: { label: 'Home screen & push', emoji: '🔔', blurb: 'Browser and installed-app notifications.' },
  email: { label: 'Email', emoji: '✉️', blurb: 'A reliable backup, straight to your inbox.' },
  telegram: { label: 'Telegram', emoji: '✈️', blurb: 'Instant — the most reliable channel.' },
  discord: { label: 'Discord', emoji: '🎮', blurb: 'Pinged in the SBS Discord server.' },
};

const EVENT_META: Record<EventId, { label: string; emoji: string; blurb: string }> = {
  draftFilled: { label: 'A draft I joined fills up', emoji: '🍌', blurb: 'All 10 spots are in — the draft starts.' },
  pickSlow: { label: 'My pick — slow drafts', emoji: '🐢', blurb: 'Long pick clock. You stepped away — get pinged.' },
  pickFast: { label: 'My pick — fast drafts', emoji: '⚡️', blurb: 'Quick pick clock. Most players watch live.' },
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
      <div className="mx-auto max-w-xl py-16 text-center text-text-secondary">
        <p>Sign in to choose how you hear about your drafts.</p>
      </div>
    );
  }

  // Per-channel connection state + the right-hand control.
  const channelConnected = (id: ChannelId): boolean => {
    if (id === 'push') return push.state === 'connected';
    if (id === 'email') return !!prefs?.email;
    if (id === 'telegram') return !!prefs?.telegramChatId;
    return !!prefs?.discordId;
  };
  const channelDetail = (id: ChannelId): string | undefined =>
    id === 'email' ? prefs?.email : undefined;

  return (
    <div className="mx-auto max-w-xl">
      {/* Header */}
      <div className="mb-7">
        <h2 className="text-[22px] font-bold tracking-tight text-text-primary">Draft alerts</h2>
        <p className="mt-1 text-sm leading-relaxed text-text-muted">
          Choose what you want to know about, and how you want to hear it. Connect and
          switch on as many channels as you like.
        </p>
      </div>

      {banner && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-banana/25 bg-banana/[0.08] px-4 py-3 text-[13px] leading-relaxed text-banana">
          <span aria-hidden>🔔</span>
          <span>{banner}</span>
          <button
            onClick={() => setBanner(null)}
            className="ml-auto -mr-1 -mt-0.5 shrink-0 rounded p-0.5 text-banana/60 hover:text-banana"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[68px] animate-pulse rounded-xl bg-white/[0.04]" />
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
                  emoji={EVENT_META[id].emoji}
                  label={EVENT_META[id].label}
                  blurb={EVENT_META[id].blurb}
                  control={<Switch on={eventOn(id)} onToggle={(v) => setEvent(id, v)} />}
                />
              ))}
            </Group>
          </section>

          {/* ─── How to reach me ─── */}
          <section>
            <SectionLabel>How to reach me</SectionLabel>
            <Group>
              {CHANNEL_ORDER.map((id, i) => {
                const meta = CHANNEL_META[id];
                const connected = channelConnected(id);
                const detail = channelDetail(id);
                const rowBusy =
                  busy === id || (id === 'push' && push.state === 'loading') || (id === 'push' && push.busy);

                // Right-hand control: toggle once connected, else a Connect button.
                let control: React.ReactNode;
                if (id === 'email') {
                  control = connected ? (
                    <Switch on={channelOn('email')} onToggle={(v) => setChannel('email', v)} />
                  ) : null;
                } else if (connected) {
                  control = (
                    <div className="flex items-center gap-2.5">
                      <PillButton
                        onClick={
                          id === 'push'
                            ? handlePush
                            : id === 'telegram'
                              ? connectTelegram
                              : connectDiscord
                        }
                        busy={rowBusy}
                        subtle
                      >
                        {id === 'push' ? 'Disconnect' : 'Reconnect'}
                      </PillButton>
                      <Switch
                        on={channelOn(id)}
                        disabled={rowBusy}
                        onToggle={(v) => setChannel(id, v)}
                      />
                    </div>
                  );
                } else {
                  control = (
                    <PillButton
                      onClick={
                        id === 'push'
                          ? handlePush
                          : id === 'telegram'
                            ? connectTelegram
                            : connectDiscord
                      }
                      busy={rowBusy}
                    >
                      Connect
                    </PillButton>
                  );
                }

                return (
                  <Row
                    key={id}
                    first={i === 0}
                    emoji={meta.emoji}
                    label={meta.label}
                    blurb={meta.blurb}
                    status={
                      <StatusLine connected={connected} detail={detail} />
                    }
                    control={control}
                  >
                    {id === 'email' && (
                      <div className="mt-3">
                        <div className="flex gap-2">
                          <input
                            type="email"
                            value={emailInput}
                            onChange={(e) => setEmailInput(e.target.value)}
                            placeholder="you@example.com"
                            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-text-primary placeholder-text-muted outline-none transition-colors focus:border-banana/50"
                          />
                          <PillButton
                            onClick={saveEmail}
                            busy={busy === 'email'}
                            disabled={!emailInput.trim()}
                          >
                            Save
                          </PillButton>
                        </div>
                        <p className="mt-2 text-[12px] leading-relaxed text-text-muted">
                          📬 Your first alert may land in <span className="text-text-secondary">Spam</span> or
                          Promotions — open it and tap{' '}
                          <span className="text-text-secondary">“Not spam”</span> so the rest reach your inbox.
                        </p>
                      </div>
                    )}
                    {id === 'telegram' && !connected && (
                      <button
                        onClick={loadProfile}
                        className="mt-2 text-[12px] font-medium text-text-muted underline decoration-white/20 underline-offset-2 hover:text-text-secondary"
                      >
                        Check connection
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
    <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
      {children}
    </p>
  );
}

/** A grouped card — rows inside share hairline dividers. */
function Group({ children }: { children: React.ReactNode }) {
  return (
    <div className="glass-card overflow-hidden">
      <div className="divide-y divide-white/[0.06]">{children}</div>
    </div>
  );
}

/** One settings row: tinted icon, label + blurb (+ status), right-hand control. */
function Row({
  emoji,
  label,
  blurb,
  status,
  control,
  children,
}: {
  first?: boolean;
  emoji: string;
  label: string;
  blurb: string;
  status?: React.ReactNode;
  control: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-white/[0.06] text-[17px]">
          {emoji}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium leading-tight text-text-primary">{label}</p>
          <p className="mt-0.5 text-[12.5px] leading-snug text-text-muted">{blurb}</p>
          {status}
        </div>
        <div className="shrink-0">{control}</div>
      </div>
      {children}
    </div>
  );
}

/** Green-dot "Connected" / muted "Not connected" line. */
function StatusLine({ connected, detail }: { connected: boolean; detail?: string }) {
  return (
    <p className="mt-1 flex items-center gap-1.5 text-[12px]">
      <span
        className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-white/25'}`}
      />
      {connected ? (
        <span className="text-emerald-400">
          Connected{detail ? <span className="text-text-muted"> · {detail}</span> : ''}
        </span>
      ) : (
        <span className="text-text-muted">Not connected</span>
      )}
    </p>
  );
}

/** iOS-style switch. */
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
      className={`relative h-[27px] w-[46px] shrink-0 rounded-full transition-colors duration-200 ease-out disabled:opacity-40 ${
        on ? 'bg-banana' : 'bg-white/15'
      }`}
    >
      <span
        className={`absolute top-[2.5px] h-[22px] w-[22px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.45)] transition-transform duration-200 ease-out ${
          on ? 'translate-x-[21px]' : 'translate-x-[2.5px]'
        }`}
      />
    </button>
  );
}

/** Compact pill button — banana-filled by default, subtle outline variant. */
function PillButton({
  children,
  onClick,
  busy,
  disabled,
  subtle,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  busy?: boolean;
  disabled?: boolean;
  subtle?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-all duration-150 active:scale-[0.97] disabled:opacity-40 ${
        subtle
          ? 'border border-white/15 text-text-secondary hover:bg-white/[0.06] hover:text-text-primary'
          : 'bg-gradient-to-b from-[#fbbf24] to-[#f59e0b] text-[#1a1a1f] shadow-[0_2px_8px_rgba(251,191,36,0.25)] hover:from-[#fcc63a] hover:to-[#fbbf24]'
      }`}
    >
      {busy ? '…' : children}
    </button>
  );
}
