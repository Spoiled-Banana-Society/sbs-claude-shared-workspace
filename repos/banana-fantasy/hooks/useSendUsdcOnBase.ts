'use client';

// Send USDC on Base from the connected admin's Privy wallet.
//
// Lets the admin Withdrawals UI dispatch real-money payouts in a single
// click instead of bouncing to MetaMask, copying the tx hash, and pasting
// it back. The wallet still signs the tx — we just orchestrate the call.
//
// Returns a function `send(to, amount)` that:
//   1. Switches the wallet to Base mainnet if needed
//   2. Encodes ERC20.transfer(to, amount * 1e6)
//   3. Submits via eth_sendTransaction
//   4. Polls the public Base RPC for the receipt
//   5. Returns the tx hash on success
//
// Errors propagate as Error instances with user-friendly messages so
// the calling UI can render them directly.

import { useCallback, useState } from 'react';
import { useWallets } from '@privy-io/react-auth';
import { encodeFunctionData, parseUnits, type Address, type Hex } from 'viem';

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address;
const BASE_CHAIN_ID = 8453;
const BASE_RPC = 'https://mainnet.base.org';

const ERC20_TRANSFER_ABI = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

export type SendStatus = 'idle' | 'connecting' | 'switching' | 'signing' | 'pending' | 'done' | 'error';

export interface SendResult {
  txHash: Hex;
}

async function waitForReceipt(txHash: Hex, timeoutMs = 90_000): Promise<void> {
  const start = Date.now();
  // Poll the public Base RPC. We use raw JSON-RPC instead of viem's
  // public client because spinning one up here for a single read isn't
  // worth the import weight; one fetch every 3s for ≤30 iterations.
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(BASE_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getTransactionReceipt',
        params: [txHash],
      }),
    });
    const data = (await res.json()) as { result?: { status?: string } | null };
    if (data?.result?.status) {
      // 0x1 = success, 0x0 = revert
      if (data.result.status === '0x1') return;
      throw new Error('Transaction reverted on-chain');
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('Transaction confirmation timed out (90s) — check the explorer');
}

export function useSendUsdcOnBase() {
  const { wallets, ready: walletsReady } = useWallets();
  const [status, setStatus] = useState<SendStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(async (to: Address | string, amountUsd: number): Promise<SendResult> => {
    setError(null);
    setStatus('connecting');

    if (!walletsReady) throw new Error('Wallet not ready yet — try again in a moment');
    const wallet = wallets[0];
    if (!wallet) throw new Error('No connected wallet found');

    try {
      const provider = await wallet.getEthereumProvider();

      // Make sure we're on Base. Embedded Privy wallets always are; an
      // external wallet sitting on Ethereum mainnet would happily send
      // USDC there and burn the funds, so this is non-optional.
      setStatus('switching');
      const currentHex = await provider.request({ method: 'eth_chainId' });
      if (parseInt(currentHex as string, 16) !== BASE_CHAIN_ID) {
        await wallet.switchChain(BASE_CHAIN_ID);
      }

      // Build the ERC20.transfer call. USDC has 6 decimals, so $1.00
      // becomes 1_000_000.
      const data = encodeFunctionData({
        abi: ERC20_TRANSFER_ABI,
        functionName: 'transfer',
        args: [to as Address, parseUnits(amountUsd.toString(), 6)],
      });

      setStatus('signing');
      const txHash = (await provider.request({
        method: 'eth_sendTransaction',
        params: [
          {
            from: wallet.address,
            to: USDC_BASE,
            data,
          },
        ],
      })) as Hex;

      setStatus('pending');
      await waitForReceipt(txHash);

      setStatus('done');
      return { txHash };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Send failed';
      // User-cancelled flows surface different messages depending on
      // wallet — normalize the most common one so the UI doesn't say
      // anything alarming.
      const friendly = /user (rejected|denied)/i.test(msg)
        ? 'Send cancelled in wallet'
        : msg;
      setError(friendly);
      setStatus('error');
      throw new Error(friendly);
    }
  }, [walletsReady, wallets]);

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
  }, []);

  return { send, status, error, reset, walletsReady, walletAddress: wallets[0]?.address };
}
