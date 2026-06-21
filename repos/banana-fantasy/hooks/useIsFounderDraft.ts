'use client';

import { useEffect, useState } from 'react';

/**
 * Returns whether a draft is a Founder Draft (server source of truth via
 * /api/founder-drafts/check). Read-only. Rule #0 safe: the fetch effect depends
 * only on the scalar draftId — no Privy-derived callbacks.
 */
export function useIsFounderDraft(draftId: string | undefined | null): boolean {
  const [isFounder, setIsFounder] = useState(false);

  useEffect(() => {
    if (!draftId) { setIsFounder(false); return; }
    let cancelled = false;
    fetch(`/api/founder-drafts/check?draftId=${encodeURIComponent(draftId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setIsFounder(d?.isFounder === true); })
      .catch(() => { if (!cancelled) setIsFounder(false); });
    return () => { cancelled = true; };
  }, [draftId]);

  return isFounder;
}
