'use client';

import { useEffect, useRef, useState } from 'react';

export interface FounderTeamRef {
  tokenId: string;
  owner?: string | null;
  /** Pass when the card already knows it (My Teams) so the server skips resolution. */
  leagueId?: string | null;
}

/**
 * Given a list of teams (token cards), returns the Set of tokenIds that were
 * drafted in a Founder Draft — for showing a FOUNDER label on team cards.
 *
 * ONE batched request per token-set (keyed on the sorted tokenIds), not a
 * per-card fetch — avoids N+1 and the Rule #0 render-loop/self-DDoS risk. The
 * effect depends only on the scalar key; the live token list is read via a ref.
 */
export function useFounderTeams(tokens: FounderTeamRef[]): Set<string> {
  const [founderSet, setFounderSet] = useState<Set<string>>(new Set());
  const key = tokens.map((t) => t.tokenId).filter(Boolean).sort().join(',');
  const tokensRef = useRef(tokens);
  tokensRef.current = tokens;

  useEffect(() => {
    if (!key) { setFounderSet(new Set()); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/founder-drafts/by-tokens', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tokens: tokensRef.current.map((t) => ({
              tokenId: t.tokenId,
              owner: t.owner ?? null,
              leagueId: t.leagueId ?? undefined,
            })),
          }),
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        setFounderSet(new Set<string>((data?.founderTokenIds ?? []).map(String)));
      } catch { /* best-effort — no badge on failure */ }
    })();
    return () => { cancelled = true; };
  }, [key]);

  return founderSet;
}
