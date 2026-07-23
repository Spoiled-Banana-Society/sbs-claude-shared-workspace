'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWallets, useSignTypedData, useSendTransaction, type SignTypedDataParams } from '@privy-io/react-auth';
import {
  createPublicClient,
  encodeFunctionData,
  http,
  type Address,
  type Hex,
} from 'viem';
import { useAuth } from '@/hooks/useAuth';
import {
  BASE,
  BASE_CHAIN_ID,
  BASE_RPC_URL,
  BASE_SEPOLIA_USDC_ADDRESS,
  BBB4_ABI,
  BBB4_CONTRACT_ADDRESS,
  USDC_PERMIT_ABI,
} from '@/lib/contracts/bbb4';
import { buildUsdcPermitTypedData } from '@/lib/onchain/usdcPermit';
import { ONE_TAP_ALLOWANCE_USD } from '@/lib/deposits';
import { reportClientError } from '@/lib/clientErrors';
import { LOG_SOURCES } from '@/lib/logSources';
import { clientLog } from '@/lib/clientLog';
import { connectMetaMaskFresh } from '@/lib/metamaskSigner';
import { ensureBaseNetwork } from '@/lib/ensureBaseNetwork';
import { type PurchasePromoAwards } from '@/lib/promoAwardToasts';

type MintFn = (
  quantity: number,
  opts?: {
    paymentMethod?: 'usdc' | 'card';
    // Which onramp provider the card flow went through. Used by the
    // server to label the activity-feed event source so admin can
    // distinguish MoonPay vs Coinbase purchases. Ignored when
    // paymentMethod === 'usdc'.
    cardProvider?: 'moonpay' | 'coinbase';
    // Deposit bankroll one-tap entry: hit /api/purchases/instant-mint,
    // which fronts the pass immediately (house money) and collects the $25
    // in the background — the response returns as soon as the pass is
    // registered, so the join can start seconds sooner. usdc-only, qty 1.
    instantSeat?: boolean;
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

  // Privy embedded-wallet signer — lets web2 (email/X) users sign the gasless
  // permit silently (no confirm modal) for a one-tap mint. Ref-held so it
  // doesn't churn `mint`'s deps (render-loop rule).
  const { signTypedData } = useSignTypedData();
  const signTypedDataRef = useRef(signTypedData);
  signTypedDataRef.current = signTypedData;

  // Gas-sponsored send for embedded wallets (same proven path as useListTeam).
  // Smart-account embedded wallets can't produce an ECDSA permit USDC accepts,
  // so they grant the allowance with a real (sponsored, gasless) `approve` tx
  // instead; the relay then skips the permit and pulls + mints as usual.
  const { sendTransaction } = useSendTransaction();
  const sendTransactionRef = useRef(sendTransaction);
  sendTransactionRef.current = sendTransaction;

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
  // Auth address in a ref so mint() can read it without taking walletAddress as a
  // dep (keeps the callback stable — render-loop rule).
  const walletAddressRef = useRef(walletAddress);
  walletAddressRef.current = walletAddress;

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

      // Diagnostic backstop — captures the exact wallet state at mint entry so a
      // mobile stall is pinpointable from the logs (no console needed).
      clientLog('payment', 'mint_wallet_state', {
        walletsReady: walletsReadyRef.current,
        hasSelected: !!selectedWalletRef.current,
        selectedType: selectedWalletRef.current?.walletClientType,
        selectedAddr: selectedWalletRef.current?.address,
      });

      // Resolve a usable wallet OBJECT to sign with (not Privy's `ready` flag,
      // which can stay false on mobile while a wallet exists). Wait briefly for
      // useWallets() to populate.
      let activeWallet = selectedWalletRef.current;
      if (!activeWallet) {
        const readyStart = Date.now();
        while (Date.now() - readyStart < 6000) {
          await new Promise((r) => setTimeout(r, 250));
          if (selectedWalletRef.current) break;
        }
        activeWallet = selectedWalletRef.current;
      }

      // Mobile fallback: the mobile login uses SIWE / WalletConnect, which
      // AUTHENTICATES the user (sets walletAddress) but does NOT add a wallet to
      // Privy's useWallets() — so on mobile MetaMask (in-app browser) activeWallet
      // is null even though a usable injected provider (window.ethereum) is right
      // there. Sign through it directly. (Root-caused 2026-06-22: mint_wallet_state
      // logged walletsReady:true, hasSelected:false on every mobile attempt.)
      const injected = typeof window !== 'undefined'
        ? (window as unknown as { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum
        : undefined;
      if (!activeWallet && injected && walletAddressRef.current) {
        clientLog('payment', 'mint_injected_fallback', { addr: walletAddressRef.current });
        activeWallet = {
          address: walletAddressRef.current,
          walletClientType: 'injected',
          getEthereumProvider: async () => injected,
        } as unknown as NonNullable<typeof activeWallet>;
      }

      // Mobile MetaMask fresh-connect fallback (the main mobile case).
      // On mobile, login signs in via MetaMask's SDK in one connect→sign burst
      // over a LIVE relay (works), but Privy never registers it in useWallets()
      // and there's no window.ethereum in a normal browser, so both paths above
      // miss. Reusing the post-login provider FAILS: by purchase time the relay
      // socket is dead (app backgrounded during login) and mobile Safari often
      // reloaded the tab on return (root-caused 2026-06-22: `mint_started` fired
      // but MetaMask opened with "nothing to approve" and the request hung).
      // So establish a BRAND-NEW MetaMask connection right here — the same proven
      // burst login uses — so the signature requested a moment later round-trips
      // over a fresh, live relay.
      //   SAFETY: only runs when there's STILL no wallet (no useWallets entry AND
      //   no injected provider). Card / embedded / desktop / MetaMask-in-app-browser
      //   flows all already have a wallet here → they never enter this block (zero
      //   regression). On failure / address mismatch we fall through to the same
      //   "reconnect" error below — never worse than today.
      if (!activeWallet && !injected && walletAddressRef.current) {
        clientLog('payment', 'mint_mm_fresh_connect_start', {});
        const fresh = await connectMetaMaskFresh();
        const matches = !!fresh &&
          fresh.address.toLowerCase() === walletAddressRef.current.toLowerCase();
        clientLog('payment', 'mint_mm_fresh_connect_result', {
          connected: !!fresh,
          matches,
          addr: fresh?.address ?? null,
        });
        if (fresh && matches) {
          activeWallet = {
            address: fresh.address,
            // NOT 'privy' → routes through the external-wallet signing branch
            // (getEthereumProvider → ensureBaseNetwork → eth_signTypedData_v4).
            walletClientType: 'metamask',
            getEthereumProvider: async () => fresh.provider,
          } as unknown as NonNullable<typeof activeWallet>;
        }
      }

      if (!activeWallet) {
        clientLog('payment', 'mint_no_wallet', { hasInjected: !!injected, authAddr: walletAddressRef.current });
        const message = 'Wallet not connected — please reconnect your wallet and try again.';
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

        const isEmbedded = activeWallet.walletClientType === 'privy';

        // Detect a smart-contract account (e.g. an EIP-7702 / Privy smart wallet
        // — it has on-chain bytecode). USDC validates permits for such accounts
        // via EIP-1271, which REJECTS a plain ECDSA permit ("EIP2612: invalid
        // signature"). So for an embedded smart account we grant the allowance
        // with a real, gas-sponsored `approve` tx instead of a permit signature;
        // the relay then sees the allowance and skips the permit (no signature
        // needed) before pulling + minting. Plain EOAs keep the gasless permit.
        let walletCode: string | undefined;
        try {
          walletCode = await publicClient.getBytecode({ address: activeWallet.address as Address });
        } catch { walletCode = undefined; }
        const isSmartAccount = !!walletCode && walletCode !== '0x';

        const ALLOWANCE_ABI = [{
          type: 'function', name: 'allowance', stateMutability: 'view',
          inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
          outputs: [{ type: 'uint256' }],
        }] as const;
        const APPROVE_ABI = [{
          type: 'function', name: 'approve', stateMutability: 'nonpayable',
          inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
          outputs: [{ type: 'bool' }],
        }] as const;

        // One-tap entries: a prior enlarged permit/approve may have left a
        // standing allowance that already covers this purchase — then no
        // authorization step is needed at all ('0x' sentinel; both mint routes
        // re-verify the allowance server-side before pulling).
        let standingAllowance = 0n;
        try {
          standingAllowance = (await publicClient.readContract({
            address: BASE_SEPOLIA_USDC_ADDRESS, abi: ALLOWANCE_ABI,
            functionName: 'allowance', args: [activeWallet.address as Address, adminAddress],
          })) as bigint;
        } catch { standingAllowance = 0n; }

        // Authorize the one-tap cap (not the exact price) wherever the extra
        // authorization is free for the user: external EOAs (one gasless
        // signature either way — wallet UI discloses the cap) and smart
        // accounts (one sponsored approve either way, and a standing allowance
        // skips the ~30s approve-and-wait on every later purchase). Embedded
        // EOAs sign silently per purchase, so they keep the exact amount —
        // no reason to hold a standing allowance for them.
        const oneTapCap = BigInt(ONE_TAP_ALLOWANCE_USD) * 1_000_000n;
        const authAmount =
          (!isEmbedded || isSmartAccount) && oneTapCap > value ? oneTapCap : value;
        // The amount a signed permit covers — the server must submit the
        // permit with EXACTLY this value or USDC rejects the signature.
        let signedPermitValue = value;

        // '0x' is a sentinel meaning "no permit — allowance set on-chain instead".
        let signature: Hex = '0x';
        if (standingAllowance >= value) {
          clientLog('payment', 'mint_allowance_skip_sign', {
            wallet: activeWallet.address, allowance: standingAllowance.toString(),
          });
        } else if (isEmbedded && isSmartAccount) {
          // Gas-sponsored approve (Privy sponsors it → $0 for the user).
          const approveData = encodeFunctionData({ abi: APPROVE_ABI, functionName: 'approve', args: [adminAddress, authAmount] });
          await sendTransactionRef.current(
            { to: BASE_SEPOLIA_USDC_ADDRESS, data: approveData, chainId: BASE_CHAIN_ID },
            { sponsor: true, uiOptions: { showWalletUIs: false } },
          );
          // Wait until the allowance actually reflects on-chain before the relay
          // reads it (RPC nodes can lag a block behind the just-mined approve).
          for (let i = 0; i < 20; i++) {
            const allowance = (await publicClient.readContract({
              address: BASE_SEPOLIA_USDC_ADDRESS, abi: ALLOWANCE_ABI,
              functionName: 'allowance', args: [activeWallet.address as Address, adminAddress],
            }).catch(() => 0n)) as bigint;
            if (allowance >= value) break;
            await new Promise((r) => setTimeout(r, 1500));
          }
        } else {
          signedPermitValue = authAmount;
          const typedData = buildUsdcPermitTypedData({
            owner: activeWallet.address as Address,
            spender: adminAddress,
            value: authAmount,
            nonce: userNonce as bigint,
            deadline,
          });
          if (isEmbedded) {
            // Embedded EOA — sign the gasless permit silently for a one-tap mint.
            const result = await signTypedDataRef.current(
              typedData as unknown as SignTypedDataParams,
              { uiOptions: { showWalletUIs: false }, address: activeWallet.address },
            );
            signature = result.signature as Hex;
          } else {
            // External wallet (MetaMask/Coinbase) — signs in its own popup; ensure Base first.
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
        }

        setIsApproving(false);
        setIsMinting(true);
        setMintStep('processing');
        clientLog('payment', 'mint_signed', { wallet: activeWallet.address, quantity, paymentMethod: method });

        // Server orchestrates permit → transferFrom → reserveTokens.
        // instantSeat flips the order server-side: pass fronted first,
        // payment collected behind the response (seat-first entry).
        const mintUrl = opts?.instantSeat && quantity === 1 && (opts?.paymentMethod ?? 'usdc') === 'usdc'
          ? '/api/purchases/instant-mint'
          : '/api/purchases/card-mint';
        const res = await fetch(mintUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: (activeWallet.address as string).toLowerCase(),
            quantity,
            deadline: Number(deadline),
            signature,
            permitValue: signedPermitValue.toString(),
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
        // No toasts (Boris 2026-07-10): promo milestones surface via the
        // server-created bell only.
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
    [publicClient, refreshContractState, selectedWallet]
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
