'use client';

import { useCallback, useMemo, useState } from 'react';
import { useSendTransaction, useWallets } from '@privy-io/react-auth';

import { ensureBaseNetwork } from '@/lib/ensureBaseNetwork';
import { friendlyTxError } from '@/lib/marketplace/txErrors';
import { logger } from '@/lib/logger';

// OpenSea Seaport conduit (operator we approve to transfer the NFT on sale).
const OPENSEA_CONDUIT = '0x1e0049783f008a0085193e00003d00cd54003c71';

export interface UseListTeamResult {
  /** List a team for sale. Handles the one-time NFT approval, then the Seaport order. */
  listTeam: (tokenId: string, priceUsd: number, durationSeconds: number) => Promise<{ orderHash: string; price: number }>;
  /** Cancel an active listing by its order hash. */
  cancelTeam: (tokenId: string, orderHash: string) => Promise<void>;
  busy: boolean;
  error: string | null;
  clearError: () => void;
}

/**
 * Shared listing flow used by the marketplace detail page and the My Teams
 * cards (the main marketplace page has its own copy). One place owns the
 * money path: embedded-vs-external wallet routing (gas-sponsored for Privy),
 * the NFT approval, createListing, and cancel.
 */
export function useListTeam(walletAddress: string | null): UseListTeamResult {
  const { wallets } = useWallets();
  const { sendTransaction } = useSendTransaction();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedWallet = useMemo(() => {
    const embedded = wallets.find(w => w.walletClientType === 'privy');
    if (embedded) return embedded;
    if (walletAddress) {
      return wallets.find(w => w.address.toLowerCase() === walletAddress.toLowerCase()) ?? null;
    }
    return wallets[0] ?? null;
  }, [wallets, walletAddress]);

  // Embedded Privy wallets get gas-sponsored, gasless txs; external wallets
  // (MetaMask, etc.) sign via their own provider and pay their own gas.
  const sendTx = useCallback(async (
    txRequest: { to: `0x${string}`; data?: `0x${string}`; value?: bigint; chainId: number },
    opts: { description: string; waitForReceipt?: boolean },
  ): Promise<{ hash: string }> => {
    if (!selectedWallet) throw new Error('No wallet connected');
    if (selectedWallet.walletClientType === 'privy') {
      const receipt = await sendTransaction(txRequest, { sponsor: true, uiOptions: { description: opts.description } });
      const r = receipt as Record<string, unknown>;
      return { hash: String(r.hash ?? r.transactionHash ?? '') };
    }
    const ethereum = await selectedWallet.getEthereumProvider();
    const currentChainHex = (await ethereum.request({ method: 'eth_chainId' })) as string;
    if (parseInt(currentChainHex, 16) !== txRequest.chainId) {
      await selectedWallet.switchChain(txRequest.chainId);
    }
    const { ethers } = await import('ethers');
    const provider = new ethers.BrowserProvider(ethereum);
    const signer = await provider.getSigner();
    const tx = await signer.sendTransaction({ to: txRequest.to, data: txRequest.data, value: txRequest.value });
    if (opts.waitForReceipt) await tx.wait();
    return { hash: tx.hash };
  }, [selectedWallet, sendTransaction]);

  const listTeam = useCallback(async (tokenId: string, priceUsd: number, durationSeconds: number) => {
    setError(null);
    setBusy(true);
    try {
      const { createListing } = await import('@/lib/marketplace/sell');
      const { ethers } = await import('ethers');
      const { BBB4_CONTRACT } = await import('@/lib/opensea');

      if (!selectedWallet) throw new Error('No wallet connected');
      const ethereum = await selectedWallet.getEthereumProvider();
      const baseNet = await ensureBaseNetwork(ethereum);
      if (!baseNet.ok) throw new Error(baseNet.message ?? 'Please switch your wallet to the Base network to continue.');

      const provider = new ethers.BrowserProvider(ethereum);
      const signer = await provider.getSigner();
      const signerAddress = await signer.getAddress();

      const iface = new ethers.Interface([
        'function isApprovedForAll(address owner, address operator) view returns (bool)',
        'function setApprovalForAll(address operator, bool approved)',
      ]);
      const checkData = iface.encodeFunctionData('isApprovedForAll', [signerAddress, OPENSEA_CONDUIT]);
      const checkRes = await fetch(process.env.NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL || 'https://mainnet.base.org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: BBB4_CONTRACT, data: checkData }, 'latest'] }),
      });
      const checkResult = await checkRes.json();
      const isApproved = checkResult?.result && parseInt(checkResult.result, 16) === 1;

      if (!isApproved) {
        const approvalData = iface.encodeFunctionData('setApprovalForAll', [OPENSEA_CONDUIT, true]);
        await sendTx(
          { to: BBB4_CONTRACT as `0x${string}`, data: approvalData as `0x${string}`, chainId: 8453 },
          { description: 'Approve marketplace to list your NFTs', waitForReceipt: true },
        );
      }

      const result = await createListing(tokenId, priceUsd, signerAddress, provider, durationSeconds);
      logger.debug('[useListTeam] Listed with orderHash:', result.orderHash);
      return { orderHash: result.orderHash, price: priceUsd };
    } catch (e) {
      setError(friendlyTxError(e, 'Couldn’t create the listing. Please try again.'));
      throw e;
    } finally {
      setBusy(false);
    }
  }, [selectedWallet, sendTx]);

  const cancelTeam = useCallback(async (tokenId: string, orderHash: string) => {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch('/api/marketplace/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderHash }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to prepare cancel transaction' }));
        throw new Error(errorData.error || `Cancel failed: ${response.status}`);
      }
      const tx = await response.json();
      await sendTx(
        { to: tx.to as `0x${string}`, data: tx.data as `0x${string}`, chainId: 8453 },
        { description: 'Cancel your listing', waitForReceipt: true },
      );
      logger.debug('[useListTeam] Cancelled listing for token:', tokenId);
    } catch (e) {
      setError(friendlyTxError(e, 'Couldn’t cancel the listing. Please try again.'));
      throw e;
    } finally {
      setBusy(false);
    }
  }, [sendTx]);

  return { listTeam, cancelTeam, busy, error, clearError: () => setError(null) };
}
