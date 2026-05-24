'use client';

/**
 * Per-error-source runbook editor.
 *
 * "When you see this error, do X." Admin-editable freeform notes attached
 * to an error source. Persisted via /api/admin/error-runbooks so all
 * admins see the same notes (not just the device where they were typed).
 *
 * Falls back to localStorage when the API call fails — so the notes are
 * never lost even if the backend is degraded. The next successful save
 * promotes them to the shared store.
 *
 * Phase 4 of the admin overhaul. Pairs with the per-group `💡 explainError`
 * blurb (which is hard-coded in lib/logSources.ts) — the runbook is the
 * editable extension where admins can capture context the code doesn't
 * know about ("ask Richard, this happens during deploys" etc.).
 */

import { useEffect, useRef, useState } from 'react';
import { useAdminAuthHeaders } from '@/hooks/admin/useAdminApi';

interface Props {
  source: string;
}

const LS_KEY = (source: string) => `sbs-admin-runbook:${source}`;
const SAVE_DEBOUNCE_MS = 800;

export function RunbookEditor({ source }: Props) {
  const getHeaders = useAdminAuthHeaders();
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load on mount: try the shared store first, fall back to localStorage.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const headers = await getHeaders();
        const res = await fetch(`/api/admin/error-runbooks?source=${encodeURIComponent(source)}`, { headers });
        if (res.ok) {
          const body = (await res.json()) as { text?: string };
          if (!cancelled) {
            setText(body.text || '');
            setLoaded(true);
            return;
          }
        }
      } catch { /* fall through to localStorage */ }
      if (cancelled) return;
      try {
        const fallback = localStorage.getItem(LS_KEY(source));
        if (fallback) setText(fallback);
      } catch { /* ignore */ }
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [source, getHeaders]);

  // Debounced save — fires SAVE_DEBOUNCE_MS after the last keystroke.
  // Persist to localStorage immediately on every change so a tab close
  // never loses unsaved edits; promote to the shared API on debounce.
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(LS_KEY(source), text); } catch { /* ignore */ }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        const headers = await getHeaders();
        const res = await fetch('/api/admin/error-runbooks', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ source, text }),
        });
        if (res.ok) setSavedAt(Date.now());
      } catch { /* keep localStorage as the surviving record */ }
      setSaving(false);
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [text, loaded, source, getHeaders]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] uppercase text-gray-500">Runbook</p>
        <span className="text-[10px] text-gray-500">
          {saving ? 'Saving…' : savedAt ? `saved ${Math.max(1, Math.round((Date.now() - savedAt) / 1000))}s ago` : ''}
        </span>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="When this fires, do X. (Notes shared with all admins.)"
        rows={3}
        className="w-full px-3 py-2 rounded-md bg-black/40 border border-white/[0.08] text-[12px] text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-banana/40 resize-y"
        spellCheck
      />
    </div>
  );
}
