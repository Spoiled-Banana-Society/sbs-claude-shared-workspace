'use client';

/**
 * Health summary card. Reads the server-computed status (ok/warning/
 * critical) + list of issues and renders them as a glanceable checklist
 * at the top of the page. Server-side computation keeps thresholds in
 * one place; UI just renders.
 */

interface Props {
  status: 'ok' | 'warning' | 'critical';
  issues: { level: 'critical' | 'warning'; text: string }[];
}

export function HealthSummary({ status, issues }: Props) {
  const palette =
    status === 'critical'
      ? {
          border: 'border-red-500/40',
          bg: 'bg-red-500/[0.07]',
          ring: 'ring-red-500/30',
          dot: 'bg-red-400',
          text: 'text-red-200',
          headline: 'Critical issues',
        }
      : status === 'warning'
        ? {
            border: 'border-amber-500/40',
            bg: 'bg-amber-500/[0.06]',
            ring: 'ring-amber-500/30',
            dot: 'bg-amber-400',
            text: 'text-amber-200',
            headline: 'Needs attention',
          }
        : {
            border: 'border-emerald-500/30',
            bg: 'bg-emerald-500/[0.05]',
            ring: 'ring-emerald-500/30',
            dot: 'bg-emerald-400',
            text: 'text-emerald-200',
            headline: 'All good',
          };

  return (
    <section className={`rounded-xl border ${palette.border} ${palette.bg} p-4`}>
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-2 w-2 animate-pulse rounded-full ${palette.dot}`}
        />
        <h3 className={`text-sm font-semibold ${palette.text}`}>
          {palette.headline}
          {issues.length > 0 && (
            <span className="ml-1 text-xs font-normal opacity-75">
              ({issues.length})
            </span>
          )}
        </h3>
      </div>

      {issues.length > 0 ? (
        <ul className="mt-2 space-y-1 text-[13px]">
          {issues.map((issue, i) => (
            <li key={i} className="flex gap-2 text-gray-200">
              <span aria-hidden className={issue.level === 'critical' ? 'text-red-400' : 'text-amber-400'}>
                {issue.level === 'critical' ? '❌' : '⚠️'}
              </span>
              <span>{issue.text}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[13px] text-gray-300">
          No flagged issues. Notifications, payments, and KYC all look healthy.
        </p>
      )}
    </section>
  );
}
