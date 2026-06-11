'use client';

import { useState } from 'react';
import { useSupportInbox, AdminApiError, type CrispConversationEntry } from '@/hooks/admin/useAdminApi';

function ago(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

function unreadCount(u: CrispConversationEntry['unread']): number {
  if (typeof u === 'number') return u;
  return (u?.operator ?? 0);
}

export function SupportInbox({ enabled }: { enabled: boolean }) {
  const [filter, setFilter] = useState<'all' | 'unread' | 'open'>('unread');
  const query = useSupportInbox(enabled, filter);
  const data = query.data;
  const conversations = data?.conversations ?? [];
  const configured = data?.configured ?? true;
  const authFailed = (data as { authFailed?: boolean } | undefined)?.authFailed ?? false;

  return (
    <div className="space-y-4">
      {/* Filter pills + inbox link */}
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 rounded-lg bg-white/[0.03] border border-white/[0.06] p-1">
          {(['unread', 'open', 'all'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors ${
                filter === f ? 'bg-white/[0.08] text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        {data?.inboxUrl && (
          <a
            href={data.inboxUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-400 hover:text-white underline underline-offset-2"
          >
            Open Crisp dashboard ↗
          </a>
        )}
      </div>

      {authFailed && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 text-red-100 text-sm px-4 py-3 space-y-2">
          <p className="font-semibold">Crisp token invalid — inbox can&apos;t load</p>
          <p className="text-xs text-red-200/80">
            Crisp rejected our API token (401 invalid_session). Regenerate it: Crisp Marketplace →
            your plugin → copy the new identifier + key → update{' '}
            <code className="bg-black/30 px-1.5 py-0.5 rounded">CRISP_IDENTIFIER</code> /{' '}
            <code className="bg-black/30 px-1.5 py-0.5 rounded">CRISP_KEY</code> in Vercel → redeploy.
          </p>
        </div>
      )}

      {!configured && (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 text-yellow-100 text-sm px-4 py-3 space-y-2">
          <p className="font-semibold">Crisp API not connected</p>
          <p className="text-xs text-yellow-200/80">
            Add <code className="bg-black/30 px-1.5 py-0.5 rounded">CRISP_IDENTIFIER</code> and{' '}
            <code className="bg-black/30 px-1.5 py-0.5 rounded">CRISP_KEY</code> to Vercel env vars. Get them from{' '}
            <a
              href="https://marketplace.crisp.chat/plugins/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              marketplace.crisp.chat/plugins
            </a>{' '}
            → create a new plugin with conversation read scope → copy Identifier + Key.
          </p>
        </div>
      )}

      {query.isError && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 text-red-200 text-sm px-4 py-3">
          {(query.error as AdminApiError)?.message || 'Failed to load conversations'}
        </div>
      )}

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        {conversations.length === 0 && !query.isLoading ? (
          <div className="px-6 py-12 text-center text-gray-500 text-sm">
            {configured ? 'No conversations match this filter.' : 'Connect Crisp to see conversations.'}
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.04]">
            {conversations.map((c) => {
              const unread = unreadCount(c.unread);
              const name = c.nickname || c.email || 'Anonymous';
              return (
                <li key={c.session_id}>
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors"
                  >
                    <div className="w-9 h-9 rounded-full bg-gray-700 flex items-center justify-center overflow-hidden shrink-0">
                      {c.avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.avatar} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-sm font-semibold text-gray-300">
                          {name.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white truncate">{name}</span>
                        {unread > 0 && (
                          <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-[#F3E216] text-black text-[10px] font-bold px-1.5">
                            {unread}
                          </span>
                        )}
                        {c.state === 'pending' && (
                          <span className="text-[10px] text-yellow-400 uppercase tracking-wider">Pending</span>
                        )}
                        {c.state === 'resolved' && (
                          <span className="text-[10px] text-gray-500 uppercase tracking-wider">Resolved</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 truncate mt-0.5">
                        {c.last_message || <span className="italic text-gray-600">No message</span>}
                      </p>
                    </div>
                    <span className="text-[11px] text-gray-500 shrink-0 mt-1">{ago(c.updated_at)}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="text-[11px] text-gray-500">
        Click a conversation to open it in Crisp where you can reply. Auto-refreshes every 20s.
      </p>
    </div>
  );
}
