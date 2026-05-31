'use client';

import { useState } from 'react';

interface Finding {
  source: string;
  severity: 'critical' | 'warning' | 'low';
  actor?: string;
  message: string;
}
interface AuditResponse {
  summary?: { total: number; critical: number; warning: number; checks: string[] };
  findings?: Finding[];
  error?: string;
}

/**
 * On-demand state-integrity audit. Runs the money/fairness invariant checks
 * (passes counter vs real spendable tokens, negative balances) and posts any
 * findings into the admin Logs feed. The same checks run daily via
 * /api/crons/audit-integrity. See docs/AUDITS.md.
 */
export function IntegrityAuditPanel({ getHeaders }: { getHeaders: () => Promise<HeadersInit> }) {
  const [running, setRunning] = useState(false);
  const [res, setRes] = useState<AuditResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    if (running) return;
    setRunning(true);
    setErr(null);
    setRes(null);
    try {
      const headers = await getHeaders();
      // post=1 also writes findings into the Logs feed (tiered by severity).
      const r = await fetch('/api/admin/integrity?post=1', { headers });
      const body = (await r.json()) as AuditResponse;
      if (!r.ok) setErr(body.error || `Request failed (${r.status})`);
      else setRes(body);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const crit = res?.summary?.critical ?? 0;
  const warn = res?.summary?.warning ?? 0;

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold text-white uppercase tracking-wider">State Integrity Audit</h4>
        <button
          onClick={run}
          disabled={running}
          className="rounded-lg bg-banana px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
        >
          {running ? 'Running…' : 'Run audit'}
        </button>
      </div>
      <p className="text-[11px] text-gray-500 mb-3">
        Proactively checks money/fairness invariants (pass counter vs real spendable tokens, negative
        balances) and posts findings to the Logs feed. Runs daily automatically. See docs/AUDITS.md.
      </p>

      {err && <p className="text-xs text-red-400">{err}</p>}

      {res?.summary && (
        <div className="space-y-2">
          <div className="flex gap-3 text-xs">
            <span className={crit ? 'text-red-400 font-semibold' : 'text-gray-400'}>🔴 {crit} critical</span>
            <span className={warn ? 'text-yellow-400 font-semibold' : 'text-gray-400'}>🟡 {warn} warning</span>
            <span className="text-gray-500">· checks: {res.summary.checks.join(', ')}</span>
          </div>
          {crit === 0 && warn === 0 && (
            <p className="text-xs text-green-400">✅ All invariants hold — counters match real spendable tokens.</p>
          )}
          {!!res.findings?.length && (
            <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-700 bg-gray-900/60 p-2 space-y-1">
              {res.findings.map((f, i) => (
                <div key={i} className="text-[11px] leading-tight">
                  <span>{f.severity === 'critical' ? '🔴' : '🟡'}</span>{' '}
                  <span className="text-gray-400">[{f.source}]</span>{' '}
                  <span className="text-gray-500">{f.actor ? `${f.actor.slice(0, 10)}…` : ''}</span>
                  <div className="text-gray-300 pl-4">{f.message}</div>
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-gray-600">Findings were also posted to the Logs feed.</p>
        </div>
      )}
    </div>
  );
}
