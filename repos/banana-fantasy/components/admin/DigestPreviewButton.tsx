'use client';

/**
 * Send-digest-now button + previewer.
 *
 * Hits POST /api/admin/daily-digest which both renders + emails the
 * digest to admin recipients. Response includes the rendered subject
 * and body so we can show a preview right under the button.
 *
 * Vercel cron fires the GET path at 13:00 UTC daily — this button is
 * for "I want it now / I want to see what it looks like." Phase 5 of
 * the admin overhaul.
 */

import { useState } from 'react';
import { useAdminAuthHeaders } from '@/hooks/admin/useAdminApi';

interface Response {
  ok?: boolean;
  recipients?: number;
  status?: string;
  subject?: string;
  body?: string;
  error?: string;
}

export function DigestPreviewButton() {
  const getHeaders = useAdminAuthHeaders();
  const [submitting, setSubmitting] = useState(false);
  const [response, setResponse] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fire = async () => {
    setError(null);
    setResponse(null);
    if (!window.confirm(`Send the daily digest now to every admin with an email on file?`)) return;
    setSubmitting(true);
    try {
      const headers = await getHeaders();
      const res = await fetch('/api/admin/daily-digest', {
        method: 'POST',
        headers,
      });
      const json = (await res.json().catch(() => ({}))) as Response;
      if (!res.ok) setError(json.error || `${res.status}`);
      setResponse(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-white">Daily digest</h3>
        <p className="text-[12px] text-gray-500 mt-0.5">
          Fires daily at 13:00 UTC via cron to every admin email on file in notificationPrefs. Click below to send manually + preview.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={fire}
          disabled={submitting}
          className="px-3 py-1.5 rounded-md bg-banana hover:bg-banana/80 text-black text-xs font-semibold disabled:opacity-40 transition-colors"
        >
          {submitting ? 'Sending…' : 'Send digest now'}
        </button>
        {error && <span className="text-[12px] text-red-300">{error}</span>}
        {response?.status === 'sent' && (
          <span className="text-[12px] text-emerald-300">Sent to {response.recipients ?? '?'} recipient(s)</span>
        )}
        {response && response.status !== 'sent' && (
          <span className="text-[12px] text-amber-300">{response.status}</span>
        )}
      </div>
      {response?.subject && (
        <div className="rounded-md border border-white/[0.06] bg-black/30 p-3 space-y-1.5">
          <p className="text-[11px] uppercase text-gray-500">Preview</p>
          <p className="text-sm text-banana font-semibold">{response.subject}</p>
          <pre className="text-[11px] text-gray-300 whitespace-pre-wrap font-mono">{response.body}</pre>
        </div>
      )}
    </section>
  );
}
