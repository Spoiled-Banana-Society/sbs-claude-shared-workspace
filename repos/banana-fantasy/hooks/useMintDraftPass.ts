'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWallets, useSignTypedData, type SignTypedDataParams } from '@privy-io/react-auth';
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
import { reportClientError } from '@/lib/clientErrors';
import { LOG_SOURCES } from '@/lib/logSources';
import { clientLog } from '@/lib/clientLog';
import { ensureBaseNetwork } from '@/lib/ensureBaseNetwork';
import { useToast } from '@/components/ui/Toast';
import { surfacePurchasePromoAwards, type PurchasePromoAwards } from '@/lib/promoAwardToasts';

type MintFn = (
  quantity: number,
  opts?: {
    paymentMethod?: 'usdc' | 'card';
    // Which onramp provider the card flow went through. Used by the
    // server to label the activity-feed event source so admin can
    // distinguish MoonPay vs Coinbase purchases. Ignored when
    // paymentMethod === 'usdc'.
    cardProvider?: 'moonpay' | 'coinbase';
  },
) => Promise<Hex>;

export type MintStep = 'idle' | 'signing' | 'processing' | 'success' | 'error';

interface UseMintDraftPassResult {
  mint: MintFn;
  isApproving: boolean;
  isMinting: boolean;
  /** Current step of the mint flow, used by the modal to render a stepper. */
  mintStep: MintStep;
  error: string | null;
  /**
   * True when the user's payment SUCCEEDED but pass delivery is still pending
   * (e.g. a transient mint retry exhausted). Their money is safe and the pass
   * is queued — the UI should reassure, not show a hard failure.
   */
  paymentPending: boolean;
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
  // Ref pattern (CLAUDE.md render-loop rule): keep the mint callback's deps to
  // stable values — `show` may churn per render and must not re-create `mint`.
  const { show } = useToast();
  const showToastRef = useRef(show);
  showToastRef.current = show;

  // Privy embedded-wallet signer — lets web2 (email/X) users sign the gasless
  // permit silently (no confirm modal) for a one-tap mint. Ref-held so it
  // doesn't churn `mint`'s deps (render-loop rule).
  const { signTypedData } = useSignTypedData();
  const signTypedDataRef = useRef(signTypedData);
  signTypedDataRef.current = signTypedData;

  const [isApproving, setIsApproving] = useState(false);
  const [isMinting, setIsMinting] = useState(false);
  const [mintStep, setMintStep] = useState<MintStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const [paymentPending, setPaymentPending] = useState(false);
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

  // Live refs so mint() can read the CURRENT wallet readiness at call time, not
  // the (possibly stale) value captured when the callback was created. On mobile
  // useWallets can be momentarily not-ready right after the MoonPay detour / a
  // tab refocus, and the auto-mint may fire in that window.
  const walletsReadyRef = useRef(walletsReady);
  walletsReadyRef.current = walletsReady;
  const selectedWalletRef = useRef(selectedWallet);
  selectedWalletRef.current = selectedWallet;

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
      setPaymentPending(false);
      setTxHash(null);
      setMintStep('idle');

      // Wait briefly for the wallet to be ready rather than hard-failing on a
      // transient. Reads the live refs so a stale captured `selectedWallet`
      // (e.g. null right after the MoonPay detour on mobile) can't block a mint
      // that's actually ready a beat later.
      let activeWallet = selectedWalletRef.current;
      if (!walletsReadyRef.current || !activeWallet) {
        const readyStart = Date.now();
        while (Date.now() - readyStart < 8000) {
          await new Promise((r) => setTimeout(r, 250));
          if (walletsReadyRef.current && selectedWalletRef.current) break;
        }
        activeWallet = selectedWalletRef.current;
      }
      if (!walletsReadyRef.current || !activeWallet) {
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

      const method = opts?.paymentMethod ?? 'usdc';
      clientLog('payment', 'mint_started', {
        wallet: activeWallet.address,
        quantity,
        paymentMethod: method,
        walletType: activeWallet.walletClientType,
      });

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
            args: [activeWallet.address as Address],
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
          owner: activeWallet.address as Address,
          spender: adminAddress,
          value,
          nonce: userNonce as bigint,
          deadline,
        });

        // Request the EIP-712 permit signature (gasless — no gas prompt either way).
        let signature: Hex;
        if (activeWallet.walletClientType === 'privy') {
          // Embedded (web2) wallet — sign silently for a true one-tap mint.
          // showWalletUIs:false suppresses the Privy confirm modal. Embedded
          // wallets are always on Base, so no network switch is needed.
          const result = await signTypedDataRef.current(
            typedData as unknown as SignTypedDataParams,
            { uiOptions: { showWalletUIs: false }, address: activeWallet.address },
          );
          signature = result.signature as Hex;
        } else {
          // External wallet (MetaMask/Coinbase) — must sign in its own popup;
          // we can't (and shouldn't) suppress that. Ensure it's on Base first:
          // the permit domain references Base (8453), so a wallet on another
          // network would warn or refuse. ensureBaseNetwork switches/adds Base
          // and returns clear copy on failure instead of a murky signature error.
          const provider = await activeWallet.getEthereumProvider();
          const baseNet = await ensureBaseNetwork(provider);
          if (!baseNet.ok) {
            throw new Error(baseNet.message ?? 'Please switch your wallet to the Base network to continue.');
          }
          signature = (await provider.request({
            method: 'eth_signTypedData_v4',
            params: [activeWallet.address, JSON.stringify(typedData)],
          })) as Hex;
        }

        setIsApproving(false);
        setIsMinting(true);
        setMintStep('processing');
        clientLog('payment', 'mint_signed', { wallet: activeWallet.address, quantity, paymentMethod: method });

        // Server orchestrates permit → transferFrom → reserveTokens.
        const res = await fetch('/api/purchases/card-mint', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: (activeWallet.address as string).toLowerCase(),
            quantity,
            deadline: Number(deadline),
            signature,
            paymentMethod: opts?.paymentMethod ?? 'usdc',
            ...(opts?.cardProvider ? { cardProvider: opts.cardProvider } : {}),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          error?: string;
          paymentSucceeded?: boolean;
          txHashes?: { mint?: Hex };
          promoAwards?: PurchasePromoAwards;
          cardFreeDraftsEarned?: number;
        };
        clientLog('payment', 'mint_server_result', {
          wallet: activeWallet.address,
          quantity,
          paymentMethod: method,
          httpOk: res.ok,
          success: !!data.success,
          paymentSucceeded: !!data.paymentSucceeded,
          txHash: data.txHashes?.mint ?? null,
          error: data.error ?? null,
        });
        if (!res.ok || !data.success) {
          // Payment went through but delivery is pending — NOT a hard failure.
          // Surface a reassuring pending state instead of an error so the user
          // knows their money is safe and the pass is on its way.
          if (data.paymentSucceeded) {
            setPaymentPending(true);
            setError(data.error || 'Payment received — your pass is on its way.');
            setMintStep('error');
            return '0x' as Hex;
          }
          throw new Error(data.error || `Mint failed (${res.status})`);
        }
        const hash = (data.txHashes?.mint ?? '0x') as Hex;
        setTxHash(hash);
        setMintStep('success');
        // Instant milestone toasts + bell refresh on the buying device
        // (the stream copy is deduped; mobile's RTDB socket may be dead).
        surfacePurchasePromoAwards(data.promoAwards, showToastRef.current, {
          cardFreeDraftsEarned: data.cardFreeDraftsEarned,
        });
        await refreshContractState();
        return hash;
      } catch (err) {
        const message = normalizeMintError(err);
        // Classify the failure so the admin Logs tab can split signature
        // rejections (user action) from admin-wallet / permit failures
        // (infra). Purely additive — control flow unchanged.
        const rawMessage = err instanceof Error ? err.message : String(err);
        const lowerRaw = rawMessage.toLowerCase();
        const baseContext = {
          quantity,
          paymentMethod: opts?.paymentMethod ?? 'usdc',
          wallet: selectedWallet?.address,
        };
        if (
          lowerRaw.includes('user rejected') ||
          lowerRaw.includes('rejected the request') ||
          lowerRaw.includes('user denied')
        ) {
          reportClientError({
            source: LOG_SOURCES.payment.USDC_SIGNATURE_REJECTED,
            message: rawMessage,
            route: 'useMintDraftPass',
            context: baseContext,
            stack: err instanceof Error ? err.stack : undefined,
          });
        } else if (
          lowerRaw.includes('payment relay not available') ||
          lowerRaw.includes('temporarily paused for maintenance') ||
          lowerRaw.includes('admin wallet')
        ) {
          reportClientError({
            source: LOG_SOURCES.payment.ADMIN_WALLET_UNAVAILABLE,
            message: rawMessage,
            route: 'useMintDraftPass',
            context: baseContext,
            stack: err instanceof Error ? err.stack : undefined,
          });
        } else if (lowerRaw.includes('base network')) {
          reportClientError({
            source: LOG_SOURCES.payment.WRONG_NETWORK,
            message: rawMessage,
            route: 'useMintDraftPass',
            context: baseContext,
            stack: err instanceof Error ? err.stack : undefined,
          });
        } else {
          reportClientError({
            source: LOG_SOURCES.payment.USDC_PERMIT_FAILED,
            message: rawMessage,
            route: 'useMintDraftPass',
            context: baseContext,
            stack: err instanceof Error ? err.stack : undefined,
          });
        }
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
    paymentPending,
    txHash,
    tokenPrice,
    mintActive,
    totalMinted,
    userPassCount,
  };
}
