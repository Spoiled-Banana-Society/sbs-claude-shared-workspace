'use client';

import { useCallback, useEffect, useState } from 'react';

interface DraftMerkleAdminPanelProps {
  getHeaders: () => Promise<HeadersInit>;
  enabled: boolean;
}

interface MerkleProofConfig {
  contractAddress?: string;
  vrfCoordinator?: string;
  vrfSubscriptionId?: string;
  vrfKeyHash?: string;
  deployerAddress?: string;
  deployTxHash?: string;
}

/**
 * Admin panel for the round-based draft Merkle proof system.
 * Deploys BBB4BatchProofMerkle on Base. After deploy + adding the new
 * address as a Chainlink VRF consumer, flip
 * system_config/batchProof.contractVariant to 'vrf-commit-merkle' to
 * route the next batch boundary through the new flow.
 */
export function DraftMerkleAdminPanel({ getHeaders, enabled }: DraftMerkleAdminPanelProps) {
  const [config, setConfig] = useState<MerkleProofConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Prefill defaults from the existing batch-proof config so the deploy
  // form lands on the same VRF subscription drafts already use.
  const [vrfCoordinator, setVrfCoordinator] = useState('');
  const [vrfSubId, setVrfSubId] = useState('');
  const [vrfKeyHash, setVrfKeyHash] = useState('');

  const mergeHeaders = useCallback(async () => {
    const headers = await getHeaders();
    const merged: Record<string, string> = { 'Content-Type': 'application/json' };
    if (headers instanceof Headers) headers.forEach((v, k) => { merged[k] = v; });
    else if (Array.isArray(headers)) headers.forEach(([k, v]) => { merged[k] = v; });
    else if (headers && typeof headers === 'object') Object.assign(merged, headers);
    return merged;
  }, [getHeaders]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const headers = await mergeHeaders();
        const res = await fetch('/api/admin/wheel-proof-defaults', { headers });
        if (!res.ok) return;
        const body = (await res.json()) as {
          found: boolean;
          vrfCoordinator?: string | null;
          subscriptionId?: string | null;
          keyHash?: string | null;
        };
        if (cancelled || !body.found) return;
        if (body.vrfCoordinator) setVrfCoordinator(body.vrfCoordinator);
        if (body.subscriptionId) setVrfSubId(body.subscriptionId);
        if (body.keyHash) setVrfKeyHash(body.keyHash);
      } catch {
        // best-effort
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, mergeHeaders]);

  // Surface the currently-deployed merkle contract address so the
  // Transfer / Force redeploy buttons appear without requiring a Deploy
  // click first.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/batch-proof-merkle-contract');
        if (!res.ok) return;
        const body = (await res.json()) as { contractAddress: string | null };
        if (cancelled || !body.contractAddress) return;
        setConfig((c) => ({ ...(c ?? {}), contractAddress: body.contractAddress ?? undefined }));
      } catch {
        // best-effort
      }
    })();
    return () => { cancelled = true; };
  }, [enabled]);

  const handleDeploy = useCallback(async (forceRedeploy = false) => {
    if (loading) return;
    if (!confirm(forceRedeploy
      ? 'FORCE redeploy BBB4BatchProofMerkle? Old contract address discarded — make sure to re-add the new one as a VRF consumer.'
      : 'Deploy BBB4BatchProofMerkle to Base mainnet?\n\nServer auto-uses the deployer wallet as the contract owner. After deploy, add the new address as a VRF consumer on Chainlink.'
    )) return;
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const headers = await mergeHeaders();
      const res = await fetch('/api/admin/deploy-batch-proof-merkle', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          vrfCoordinator: vrfCoordinator.trim(),
          subscriptionId: vrfSubId.trim(),
          keyHash: vrfKeyHash.trim(),
          forceRedeploy,
        }),
      });
      const body = (await res.json()) as { success?: boolean; error?: string; contractAddress?: string } & Record<string, unknown>;
      if (!res.ok || body.success === false) {
        setError(body.error || `Request failed (${res.status})`);
      } else {
        setInfo(JSON.stringify(body, null, 2));
        if (body.contractAddress) {
          setConfig((c) => ({ ...(c ?? {}), contractAddress: body.contractAddress }));
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [loading, mergeHeaders, vrfCoordinator, vrfSubId, vrfKeyHash]);

  if (!enabled) return null;

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-4 space-y-4">
      <div>
        <h4 className="text-xs font-semibold text-white uppercase tracking-wider">Draft Batch Proof (Merkle, round-based)</h4>
        <p className="text-[11px] text-gray-500 mt-0.5">
          Per-draft instant Merkle verification for the next-gen draft proof system. 10,000 drafts per round (= 100 batches × 100 drafts). 1/5/94 distribution enforced per 100-draft window. After deploy + VRF consumer, flip system_config/batchProof.contractVariant to &apos;vrf-commit-merkle&apos; to switch the next batch boundary onto this system.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
        <KV label="Contract" value={config?.contractAddress ? (
          <a className="text-banana hover:underline font-mono" href={`https://basescan.org/address/${config.contractAddress}`} target="_blank" rel="noreferrer">{config.contractAddress}</a>
        ) : <span className="text-amber-300">not deployed</span>} />
      </div>

      {!config?.contractAddress && (
        <div className="rounded-md bg-gray-900/80 border border-gray-700 p-3 space-y-2">
          <div className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider">Deploy contract</div>
          <p className="text-[11px] text-gray-500">
            Prefilled from the draft batch-proof config — same VRF subscription drafts already use.
          </p>
          <input
            placeholder="VRF coordinator address (0x...)"
            value={vrfCoordinator}
            onChange={(e) => setVrfCoordinator(e.target.value)}
            className="w-full px-2 py-1.5 rounded bg-gray-900 border border-gray-700 text-[11px] text-white font-mono"
          />
          <input
            placeholder="Subscription ID (decimal)"
            value={vrfSubId}
            onChange={(e) => setVrfSubId(e.target.value)}
            className="w-full px-2 py-1.5 rounded bg-gray-900 border border-gray-700 text-[11px] text-white font-mono"
          />
          <input
            placeholder="Key hash (0x... 64 hex)"
            value={vrfKeyHash}
            onChange={(e) => setVrfKeyHash(e.target.value)}
            className="w-full px-2 py-1.5 rounded bg-gray-900 border border-gray-700 text-[11px] text-white font-mono"
          />
          <button
            disabled={loading}
            onClick={() => handleDeploy(false)}
            className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[11px] font-semibold"
          >
            Deploy
          </button>
        </div>
      )}

      {config?.contractAddress && (
        <div className="flex flex-wrap gap-2">
          <button
            disabled={loading}
            onClick={async () => {
              if (loading) return;
              if (!confirm('Transfer merkle contract ownership to the Go API signer (0xe0d0…67e3)?\n\nRequired before the Go API can call requestRandomnessAndCommit / commitMerkleRoot / revealSalt without onlyOwner reverts.')) return;
              setLoading(true);
              setError(null);
              setInfo(null);
              try {
                const headers = await mergeHeaders();
                const res = await fetch('/api/admin/transfer-merkle-ownership', {
                  method: 'POST',
                  headers,
                  body: JSON.stringify({ newOwner: '0xe0d0C8ad893aD6F5fa0a51A43260c169C87b67e3' }),
                });
                const body = (await res.json()) as { success?: boolean; error?: string } & Record<string, unknown>;
                if (!res.ok || body.success === false) {
                  setError(body.error || `Request failed (${res.status})`);
                } else {
                  setInfo(JSON.stringify(body, null, 2));
                }
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setLoading(false);
              }
            }}
            className="px-3 py-1.5 rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-[11px] font-semibold"
          >
            Transfer ownership → Go API signer
          </button>
          <button
            disabled={loading}
            onClick={() => handleDeploy(true)}
            className="px-3 py-1.5 rounded bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-[11px] font-semibold"
          >
            Force redeploy
          </button>
        </div>
      )}

      {error && (
        <pre className="text-[10px] text-red-300 bg-red-950/30 border border-red-900 rounded p-2 whitespace-pre-wrap">{error}</pre>
      )}
      {info && (
        <pre className="text-[10px] text-gray-300 bg-gray-900/80 border border-gray-700 rounded p-2 whitespace-pre-wrap max-h-64 overflow-auto">{info}</pre>
      )}
    </div>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center gap-2">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-200">{value}</span>
    </div>
  );
}
