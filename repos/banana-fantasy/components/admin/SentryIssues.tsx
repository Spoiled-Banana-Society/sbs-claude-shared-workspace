'use client';

import { useSentryIssues, AdminApiError, type SentryIssueEntry } from '@/hooks/admin/useAdminApi';

function formatRelative(iso: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function levelClasses(level: string): string {
  const l = level.toLowerCase();
  if (l === 'fatal' || l === 'error') return 'bg-red-500/10 text-red-300 border-red-500/30';
  if (l === 'warning') return 'bg-yellow-500/10 text-yellow-300 border-yellow-500/30';
  if (l === 'info') return 'bg-blue-500/10 text-blue-300 border-blue-500/30';
  return 'bg-gray-500/10 text-gray-300 border-gray-500/30';
}

function IssueRow({ issue }: { issue: SentryIssueEntry }) {
  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-4 hover:bg-gray-800/80 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${levelClasses(issue.level)}`}>
              {issue.level}
            </span>
            <span className="text-[11px] text-gray-500 font-mono">{issue.shortId}</span>
          </div>
          <p className="text-sm text-white font-medium truncate" title={issue.title}>
            {issue.title}
          </p>
          {issue.culprit ? (
            <p className="text-[12px] text-gray-400 truncate font-mono mt-0.5" title={issue.culprit}>
              {issue.culprit}
            </p>
          ) : null}
          <div className="flex items-center gap-4 mt-2 text-[11px] text-gray-500">
            <span>
              <span className="text-gray-300 font-semibold">{issue.count}</span> events
            </span>
            <span>
              <span className="text-gray-300 font-semibold">{issue.userCount}</span> users
            </span>
            <span>last {formatRelative(issue.lastSeen)}</span>
          </div>
        </div>
        {issue.permalink ? (
          <a
            href={issue.permalink}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-amber-400 hover:text-amber-300 underline underline-offset-2 shrink-0"
          >
            View →
          </a>
        ) : null}
      </div>
    </div>
  );
}

export function SentryIssues({ enabled }: { enabled: boolean }) {
  const query = useSentryIssues(enabled);
  const issues = query.data?.issues ?? [];
  const configured = query.data?.configured ?? true;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">Frontend Errors (Sentry) — last 24h</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Auto-refreshes every 30s · {query.isFetching ? 'refreshing…' : `${issues.length} unresolved`}
          </p>
        </div>
        <button
          onClick={() => query.refetch()}
          className="text-xs text-gray-400 hover:text-white underline underline-offset-2"
        >
          ↻ Refresh
        </button>
      </div>

      {!configured && (
        <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 text-yellow-200 text-sm px-4 py-3">
          Sentry isn&apos;t configured on the server. Set <code className="text-[12px]">SENTRY_AUTH_TOKEN</code> in Vercel env to enable this view.
        </div>
      )}

      {query.isError && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 text-red-200 text-sm px-4 py-3">
          {(query.error as AdminApiError)?.message || 'Failed to load Sentry issues'}
        </div>
      )}

      {configured && issues.length === 0 && !query.isLoading ? (
        <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-8 text-center text-gray-500 text-sm">
          No frontend errors in the last 24h 🎉
        </div>
      ) : (
        <div className="space-y-2">
          {issues.map((issue) => (
            <IssueRow key={issue.id} issue={issue} />
          ))}
        </div>
      )}
    </div>
  );
}
