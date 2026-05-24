'use client';

/**
 * Admin actions targeting this wallet — the audit trail. Shows
 * who did what + when. Click into Audit tab for full before/after.
 */

import { useState } from 'react';
import Link from 'next/link';
import { isSectionFail } from '@/hooks/admin/useUserLookup';
import { WalletLink } from '@/components/admin/WalletLink';

function fmtAgo(v: unknown): string {
  if (typeof v !== 'string' || !v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

interface Props {
  audit: Record<string, unknown>[] | { ok: false; reason: string };
}

export function AuditSection({ audit }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (isSectionFail(audit)) {
    return (
      <Card>
        <Header />
        <p className="mt-2 text-sm text-red-300">Audit unavailable: {audit.reason}</p>
      </Card>
    );
  }
  if (audit.length === 0) {
    return (
      <Card>
        <Header />
        <p className="mt-2 text-sm text-gray-500">No admin actions targeting this wallet.</p>
      </Card>
    );
  }
  const rows = expanded ? audit : audit.slice(0, 5);
  return (
    <Card>
      <Header count={audit.length} />
      <ul className="mt-3 space-y-1">
        {rows.map((row, i) => (
          <li
            key={String(row.id ?? row.requestId ?? i)}
            className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border border-gray-800 bg-gray-950/40 px-2.5 py-1.5 text-xs"
          >
            <code className="rounded bg-gray-700/40 px-1.5 py-0.5 font-mono text-[10px] text-gray-200">
              {String(row.action ?? '—')}
            </code>
            {typeof row.actor === 'string' && row.actor && (
              <>
                <span className="text-gray-500">by</span>
                <WalletLink wallet={row.actor} bare className="!text-gray-300" />
              </>
            )}
            <span className="ml-auto text-[10px] text-gray-500">
              {fmtAgo(row.timestamp)}
            </span>
          </li>
        ))}
      </ul>
      {audit.length > 5 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-[11px] text-gray-400 hover:text-[#F3E216]"
        >
          {expanded ? 'Show less' : `Show all ${audit.length} →`}
        </button>
      )}
      <div className="mt-2 text-right">
        <Link
          href="/admin?tab=audit"
          className="text-[11px] text-gray-400 hover:text-[#F3E216]"
        >
          Open full Audit tab →
        </Link>
      </div>
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-700 bg-gray-900/40 p-4">
      {children}
    </section>
  );
}

function Header({ count }: { count?: number }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
      Admin actions {typeof count === 'number' && `(${count})`}
    </h3>
  );
}
