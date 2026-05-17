'use client';

import { useState } from 'react';
import { useRecentErrors, AdminApiError, type ErrorEventEntry } from '@/hooks/admin/useAdminApi';

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function ErrorLog({ enabled }: { enabled: boolean }) {
  const query = useRecentErrors(enabled);
  const allErrors = query.data?.errors ?? [];
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  // Match against wallet (actor), source, route, message. Case-insensitive,
  // partial — paste a wallet prefix and see every error for that user.
  const norm = filter.trim().toLowerCase();
  const errors = norm
    ? allErrors.filter((e) =>
        (e.actor || '').toLowerCase().includes(norm) ||
        (e.source || '').toLowerCase().includes(norm) ||
        (e.route || '').toLowerCase().includes(norm) ||
        (e.message || '').toLowerCase().includes(norm),
      )
    : allErrors;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-white">Error Log — live backend issues</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Auto-refreshes every 15s · {query.isFetching ? 'refreshing…' : norm ? `${errors.length} of ${allErrors.length} match` : `${allErrors.length} recent`}
          </p>
        </div>
        <button
          onClick={() => query.refetch()}
          className="text-xs text-gray-400 hover:text-white underline underline-offset-2"
        >
          ↻ Refresh
        </button>
      </div>

      <div className="relative">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by wallet, source, route, or message…"
          className="w-full px-3 py-2 bg-bg-tertiary/50 border border-gray-700 rounded-lg text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-banana/50"
        />
        {filter && (
          <button
            onClick={() => setFilter('')}
            aria-label="Clear filter"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white text-sm w-6 h-6 flex items-center justify-center"
          >
            ×
          </button>
        )}
      </div>

      {query.isError && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 text-red-200 text-sm px-4 py-3">
          {(query.error as AdminApiError)?.message || 'Failed to load errors'}
        </div>
      )}

      {errors.length === 0 && !query.isLoading ? (
        <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-8 text-center text-gray-500 text-sm">
          {norm ? `No errors match "${filter}"` : 'No backend errors recorded 🎉'}
        </div>
      ) : (
        <div className="space-y-2">
          {errors.map((e, i) => (
            <ErrorRow
              key={`${e.timestamp}-${i}`}
              error={e}
              isOpen={expanded === `${e.timestamp}-${i}`}
              onToggle={() => setExpanded((prev) => (prev === `${e.timestamp}-${i}` ? null : `${e.timestamp}-${i}`))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ErrorRow({ error, isOpen, onToggle }: { error: ErrorEventEntry; isOpen: boolean; onToggle: () => void }) {
  const severity = error.source.includes('failed') || error.source.includes('error') ? 'error' : 'warning';
  const accent = severity === 'error' ? 'border-red-500/40 bg-red-500/[0.06]' : 'border-yellow-500/40 bg-yellow-500/[0.06]';

  return (
    <div className={`rounded-lg border ${accent} overflow-hidden`}>
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-start gap-3 hover:bg-white/[0.02] text-left"
      >
        <span className={severity === 'error' ? 'text-red-400 mt-0.5' : 'text-yellow-400 mt-0.5'}>●</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="font-mono text-sm text-white font-semibold">{error.source}</span>
            {error.route && <span className="text-xs text-gray-400 font-mono">{error.route}</span>}
          </div>
          <p className="text-sm text-gray-300 mt-0.5 truncate">{error.message}</p>
          <div className="flex gap-3 mt-1 text-[11px] text-gray-500">
            <span>{formatDate(error.timestamp)}</span>
            {error.requestId && <span className="font-mono">req: {error.requestId}</span>}
            {error.actor && <span className="font-mono">actor: {error.actor.slice(0, 10)}…</span>}
          </div>
        </div>
        <span className="text-gray-500 text-xs">{isOpen ? '▾' : '▸'}</span>
      </button>
      {isOpen && (
        <div className="border-t border-white/5 px-4 py-3 space-y-2 bg-black/20">
          {error.stack && (
            <div>
              <p className="text-[11px] uppercase text-gray-500 mb-1">Stack</p>
              <pre className="text-[11px] text-gray-300 whitespace-pre-wrap break-all font-mono max-h-48 overflow-auto">{error.stack}</pre>
            </div>
          )}
          {error.context && Object.keys(error.context).length > 0 && (
            <div>
              <p className="text-[11px] uppercase text-gray-500 mb-1">Context</p>
              <pre className="text-[11px] text-gray-300 whitespace-pre-wrap break-all font-mono">{JSON.stringify(error.context, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
