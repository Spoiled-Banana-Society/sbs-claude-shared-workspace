'use client';

import { useCallback, useEffect, useState } from 'react';

interface PeriodSummary {
  periodNumber: number;
  status: 'requested' | 'fulfilled' | 'active' | 'closed' | 'revealed';
  spinCount: number;
  maxSpins: number;
  saltHash: string;
  merkleRoot: string | null;
  vrfRandomness: string | null;
  salt: string | null;
  openedAt: number;
  commitTxHash: string | null;
  rootCommitTxHash: string | null;
  revealTxHash: string | null;
}

interface WheelProofAdminPanelProps {
  getHeaders: () => Promise<HeadersInit>;
  enabled: boolean;
}

export function WheelProofAdminPanel({ getHeaders, enabled }: WheelProofAdminPanelProps) {
  const [contractAddress, setContractAddress] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Deploy form inputs (pre-fill from existing batch-proof config if user wants)
  const [vrfCoordinator, setVrfCoordinator] = useState('');
  const [vrfSubId, setVrfSubId] = useState('');
  const [vrfKeyHash, setVrfKeyHash] = useState('');
  const [vrfInitialOwner, setVrfInitialOwner] = useState('');

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/wheel/period', { cache: 'no-store' });
      if (!res.ok) return;
      const body = (await res.json()) as { contractAddress: string | null; period: PeriodSummary | null };
      setContractAddress(body.contractAddress);
      setPeriod(body.period);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [enabled, refresh]);

  // Prefill the deploy form from the existing draft batch-proof config so
  // the wheel deploys to the same Chainlink VRF subscription with a single
  // click. Only fires once on mount.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    async function prefill() {
      try {
        const headers = await getHeaders();
        const merged: Record<string, string> = {};
        if (headers instanceof Headers) headers.forEach((v, k) => { merged[k] = v; });
        else if (Array.isArray(headers)) headers.forEach(([k, v]) => { merged[k] = v; });
        else if (headers && typeof headers === 'object') Object.assign(merged, headers);
        const res = await fetch('/api/admin/wheel-proof-defaults', { headers: merged });
        if (!res.ok) return;
        const body = (await res.json()) as {
          found: boolean;
          vrfCoordinator?: string | null;
          subscriptionId?: string | null;
          keyHash?: string | null;
          initialOwner?: string | null;
        };
        if (cancelled || !body.found) return;
        if (body.vrfCoordinator) setVrfCoordinator(body.vrfCoordinator);
        if (body.subscriptionId) setVrfSubId(body.subscriptionId);
        if (body.keyHash) setVrfKeyHash(body.keyHash);
        if (body.initialOwner) setVrfInitialOwner(body.initialOwner);
      } catch {
        // best-effort
      }
    }
    prefill();
    return () => { cancelled = true; };
  }, [enabled, getHeaders]);

  const runPost = useCallback(
    async (url: string, body?: unknown, confirmMsg?: string): Promise<unknown | null> => {
      if (confirmMsg && !confirm(confirmMsg)) return null;
      setLoading(true);
      setError(null);
      setInfo(null);
      try {
        const headers = await getHeaders();
        const merged: Record<string, string> = { 'Content-Type': 'application/json' };
        if (headers instanceof Headers) {
          headers.forEach((value, key) => { merged[key] = value; });
        } else if (Array.isArray(headers)) {
          headers.forEach(([k, v]) => { merged[k] = v; });
        } else if (headers && typeof headers === 'object') {
          Object.assign(merged, headers);
        }
        const res = await fetch(url, {
          method: 'POST',
          headers: merged,
          body: body ? JSON.stringify(body) : undefined,
        });
        const data = (await res.json()) as { success?: boolean; error?: string } & Record<string, unknown>;
        if (!res.ok || data.success === false) {
          setError(data.error || `Request failed (${res.status})`);
          return null;
        }
        setInfo(JSON.stringify(data, null, 2));
        await refresh();
        return data;
      } catch (err) {
        setError((err as Error).message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [getHeaders, refresh],
  );

  const handleDeploy = useCallback((forceRedeploy = false) => {
    return runPost(
      '/api/admin/deploy-banana-wheel-proof',
      {
        vrfCoordinator: vrfCoordinator.trim(),
        subscriptionId: vrfSubId.trim(),
        keyHash: vrfKeyHash.trim(),
        initialOwner: vrfInitialOwner.trim(),
        forceRedeploy,
      },
      forceRedeploy
        ? `FORCE redeploy BananaWheelProof? The old contract address will be discarded — make sure you re-add the new one as a VRF consumer afterward.`
        : `Deploy BananaWheelProof to Base mainnet?\n\n• coordinator: ${vrfCoordinator}\n• subscription: ${vrfSubId}\n• keyHash: ${vrfKeyHash}\n\nServer auto-uses the deployer wallet as the contract owner so subsequent calls don't revert on onlyOwner. After deploy, add the new address as a Consumer on the Chainlink VRF subscription.`,
    );
  }, [runPost, vrfCoordinator, vrfSubId, vrfKeyHash, vrfInitialOwner]);

  const handleOpen = useCallback(
    () =>
      runPost(
        '/api/admin/wheel-period/open',
        {},
        `Open the next wheel-proof period?\n\nThis submits a salt-hash commit + Chainlink VRF request on Base (one tx). After ~30s, call "Finalize" to compute outcomes and commit the Merkle root.`,
      ),
    [runPost],
  );

  const handleFinalize = useCallback(() => {
    if (!period) return;
    return runPost(
      '/api/admin/wheel-period/finalize',
      { periodNumber: period.periodNumber },
      `Finalize period ${period.periodNumber}?\n\nReads VRF randomness from the contract, pre-computes 10k outcomes, builds a Merkle tree, commits the root on-chain. Takes ~1-3s of compute + one Base tx.`,
    );
  }, [runPost, period]);

  const handleReveal = useCallback(() => {
    if (!period) return;
    return runPost(
      '/api/admin/wheel-period/reveal',
      { periodNumber: period.periodNumber },
      `Reveal salt for period ${period.periodNumber}?\n\nPublishes the period's salt on-chain. After this, anyone can re-derive every outcome from scratch and audit the Merkle root. Once revealed, the period is closed forever.`,
    );
  }, [runPost, period]);

  if (!enabled) return null;

  const stage = period?.status ?? null;

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-xs font-semibold text-white uppercase tracking-wider">Banana Wheel Proof (VRF + Merkle)</h4>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Provable-fair spin outcomes. 10,000 spins per period, Merkle root committed on-chain at open, salt revealed at close.
          </p>
        </div>
        <button
          onClick={() => void refresh()}
          className="text-[11px] text-gray-400 hover:text-white"
        >
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
        <KV label="Contract" value={contractAddress ? (
          <a className="text-banana hover:underline font-mono" href={`https://basescan.org/address/${contractAddress}`} target="_blank" rel="noreferrer">{contractAddress}</a>
        ) : <span className="text-amber-300">not deployed</span>} />
        <KV label="Current period" value={period ? `#${period.periodNumber}` : '—'} />
        <KV label="Status" value={stage ? <Pill status={stage} /> : '—'} />
        <KV label="Spins used" value={period ? `${period.spinCount.toLocaleString()} / ${period.maxSpins.toLocaleString()}` : '—'} />
        <KV label="Merkle root" value={period?.merkleRoot ? <span className="font-mono">{period.merkleRoot.slice(0, 14)}…</span> : '—'} />
        <KV label="Salt" value={period?.salt ? <span className="font-mono">{period.salt.slice(0, 14)}…</span> : (period ? 'sealed' : '—')} />
      </div>

      {!contractAddress && (
        <div className="rounded-md bg-gray-900/80 border border-gray-700 p-3 space-y-2">
          <div className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider">1. Deploy contract</div>
          <p className="text-[11px] text-gray-500">
            Reuse the draft VRF subscription. Look at <code>system_config/batchProof</code> in Firestore for the existing values.
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
          <input
            placeholder="Initial owner address (0x...)"
            value={vrfInitialOwner}
            onChange={(e) => setVrfInitialOwner(e.target.value)}
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

      {contractAddress && (
        <div className="flex flex-wrap gap-2">
          <button
            disabled={loading || (period?.status === 'requested' || period?.status === 'fulfilled' || period?.status === 'active')}
            onClick={handleOpen}
            className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-30 text-white text-[11px] font-semibold"
          >
            {period ? `Open period ${period.periodNumber + 1}` : 'Open period 1'}
          </button>
          <button
            disabled={loading}
            onClick={() => handleDeploy(true)}
            className="px-3 py-1.5 rounded bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-[11px] font-semibold"
          >
            Force redeploy
          </button>
          <button
            disabled={loading || !(period?.status === 'requested' || period?.status === 'fulfilled')}
            onClick={handleFinalize}
            className="px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-30 text-white text-[11px] font-semibold"
          >
            Finalize current
          </button>
          <button
            disabled={loading || !(period?.status === 'active' || period?.status === 'closed')}
            onClick={handleReveal}
            className="px-3 py-1.5 rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-30 text-white text-[11px] font-semibold"
          >
            Reveal salt
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

function Pill({ status }: { status: PeriodSummary['status'] }) {
  const styles: Record<PeriodSummary['status'], string> = {
    requested: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    fulfilled: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    active: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    closed: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
    revealed: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wider ${styles[status]}`}>
      {status}
    </span>
  );
}
