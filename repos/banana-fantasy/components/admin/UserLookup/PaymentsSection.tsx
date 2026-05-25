'use client';

/**
 * Payments overview: onramps (USDC purchases), offramps (cashouts),
 * and withdrawal requests for one wallet. Aggregates counts so you can
 * tell at a glance "this user has 3 failed onramps" before opening
 * individual rows.
 */

import { isSectionFail } from '@/hooks/admin/useUserLookup';

function fmtDate(v: unknown) {
  if (typeof v !== 'string' || !v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function statusTone(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('complet') || s.includes('paid') || s.includes('succ'))
    return 'text-emerald-300';
  if (s.includes('fail') || s.includes('denied')) return 'text-red-300';
  if (s.includes('pend') || s.includes('approv') || s.includes('progress'))
    return 'text-amber-300';
  return 'text-gray-300';
}

interface Props {
  payments: {
    onramps: Record<string, unknown>[] | { ok: false; reason: string };
    offramps: Record<string, unknown>[] | { ok: false; reason: string };
    withdrawals: Record<string, unknown>[] | { ok: false; reason: string };
  };
}

export function PaymentsSection({ payments }: Props) {
  return (
    <Card>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
        Payments
      </h3>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <PaymentList
          title="Onramps (USDC in)"
          data={payments.onramps}
        />
        <PaymentList
          title="Offramps (USDC out)"
          data={payments.offramps}
        />
        <PaymentList
          title="Withdrawals"
          data={payments.withdrawals}
        />
      </div>
    </Card>
  );
}

function PaymentList({
  title,
  data,
}: {
  title: string;
  data: Record<string, unknown>[] | { ok: false; reason: string };
}) {
  if (isSectionFail(data)) {
    return (
      <div className="rounded-md border border-gray-800 bg-gray-950/40 p-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
          {title}
        </p>
        <p className="mt-1 text-xs text-red-300">Unavailable: {data.reason}</p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-gray-800 bg-gray-950/40 p-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
        {title} ({data.length})
      </p>
      {data.length === 0 ? (
        <p className="mt-1 text-xs text-gray-500">No records.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {data.slice(0, 8).map((row, i) => {
            const status = String(row.status ?? '—');
            const amount = typeof row.amount === 'number' ? row.amount : null;
            const ts = (row.timestamp ?? row.createdAt) as string | undefined;
            return (
              <li
                key={String(row.id ?? i)}
                className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs"
              >
                <span className={statusTone(status)}>{status}</span>
                {amount !== null && (
                  <span className="text-gray-200">${amount.toFixed(2)}</span>
                )}
                <span className="ml-auto text-[10px] text-gray-500">
                  {fmtDate(ts)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      {children}
    </section>
  );
}
