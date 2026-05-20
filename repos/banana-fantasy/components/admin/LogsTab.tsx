'use client';

import { useMemo, useState } from 'react';
import { useRecentErrors, useExportErrorSession, AdminApiError, type ErrorEventEntry } from '@/hooks/admin/useAdminApi';
import { logAreaForSource, type LogArea } from '@/lib/logSources';
import { SentryIssues } from '@/components/admin/SentryIssues';

/**
 * Unified admin Logs view. One place for every error — server, browser
 * crashes, uncaught JS, Go backend — with an area filter, plus Sentry's
 * grouped-issue view as a sub-section. Replaces the old separate
 * "Server Errors" + "Frontend Errors" tabs.
 */

type LogMode = 'feed' | 'sentry';

// Filter pills. `all` plus the areas worth slicing by in admin.
const AREA_FILTERS: { key: LogArea | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'payment', label: 'Payment' },
  { key: 'promo', label: 'Promo' },
  { key: 'marketplace', label: 'Marketplace' },
  { key: 'wheel', label: 'Wheel' },
  { key: 'auth', label: 'Auth' },
  { key: 'backend', label: 'Backend' },
  { key: 'global', label: 'Crashes' },
  { key: 'other', label: 'Other' },
];

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function LogsTab({ enabled }: { enabled: boolean }) {
  const [mode, setMode] = useState<LogMode>('feed');

  return (
    <div className="space-y-4">
      {/* Mode switch — error feed vs. Sentry grouped issues */}
      <div className="inline-flex rounded-lg border border-gray-700 bg-bg-tertiary/40 p-0.5 text-xs">
        <button
          onClick={() => setMode('feed')}
          className={`px-3 py-1.5 rounded-md transition-colors ${
            mode === 'feed' ? 'bg-banana text-black font-semibold' : 'text-gray-400 hover:text-white'
          }`}
        >
          Error feed
        </button>
        <button
          onClick={() => setMode('sentry')}
          className={`px-3 py-1.5 rounded-md transition-colors ${
            mode === 'sentry' ? 'bg-banana text-black font-semibold' : 'text-gray-400 hover:text-white'
          }`}
        >
          Sentry issues
        </button>
      </div>

      {mode === 'feed' ? <ErrorFeed enabled={enabled} /> : <SentryIssues enabled={enabled} />}
    </div>
  );
}

function ErrorFeed({ enabled }: { enabled: boolean }) {
  const query = useRecentErrors(enabled);
  const allErrors = useMemo(() => query.data?.errors ?? [], [query.data]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [area, setArea] = useState<LogArea | 'all'>('all');

  // Area filter (source dot-prefix) + free-text filter, both applied.
  const norm = filter.trim().toLowerCase();
  const errors = useMemo(() => {
    return allErrors.filter((e) => {
      if (area !== 'all' && logAreaForSource(e.source) !== area) return false;
      if (!norm) return true;
      return (
        (e.actor || '').toLowerCase().includes(norm) ||
        (e.source || '').toLowerCase().includes(norm) ||
        (e.route || '').toLowerCase().includes(norm) ||
        (e.message || '').toLowerCase().includes(norm) ||
        (e.sessionId || '').toLowerCase().includes(norm)
      );
    });
  }, [allErrors, area, norm]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-white">Error feed — every logged issue</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Auto-refreshes every 15s · {query.isFetching ? 'refreshing…' : `${errors.length} of ${allErrors.length} shown`}
          </p>
        </div>
        <button
          onClick={() => query.refetch()}
          className="text-xs text-gray-400 hover:text-white underline underline-offset-2"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Area filter pills */}
      <div className="flex flex-wrap gap-1.5">
        {AREA_FILTERS.map((f) => {
          const count = f.key === 'all'
            ? allErrors.length
            : allErrors.filter((e) => logAreaForSource(e.source) === f.key).length;
          if (f.key !== 'all' && count === 0) return null;
          return (
            <button
              key={f.key}
              onClick={() => setArea(f.key)}
              className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors ${
                area === f.key
                  ? 'bg-banana text-black border-banana font-semibold'
                  : 'border-gray-700 text-gray-400 hover:text-white hover:border-gray-500'
              }`}
            >
              {f.label} {count > 0 && <span className="opacity-60">{count}</span>}
            </button>
          );
        })}
      </div>

      <div className="relative">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by wallet, source, route, message, or session…"
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
          {norm || area !== 'all' ? 'No errors match this filter' : 'No errors recorded 🎉'}
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
  const area = logAreaForSource(error.source);
  const exportSession = useExportErrorSession();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExport = async () => {
    if (!error.sessionId || exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      await exportSession(error.sessionId);
    } catch (err) {
      setExportError((err as Error).message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className={`rounded-lg border ${accent} overflow-hidden`}>
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-start gap-3 hover:bg-white/[0.02] text-left"
      >
        <span className={severity === 'error' ? 'text-red-400 mt-0.5' : 'text-yellow-400 mt-0.5'}>●</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider text-gray-500 bg-white/[0.04] px-1.5 py-0.5 rounded">{area}</span>
            <span className="font-mono text-sm text-white font-semibold">{error.source}</span>
            {error.route && <span className="text-xs text-gray-400 font-mono">{error.route}</span>}
          </div>
          <p className="text-sm text-gray-300 mt-0.5 truncate">{error.message}</p>
          <div className="flex gap-3 mt-1 text-[11px] text-gray-500 flex-wrap">
            <span>{formatDate(error.timestamp)}</span>
            {error.requestId && <span className="font-mono">req: {error.requestId}</span>}
            {error.actor && <span className="font-mono">actor: {error.actor.slice(0, 10)}…</span>}
            {error.sessionId && <span className="font-mono">session: {error.sessionId}</span>}
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
          {error.sessionId && (
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={handleExport}
                disabled={exporting}
                className="px-2.5 py-1 rounded-md bg-banana/90 hover:bg-banana text-black text-[11px] font-semibold disabled:opacity-50"
                title="Download this error + the user's full session trace as a JSON file to hand to a developer"
              >
                {exporting ? 'Exporting…' : '⬇ Export trace'}
              </button>
              {exportError && <span className="text-[11px] text-red-300">{exportError}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
