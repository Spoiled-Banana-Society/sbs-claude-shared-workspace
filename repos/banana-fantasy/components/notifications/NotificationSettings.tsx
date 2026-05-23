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
import {
  IoNotifications,
  IoMail,
  IoAmericanFootball,
  IoTime,
  IoFlash,
  IoPhonePortrait,
} from 'react-icons/io5';
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

const CHANNEL_META: Record<ChannelId, { label: string; blurb?: string; tile: Tile }> = {
  push: {
    label: 'Push notifications',
    blurb: 'Pop-up alerts on your phone or computer.',
    tile: { Icon: IoPhonePortrait, grad: 'from-[#fbbf24] to-[#f59e0b]', dark: true },
  },
  email: {
    label: 'Email',
    tile: { Icon: IoMail, grad: 'from-[#0a84ff] to-[#0060df]' },
  },
  telegram: {
    label: 'Telegram',
    blurb: 'A DM from the SBS bot.',
    tile: { Icon: FaTelegramPlane, grad: 'from-[#2aabee] to-[#1d93d2]' },
  },
  discord: {
    label: 'Discord',
    blurb: 'Pinged in the SBS Discord server.',
    tile: { Icon: FaDiscord, grad: 'from-[#5865f2] to-[#4752c4]' },
  },
};

const EVENT_META: Record<EventId, { label: string; tile: Tile }> = {
  draftFilled: {
    label: 'Draft starting',
    tile: { Icon: IoAmericanFootball, grad: 'from-[#fbbf24] to-[#f59e0b]', dark: true },
  },
  pickFast: {
    label: 'My pick — fast draft',
    tile: { Icon: IoFlash, grad: 'from-[#ff9f0a] to-[#f08000]' },
  },
  pickSlow: {
    label: 'My pick — slow draft',
    tile: { Icon: IoTime, grad: 'from-[#30d158] to-[#28b14c]' },
  },
};
const EVENT_ORDER: EventId[] = ['draftFilled', 'pickFast', 'pickSlow'];
const CHANNEL_ORDER: ChannelId[] = ['push', 'email', 'telegram', 'discord'];

// Discord @mentions only reach a user who is in the SBS Discord server —
// OAuth links the account but doesn't add them. Surface a join link.
// Env-driven so the invite can be rotated without a redeploy.
const DISCORD_INVITE_URL = process.env.NEXT_PUBLIC_DISCORD_INVITE_URL || '';

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
  // iOS only delivers web push to an installed (home-screen) PWA — Apple's
  // restriction. True when we're on an iPhone/iPad that isn't installed yet.
  const [iosNeedsInstall, setIosNeedsInstall] = useState(false);
  // True when the user is in the installed PWA (home-screen app) — used
  // to surface Discord's iOS-only authorize quirk only where it matters.
  const [isStandalonePWA, setIsStandalonePWA] = useState(false);

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

  // When the user comes back to the PWA after authorizing Discord in
  // Safari, the page becomes visible again — re-fetch prefs so the
  // Discord row flips to "Connected" without a manual refresh.
  useEffect(() => {
    if (!user?.walletAddress) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadProfile();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [user?.walletAddress, loadProfile]);

  // Surface the result of the Discord OAuth round-trip.
  useEffect(() => {
    const flag = new URLSearchParams(window.location.search).get('discord');
    if (flag === 'linked') {
      // Default — covers desktop and the iOS-Safari-after-escape case
      // where the user got pushed out of the PWA into real Safari to
      // finish auth. Tell them to switch back to the home-screen app.
      setBanner('✅ Discord connected. If you started this from the SBS app on your home screen, switch back to it now.');
      // If this tab was popped open from the PWA (window.opener is set),
      // close it shortly after success — iOS returns the user to the
      // PWA they came from automatically.
      if (typeof window !== 'undefined' && window.opener) {
        setBanner('✅ Discord connected — closing this tab…');
        setTimeout(() => window.close(), 1500);
      }
    } else if (flag === 'error') {
      // The callback redirects with ?reason=… naming the exact failure
      // ("oauth_denied_or_error", "invalid_or_expired_state", etc.) —
      // surface it so a tester reading the URL or banner can tell why.
      const reason = new URLSearchParams(window.location.search).get('reason') || '';
      const human = reason ? ` (${reason.replace(/_/g, ' ')})` : '';
      setBanner(`Discord connection failed${human} — please try connecting again.`);
      reportClientError({
        source: LOG_SOURCES.notifications.CHANNEL_CONNECT_FAILED,
        message: `discord oauth callback returned error${reason ? `: ${reason}` : ''}`,
        route: 'notifications-settings',
        context: { reason: reason || 'unknown' },
      });
    }
  }, []);

  // Detect an iPhone/iPad that hasn't been added to the home screen — iOS
  // only delivers web push to an installed PWA.
  useEffect(() => {
    const ua = navigator.userAgent || '';
    const isIOS =
      /iP(hone|ad|od)/.test(ua) ||
      // iPadOS 13+ reports as a Mac; disambiguate via touch support.
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone =
      window.matchMedia?.('(display-mode: standalone)')?.matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setIosNeedsInstall(isIOS && !standalone);
    setIsStandalonePWA(standalone);
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

    const isStandalonePWA =
      window.matchMedia?.('(display-mode: standalone)')?.matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;

    // iOS PWAs route window.open to SFSafariViewController; we have no
    // way out of that programmatically. Pre-open a blank tab inside the
    // user gesture so iOS keeps it as user-initiated, then point it at
    // the OAuth URL once the server hands it back. First load may need
    // a manual refresh in that tab — that's the iOS quirk, banner says so.
    const pwaTab: Window | null = isStandalonePWA ? window.open('about:blank', '_blank') : null;

    try {
      const res = await authedFetch('/api/notifications/link/discord');
      if (!res.ok) throw new Error(`link/discord ${res.status}`);
      const url = (await res.json()).url as string;

      if (pwaTab) {
        pwaTab.location.href = url;
        setBanner(
          'Authorizing Discord in a new tab. If it shows a blank page, tap refresh in that tab. Come back here after — your Discord row will update on its own.',
        );
        setBusy(null);
      } else if (isStandalonePWA) {
        window.open(url, '_blank');
        setBusy(null);
      } else {
        window.location.href = url; // desktop / non-PWA — same-window redirect
      }
    } catch (err) {
      if (pwaTab) pwaTab.close();
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
  // Always flip the channel flag too — so the toggle visually stays on,
  // the row's "needs action" state renders, and the PWA "Authorize in
  // Safari" link appears in the row's children.
  const toggleDiscord = (on: boolean) => {
    patchChannel('discord', on);
    if (on && !channelLinked('discord')) connectDiscord();
  };

  // Truly disconnect a linked channel — clears the stored account so the
  // next connect re-runs the login (lets the user link a different one).
  const disconnectChannel = async (id: 'telegram' | 'discord') => {
    setBusy(id);
    clientLog('notifications', 'channel-disconnect', { channel: id });
    try {
      const res = await authedFetch('/api/notifications/profile', {
        method: 'PUT',
        body: JSON.stringify({ unlink: id }),
      });
      if (!res.ok) throw new Error(`PUT profile ${res.status}`);
      setPrefs((await res.json()).prefs as Prefs);
      setBanner(`${CHANNEL_META[id].label} disconnected — connect again to link a different account.`);
    } catch (err) {
      setBanner(`Couldn’t disconnect ${CHANNEL_META[id].label} — please try again.`);
      reportIssue(LOG_SOURCES.notifications.SETTINGS_SAVE_FAILED, `channel disconnect failed: ${id}`, {
        channel: id,
        error: String(err),
      });
    } finally {
      setBusy(null);
    }
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
          Choose how you get notified when drafts fill and when it&apos;s your pick.
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
          {/* ─── Which alerts ─── */}
          <section>
            <Group>
              {EVENT_ORDER.map((id, i) => (
                <Row
                  key={id}
                  first={i === 0}
                  tile={EVENT_META[id].tile}
                  label={EVENT_META[id].label}
                  control={<Switch on={eventOn(id)} onToggle={(v) => setEvent(id, v)} />}
                />
              ))}
            </Group>
          </section>

          {/* ─── Places you'll get notified ─── */}
          <section>
            <SectionLabel>Places you&apos;ll get notified</SectionLabel>
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
                    {id === 'discord' && isStandalonePWA && (!linked || !on) && (
                      // iOS PWA quirk: the OAuth tab is SFSafariViewController
                      // — a separate cookie jar from real Safari, so it can't
                      // see the user's Discord login session. The bottom-right
                      // Safari button hands off to real Safari, where they're
                      // already signed in. Show this BEFORE the toggle tap so
                      // they know what's coming — and also when toggled off
                      // (linked or not), so the user has guidance + a switch-
                      // account option at the bottom.
                      <div className="text-[12px] leading-relaxed text-amber-400/95">
                        <p className="mb-1.5 font-semibold">📱 Mobile only — must use Safari:</p>
                        <ol className="ml-5 list-decimal space-y-0.5">
                          <li>Toggle Discord on (a new tab opens)</li>
                          <li>
                            Tap the Safari icon{' '}
                            <span
                              aria-hidden
                              className="inline-flex h-[16px] w-[16px] translate-y-[3px] items-center justify-center"
                            >
                              {/* Apple Safari logo: outline circle + a
                                  horizontal compass-needle "lens" with a
                                  tiny pivot hole at the center. Drawn as
                                  one path with even-odd fill so the hole
                                  shows the background through. */}
                              <svg
                                viewBox="0 0 24 24"
                                width="16"
                                height="16"
                                aria-hidden
                              >
                                <circle
                                  cx="12"
                                  cy="12"
                                  r="9.5"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                />
                                <path
                                  d="M4 12 L12 9 L20 12 L12 15 Z M10.7 12 a1.3 1.3 0 1 0 2.6 0 a1.3 1.3 0 1 0 -2.6 0 Z"
                                  fill="currentColor"
                                  fillRule="evenodd"
                                />
                              </svg>
                            </span>{' '}
                            (bottom-right)
                          </li>
                          <li>Refresh that tab if it&apos;s blank</li>
                          <li>Tap <span className="font-semibold">Authorize</span></li>
                          <li>Come back to this app</li>
                        </ol>
                      </div>
                    )}
                    {(id === 'telegram' || id === 'discord') && linked && (
                      <TextAction onClick={() => disconnectChannel(id)}>
                        Use a different account
                      </TextAction>
                    )}
                    {id === 'discord' && on && DISCORD_INVITE_URL && (
                      <p className="text-[12px] leading-relaxed text-text-muted">
                        Pings only reach you inside the SBS Discord —{' '}
                        <a
                          href={DISCORD_INVITE_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-text-secondary underline decoration-white/20 underline-offset-[3px] transition-colors hover:text-white"
                        >
                          join the server
                        </a>{' '}
                        if you haven&apos;t yet.
                      </p>
                    )}
                    {id === 'push' && iosNeedsInstall && !on && (
                      <p className="text-[12px] leading-relaxed text-amber-400/90">
                        On iPhone, add SBS to your home screen first — tap the Share
                        button, then “Add to Home Screen.”
                      </p>
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
  blurb?: string;
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
          {blurb && (
            <p className="mt-[3px] text-[12.5px] leading-snug text-text-muted">{blurb}</p>
          )}
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
