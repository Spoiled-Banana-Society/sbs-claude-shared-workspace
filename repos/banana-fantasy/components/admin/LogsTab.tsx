'use client';

import { useMemo, useState } from 'react';
import { useRecentErrors, useExportErrorSession, AdminApiError, type ErrorEventEntry } from '@/hooks/admin/useAdminApi';
import { logAreaForSource, logSeverity, isTestNoiseError, explainError, type LogArea, type LogSeverity } from '@/lib/logSources';
import { SentryIssues } from '@/components/admin/SentryIssues';
import { WalletLink } from '@/components/admin/WalletLink';
import { GroupSparkline } from '@/components/admin/Logs/GroupSparkline';
import { RunbookEditor } from '@/components/admin/Logs/RunbookEditor';

/**
 * Unified admin Logs view. Built to be read at a glance by a non-dev:
 *  - One triage banner tells you if anything needs attention NOW.
 *  - Errors are grouped (99 identical errors → one "×99" row).
 *  - Split into Critical / Warning / Earlier (quiet) / Test traffic.
 *  - Test-suite noise is hidden by default.
 */

type LogMode = 'feed' | 'sentry';

// An issue is "active" if it has recurred within this window. Older =
// "Earlier" — it happened but seems quiet now.
const ACTIVE_WINDOW_MS = 2 * 60 * 60 * 1000;

const AREA_FILTERS: { key: LogArea | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'payment', label: 'Payment' },
  { key: 'promo', label: 'Promo' },
  { key: 'marketplace', label: 'Marketplace' },
  { key: 'wheel', label: 'Wheel' },
  { key: 'auth', label: 'Auth' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'admin', label: 'Admin' },
  { key: 'backend', label: 'Backend' },
  { key: 'global', label: 'Crashes' },
  { key: 'other', label: 'Other' },
];

function formatAgo(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// Strip ids/numbers so identical errors with different draft ids /
// wallets / durations collapse into one group.
function normalize(s: string | undefined): string {
  return (s ?? '')
    .replace(/0x[0-9a-fA-F]+/g, '0x*')
    .replace(/\b[0-9a-f-]{16,}\b/gi, '*')
    .replace(/\d+(\.\d+)?/g, '#')
    .trim();
}

interface ErrorGroup {
  key: string;
  severity: LogSeverity;
  area: LogArea;
  count: number;
  sessionCount: number;
  rep: ErrorEventEntry;   // representative = most recent occurrence
  firstTs: number;
  lastTs: number;
  // Per-wallet hit map so the row can show "Affected users" inline
  // without re-iterating the full error list per render.
  actorCounts: Map<string, number>;
  // Bucketed counts so the row can show "3 in 24h · 7 in 7d" without
  // re-traversing the events array per render.
  countLast24h: number;
  countLast7d: number;
  // Full timestamp series for the per-group sparkline. Bucketed into
  // 12h bins client-side. Captured here so we don't re-walk all events
  // per render.
  eventTimestamps: number[];
}

function groupErrors(errors: ErrorEventEntry[]): ErrorGroup[] {
  const map = new Map<string, ErrorGroup>();
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  for (const e of errors) {
    const key = `${normalize(e.source)}|${normalize(e.message).slice(0, 140)}`;
    const ts = new Date(e.timestamp).getTime() || 0;
    const within24h = now - ts <= day;
    const within7d = now - ts <= 7 * day;
    const actor = (e.actor || '').toLowerCase();
    const existing = map.get(key);
    if (!existing) {
      const actorCounts = new Map<string, number>();
      if (actor) actorCounts.set(actor, 1);
      map.set(key, {
        key,
        severity: logSeverity(e.source),
        area: logAreaForSource(e.source),
        count: 1,
        sessionCount: e.sessionId ? 1 : 0,
        rep: e,
        firstTs: ts,
        lastTs: ts,
        actorCounts,
        countLast24h: within24h ? 1 : 0,
        countLast7d: within7d ? 1 : 0,
        eventTimestamps: ts ? [ts] : [],
      });
    } else {
      existing.count += 1;
      existing.firstTs = Math.min(existing.firstTs, ts);
      if (within24h) existing.countLast24h += 1;
      if (within7d) existing.countLast7d += 1;
      if (actor) {
        existing.actorCounts.set(actor, (existing.actorCounts.get(actor) ?? 0) + 1);
      }
      if (ts) existing.eventTimestamps.push(ts);
      if (ts >= existing.lastTs) {
        existing.lastTs = ts;
        existing.rep = e;       // keep the most recent as representative
      }
    }
  }
  return [...map.values()].sort((a, b) => b.lastTs - a.lastTs);
}

/**
 * Builds a "wallet → set of group keys it hit" map across the whole feed.
 * Powers cross-error correlation in AffectedUsers: per wallet, tells us
 * how many OTHER groups they appear in. Cheap to compute once and pass
 * down — re-walking groups per render in each row would be O(n²).
 */
function buildActorGroupMap(groups: ErrorGroup[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const g of groups) {
    for (const wallet of g.actorCounts.keys()) {
      const set = map.get(wallet) ?? new Set<string>();
      set.add(g.key);
      map.set(wallet, set);
    }
  }
  return map;
}

export function LogsTab({ enabled }: { enabled: boolean }) {
  const [mode, setMode] = useState<LogMode>('feed');

  return (
    <div className="space-y-4">
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
  const [showTest, setShowTest] = useState(false);
  const [showEarlier, setShowEarlier] = useState(false);
  // Severity filter: 'all' shows every section, otherwise only the
  // matching severity tier renders. Boris asked for the top-of-page
  // severity chips to BE filters, not just informational.
  const [severityFilter, setSeverityFilter] = useState<LogSeverity | 'all'>('all');

  const norm = filter.trim().toLowerCase();

  const buckets = useMemo(() => {
    // 1. area + text filter
    const filtered = allErrors.filter((e) => {
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

    // 2. split real vs test-suite traffic
    const real: ErrorEventEntry[] = [];
    const test: ErrorEventEntry[] = [];
    for (const e of filtered) (isTestNoiseError(e) ? test : real).push(e);

    // 3. group, then split active vs earlier (quiet)
    const cutoff = Date.now() - ACTIVE_WINDOW_MS;
    const groups = groupErrors(real);
    // Cross-error correlation map: wallet → set of group keys it appears in.
    // Passed to AffectedUsers so each wallet row can show "+N other errors"
    // for heavy hitters spanning multiple sources.
    const actorGroupMap = buildActorGroupMap(groups);
    const activeCritical = groups.filter((g) => g.lastTs >= cutoff && g.severity === 'critical');
    const activeWarning = groups.filter((g) => g.lastTs >= cutoff && g.severity === 'warning');
    const activeLow = groups.filter((g) => g.lastTs >= cutoff && g.severity === 'low');
    const earlier = groups.filter((g) => g.lastTs < cutoff);
    const testGroups = groupErrors(test);

    // Total counts (active + earlier) per severity — drives the top-of-page
    // severity summary so Boris can scan "X critical / X warning / X low"
    // including unresolved older bugs in the same view.
    const totalCritical = groups.filter((g) => g.severity === 'critical').length;
    const totalWarning = groups.filter((g) => g.severity === 'warning').length;
    const totalLow = groups.filter((g) => g.severity === 'low').length;

    return {
      activeCritical,
      activeWarning,
      activeLow,
      earlier,
      testGroups,
      testCount: test.length,
      totalCritical,
      totalWarning,
      totalLow,
      actorGroupMap,
    };
  }, [allErrors, area, norm]);

  const {
    activeCritical,
    activeWarning,
    activeLow,
    earlier,
    testGroups,
    testCount,
    totalCritical,
    totalWarning,
    totalLow,
    actorGroupMap,
  } = buckets;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-white">Error feed</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Auto-refreshes every 15s{query.isFetching ? ' · refreshing…' : ''}
          </p>
        </div>
        <button
          onClick={() => query.refetch()}
          className="text-xs text-gray-400 hover:text-white underline underline-offset-2"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Severity summary — three color-coded chips with total counts
          (active + earlier) per severity. Clickable: tapping a chip
          filters the feed to that tier; tapping the same chip again
          (or the "All" implicit fourth state) clears the filter. */}
      <SeveritySummaryBar
        critical={totalCritical}
        warning={totalWarning}
        low={totalLow}
        active={severityFilter}
        onChange={(next) => setSeverityFilter(next === severityFilter ? 'all' : next)}
      />

      <TriageBanner critical={activeCritical} warning={activeWarning} earlierCount={earlier.length} />

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
              {f.label}
            </button>
          );
        })}
      </div>

      <div className="relative">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search by wallet, source, route, message, or session…"
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

      {/* Critical — fix now. Hidden when severity filter excludes it. */}
      {activeCritical.length > 0 && (severityFilter === 'all' || severityFilter === 'critical') && (
        <Section title="Critical — fix now" tone="critical" count={activeCritical.length} defaultOpen>
          {activeCritical.map((g) => (
            <GroupRow key={g.key} group={g} isOpen={expanded === g.key} actorGroupMap={actorGroupMap}
              onToggle={() => setExpanded((p) => (p === g.key ? null : g.key))} />
          ))}
        </Section>
      )}

      {/* Warnings — look into it */}
      {activeWarning.length > 0 && (severityFilter === 'all' || severityFilter === 'warning') && (
        <Section title="Warnings — look into it" tone="warning" count={activeWarning.length} defaultOpen>
          {activeWarning.map((g) => (
            <GroupRow key={g.key} group={g} isOpen={expanded === g.key} actorGroupMap={actorGroupMap}
              onToggle={() => setExpanded((p) => (p === g.key ? null : g.key))} />
          ))}
        </Section>
      )}

      {/* Low priority — informational, collapsed by default so it doesn't
          crowd the page. These are fallback/transient errors that don't
          impact the user-facing happy path (watchdog crashes, transient
          RTDB hiccups, prefs-load failures). Worth knowing about, not
          worth panicking over. */}
      {activeLow.length > 0 && (severityFilter === 'all' || severityFilter === 'low') && (
        <Section title="Low priority — informational" tone="low" count={activeLow.length}>
          {activeLow.map((g) => (
            <GroupRow key={g.key} group={g} isOpen={expanded === g.key} actorGroupMap={actorGroupMap}
              onToggle={() => setExpanded((p) => (p === g.key ? null : g.key))} />
          ))}
        </Section>
      )}

      {/* "Nothing firing recently" state. We deliberately split this into
          two visually distinct cards based on whether there are unresolved
          earlier issues. Boris flagged that the old "All clear" green copy
          implied "the system is healthy" even when earlier bugs sat in the
          backlog — they hadn't been fixed, just hadn't fired in 2h. New
          copy never claims fixedness; it only describes activity. */}
      {activeCritical.length === 0 && activeWarning.length === 0 && !query.isLoading && (
        <div
          className={`rounded-xl border p-8 text-center ${
            earlier.length > 0
              ? 'border-yellow-500/30 bg-yellow-500/[0.05]'
              : 'border-emerald-500/30 bg-emerald-500/[0.06]'
          }`}
        >
          <p
            className={`text-sm font-medium ${
              earlier.length > 0 ? 'text-yellow-300' : 'text-emerald-300'
            }`}
          >
            {earlier.length > 0
              ? '⚠️ Quiet now (last 2h) — but earlier issues may still be live bugs'
              : '✓ Nothing active right now'}
          </p>
          <p className="text-gray-500 text-[12px] mt-1">
            {earlier.length > 0
              ? `${earlier.length} earlier ${earlier.length === 1 ? 'issue has' : 'issues have'} not been verified as fixed — they just haven't fired in the last 2 hours. Review under "Earlier" below.`
              : 'No errors in the last 2 hours.'}
          </p>
        </div>
      )}

      {/* Earlier — happened but quiet now */}
      {earlier.length > 0 && (
        <div className="rounded-xl border border-gray-800 bg-gray-900/40 overflow-hidden">
          <button
            onClick={() => setShowEarlier((s) => !s)}
            className="w-full px-4 py-2.5 flex items-center justify-between text-left hover:bg-white/[0.02]"
          >
            <span className="text-[12px] text-gray-400">
              🕐 Earlier — {earlier.length} {earlier.length === 1 ? 'issue' : 'issues'}, quiet for 2h+ (not happening now)
            </span>
            <span className="text-gray-600 text-xs">{showEarlier ? 'hide' : 'show'}</span>
          </button>
          {showEarlier && (
            <div className="px-3 pb-3 space-y-2">
              {earlier.map((g) => (
                <GroupRow key={g.key} group={g} isOpen={expanded === g.key} muted actorGroupMap={actorGroupMap}
                  onToggle={() => setExpanded((p) => (p === g.key ? null : g.key))} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Test traffic toggle */}
      {testCount > 0 && (
        <div className="rounded-xl border border-gray-800 bg-gray-900/40 overflow-hidden">
          <button
            onClick={() => setShowTest((s) => !s)}
            className="w-full px-4 py-2.5 flex items-center justify-between text-left hover:bg-white/[0.02]"
          >
            <span className="text-[12px] text-gray-500">
              🧪 {testCount} {testCount === 1 ? 'entry' : 'entries'} from automated tests (not real users)
            </span>
            <span className="text-gray-600 text-xs">{showTest ? 'hide' : 'show'}</span>
          </button>
          {showTest && (
            <div className="px-3 pb-3 space-y-2">
              {testGroups.map((g) => (
                <GroupRow key={g.key} group={g} isOpen={expanded === g.key} muted actorGroupMap={actorGroupMap}
                  onToggle={() => setExpanded((p) => (p === g.key ? null : g.key))} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TriageBanner({ critical, warning, earlierCount }: {
  critical: ErrorGroup[]; warning: ErrorGroup[]; earlierCount: number;
}) {
  if (critical.length > 0) {
    return (
      <div className="rounded-xl border border-red-500/50 bg-red-500/[0.08] px-4 py-3">
        <p className="text-red-300 text-sm font-semibold">
          🔴 {critical.length} critical {critical.length === 1 ? 'issue' : 'issues'} happening now — start here
        </p>
        <p className="text-[12px] text-gray-400 mt-1">
          {critical.slice(0, 3).map((g) => g.rep.source).join(' · ')}
          {critical.length > 3 ? ` +${critical.length - 3} more` : ''}
        </p>
        <p className="text-[11px] text-gray-500 mt-1">
          {warning.length} warning{warning.length === 1 ? '' : 's'} active · {earlierCount} earlier
        </p>
      </div>
    );
  }
  if (warning.length > 0) {
    return (
      <div className="rounded-xl border border-yellow-500/40 bg-yellow-500/[0.06] px-4 py-3">
        <p className="text-yellow-300 text-sm font-semibold">
          🟡 No critical issues — {warning.length} warning{warning.length === 1 ? '' : 's'} to look into
        </p>
        <p className="text-[11px] text-gray-500 mt-1">{earlierCount} earlier (quiet now, still unfixed)</p>
      </div>
    );
  }
  // Nothing active. Two distinct states based on whether earlier issues
  // exist — "All clear" must only show when there are TRULY zero bugs in
  // the feed (active OR earlier). If earlier > 0, those are unfixed bugs
  // that simply haven't fired recently; not "all clear."
  if (earlierCount > 0) {
    return (
      <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/[0.05] px-4 py-3">
        <p className="text-yellow-300 text-sm font-semibold">
          ⚠️ Quiet now (last 2h) — {earlierCount} earlier {earlierCount === 1 ? 'issue is' : 'issues are'} still unfixed
        </p>
        <p className="text-[11px] text-gray-500 mt-1">
          No new errors in the last 2 hours, but earlier bugs haven&apos;t been verified as fixed — they just haven&apos;t fired again yet. Review them below.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3">
      <p className="text-emerald-300 text-sm font-semibold">✓ All clear — no bugs in the feed</p>
    </div>
  );
}

function Section({ title, tone, count, defaultOpen, children }: {
  title: string;
  tone: 'critical' | 'warning' | 'low';
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const dot =
    tone === 'critical'
      ? 'text-red-400'
      : tone === 'warning'
        ? 'text-yellow-400'
        : 'text-gray-500';
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 py-1.5 text-left"
      >
        <span className={dot}>●</span>
        <span className="text-sm font-semibold text-white">{title}</span>
        <span className="text-[11px] text-gray-500">({count})</span>
        <span className="text-gray-600 text-xs ml-auto">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="space-y-2">{children}</div>}
    </div>
  );
}

function GroupRow({ group, isOpen, onToggle, muted, actorGroupMap }: {
  group: ErrorGroup;
  isOpen: boolean;
  onToggle: () => void;
  muted?: boolean;
  /** wallet → set of group keys it appears in across the whole feed */
  actorGroupMap: Map<string, Set<string>>;
}) {
  const { rep, severity, area, count } = group;
  // Which side broke — the Go server, or the banana-fantasy app
  // (browser + its API routes). Tells you which repo / dev it goes to.
  const isBackend = area === 'backend';
  const layerLabel = isBackend ? 'Backend' : 'Frontend';
  const layerClass = isBackend
    ? 'text-violet-300 bg-violet-500/15 border-violet-500/30'
    : 'text-sky-300 bg-sky-500/15 border-sky-500/30';
  const exportSession = useExportErrorSession();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExport = async () => {
    if (!rep.sessionId || exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      await exportSession(rep.sessionId);
    } catch (err) {
      setExportError((err as Error).message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const accent = muted
    ? 'border-gray-800 bg-gray-900/40'
    : severity === 'critical'
      ? 'border-red-500/40 bg-red-500/[0.06]'
      : 'border-yellow-500/40 bg-yellow-500/[0.06]';
  const dot = muted ? 'text-gray-600' : severity === 'critical' ? 'text-red-400' : 'text-yellow-400';

  return (
    <div className={`rounded-lg border ${accent} overflow-hidden`}>
      <button onClick={onToggle} className="w-full px-4 py-3 flex items-start gap-3 hover:bg-white/[0.02] text-left">
        <span className={`${dot} mt-0.5`}>●</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${layerClass}`}>{layerLabel}</span>
            <span className="text-[10px] uppercase tracking-wider text-gray-500 bg-white/[0.04] px-1.5 py-0.5 rounded">{area}</span>
            <span className="font-mono text-sm text-white font-semibold">{rep.source}</span>
            {count > 1 && (
              <span className="text-[11px] font-bold text-black bg-white/70 px-1.5 py-0.5 rounded-full">×{count}</span>
            )}
          </div>
          <p className="text-sm text-gray-300 mt-0.5 truncate">{rep.message}</p>
          {explainError(rep.source, rep.message) && (
            <p className="text-[12px] text-banana/90 mt-1">💡 {explainError(rep.source, rep.message)}</p>
          )}
          <div className="flex gap-3 mt-1 text-[11px] text-gray-500 flex-wrap items-center">
            <span>last {formatAgo(rep.timestamp)}</span>
            <span className="font-medium text-gray-400">
              {group.countLast24h} in 24h · {group.countLast7d} in 7d
            </span>
            {/* Inline 7-day sparkline — instantly shows whether the error is
                spiking now, decaying since a fix, or steady-state noise. */}
            <GroupSparkline timestamps={group.eventTimestamps} />
            {count > 1 && <span>first seen {formatAgo(new Date(group.firstTs).toISOString())}</span>}
            {rep.route && <span className="font-mono truncate max-w-[260px]">{rep.route}</span>}
          </div>
        </div>
        <span className="text-gray-500 text-xs">{isOpen ? '▾' : '▸'}</span>
      </button>

      {/* Affected users — inline so triage doesn't need to leave this row.
          Renders even when collapsed so you can scan affected wallets at
          a glance and click straight into User Lookup. Cross-correlation
          chips ("+2 other errors") surface heavy hitters spanning sources. */}
      {group.actorCounts.size > 0 && (
        <AffectedUsers actorCounts={group.actorCounts} actorGroupMap={actorGroupMap} />
      )}
      {isOpen && (
        <div className="border-t border-white/5 px-4 py-3 space-y-3 bg-black/20">
          {/* Runbook editor — shared with all admins via Firestore. Falls
              back to localStorage when the API is unavailable so unsaved
              notes survive a tab close. */}
          <RunbookEditor source={rep.source} />
          {rep.stack && (
            <div>
              <p className="text-[11px] uppercase text-gray-500 mb-1">Stack (most recent occurrence)</p>
              <pre className="text-[11px] text-gray-300 whitespace-pre-wrap break-all font-mono max-h-48 overflow-auto">{rep.stack}</pre>
            </div>
          )}
          {rep.context && Object.keys(rep.context).length > 0 && (
            <div>
              <p className="text-[11px] uppercase text-gray-500 mb-1">Context</p>
              <pre className="text-[11px] text-gray-300 whitespace-pre-wrap break-all font-mono">{JSON.stringify(rep.context, null, 2)}</pre>
            </div>
          )}
          {rep.requestId && (
            <p className="text-[11px] text-gray-500 font-mono">req: {rep.requestId}</p>
          )}
          {rep.sessionId && (
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={handleExport}
                disabled={exporting}
                className="px-2.5 py-1 rounded-md bg-banana/90 hover:bg-banana text-black text-[11px] font-semibold disabled:opacity-50"
                title="Download this error + the user's full session trace as a JSON file to hand to a developer"
              >
                {exporting ? 'Exporting…' : '⬇ Export trace for dev'}
              </button>
              {exportError && <span className="text-[11px] text-red-300">{exportError}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Inline list of wallets affected by this error group. Each wallet links
 * into User Lookup so triage doesn't need a tab switch. Defaults to 5,
 * "Show all (N)" / "Hide" to expand. The hit count per wallet surfaces
 * heavy hitters at a glance.
 */
function AffectedUsers({
  actorCounts,
  actorGroupMap,
}: {
  actorCounts: Map<string, number>;
  actorGroupMap: Map<string, Set<string>>;
}) {
  const [expanded, setExpanded] = useState(false);
  const sorted = useMemo(
    () => Array.from(actorCounts.entries()).sort((a, b) => b[1] - a[1]),
    [actorCounts],
  );
  const visible = expanded ? sorted : sorted.slice(0, 5);
  return (
    <div className="border-t border-white/5 bg-black/20 px-4 py-2.5">
      <div className="mb-1 flex items-baseline justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          Affected users ({sorted.length})
        </p>
        {sorted.length > 5 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            className="text-[11px] text-gray-400 hover:text-banana"
          >
            {expanded ? 'Hide' : `Show all (${sorted.length})`}
          </button>
        )}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        {visible.map(([wallet, hits]) => {
          // How many OTHER error groups this wallet appears in. A high
          // number means the wallet is a heavy hitter across the system,
          // not just here — worth opening User Lookup to see the pattern.
          const otherGroups = (actorGroupMap.get(wallet)?.size ?? 1) - 1;
          return (
            <li key={wallet} className="flex items-center gap-1">
              <WalletLink wallet={wallet} bare className="!text-gray-300 hover:!text-banana" />
              {hits > 1 && (
                <span className="rounded bg-white/[0.06] px-1 text-[10px] text-gray-400">
                  ×{hits}
                </span>
              )}
              {otherGroups > 0 && (
                <span
                  className="rounded bg-amber-500/[0.12] px-1 text-[10px] text-amber-300/90"
                  title={`This wallet also appears in ${otherGroups} other error group${otherGroups === 1 ? '' : 's'} — open User Lookup for the full pattern.`}
                >
                  +{otherGroups} other
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Three color-coded chips showing total counts per severity tier
 * (active + earlier combined). Sits above the TriageBanner so Boris
 * can scan the whole feed's severity profile in one look — no need
 * to read individual rows to know how serious things are.
 *
 * Color convention matches the rest of the page (red/yellow/gray).
 * Even zero-count chips render — empty state still helps confirm
 * "yep, zero critical right now" without ambiguity.
 */
function SeveritySummaryBar({
  critical,
  warning,
  low,
  active,
  onChange,
}: {
  critical: number;
  warning: number;
  low: number;
  active: LogSeverity | 'all';
  onChange: (next: LogSeverity) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SeverityChip
        emoji="🔴"
        label="Critical"
        count={critical}
        tone="critical"
        helpText="Fix right away — payment / mint / auth / draft-blocking failures. Click to filter."
        isActive={active === 'critical'}
        onClick={() => onChange('critical')}
      />
      <SeverityChip
        emoji="🟡"
        label="Warning"
        count={warning}
        tone="warning"
        helpText="Worth looking at — non-critical bugs that may need a fix. Click to filter."
        isActive={active === 'warning'}
        onClick={() => onChange('warning')}
      />
      <SeverityChip
        emoji="⚪"
        label="Low"
        count={low}
        tone="low"
        helpText="Fallback / transient — doesn't affect the user-facing happy path. Click to filter."
        isActive={active === 'low'}
        onClick={() => onChange('low')}
      />
      {active !== 'all' && (
        <span className="text-[11px] text-gray-400">
          Filtering by <span className="text-white">{active}</span> — click chip again to clear.
        </span>
      )}
    </div>
  );
}

function SeverityChip({
  emoji,
  label,
  count,
  tone,
  helpText,
  isActive,
  onClick,
}: {
  emoji: string;
  label: string;
  count: number;
  tone: 'critical' | 'warning' | 'low';
  helpText: string;
  isActive: boolean;
  onClick: () => void;
}) {
  // Active chips (count > 0) get the full color treatment so they pop.
  // Zero-count chips render in a muted neutral state — present so the
  // bar always shows all three tiers (no "is there a critical chip?"
  // ambiguity) without screaming for attention.
  // The filter-selected chip gets a bright ring outline so it's obvious
  // which tier is currently filtered.
  const hasCount = count > 0;
  const styles =
    !hasCount
      ? 'border-gray-800 bg-gray-900/40 text-gray-500'
      : tone === 'critical'
        ? 'border-red-500/50 bg-red-500/[0.10] text-red-200'
        : tone === 'warning'
          ? 'border-yellow-500/40 bg-yellow-500/[0.08] text-yellow-200'
          : 'border-gray-600/60 bg-gray-700/30 text-gray-300';
  const activeRing = isActive
    ? tone === 'critical'
      ? 'ring-2 ring-red-400/60'
      : tone === 'warning'
        ? 'ring-2 ring-yellow-400/60'
        : 'ring-2 ring-gray-400/60'
    : 'ring-0';
  return (
    <button
      type="button"
      onClick={onClick}
      title={helpText}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${styles} ${activeRing} transition-colors hover:brightness-110`}
    >
      <span aria-hidden>{emoji}</span>
      <span className="text-[12px] font-semibold">{count}</span>
      <span className="text-[11px] opacity-80">{label}</span>
    </button>
  );
}
