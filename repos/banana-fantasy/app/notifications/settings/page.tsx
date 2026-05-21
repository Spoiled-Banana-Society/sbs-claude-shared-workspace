'use client';

/**
 * Notification settings — one row per channel. Each channel can be
 * connected (push permission / email address / Telegram / Discord) and
 * independently toggled on or off. A user may enable any combination,
 * including all four. Reads/writes /api/notifications/profile.
 */

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { useAuth } from '@/hooks/useAuth';
import { useNotificationOptIn } from '@/hooks/useNotificationOptIn';

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
  push: { label: 'Home screen / push', emoji: '🔔', blurb: 'Browser & installed-app notifications.' },
  email: { label: 'Email', emoji: '✉️', blurb: 'A fast backup in your inbox.' },
  telegram: { label: 'Telegram', emoji: '✈️', blurb: 'Instant — the most reliable channel.' },
  discord: { label: 'Discord', emoji: '🎮', blurb: 'Pinged in the SBS Discord server.' },
};

const EVENT_META: Record<EventId, { label: string; blurb: string }> = {
  draftFilled: { label: 'A draft I joined fills up', blurb: 'When all 10 spots are in and the draft starts.' },
  pickSlow: { label: 'My pick — slow drafts', blurb: 'Long pick clock (hours). You stepped away — get pinged.' },
  pickFast: { label: 'My pick — fast drafts', blurb: 'Quick pick clock (seconds). Most players watch live.' },
};
const EVENT_ORDER: EventId[] = ['draftFilled', 'pickSlow', 'pickFast'];

export default function NotificationSettingsPage() {
  const { user } = useAuth();
  const { getAccessToken } = usePrivy();
  const { isSubscribed, acceptOptIn, isLoading: pushLoading } = useNotificationOptIn();

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
    if (flag === 'linked') setBanner('Discord connected ✅');
    else if (flag === 'error') setBanner('Discord connection failed — please try again.');
  }, []);

  const channelOn = (id: ChannelId) => !!prefs?.channels?.[id];
  // Events default to ON — only an explicit false counts as off.
  const eventOn = (id: EventId) => prefs?.events?.[id] !== false;

  const setChannel = async (id: ChannelId, on: boolean) => {
    setBusy(id);
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
    // Optimistic — event toggles should feel instant.
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
        setBanner('Email saved ✅');
      }
    } finally {
      setBusy(null);
    }
  };

  const connectTelegram = async () => {
    setBusy('telegram');
    try {
      const res = await authedFetch('/api/notifications/link/telegram');
      if (res.ok) {
        window.open((await res.json()).url, '_blank', 'noopener');
        setBanner('Tap Start in Telegram, then press "Check connection".');
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
      <main className="mx-auto max-w-xl px-4 py-16 text-center text-gray-300">
        <h1 className="mb-3 text-2xl font-bold text-white">Notification settings</h1>
        <p>Sign in to choose how you get draft alerts.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <div className="mb-6">
        <Link href="/notifications" className="text-sm text-gray-400 hover:text-white">
          ← Notifications
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-white">Draft alerts</h1>
        <p className="mt-1 text-sm text-gray-400">
          Pick how you want to hear that a draft filled or it&apos;s your pick. Connect
          and switch on as many as you like.
        </p>
      </div>

      {banner && (
        <div className="mb-4 rounded-lg border border-[#fbbf24]/30 bg-[#fbbf24]/10 px-4 py-2 text-sm text-[#fbbf24]">
          {banner}
        </div>
      )}

      {loading ? (
        <p className="text-gray-400">Loading…</p>
      ) : (
        <>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
            What to tell me about
          </h2>
          <div className="mb-6 space-y-3">
            {EVENT_ORDER.map((id) => (
              <ToggleRow
                key={id}
                label={EVENT_META[id].label}
                blurb={EVENT_META[id].blurb}
                on={eventOn(id)}
                onToggle={(v) => setEvent(id, v)}
              />
            ))}
          </div>

          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
            How to reach me
          </h2>
          <div className="space-y-3">
          {/* Push */}
          <ChannelRow
            id="push"
            connected={isSubscribed}
            on={channelOn('push')}
            busy={busy === 'push' || pushLoading}
            connectLabel={isSubscribed ? 'Connected' : 'Enable'}
            onConnect={acceptOptIn}
            onToggle={(v) => setChannel('push', v)}
          />

          {/* Email */}
          <ChannelRow
            id="email"
            connected={!!prefs?.email}
            on={channelOn('email')}
            busy={busy === 'email'}
            connected_detail={prefs?.email}
            onToggle={(v) => setChannel('email', v)}
          >
            <div className="mt-3 flex gap-2">
              <input
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="you@example.com"
                className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-[#fbbf24]/50"
              />
              <button
                onClick={saveEmail}
                disabled={busy === 'email' || !emailInput.trim()}
                className="rounded-lg bg-[#fbbf24] px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </ChannelRow>

          {/* Telegram */}
          <ChannelRow
            id="telegram"
            connected={!!prefs?.telegramChatId}
            on={channelOn('telegram')}
            busy={busy === 'telegram'}
            connectLabel={prefs?.telegramChatId ? 'Reconnect' : 'Connect'}
            onConnect={connectTelegram}
            onToggle={(v) => setChannel('telegram', v)}
          >
            {!prefs?.telegramChatId && (
              <button
                onClick={loadProfile}
                className="mt-2 text-xs text-gray-400 underline hover:text-white"
              >
                Check connection
              </button>
            )}
          </ChannelRow>

          {/* Discord */}
          <ChannelRow
            id="discord"
            connected={!!prefs?.discordId}
            on={channelOn('discord')}
            busy={busy === 'discord'}
            connectLabel={prefs?.discordId ? 'Reconnect' : 'Connect'}
            onConnect={connectDiscord}
            onToggle={(v) => setChannel('discord', v)}
          />
          </div>
        </>
      )}
    </main>
  );
}

/** A label + blurb + on/off toggle, with no connect action. */
function ToggleRow({
  label,
  blurb,
  on,
  onToggle,
}: {
  label: string;
  blurb: string;
  on: boolean;
  onToggle: (on: boolean) => void;
}) {
  return (
    <div className="glass-card flex items-center justify-between gap-3 rounded-xl border border-white/10 p-4">
      <div className="min-w-0">
        <p className="font-semibold text-white">{label}</p>
        <p className="mt-0.5 text-xs text-gray-400">{blurb}</p>
      </div>
      <button
        role="switch"
        aria-checked={on}
        aria-label={`Toggle ${label}`}
        onClick={() => onToggle(!on)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          on ? 'bg-[#fbbf24]' : 'bg-white/15'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
            on ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}

/** A single channel row: icon, label, connection state, connect + toggle. */
function ChannelRow({
  id,
  connected,
  connected_detail,
  on,
  busy,
  connectLabel,
  onConnect,
  onToggle,
  children,
}: {
  id: ChannelId;
  connected: boolean;
  connected_detail?: string;
  on: boolean;
  busy: boolean;
  connectLabel?: string;
  onConnect?: () => void;
  onToggle: (on: boolean) => void;
  children?: React.ReactNode;
}) {
  const meta = CHANNEL_META[id];
  return (
    <div className="glass-card rounded-xl border border-white/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-white">
            <span className="mr-2">{meta.emoji}</span>
            {meta.label}
          </p>
          <p className="mt-0.5 text-xs text-gray-400">{meta.blurb}</p>
          <p className="mt-1 text-xs">
            {connected ? (
              <span className="text-green-400">
                Connected{connected_detail ? ` · ${connected_detail}` : ''}
              </span>
            ) : (
              <span className="text-gray-500">Not connected</span>
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {onConnect && (
            <button
              onClick={onConnect}
              disabled={busy}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/5 disabled:opacity-40"
            >
              {busy ? '…' : connectLabel}
            </button>
          )}
          {/* On/off toggle */}
          <button
            role="switch"
            aria-checked={on}
            aria-label={`Toggle ${meta.label}`}
            disabled={busy}
            onClick={() => onToggle(!on)}
            className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-40 ${
              on ? 'bg-[#fbbf24]' : 'bg-white/15'
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                on ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}
