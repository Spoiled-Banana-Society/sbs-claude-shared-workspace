// On-chain verification of USDC payouts on Base.
//
// Before a withdrawal is marked 'paid' with a tx hash, we fetch the
// receipt and prove the tx actually transferred the right amount of
// USDC to the right wallet. This closes the biggest money hole in the
// admin flow: a typo'd hash, a failed Safe batch, or a batch that
// missed a recipient can no longer flip withdrawals to paid.
//
// Works for both rails:
//   - Gnosis Safe CSV Airdrop batch (one tx, many Transfer logs)
//   - direct admin wallet send (one tx, one Transfer log)
//
// Server-side only (raw JSON-RPC, no signer).

import { BASE_RPC_URL } from '@/lib/contracts/bbb4';

const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'; // lowercase
const USDC_DECIMALS = 6;
// keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

interface RpcLog {
  address: string;
  topics: string[];
  data: string;
}

interface RpcReceipt {
  status: string; // '0x1' success, '0x0' reverted
  logs: RpcLog[];
}

export type PayoutTxStatus = 'verified' | 'tx_not_found' | 'tx_failed';

export interface ExpectedPayout {
  /** Identifier the caller uses to correlate results (e.g. withdrawal id). */
  key: string;
  wallet: string;
  amount: number; // USD == USDC units
}

export interface PayoutVerification {
  status: PayoutTxStatus;
  /** keys whose wallet received >= the expected USDC total in this tx */
  verified: string[];
  /** keys that didn't match, with what the tx actually sent that wallet */
  unmatched: { key: string; wallet: string; expectedUsd: number; foundUsd: number }[];
}

async function fetchReceipt(txHash: string): Promise<RpcReceipt | null> {
  const res = await fetch(BASE_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getTransactionReceipt',
      params: [txHash],
    }),
  });
  if (!res.ok) throw new Error(`Base RPC error ${res.status}`);
  const body = (await res.json()) as { result?: RpcReceipt | null; error?: { message?: string } };
  if (body.error) throw new Error(`Base RPC: ${body.error.message ?? 'unknown error'}`);
  return body.result ?? null;
}

/** topics[1]/[2] are 32-byte left-padded addresses. */
function topicToAddress(topic: string): string {
  return `0x${topic.slice(-40)}`.toLowerCase();
}

/**
 * Verify that `txHash` transferred at least the expected USDC to each
 * expected wallet. Amounts are compared per-WALLET (summing both the
 * tx's transfers to that wallet and the expectations for that wallet),
 * so one user with two withdrawals in the same batch verifies correctly.
 *
 * Cent-level tolerance: amounts compared in integer micro-USDC after
 * rounding, so float artifacts (249.99999) can't fail a $250 payout.
 */
export async function verifyUsdcPayouts(
  txHash: string,
  expected: ExpectedPayout[],
): Promise<PayoutVerification> {
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    throw new Error('Invalid tx hash — expected 0x + 64 hex chars');
  }

  const receipt = await fetchReceipt(txHash);
  if (!receipt) return { status: 'tx_not_found', verified: [], unmatched: [] };
  if (receipt.status !== '0x1') {
    return {
      status: 'tx_failed',
      verified: [],
      unmatched: expected.map((e) => ({ key: e.key, wallet: e.wallet, expectedUsd: e.amount, foundUsd: 0 })),
    };
  }

  // Sum USDC transferred per recipient in this tx (micro-USDC, bigint).
  const sentTo = new Map<string, bigint>();
  for (const log of receipt.logs) {
    if ((log.address ?? '').toLowerCase() !== USDC_BASE) continue;
    if ((log.topics?.[0] ?? '').toLowerCase() !== TRANSFER_TOPIC) continue;
    if (!log.topics?.[2]) continue;
    const to = topicToAddress(log.topics[2]);
    const value = BigInt(log.data);
    sentTo.set(to, (sentTo.get(to) ?? 0n) + value);
  }

  // Sum expectations per wallet, then judge each wallet once.
  const expectedByWallet = new Map<string, bigint>();
  for (const e of expected) {
    const w = e.wallet.toLowerCase();
    const micro = BigInt(Math.round(e.amount * 10 ** USDC_DECIMALS));
    expectedByWallet.set(w, (expectedByWallet.get(w) ?? 0n) + micro);
  }

  const verified: string[] = [];
  const unmatched: PayoutVerification['unmatched'] = [];
  for (const e of expected) {
    const w = e.wallet.toLowerCase();
    const got = sentTo.get(w) ?? 0n;
    const want = expectedByWallet.get(w) ?? 0n;
    if (got >= want) {
      verified.push(e.key);
    } else {
      unmatched.push({
        key: e.key,
        wallet: w,
        expectedUsd: e.amount,
        foundUsd: Number(got) / 10 ** USDC_DECIMALS,
      });
    }
  }

  return { status: 'verified', verified, unmatched };
}
