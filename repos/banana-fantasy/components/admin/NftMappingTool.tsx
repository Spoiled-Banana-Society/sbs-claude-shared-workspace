'use client';

import { useCallback, useEffect, useState } from 'react';

interface Mapping {
  tokenId: string;
  leagueId: string | null;
  ownerAtMap: string | null;
  mappedAt: number | null;
  mappedBy: string | null;
}

export function NftMappingTool({ enabled }: { enabled: boolean }) {
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenIdInput, setTokenIdInput] = useState('');
  const [leagueIdInput, setLeagueIdInput] = useState('');
  const [ownerInput, setOwnerInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/nft-mapping', { credentials: 'include' });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data = await res.json();
      setMappings((data.mappings ?? []).sort((a: Mapping, b: Mapping) => Number(a.tokenId) - Number(b.tokenId)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) refresh();
  }, [enabled, refresh]);

  const handleSubmit = async () => {
    setSuccess(null);
    setError(null);
    if (!/^\d+$/.test(tokenIdInput.trim())) { setError('tokenId must be numeric'); return; }
    if (!leagueIdInput.trim()) { setError('leagueId required'); return; }

    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/nft-mapping', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tokenId: tokenIdInput.trim(),
          leagueId: leagueIdInput.trim(),
          ownerAtMap: ownerInput.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed: ${res.status}`);
      }
      setSuccess(`Mapped #${tokenIdInput} → ${leagueIdInput}`);
      setTokenIdInput('');
      setLeagueIdInput('');
      setOwnerInput('');
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (tokenId: string) => {
    if (!confirm(`Delete mapping for #${tokenId}?`)) return;
    try {
      const res = await fetch(`/api/admin/nft-mapping?tokenId=${tokenId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
    }
  };

  const handleClearAutoSynced = async () => {
    if (!confirm('Delete every auto-sync mapping (manual entries are kept)? Marketplace will re-pair on next visit.')) return;
    setError(null); setSuccess(null);
    try {
      const res = await fetch('/api/admin/nft-mapping?clearAutoSynced=1', {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data = await res.json();
      setSuccess(`Cleared ${data.deleted ?? 0} auto-sync mapping(s). Reload marketplace to re-pair.`);
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to clear');
    }
  };

  if (!enabled) return null;

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-semibold text-white uppercase tracking-wider">NFT → League Mapping</h4>
        <div className="flex items-center gap-3">
          <button
            onClick={() => void handleClearAutoSynced()}
            className="text-[11px] text-red-400 hover:text-red-300 underline underline-offset-2"
          >
            Clear auto-synced
          </button>
          <button
            onClick={() => void refresh()}
            disabled={loading}
            className="text-[11px] text-gray-400 hover:text-white underline underline-offset-2 disabled:opacity-50"
          >
            {loading ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      <p className="text-[11px] text-gray-500 mb-3">
        Manual override for tokenId → leagueId. Used by the marketplace to show real team data when the
        Go API&apos;s <code className="bg-black/30 px-1 rounded">_cardId</code> doesn&apos;t equal the on-chain tokenId
        (staging admin mints, post-trade desync, etc.). Production mints don&apos;t need this — cardId match handles them.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-[120px_1fr_1fr_auto] gap-2 mb-3">
        <input
          value={tokenIdInput}
          onChange={(e) => setTokenIdInput(e.target.value)}
          placeholder="tokenId (292)"
          className="bg-bg-primary border border-bg-tertiary rounded-lg px-3 py-2 text-xs text-white placeholder-gray-500 font-mono"
        />
        <input
          value={leagueIdInput}
          onChange={(e) => setLeagueIdInput(e.target.value)}
          placeholder="leagueId (2025-fast-draft-125)"
          className="bg-bg-primary border border-bg-tertiary rounded-lg px-3 py-2 text-xs text-white placeholder-gray-500 font-mono"
        />
        <input
          value={ownerInput}
          onChange={(e) => setOwnerInput(e.target.value)}
          placeholder="ownerAtMap (optional 0x…)"
          className="bg-bg-primary border border-bg-tertiary rounded-lg px-3 py-2 text-xs text-white placeholder-gray-500 font-mono"
        />
        <button
          onClick={() => void handleSubmit()}
          disabled={submitting}
          className="px-4 py-2 rounded-lg text-xs font-semibold bg-banana text-black hover:brightness-110 disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Save'}
        </button>
      </div>

      {error && (
        <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 mb-3">
          {error}
        </div>
      )}
      {success && (
        <div className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2 mb-3">
          {success}
        </div>
      )}

      {mappings.length === 0 ? (
        <p className="text-[11px] text-gray-500 italic">No mappings yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-gray-400">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Token</th>
                <th className="py-1.5 pr-3 font-medium">League</th>
                <th className="py-1.5 pr-3 font-medium">Owner</th>
                <th className="py-1.5 pr-3 font-medium">By</th>
                <th className="py-1.5"></th>
              </tr>
            </thead>
            <tbody className="text-white font-mono">
              {mappings.map((m) => (
                <tr key={m.tokenId} className="border-t border-white/[0.04]">
                  <td className="py-1.5 pr-3">#{m.tokenId}</td>
                  <td className="py-1.5 pr-3">{m.leagueId ?? '—'}</td>
                  <td className="py-1.5 pr-3 text-gray-400">{m.ownerAtMap ? `${m.ownerAtMap.slice(0, 6)}…${m.ownerAtMap.slice(-4)}` : '—'}</td>
                  <td className="py-1.5 pr-3 text-gray-400">{m.mappedBy ? `${m.mappedBy.slice(0, 6)}…${m.mappedBy.slice(-4)}` : '—'}</td>
                  <td className="py-1.5 text-right">
                    <button
                      onClick={() => void handleDelete(m.tokenId)}
                      className="text-red-400 hover:text-red-300 text-[11px]"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
