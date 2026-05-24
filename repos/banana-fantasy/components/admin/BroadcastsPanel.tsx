'use client';

/**
 * Broadcasts — admin composer for DM-all-users push + email.
 *
 * Phase 5 of the admin overhaul (May 2026). Lives inside the Tools tab
 * for now; if Boris uses it a lot we'll promote it to its own top-level
 * tab in a follow-up.
 *
 * The audience picker has three states matching the API:
 *   - all                    every push subscriber + every email on file
 *   - kyc-approved           only wallets with kycStatus == 'approved'
 *   - wallets (manual list)  paste a wallet list (one per line / comma-sep)
 *
 * The Send button always asks `confirm()` before firing — broadcasts are
 * loud and irreversible.
 */

import { useMemo, useState } from 'react';
import { useAdminAuthHeaders } from '@/hooks/admin/useAdminApi';

type AudienceKind = 'all' | 'kyc-approved' | 'wallets';
type ChannelId = 'push' | 'email';

interface ResultRow {
  channel: 'push' | 'email';
  status: 'sent' | 'skipped' | 'failed';
  recipients?: number;
  reason?: string;
}

interface SendResponse {
  ok?: boolean;
  results?: ResultRow[];
  targetCount?: number;
  requestId?: string;
  error?: string;
}

const WALLET_RE = /0x[0-9a-fA-F]{40}/g;

export function BroadcastsPanel() {
  const getHeaders = useAdminAuthHeaders();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('/');
  const [audience, setAudience] = useState<AudienceKind>('kyc-approved');
  const [walletList, setWalletList] = useState('');
  const [push, setPush] = useState(true);
  const [email, setEmail] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsedWallets = useMemo(() => {
    const matches = walletList.match(WALLET_RE) ?? [];
    return Array.from(new Set(matches.map((w) => w.toLowerCase())));
  }, [walletList]);

  const canSend =
    !sending &&
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    (push || email) &&
    (audience !== 'wallets' || parsedWallets.length > 0);

  const send = async () => {
    setError(null);
    setResult(null);
    const channels: ChannelId[] = [];
    if (push) channels.push('push');
    if (email) channels.push('email');

    const aud: 'all' | { kind: 'kyc-approved' } | { kind: 'wallets'; wallets: string[] } =
      audience === 'all'
        ? 'all'
        : audience === 'kyc-approved'
          ? { kind: 'kyc-approved' }
          : { kind: 'wallets', wallets: parsedWallets };

    const audienceLabel =
      audience === 'all'
        ? 'EVERY USER'
        : audience === 'kyc-approved'
          ? 'every KYC-approved user'
          : `${parsedWallets.length} wallet${parsedWallets.length === 1 ? '' : 's'}`;
    const channelLabel = channels.join(' + ');
    if (!window.confirm(
      `Send "${title.trim()}" via ${channelLabel} to ${audienceLabel}?\n\nThis is irreversible.`,
    )) return;

    setSending(true);
    try {
      const headers = await getHeaders();
      const res = await fetch('/api/admin/broadcasts', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), body: body.trim(), url, channels, audience: aud }),
      });
      const json = (await res.json().catch(() => ({}))) as SendResponse;
      if (!res.ok) {
        setError(json.error || `${res.status}`);
      } else {
        setResult(json);
        // Don't clear the form — admin might want to tweak and re-send.
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-white">Broadcasts — DM all users</h3>
        <p className="text-[12px] text-gray-500 mt-0.5">
          Fires a push notification and/or email to a filtered audience. Loud, irreversible — confirm twice.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <label className="block">
            <span className="text-[11px] uppercase text-gray-500 tracking-wider">Title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              className="mt-1 w-full px-3 py-2 rounded-md bg-black/40 border border-white/[0.08] text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-banana/40"
              placeholder="🎉 New season is live"
            />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase text-gray-500 tracking-wider">Body</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={1000}
              rows={4}
              className="mt-1 w-full px-3 py-2 rounded-md bg-black/40 border border-white/[0.08] text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-banana/40 resize-y"
              placeholder="Tap to enter the new season drafts before they fill up."
            />
            <span className="text-[10px] text-gray-500 mt-1 block">{body.length} / 1000</span>
          </label>
          <label className="block">
            <span className="text-[11px] uppercase text-gray-500 tracking-wider">Click URL (optional)</span>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-md bg-black/40 border border-white/[0.08] text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-banana/40 font-mono"
              placeholder="/drafting"
            />
          </label>
        </div>

        <div className="space-y-3">
          <div>
            <span className="text-[11px] uppercase text-gray-500 tracking-wider">Channels</span>
            <div className="mt-1 flex gap-3">
              <label className="inline-flex items-center gap-2 text-sm text-gray-200">
                <input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} className="accent-banana" />
                Push
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-gray-200">
                <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} className="accent-banana" />
                Email
              </label>
            </div>
          </div>
          <div>
            <span className="text-[11px] uppercase text-gray-500 tracking-wider">Audience</span>
            <div className="mt-1 space-y-1.5">
              {(
                [
                  { value: 'all' as const, label: 'Everyone (all push subscribers + all on-file emails)' },
                  { value: 'kyc-approved' as const, label: 'KYC-approved users only' },
                  { value: 'wallets' as const, label: 'Manual wallet list (paste below)' },
                ]
              ).map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 text-sm text-gray-200 cursor-pointer">
                  <input
                    type="radio"
                    name="audience"
                    checked={audience === opt.value}
                    onChange={() => setAudience(opt.value)}
                    className="accent-banana"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
          {audience === 'wallets' && (
            <label className="block">
              <span className="text-[11px] uppercase text-gray-500 tracking-wider">
                Wallets {parsedWallets.length > 0 && <span className="text-banana">({parsedWallets.length} matched)</span>}
              </span>
              <textarea
                value={walletList}
                onChange={(e) => setWalletList(e.target.value)}
                rows={4}
                className="mt-1 w-full px-3 py-2 rounded-md bg-black/40 border border-white/[0.08] text-[11px] text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-banana/40 font-mono resize-y"
                placeholder="One per line, or comma-separated. 0x prefixed."
              />
            </label>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          className="px-4 py-2 rounded-md bg-banana hover:bg-banana/80 text-black text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {sending ? 'Sending…' : 'Send broadcast'}
        </button>
        {error && <span className="text-[12px] text-red-300">{error}</span>}
      </div>

      {result && (
        <div className="rounded-md border border-white/[0.06] bg-black/30 p-3 space-y-1.5">
          <p className="text-[11px] uppercase text-gray-500">Last result · target {result.targetCount ?? '—'}</p>
          {(result.results ?? []).map((r) => (
            <div key={r.channel} className="flex items-center justify-between text-[12px]">
              <span className="capitalize text-gray-300">{r.channel}</span>
              <span
                className={
                  r.status === 'sent'
                    ? 'text-emerald-300'
                    : r.status === 'skipped'
                      ? 'text-gray-400'
                      : 'text-red-300'
                }
              >
                {r.status}{r.recipients !== undefined ? ` · ${r.recipients} recipients` : ''}{r.reason ? ` · ${r.reason}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
