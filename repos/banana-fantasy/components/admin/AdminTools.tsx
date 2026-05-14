'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAdminAuthHeaders } from '@/hooks/admin/useAdminApi';
import { GrantPrizeForm } from '@/components/admin/GrantPrizeForm';
import { NftMappingTool } from '@/components/admin/NftMappingTool';
import { RecoverDraftCardForm } from '@/components/admin/RecoverDraftCardForm';

interface WalletStatus {
  address: string;
  healthy: boolean;
  balanceWei: string | null;
  bytecode: string;
  isDelegated: boolean;
  delegate: string | null;
}

interface RevokeResponse {
  success: boolean;
  alreadyRevoked?: boolean;
  address?: string;
  previousDelegate?: string;
  txHash?: string;
  codeBefore?: string;
  codeAfter?: string;
  cleared?: boolean;
  note?: string;
  error?: string;
  requestId?: string;
}

interface DeployBatchProofResponse {
  success: boolean;
  alreadyDeployed?: boolean;
  contractAddress?: string;
  deployTxHash?: string;
  deployerAddress?: string;
  blockNumber?: number;
  gasUsed?: string;
  basescanContract?: string;
  basescanTx?: string;
  note?: string;
  error?: string;
  requestId?: string;
}

interface TransferOwnershipResponse {
  success: boolean;
  alreadyTransferred?: boolean;
  contractAddress?: string;
  currentOwner?: string;
  previousOwner?: string;
  newOwner?: string;
  txHash?: string;
  blockNumber?: number;
  basescanTx?: string;
  note?: string;
  error?: string;
  requestId?: string;
}

interface DeployVRFResponse {
  success: boolean;
  alreadyDeployed?: boolean;
  contractAddress?: string;
  contractVariant?: string;
  deployTxHash?: string;
  deployerAddress?: string;
  vrfCoordinator?: string;
  subscriptionId?: string;
  keyHash?: string;
  initialOwner?: string;
  blockNumber?: number;
  gasUsed?: string;
  basescanContract?: string;
  basescanTx?: string;
  nextSteps?: string[];
  note?: string;
  error?: string;
  requestId?: string;
}

const BASE_RPC = 'https://mainnet.base.org';

async function fetchWalletStatus(): Promise<WalletStatus | null> {
  // Public endpoint — no auth needed.
  const walletInfoRes = await fetch('/api/purchases/admin-wallet');
  if (!walletInfoRes.ok) return null;
  const walletInfo = (await walletInfoRes.json()) as {
    address?: string;
    healthy?: boolean;
    balanceWei?: string | null;
  };
  if (!walletInfo.address) return null;

  // Read bytecode directly from public Base RPC. No admin auth needed for an
  // eth_getCode read — chain data is public anyway.
  const codeRes = await fetch(BASE_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getCode',
      params: [walletInfo.address, 'latest'],
    }),
  });
  const codeBody = (await codeRes.json()) as { result?: string };
  const bytecode = (codeBody.result ?? '0x').toLowerCase();
  const isDelegated = bytecode.startsWith('0xef0100');
  const delegate = isDelegated ? `0x${bytecode.slice(8, 48)}` : null;

  return {
    address: walletInfo.address,
    healthy: walletInfo.healthy ?? true,
    balanceWei: walletInfo.balanceWei ?? null,
    bytecode,
    isDelegated,
    delegate,
  };
}

function formatEth(wei: string | null): string {
  if (!wei) return '—';
  const big = BigInt(wei);
  const eth = Number(big) / 1e18;
  return `${eth.toFixed(6)} ETH`;
}

export function AdminTools({ enabled }: { enabled: boolean }) {
  const getHeaders = useAdminAuthHeaders();
  const [status, setStatus] = useState<WalletStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeResult, setRevokeResult] = useState<RevokeResponse | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState<DeployBatchProofResponse | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [newOwnerInput, setNewOwnerInput] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [transferResult, setTransferResult] = useState<TransferOwnershipResponse | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [vrfCoordinatorInput, setVrfCoordinatorInput] = useState('0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634');
  const [vrfSubIdInput, setVrfSubIdInput] = useState('');
  const [vrfKeyHashInput, setVrfKeyHashInput] = useState('');
  const [vrfInitialOwnerInput, setVrfInitialOwnerInput] = useState('0xe0d0C8ad893aD6F5fa0a51A43260c169C87b67e3');
  const [deployingVrf, setDeployingVrf] = useState(false);
  const [vrfResult, setVrfResult] = useState<DeployVRFResponse | null>(null);
  const [vrfError, setVrfError] = useState<string | null>(null);

  // VRF+Commit hybrid deploy state. Reuses the same form values as the
  // VRF-only deploy above — they're identical Chainlink config + initial
  // owner — but writes contractVariant='vrf-commit' to Firestore so the
  // Go API picks up the salt-commit + reveal flow.
  const [deployingVrfCommit, setDeployingVrfCommit] = useState(false);
  const [vrfCommitResult, setVrfCommitResult] = useState<DeployVRFResponse | null>(null);
  const [vrfCommitError, setVrfCommitError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const next = await fetchWalletStatus();
      if (!next) {
        setStatusError('Failed to load wallet status');
        return;
      }
      setStatus(next);
    } catch (err) {
      setStatusError((err as Error).message);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  const handleRevoke = useCallback(async () => {
    if (revoking) return;
    setRevoking(true);
    setRevokeError(null);
    setRevokeResult(null);
    try {
      const headers = await getHeaders();
      const res = await fetch('/api/admin/revoke-7702', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
      const body = (await res.json()) as RevokeResponse;
      if (!res.ok || !body.success) {
        setRevokeError(body.error || `Request failed (${res.status})`);
      } else {
        setRevokeResult(body);
      }
      // Always refresh status afterwards so the badge reflects reality.
      await refresh();
    } catch (err) {
      setRevokeError((err as Error).message);
    } finally {
      setRevoking(false);
    }
  }, [getHeaders, refresh, revoking]);

  const handleDeployBatchProof = useCallback(async () => {
    if (deploying) return;
    if (!confirm('Deploy BBB4BatchProof.sol to Base mainnet using the admin wallet? Costs ~$3 in ETH gas. This action is permanent.')) return;
    setDeploying(true);
    setDeployError(null);
    setDeployResult(null);
    try {
      const headers = await getHeaders();
      const res = await fetch('/api/admin/deploy-batch-proof', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
      const body = (await res.json()) as DeployBatchProofResponse;
      if (!res.ok || !body.success) {
        setDeployError(body.error || `Request failed (${res.status})`);
      } else {
        setDeployResult(body);
      }
    } catch (err) {
      setDeployError((err as Error).message);
    } finally {
      setDeploying(false);
    }
  }, [getHeaders, deploying]);

  const handleTransferOwnership = useCallback(async () => {
    if (transferring) return;
    const trimmed = newOwnerInput.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
      setTransferError('Address must be 0x followed by 40 hex characters.');
      return;
    }
    if (!confirm(`Transfer BBB4BatchProof ownership to ${trimmed}? After this commits, the new address controls all future commit/reveal txs and the OLD admin wallet has no power over the proof contract. The BBB4 NFT contract is unaffected.`)) return;
    setTransferring(true);
    setTransferError(null);
    setTransferResult(null);
    try {
      const headers = await getHeaders();
      const res = await fetch('/api/admin/transfer-batchproof-ownership', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ newOwner: trimmed }),
      });
      const body = (await res.json()) as TransferOwnershipResponse;
      if (!res.ok || !body.success) {
        setTransferError(body.error || `Request failed (${res.status})`);
      } else {
        setTransferResult(body);
      }
    } catch (err) {
      setTransferError((err as Error).message);
    } finally {
      setTransferring(false);
    }
  }, [getHeaders, transferring, newOwnerInput]);

  const handleDeployVRF = useCallback(async () => {
    if (deployingVrf) return;
    if (!confirm(`Deploy BBB4BatchProofVRF to Base mainnet?\n\n• coordinator: ${vrfCoordinatorInput}\n• subscription: ${vrfSubIdInput}\n• keyHash: ${vrfKeyHashInput}\n• initial owner: ${vrfInitialOwnerInput}\n\nMake sure the subscription is funded with LINK BEFORE batch 4 starts.`)) return;
    setDeployingVrf(true);
    setVrfError(null);
    setVrfResult(null);
    try {
      const headers = await getHeaders();
      const res = await fetch('/api/admin/deploy-batch-proof-vrf', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vrfCoordinator: vrfCoordinatorInput.trim(),
          subscriptionId: vrfSubIdInput.trim(),
          keyHash: vrfKeyHashInput.trim(),
          initialOwner: vrfInitialOwnerInput.trim(),
        }),
      });
      const body = (await res.json()) as DeployVRFResponse;
      if (!res.ok || !body.success) {
        setVrfError(body.error || `Request failed (${res.status})`);
      } else {
        setVrfResult(body);
      }
    } catch (err) {
      setVrfError((err as Error).message);
    } finally {
      setDeployingVrf(false);
    }
  }, [getHeaders, deployingVrf, vrfCoordinatorInput, vrfSubIdInput, vrfKeyHashInput, vrfInitialOwnerInput]);

  const handleDeployVrfCommit = useCallback(async () => {
    if (deployingVrfCommit) return;
    if (!confirm(`Deploy BBB4BatchProofVRFCommit (VRF + commit/reveal hybrid) to Base mainnet?\n\n• coordinator: ${vrfCoordinatorInput}\n• subscription: ${vrfSubIdInput}\n• keyHash: ${vrfKeyHashInput}\n• initial owner: ${vrfInitialOwnerInput}\n\nThis is the airtight version: VRF prevents SBS from grinding, salt-commit prevents users from peeking. The Firestore variant flips to 'vrf-commit' on success.`)) return;
    setDeployingVrfCommit(true);
    setVrfCommitError(null);
    setVrfCommitResult(null);
    try {
      const headers = await getHeaders();
      const res = await fetch('/api/admin/deploy-batch-proof-vrf-commit', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vrfCoordinator: vrfCoordinatorInput.trim(),
          subscriptionId: vrfSubIdInput.trim(),
          keyHash: vrfKeyHashInput.trim(),
          initialOwner: vrfInitialOwnerInput.trim(),
        }),
      });
      const body = (await res.json()) as DeployVRFResponse;
      if (!res.ok || !body.success) {
        setVrfCommitError(body.error || `Request failed (${res.status})`);
      } else {
        setVrfCommitResult(body);
      }
    } catch (err) {
      setVrfCommitError((err as Error).message);
    } finally {
      setDeployingVrfCommit(false);
    }
  }, [getHeaders, deployingVrfCommit, vrfCoordinatorInput, vrfSubIdInput, vrfKeyHashInput, vrfInitialOwnerInput]);

  if (!enabled) return null;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-white">Admin Tools</h3>
        <p className="text-[11px] text-gray-500 mt-0.5">
          One-off operational utilities. Use sparingly and remove the endpoints after they have served their purpose.
        </p>
      </div>

      <GrantPrizeForm />

      <NftMappingTool enabled={enabled} />

      <RecoverDraftCardForm />

      {/* Wallet status card */}
      <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-semibold text-white uppercase tracking-wider">Admin Wallet Status</h4>
          <button
            onClick={() => void refresh()}
            disabled={statusLoading}
            className="text-[11px] text-gray-400 hover:text-white underline underline-offset-2 disabled:opacity-50"
          >
            {statusLoading ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>

        {statusError && (
          <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 mb-3">
            {statusError}
          </div>
        )}

        {status && (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-xs">
            <dt className="text-gray-400">Address</dt>
            <dd className="text-white font-mono break-all">{status.address}</dd>

            <dt className="text-gray-400">ETH balance</dt>
            <dd className={status.healthy ? 'text-emerald-300' : 'text-red-300'}>
              {formatEth(status.balanceWei)} {status.healthy ? '✓' : '⚠ low'}
            </dd>

            <dt className="text-gray-400">Bytecode</dt>
            <dd>
              {status.isDelegated ? (
                <div>
                  <span className="text-amber-300 font-semibold">⚠ EIP-7702 delegated</span>
                  <div className="text-[10px] text-gray-500 mt-0.5 font-mono break-all">
                    delegate: {status.delegate}
                  </div>
                </div>
              ) : (
                <span className="text-emerald-300">✓ plain EOA</span>
              )}
            </dd>
          </dl>
        )}
      </div>

      {/* Revoke EIP-7702 tool */}
      <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-4">
        <h4 className="text-xs font-semibold text-white uppercase tracking-wider mb-2">Revoke EIP-7702 Delegation</h4>
        <p className="text-[11px] text-gray-400 mb-3 leading-relaxed">
          Removes the smart-account upgrade from the admin wallet, restoring it to a plain EOA. Required when viem
          rejects mint transactions with &ldquo;insufficient funds for gas * price + value&rdquo; because the
          delegation makes viem ignore our pinned gas params. Reversible at any time. Costs ~$0.05 in Base gas,
          paid by the admin wallet&apos;s own ETH.
        </p>

        <button
          onClick={() => void handleRevoke()}
          disabled={revoking || !status?.isDelegated}
          className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-600 disabled:text-gray-400 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-colors"
        >
          {revoking
            ? 'Revoking…'
            : !status
              ? 'Loading status…'
              : !status.isDelegated
                ? 'Already plain EOA — nothing to revoke'
                : 'Revoke EIP-7702 delegation'}
        </button>

        {revokeError && (
          <div className="mt-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            {revokeError}
          </div>
        )}

        {revokeResult && (
          <div className="mt-3 text-xs bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2 space-y-1">
            <p className="text-emerald-300 font-semibold">
              {revokeResult.alreadyRevoked
                ? '✓ Already plain EOA — no tx sent'
                : revokeResult.cleared
                  ? '✓ Revoke confirmed — wallet is now plain EOA'
                  : '⚠ Revoke tx sent but bytecode unchanged — investigate'}
            </p>
            {revokeResult.txHash && (
              <p className="text-gray-300 font-mono break-all">
                tx:{' '}
                <a
                  href={`https://basescan.org/tx/${revokeResult.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-300 hover:text-blue-200 underline"
                >
                  {revokeResult.txHash}
                </a>
              </p>
            )}
            {revokeResult.previousDelegate && (
              <p className="text-gray-400">
                previous delegate: <span className="font-mono">{revokeResult.previousDelegate}</span>
              </p>
            )}
            {revokeResult.note && <p className="text-gray-400 italic">{revokeResult.note}</p>}
          </div>
        )}
      </div>

      {/* Deploy BBB4BatchProof contract */}
      <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-4">
        <h4 className="text-xs font-semibold text-white uppercase tracking-wider mb-2">Deploy BBB4BatchProof Contract</h4>
        <p className="text-[11px] text-gray-400 mb-3 leading-relaxed">
          Deploys the provably-fair commit/reveal contract to Base mainnet. Owner is set to the admin wallet
          (same one that signs reserveTokens). Idempotent — refuses to redeploy if a contract is already on file
          in Firestore. ~$3 one-time gas, paid by the admin wallet&apos;s ETH. Required before the Go API can start
          publishing batch proofs.
        </p>

        <button
          onClick={() => void handleDeployBatchProof()}
          disabled={deploying}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 disabled:text-gray-400 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-colors"
        >
          {deploying ? 'Deploying contract…' : 'Deploy BatchProof to Base'}
        </button>

        {deployError && (
          <div className="mt-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            {deployError}
          </div>
        )}

        {deployResult && (
          <div className="mt-3 text-xs bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2 space-y-1.5">
            <p className="text-emerald-300 font-semibold">
              {deployResult.alreadyDeployed
                ? '✓ Contract already deployed — using existing address'
                : '✓ Contract deployed successfully'}
            </p>
            {deployResult.contractAddress && (
              <p className="text-gray-300 font-mono break-all">
                contract:{' '}
                <a
                  href={deployResult.basescanContract || `https://basescan.org/address/${deployResult.contractAddress}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-300 hover:text-blue-200 underline"
                >
                  {deployResult.contractAddress}
                </a>
              </p>
            )}
            {deployResult.deployTxHash && (
              <p className="text-gray-300 font-mono break-all">
                tx:{' '}
                <a
                  href={deployResult.basescanTx || `https://basescan.org/tx/${deployResult.deployTxHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-300 hover:text-blue-200 underline"
                >
                  {deployResult.deployTxHash}
                </a>
              </p>
            )}
            {deployResult.blockNumber && (
              <p className="text-gray-400">block {deployResult.blockNumber.toLocaleString()} · gas {deployResult.gasUsed}</p>
            )}
            {!deployResult.alreadyDeployed && deployResult.contractAddress && (
              <p className="text-gray-400 italic mt-2">
                Add <code className="font-mono text-white/80">NEXT_PUBLIC_BBB4_BATCH_PROOF_ADDRESS={deployResult.contractAddress}</code>{' '}
                to Vercel env. The Go API will read the same address from Firestore (system_config/batchProof).
              </p>
            )}
            {deployResult.note && <p className="text-gray-400 italic">{deployResult.note}</p>}
          </div>
        )}
      </div>

      {/* Transfer BBB4BatchProof ownership to a dedicated signer */}
      <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-4">
        <h4 className="text-xs font-semibold text-white uppercase tracking-wider mb-2">Transfer BatchProof Ownership</h4>
        <p className="text-[11px] text-gray-400 mb-3 leading-relaxed">
          Transfers BBB4BatchProof contract ownership to a new address. Lets us run the proof system with a
          dedicated signer that has no power over BBB4 NFTs or USDC — smaller blast radius if it leaks. The
          BBB4 NFT contract is untouched. Costs ~$0.001 in Base gas, paid by the current owner.
        </p>
        <p className="text-[11px] text-amber-300 mb-3">
          ⚠ Make sure you have the new address&apos;s private key saved in 1Password BEFORE clicking. After
          this commits, the OLD admin wallet can no longer sign batch-proof txs.
        </p>

        <input
          type="text"
          value={newOwnerInput}
          onChange={(e) => setNewOwnerInput(e.target.value)}
          placeholder="0x... new owner address"
          spellCheck={false}
          className="w-full max-w-[28rem] px-3 py-2 mb-2 text-xs font-mono bg-gray-900 text-white border border-gray-600 rounded-lg focus:outline-none focus:border-amber-500"
        />

        <div>
          <button
            onClick={() => void handleTransferOwnership()}
            disabled={transferring || !newOwnerInput.trim()}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-600 disabled:text-gray-400 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-colors"
          >
            {transferring ? 'Transferring…' : 'Transfer ownership'}
          </button>
        </div>

        {transferError && (
          <div className="mt-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            {transferError}
          </div>
        )}

        {transferResult && (
          <div className="mt-3 text-xs bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2 space-y-1.5">
            <p className="text-emerald-300 font-semibold">
              {transferResult.alreadyTransferred
                ? '✓ Already owned by that address — no tx sent'
                : '✓ Ownership transferred'}
            </p>
            {transferResult.contractAddress && (
              <p className="text-gray-300 font-mono break-all">contract: {transferResult.contractAddress}</p>
            )}
            {transferResult.previousOwner && (
              <p className="text-gray-400">previous owner: <span className="font-mono">{transferResult.previousOwner}</span></p>
            )}
            {(transferResult.newOwner || transferResult.currentOwner) && (
              <p className="text-gray-300">new owner: <span className="font-mono">{transferResult.newOwner || transferResult.currentOwner}</span></p>
            )}
            {transferResult.txHash && (
              <p className="text-gray-300 font-mono break-all">
                tx:{' '}
                <a
                  href={transferResult.basescanTx || `https://basescan.org/tx/${transferResult.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-300 hover:text-blue-200 underline"
                >
                  {transferResult.txHash}
                </a>
              </p>
            )}
            {transferResult.note && <p className="text-gray-400 italic">{transferResult.note}</p>}
          </div>
        )}
      </div>

      {/* Deploy BBB4BatchProofVRF — Chainlink VRF v2.5 backed contract */}
      <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-4">
        <h4 className="text-xs font-semibold text-white uppercase tracking-wider mb-2">Deploy BBB4BatchProofVRF (Chainlink VRF)</h4>
        <p className="text-[11px] text-gray-400 mb-3 leading-relaxed">
          Deploys the VRF-backed proof contract to Base mainnet. Replaces the legacy commit-reveal contract — Firestore
          system_config/batchProof gets overwritten to point at this one. Each batch&apos;s randomness comes from
          Chainlink&apos;s VRF v2.5 oracle network; SBS literally never sees the seed before it lands. ~$3 deploy gas + ~$5/batch in LINK.
        </p>
        <p className="text-[11px] text-amber-300 mb-3 leading-relaxed">
          ⚠ Before you click: create a Chainlink VRF v2.5 subscription at <span className="font-mono">vrf.chain.link</span>,
          fund it with LINK on Base, and grab the subscription ID. After deploy, return to vrf.chain.link and add the
          deployed contract address as a Consumer of that subscription.
        </p>

        <div className="space-y-2 max-w-[36rem]">
          <label className="block text-[10px] text-gray-400 uppercase tracking-wider">VRF Coordinator (Base mainnet)</label>
          <input
            type="text"
            value={vrfCoordinatorInput}
            onChange={(e) => setVrfCoordinatorInput(e.target.value)}
            spellCheck={false}
            className="w-full px-3 py-1.5 text-xs font-mono bg-gray-900 text-white border border-gray-600 rounded-lg focus:outline-none focus:border-purple-500"
          />

          <label className="block text-[10px] text-gray-400 uppercase tracking-wider mt-2">Subscription ID (uint256, decimal or 0x)</label>
          <input
            type="text"
            value={vrfSubIdInput}
            onChange={(e) => setVrfSubIdInput(e.target.value)}
            placeholder="e.g. 12345678901234567890..."
            spellCheck={false}
            className="w-full px-3 py-1.5 text-xs font-mono bg-gray-900 text-white border border-gray-600 rounded-lg focus:outline-none focus:border-purple-500"
          />

          <label className="block text-[10px] text-gray-400 uppercase tracking-wider mt-2">Key Hash (gas lane, bytes32)</label>
          <input
            type="text"
            value={vrfKeyHashInput}
            onChange={(e) => setVrfKeyHashInput(e.target.value)}
            placeholder="0x... 64 hex chars"
            spellCheck={false}
            className="w-full px-3 py-1.5 text-xs font-mono bg-gray-900 text-white border border-gray-600 rounded-lg focus:outline-none focus:border-purple-500"
          />

          <label className="block text-[10px] text-gray-400 uppercase tracking-wider mt-2">Initial Owner (will sign requestRandomness)</label>
          <input
            type="text"
            value={vrfInitialOwnerInput}
            onChange={(e) => setVrfInitialOwnerInput(e.target.value)}
            placeholder="0x... 40 hex chars"
            spellCheck={false}
            className="w-full px-3 py-1.5 text-xs font-mono bg-gray-900 text-white border border-gray-600 rounded-lg focus:outline-none focus:border-purple-500"
          />
        </div>

        <div className="mt-3">
          <button
            onClick={() => void handleDeployVRF()}
            disabled={deployingVrf || !vrfCoordinatorInput.trim() || !vrfSubIdInput.trim() || !vrfKeyHashInput.trim() || !vrfInitialOwnerInput.trim()}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 disabled:text-gray-400 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-colors"
          >
            {deployingVrf ? 'Deploying…' : 'Deploy VRF contract'}
          </button>
        </div>

        {vrfError && (
          <div className="mt-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            {vrfError}
          </div>
        )}

        {vrfResult && (
          <div className="mt-3 text-xs bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2 space-y-1.5">
            <p className="text-emerald-300 font-semibold">
              {vrfResult.alreadyDeployed ? '✓ Already deployed' : '✓ VRF contract deployed'}
            </p>
            {vrfResult.contractAddress && (
              <p className="text-gray-300 font-mono break-all">
                contract:{' '}
                <a href={vrfResult.basescanContract || `https://basescan.org/address/${vrfResult.contractAddress}`} target="_blank" rel="noreferrer" className="text-blue-300 hover:text-blue-200 underline">
                  {vrfResult.contractAddress}
                </a>
              </p>
            )}
            {vrfResult.deployTxHash && (
              <p className="text-gray-300 font-mono break-all">
                tx:{' '}
                <a href={vrfResult.basescanTx || `https://basescan.org/tx/${vrfResult.deployTxHash}`} target="_blank" rel="noreferrer" className="text-blue-300 hover:text-blue-200 underline">
                  {vrfResult.deployTxHash}
                </a>
              </p>
            )}
            {vrfResult.nextSteps && vrfResult.nextSteps.length > 0 && (
              <div className="pt-2 mt-2 border-t border-emerald-500/20 space-y-1">
                <p className="text-emerald-300 font-semibold text-[11px]">Next steps:</p>
                <ol className="text-gray-300 list-decimal list-inside space-y-1">
                  {vrfResult.nextSteps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              </div>
            )}
            {vrfResult.note && <p className="text-gray-400 italic">{vrfResult.note}</p>}
          </div>
        )}
      </div>

      {/* Deploy BBB4BatchProofVRFCommit — VRF + commit/reveal hybrid (airtight) */}
      <div className="rounded-xl border border-emerald-700/40 bg-emerald-900/10 p-4">
        <h4 className="text-xs font-semibold text-white uppercase tracking-wider mb-2">
          Deploy BBB4BatchProofVRFCommit (VRF + Salt Commit · airtight)
        </h4>
        <p className="text-[11px] text-gray-300 mb-3 leading-relaxed">
          Deploys the <span className="font-semibold text-emerald-200">salt-commit + Chainlink VRF v2.5 hybrid</span>.
          This is the version that hides slot positions from the public during a batch (commit-reveal property)
          while still binding entropy to a decentralized oracle (VRF property). Neither SBS nor users can manipulate
          outcomes — VRF prevents seed grinding, the salt commit prevents on-chain peeking. Firestore
          system_config/batchProof flips to <code className="font-mono text-emerald-200">contractVariant: &quot;vrf-commit&quot;</code>.
          Re-uses the form fields above.
        </p>
        <p className="text-[11px] text-amber-300 mb-3 leading-relaxed">
          ⚠ Same prerequisites as VRF: subscription must exist, be funded with LINK, and after deploy you must add this
          contract address as a Consumer of the subscription on <span className="font-mono">vrf.chain.link</span>.
        </p>

        <div className="mt-3">
          <button
            onClick={() => void handleDeployVrfCommit()}
            disabled={
              deployingVrfCommit ||
              !vrfCoordinatorInput.trim() ||
              !vrfSubIdInput.trim() ||
              !vrfKeyHashInput.trim() ||
              !vrfInitialOwnerInput.trim()
            }
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-600 disabled:text-gray-400 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-colors"
          >
            {deployingVrfCommit ? 'Deploying…' : 'Deploy VRF+Commit contract'}
          </button>
        </div>

        {vrfCommitError && (
          <div className="mt-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            {vrfCommitError}
          </div>
        )}

        {vrfCommitResult && (
          <div className="mt-3 text-xs bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2 space-y-1.5">
            <p className="text-emerald-300 font-semibold">
              {vrfCommitResult.alreadyDeployed ? '✓ Already deployed' : '✓ VRF+Commit contract deployed'}
            </p>
            {vrfCommitResult.contractAddress && (
              <p className="text-gray-300 font-mono break-all">
                contract:{' '}
                <a
                  href={vrfCommitResult.basescanContract || `https://basescan.org/address/${vrfCommitResult.contractAddress}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-300 hover:text-blue-200 underline"
                >
                  {vrfCommitResult.contractAddress}
                </a>
              </p>
            )}
            {vrfCommitResult.deployTxHash && (
              <p className="text-gray-300 font-mono break-all">
                tx:{' '}
                <a
                  href={vrfCommitResult.basescanTx || `https://basescan.org/tx/${vrfCommitResult.deployTxHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-300 hover:text-blue-200 underline"
                >
                  {vrfCommitResult.deployTxHash}
                </a>
              </p>
            )}
            {vrfCommitResult.nextSteps && vrfCommitResult.nextSteps.length > 0 && (
              <div className="pt-2 mt-2 border-t border-emerald-500/20 space-y-1">
                <p className="text-emerald-300 font-semibold text-[11px]">Next steps:</p>
                <ol className="text-gray-300 list-decimal list-inside space-y-1">
                  {vrfCommitResult.nextSteps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              </div>
            )}
            {vrfCommitResult.note && <p className="text-gray-400 italic">{vrfCommitResult.note}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
