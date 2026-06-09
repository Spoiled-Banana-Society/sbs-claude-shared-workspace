'use client';

/**
 * Winners import — paste a CSV of contest winners, preview, import.
 *
 * This is the entrance of the payout pipeline: each row becomes a prize
 * record on the winner's /winnings page (and fires a 🏆 bell
 * notification). From there the normal flow runs: user withdraws →
 * admin approves → Gnosis CSV batch → verified mark-paid.
 *
 * CSV format: wallet,amount,contestName[,draftId]
 * Header row optional. Re-pasting the same CSV is safe — rows that were
 * already imported come back as "skipped" (deterministic id per
 * wallet+contest+amount). Two intentionally identical prizes for the
 * same wallet need distinct contest names ("BBB Finals — 2nd entry").
 */

import { useMemo, useState } from 'react';
import { useAdminAuthHeaders } from '@/hooks/admin/useAdminApi';

const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

interface ParsedRow {
  wallet: string;
  amount: number;
  contestName: string;
  draftId?: string;
  lineNo: number;
  error?: string;
}

interface RowResult {
  wallet: string;
  amount: number;
  contestName: string;
  status: 'created' | 'exists' | 'invalid' | 'failed';
  prizeId?: string;
  error?: string;
}

interface ImportResponse {
  dryRun?: boolean;
  results?: RowResult[];
  newCount?: number;
  createdCount?: number;
  existsCount?: number;
  invalidCount?: number;
  failCount?: number;
  totalAmount?: number;
  error?: string;
}

/** Minimal CSV line split that honors double-quoted fields. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseCsv(text: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, idx) => {
    if (!line.trim()) return;
    const cols = splitCsvLine(line);
    // Skip an obvious header row ("wallet,amount,...").
    if (idx === 0 && /^wallet$/i.test(cols[0] ?? '')) return;
    const [walletRaw, amountRaw, contestName = '', draftId] = cols;
    const wallet = (walletRaw ?? '').toLowerCase();
    const amount = Number((amountRaw ?? '').replace(/[$,]/g, ''));
    const row: ParsedRow = {
      wallet,
      amount,
      contestName,
      draftId: draftId || undefined,
      lineNo: idx + 1,
    };
    if (!ETH_ADDRESS_RE.test(wallet)) row.error = 'invalid wallet';
    else if (!Number.isFinite(amount) || amount <= 0) row.error = 'invalid amount';
    else if (!contestName) row.error = 'missing contest name';
    rows.push(row);
  });
  return rows;
}

export function WinnersImportPanel() {
  const getHeaders = useAdminAuthHeaders();
  const [csv, setCsv] = useState('');
  const [phase, setPhase] = useState<'edit' | 'previewing' | 'preview' | 'importing' | 'done'>('edit');
  const [preview, setPreview] = useState<ImportResponse | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseCsv(csv), [csv]);
  const validRows = useMemo(() => parsed.filter((r) => !r.error), [parsed]);
  const invalidRows = useMemo(() => parsed.filter((r) => r.error), [parsed]);

  const callApi = async (dryRun: boolean): Promise<ImportResponse | null> => {
    setError(null);
    try {
      const headers = await getHeaders();
      const res = await fetch('/api/admin/import-winners', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dryRun,
          rows: validRows.map(({ wallet, amount, contestName, draftId }) => ({ wallet, amount, contestName, draftId })),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as ImportResponse;
      if (!res.ok) {
        setError(json.error || `Request failed (${res.status})`);
        return null;
      }
      return json;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  };

  const runPreview = async () => {
    setPhase('previewing');
    setResult(null);
    const res = await callApi(true);
    if (res) { setPreview(res); setPhase('preview'); }
    else setPhase('edit');
  };

  const runImport = async () => {
    const newCount = preview?.newCount ?? 0;
    const totalAmount = preview?.totalAmount ?? 0;
    if (!window.confirm(
      `Import ${newCount} winner${newCount === 1 ? '' : 's'} totalling $${totalAmount.toLocaleString()}?\n\nEach winner immediately sees the prize on /winnings and gets a notification.`,
    )) return;
    setPhase('importing');
    const res = await callApi(false);
    if (res) { setResult(res); setPhase('done'); }
    else setPhase('preview');
  };

  const reset = () => {
    setPhase('edit');
    setPreview(null);
    setResult(null);
    setError(null);
  };

  const previewBadge = (status: RowResult['status']) => {
    switch (status) {
      case 'created': return <span className="text-emerald-300">new</span>;
      case 'exists': return <span className="text-gray-500">already imported</span>;
      case 'invalid': return <span className="text-red-300">invalid</span>;
      case 'failed': return <span className="text-red-300">failed</span>;
    }
  };

  return (
    <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-white">Winners import — CSV → prize records</h3>
        <p className="text-[12px] text-gray-500 mt-0.5">
          Paste <code className="text-gray-400">wallet,amount,contestName[,draftId]</code> (header row optional).
          Re-pasting the same CSV never double-grants — already-imported rows are skipped.
          Winners see the prize on /winnings instantly + get a bell notification.
        </p>
      </div>

      {(phase === 'edit' || phase === 'previewing') && (
        <>
          <label className="block">
            <span className="text-[11px] uppercase text-gray-500 tracking-wider">
              Winners CSV{' '}
              {parsed.length > 0 && (
                <span className="text-banana">
                  ({validRows.length} valid{invalidRows.length > 0 ? `, ${invalidRows.length} invalid` : ''})
                </span>
              )}
            </span>
            <textarea
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              rows={7}
              className="mt-1 w-full px-3 py-2 rounded-md bg-black/40 border border-white/[0.08] text-[11px] text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-banana/40 font-mono resize-y"
              placeholder={'wallet,amount,contestName\n0xabc…,250,Sunday Showdown #4421\n0xdef…,50,Best Ball Championship Q1'}
            />
          </label>
          {invalidRows.length > 0 && (
            <div className="rounded-md border border-red-500/20 bg-red-500/5 p-3 max-h-32 overflow-y-auto">
              {invalidRows.slice(0, 10).map((r) => (
                <p key={r.lineNo} className="text-[11px] text-red-300">
                  Line {r.lineNo}: {r.error} — <span className="font-mono">{r.wallet || '(no wallet)'}</span>
                </p>
              ))}
              {invalidRows.length > 10 && (
                <p className="text-[11px] text-red-300">…and {invalidRows.length - 10} more</p>
              )}
            </div>
          )}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={runPreview}
              disabled={phase === 'previewing' || validRows.length === 0}
              className="px-4 py-2 rounded-md bg-banana hover:bg-banana/80 text-black text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {phase === 'previewing' ? 'Checking…' : `Preview ${validRows.length} row${validRows.length === 1 ? '' : 's'}`}
            </button>
            {error && <span className="text-[12px] text-red-300">{error}</span>}
          </div>
        </>
      )}

      {(phase === 'preview' || phase === 'importing') && preview && (
        <>
          <div className="rounded-md border border-white/[0.06] bg-black/30 p-3">
            <p className="text-[12px] text-gray-200">
              <span className="text-emerald-300 font-semibold">{preview.newCount ?? 0} new</span>
              {' · '}{preview.existsCount ?? 0} already imported
              {' · '}{preview.invalidCount ?? 0} invalid
              {' · '}<span className="text-banana font-semibold">${(preview.totalAmount ?? 0).toLocaleString()} total new</span>
            </p>
          </div>
          <div className="rounded-md bg-black/30 border border-white/[0.04] divide-y divide-white/[0.04] text-[11px] max-h-64 overflow-y-auto">
            {(preview.results ?? []).map((r, i) => (
              <div key={`${r.prizeId ?? i}`} className="px-3 py-1.5 flex items-center justify-between gap-3">
                <span className="font-mono text-gray-400 truncate">{r.wallet.slice(0, 10)}…{r.wallet.slice(-6)}</span>
                <span className="text-gray-300 truncate flex-1">{r.contestName}</span>
                <span className="text-gray-200 font-medium shrink-0">${r.amount.toLocaleString()}</span>
                <span className="shrink-0 w-28 text-right">{previewBadge(r.status)}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={runImport}
              disabled={phase === 'importing' || (preview.newCount ?? 0) === 0}
              className="px-4 py-2 rounded-md bg-banana hover:bg-banana/80 text-black text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {phase === 'importing'
                ? 'Importing…'
                : `Import ${preview.newCount ?? 0} winner${(preview.newCount ?? 0) === 1 ? '' : 's'} ($${(preview.totalAmount ?? 0).toLocaleString()})`}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={phase === 'importing'}
              className="px-3 py-2 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-gray-200 text-sm disabled:opacity-40"
            >
              Back
            </button>
            {error && <span className="text-[12px] text-red-300">{error}</span>}
          </div>
        </>
      )}

      {phase === 'done' && result && (
        <div className="space-y-3">
          <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3">
            <p className="text-[12px] text-emerald-300 font-medium">
              Imported {result.createdCount ?? 0} winner{(result.createdCount ?? 0) === 1 ? '' : 's'} (${(result.totalAmount ?? 0).toLocaleString()})
              {(result.existsCount ?? 0) > 0 ? ` · ${result.existsCount} skipped (already imported)` : ''}
              {(result.failCount ?? 0) > 0 ? ` · ${result.failCount} FAILED` : ''}
            </p>
          </div>
          {(result.failCount ?? 0) > 0 && (
            <div className="rounded-md border border-red-500/20 bg-red-500/5 p-3 max-h-32 overflow-y-auto">
              {(result.results ?? []).filter((r) => r.status === 'failed').map((r, i) => (
                <p key={i} className="text-[11px] text-red-300">
                  <span className="font-mono">{r.wallet.slice(0, 10)}…</span> — {r.error}
                </p>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => { reset(); setCsv(''); }}
            className="px-3 py-2 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-gray-200 text-sm"
          >
            Import another CSV
          </button>
        </div>
      )}
    </section>
  );
}
