'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWallets } from '@privy-io/react-auth';
import {
  createPublicClient,
  http,
  type Address,
  type Hex,
} from 'viem';
import { useAuth } from '@/hooks/useAuth';
import {
  BASE,
  BASE_RPC_URL,
  BASE_SEPOLIA_USDC_ADDRESS,
  BBB4_ABI,
  BBB4_CONTRACT_ADDRESS,
  USDC_PERMIT_ABI,
} from '@/lib/contracts/bbb4';
import { buildUsdcPermitTypedData } from '@/lib/onchain/usdcPermit';

type MintFn = (quantity: number, opts?: { paymentMethod?: 'usdc' | 'card' }) => Promise<Hex>;

export type MintStep = 'idle' | 'signing' | 'processing' | 'success' | 'error';

interface UseMintDraftPassResult {
  mint: MintFn;
  isApproving: boolean;
  isMinting: boolean;
  /** Current step of the mint flow, used by the modal to render a stepper. */
  mintStep: MintStep;
  error: string | null;
  txHash: Hex | null;
  tokenPrice: bigint | null;
  mintActive: boolean;
  totalMinted: bigint | null;
  userPassCount: bigint | null;
}

// EIP-712 permit expires shortly after signing so a malicious server can't
// hoard the signature and submit later when prices change.
const PERMIT_DEADLINE_SECONDS = 10 * 60;

function normalizeMintError(error: unknown): string {
  const message =
    typeof error === 'object' && error !== null
      ? (error as { shortMessage?: string; message?: string }).shortMessage ??
        (error as { message?: string }).message ??
        'Mint failed'
      : 'Mint failed';

  const lower = message.toLowerCase();

  if (lower.includes('user rejected') || lower.includes('rejected the request') || lower.includes('user denied')) {
    return 'Signature was rejected in your wallet.';
  }
  if (lower.includes('mint is not active')) {
    return 'Mint is not active.';
  }
  if (lower.includes('permit failed')) {
    return 'Wallet signature could not be verified. Please try again.';
  }

  return message;
}

export function useMintDraftPass(): UseMintDraftPassResult {
  const { wallets, ready: walletsReady } = useWallets();
  const { walletAddress } = useAuth();

  const [isApproving, setIsApproving] = useState(false);
  const [isMinting, setIsMinting] = useState(false);
  const [mintStep, setMintStep] = useState<MintStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [tokenPrice, setTokenPrice] = useState<bigint | null>(null);
  const [mintActive, setMintActive] = useState(false);
  const [totalMinted, setTotalMinted] = useState<bigint | null>(null);
  const [userPassCount, setUserPassCount] = useState<bigint | null>(null);

  // Pick best wallet: match auth address first, then any available
  const selectedWallet = useMemo(() => {
    if (wallets.length === 0) return null;
    if (walletAddress) {
      return (
        wallets.find((w) => w.address.toLowerCase() === walletAddress.toLowerCase()) ?? wallets[0]
      );
    }
    return wallets[0];
  }, [walletAddress, wallets]);

  const onChainAddress = selectedWallet?.address ?? walletAddress;

  const publicClient = useMemo(
    () =>
      createPublicClient({
        chain: BASE,
        transport: http(BASE_RPC_URL),
      }),
    []
  );

  const refreshContractState = useCallback(async () => {
    try {
      const calls: Promise<unknown>[] = [
        publicClient.readContract({
          address: BBB4_CONTRACT_ADDRESS,
          abi: BBB4_ABI,
          functionName: 'TOKEN_PRICE_USDC',
        }),
        publicClient.readContract({
          address: BBB4_CONTRACT_ADDRESS,
          abi: BBB4_ABI,
          functionName: 'mintIsActive',
        }),
        publicClient.readContract({
          address: BBB4_CONTRACT_ADDRESS,
          abi: BBB4_ABI,
          functionName: 'totalMinted',
        }),
      ];

      if (onChainAddress) {
        calls.push(
          publicClient.readContract({
            address: BBB4_CONTRACT_ADDRESS,
            abi: [{ type: 'function', stateMutability: 'view', name: 'balanceOf', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }] as const,
            functionName: 'balanceOf',
            args: [onChainAddress as Address],
          })
        );
      }

      const results = await Promise.all(calls);
      setTokenPrice(results[0] as bigint);
      setMintActive(results[1] as boolean);
      setTotalMinted(results[2] as bigint);
      if (results[3] !== undefined) {
        setUserPassCount(results[3] as bigint);
      }
    } catch {
      // Keep UI functional even if read calls fail
    }
  }, [publicClient, onChainAddress]);

  useEffect(() => {
    void refreshContractState();
  }, [refreshContractState]);

  const mint = useCallback<MintFn>(
    async (quantity, opts) => {
      setError(null);
      setTxHash(null);
      setMintStep('idle');

      if (!walletsReady || !selectedWallet) {
        const message = 'Wallet not ready — please wait a moment and try again.';
        setError(message);
        setMintStep('error');
        throw new Error(message);
      }

      if (!Number.isInteger(quantity) || quantity <= 0) {
        const message = 'Quantity must be a positive whole number.';
        setError(message);
        setMintStep('error');
        throw new Error(message);
      }

      try {
        setIsApproving(true);
        setMintStep('signing');

        // Read price + current permit nonce for this wallet.
        const [price, mintIsActiveNow, userNonce, adminWalletRes] = await Promise.all([
          publicClient.readContract({
            address: BBB4_CONTRACT_ADDRESS,
            abi: BBB4_ABI,
            functionName: 'TOKEN_PRICE_USDC',
          }),
          publicClient.readContract({
            address: BBB4_CONTRACT_ADDRESS,
            abi: BBB4_ABI,
            functionName: 'mintIsActive',
          }),
          publicClient.readContract({
            address: BASE_SEPOLIA_USDC_ADDRESS,
            abi: USDC_PERMIT_ABI,
            functionName: 'nonces',
            args: [selectedWallet.address as Address],
          }),
          fetch('/api/purchases/admin-wallet').then((r) => r.ok ? r.json() : null).catch(() => null),
        ]);

        if (!mintIsActiveNow) {
          throw new Error('Mint is not active.');
        }

        const adminAddress = adminWalletRes?.address as Address | undefined;
        if (!adminAddress) {
          throw new Error('Payment relay not available right now. Please try again later.');
        }
        if (adminWalletRes?.healthy === false) {
          throw new Error('Purchases are temporarily paused for maintenance. Your funds are safe — please try again in a few minutes.');
        }

        const value = (price as bigint) * BigInt(quantity);
        const deadline = BigInt(Math.floor(Date.now() / 1000) + PERMIT_DEADLINE_SECONDS);

        const typedData = buildUsdcPermitTypedData({
          owner: selectedWallet.address as Address,
          spender: adminAddress,
          value,
          nonce: userNonce as bigint,
          deadline,
        });

        // Request EIP-712 signature via the wallet's own provider. Works for
        // Privy embedded, MetaMask, Coinbase Wallet, etc. — no gas prompt.
        const provider = await selectedWallet.getEthereumProvider();

        // Make sure the wallet is on Base before signing. The USDC permit's
        // domain references Base (chain 8453), so external wallets sitting
        // on Ethereum/BNB/Polygon would either warn the user about a
        // cross-chain typed-data signature or refuse outright. Embedded
        // wallets are always on Base, so this is a no-op for them.
        try {
          const currentChainHex = await provider.request({ method: 'eth_chainId' });
          if (parseInt(currentChainHex as string, 16) !== 8453) {
            await selectedWallet.switchChain(8453);
          }
        } catch {
          // Ignore — the signature attempt below will surface a clearer
          // error if the wallet truly can't switch.
        }

        const signature = (await provider.request({
          method: 'eth_signTypedData_v4',
          params: [selectedWallet.address, JSON.stringify(typedData)],
        })) as Hex;

        setIsApproving(false);
        setIsMinting(true);
        setMintStep('processing');

        // Server orchestrates permit → transferFrom → reserveTokens.
        const res = await fetch('/api/purchases/card-mint', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: (selectedWallet.address as string).toLowerCase(),
            quantity,
            deadline: Number(deadline),
            signature,
            paymentMethod: opts?.paymentMethod ?? 'usdc',
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          error?: string;
          txHashes?: { mint?: Hex };
        };
        if (!res.ok || !data.success) {
          throw new Error(data.error || `Mint failed (${res.status})`);
        }
        const hash = (data.txHashes?.mint ?? '0x') as Hex;
        setTxHash(hash);
        setMintStep('success');
        await refreshContractState();
        return hash;
      } catch (err) {
        const message = normalizeMintError(err);
        setError(message);
        setMintStep('error');
        throw new Error(message);
      } finally {
        setIsApproving(false);
        setIsMinting(false);
      }
    },
    [publicClient, walletsReady, refreshContractState, selectedWallet]
  );

  return {
    mint,
    isApproving,
    isMinting,
    mintStep,
    error,
    txHash,
    tokenPrice,
    mintActive,
    totalMinted,
    userPassCount,
  };
}
