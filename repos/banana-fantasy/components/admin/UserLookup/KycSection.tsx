'use client';

/**
 * KYC attempt history for one wallet. Most-recent first; status badges
 * highlight blocks / mismatches. Full collision-pair detail lives in
 * the dedicated KYC tab (linked via "View all").
 */

import Link from 'next/link';
import { isSectionFail } from '@/hooks/admin/useUserLookup';

function statusTone(s: string): string {
  if (s === 'approved') return 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30';
  if (s === 'blocked') return 'bg-red-500/15 text-red-300 ring-red-500/30';
  if (s.includes('mismatch')) return 'bg-amber-500/15 text-amber-300 ring-amber-500/30';
  return 'bg-gray-700/40 text-gray-300 ring-gray-600';
}

function fmtDate(v: unknown) {
  if (typeof v !== 'string' || !v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? v
    : d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
}

interface Props {
  kyc: Record<string, unknown>[] | { ok: false; reason: string };
  wallet: string;
}

export function KycSection({ kyc, wallet }: Props) {
  return (
    <Card>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          KYC
        </h3>
        <Link
          href={`/admin?tab=kyc&user=${encodeURIComponent(wallet)}`}
          className="text-[11px] text-gray-400 hover:text-[#F3E216]"
        >
          View all in KYC tab →
        </Link>
      </div>
      {isSectionFail(kyc) ? (
        <p className="mt-2 text-sm text-red-300">KYC unavailable: {kyc.reason}</p>
      ) : kyc.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">No KYC attempts on record.</p>
      ) : (
        <ul className="mt-3 space-y-1">
          {kyc.slice(0, 5).map((row, i) => {
            const status = String(row.status ?? '—');
            return (
              <li
                key={String(row.id ?? i)}
                className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border border-gray-800 bg-gray-950/40 px-2.5 py-1.5 text-xs"
              >
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ring-1 ${statusTone(status)}`}
                >
                  {status}
                </span>
                <span className="ml-auto text-[10px] text-gray-500">
                  {fmtDate(row.timestamp ?? row.createdAt)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      {children}
    </section>
  );
}
