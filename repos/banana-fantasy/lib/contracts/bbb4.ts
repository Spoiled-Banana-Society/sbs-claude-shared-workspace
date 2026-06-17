import { type Abi, type Address, createPublicClient, defineChain, http, webSocket, parseAbiItem } from 'viem';

export const BASE_CHAIN_ID = 8453;
export const BASE_RPC_URL = process.env.NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL || 'https://mainnet.base.org';

export const BASE = defineChain({
  id: BASE_CHAIN_ID,
  name: 'Base',
  network: 'base',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [BASE_RPC_URL],
    },
    public: {
      http: [BASE_RPC_URL],
    },
  },
  blockExplorers: {
    default: {
      name: 'BaseScan',
      url: 'https://basescan.org',
    },
  },
  testnet: false,
});

// Keep old exports as aliases for any remaining references
export const BASE_SEPOLIA_CHAIN_ID = BASE_CHAIN_ID;
export const BASE_SEPOLIA_RPC_URL = BASE_RPC_URL;
export const BASE_SEPOLIA = BASE;

// V2 "BBB4 Staging" (OpenSea-conduit auto-approval baked in) — deployed 2026-06-12.
// Previous V1 contract: 0x14065412b3A431a660e6E576A14b104F1b3E463b.
export const DEFAULT_BBB4_CONTRACT_ADDRESS = '0x781B2E6fE9A615C2680A51Ef88f309ddC2e0D73F' as Address;

export const BBB4_CONTRACT_ADDRESS =
  (process.env.NEXT_PUBLIC_BBB4_CONTRACT as Address | undefined) ?? DEFAULT_BBB4_CONTRACT_ADDRESS;

export const BASE_SEPOLIA_USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address; // Real USDC on Base mainnet

export const BBB4_ABI = [
  {
    type: 'function',
    stateMutability: 'view',
    name: 'TOKEN_PRICE_USDC',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'mintIsActive',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'totalMinted',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'totalSupply',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'MAX_TOKENS_PER_TX',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'usdc',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'mint',
    inputs: [{ name: 'numberOfTokens', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'reserveTokens',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'numberOfTokens', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'balanceOf',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'tokenId', type: 'uint256', indexed: true },
    ],
    anonymous: false,
  },
  {
    type: 'function',
    stateMutability: 'nonpayable',
    // The deployed SBSDraftPassBBB4 exposes withdrawUSDC(), not withdraw() —
    // calling the latter hits the fallback and reverts (skim.withdraw_failed).
    name: 'withdrawUSDC',
    inputs: [],
    outputs: [],
  },
] as const satisfies Abi;

export const USDC_ABI = [
  {
    type: 'function',
    stateMutability: 'view',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'allowance',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'transfer',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'transferFrom',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const satisfies Abi;

// EIP-2612 permit ABI for USDC on Base. Used by the server-side card-mint
// route to consume a user-signed permit and pull USDC without the user
// paying gas. USDC (Circle) on Base uses name "USD Coin" and version "2".
export const USDC_PERMIT_ABI = [
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'permit',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'nonces',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'name',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'version',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
] as const satisfies Abi;

export async function getUsdcBalance(address: Address): Promise<bigint> {
  const client = createPublicClient({
    chain: BASE,
    transport: http(BASE_RPC_URL),
  });
  return client.readContract({
    address: BASE_SEPOLIA_USDC_ADDRESS,
    abi: USDC_ABI,
    functionName: 'balanceOf',
    args: [address],
  });
}

// Alchemy serves a WebSocket endpoint on the same key/path — derive it from the
// HTTP RPC so we can SUBSCRIBE to events (push) instead of polling. Null if the
// configured RPC isn't a ws-capable Alchemy URL (e.g. the public fallback).
const BASE_WSS_URL =
  /^https?:\/\//.test(BASE_RPC_URL) && BASE_RPC_URL.includes('alchemy.com')
    ? BASE_RPC_URL.replace(/^http/, 'ws')
    : null;

const USDC_TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)',
);

/**
 * Resolve as soon as `address` holds >= `minAmount` USDC — event-driven, no
 * polling in the happy path.
 *
 * Primary path: a WebSocket subscription to USDC `Transfer(to: address)` logs.
 * The instant the transfer is mined, Alchemy PUSHES the log and we confirm with
 * a single balanceOf read — typically sub-second after settlement, vs the old
 * 3s poll. We also read once up front (covers "already arrived") and once right
 * after subscribing (covers the tiny race between the two).
 *
 * Safety net: only if the WS endpoint is unavailable or the socket errors/closes
 * do we fall back to a balance check loop, so the purchase can never hang. In
 * normal operation nothing is polled.
 *
 * Returns true when funded, false on timeout/cancel.
 */
export async function waitForUsdcArrival(
  address: Address,
  minAmount: bigint,
  opts: { timeoutMs?: number; isCancelled?: () => boolean; onError?: (e: unknown) => void } = {},
): Promise<boolean> {
  const { timeoutMs = 300_000, isCancelled, onError } = opts;

  const hasEnough = async () => {
    try {
      return (await getUsdcBalance(address)) >= minAmount;
    } catch (e) {
      onError?.(e);
      return false;
    }
  };

  // Fast path — maybe it's already here.
  if (await hasEnough()) return true;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    let unwatch: (() => void) | undefined;
    let fallbackTimer: ReturnType<typeof setInterval> | undefined;
    let cancelTimer: ReturnType<typeof setInterval> | undefined;

    // Re-check the instant the tab is foregrounded again. On mobile the user
    // pays in MoonPay's separate tab, so ours is backgrounded and the browser
    // throttles/suspends our socket + timers; this makes the return-to-tab
    // update instant instead of waiting on a throttled event.
    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };

    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      try { unwatch?.(); } catch { /* noop */ }
      if (fallbackTimer) clearInterval(fallbackTimer);
      if (cancelTimer) clearInterval(cancelTimer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
      clearTimeout(timer);
      resolve(result);
    };

    const check = async () => {
      if (settled) return;
      if (await hasEnough()) finish(true);
    };

    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);

    // Safety net only — engages if WS is unavailable or drops. Not the primary
    // mechanism; a generous interval purely so the flow can't stall on a dead
    // socket.
    const startFallback = () => {
      if (settled || fallbackTimer) return;
      fallbackTimer = setInterval(check, 5_000);
    };

    const timer = setTimeout(() => finish(false), timeoutMs);

    // Local cancel check (no network) — lets the caller abort if the user backs
    // out of the funding flow.
    if (isCancelled) {
      cancelTimer = setInterval(() => { if (isCancelled()) finish(false); }, 500);
    }

    if (BASE_WSS_URL) {
      try {
        const wsClient = createPublicClient({ chain: BASE, transport: webSocket(BASE_WSS_URL) });
        unwatch = wsClient.watchEvent({
          address: BASE_SEPOLIA_USDC_ADDRESS,
          event: USDC_TRANSFER_EVENT,
          args: { to: address },
          poll: false, // force eth_subscribe (push), never viem's HTTP-style polling
          onLogs: () => { void check(); },
          onError: (e) => { onError?.(e); startFallback(); },
        });
        // Cover the race between the initial read and the subscription opening.
        void check();
      } catch (e) {
        onError?.(e);
        startFallback();
      }
    } else {
      startFallback();
    }
  });
}
