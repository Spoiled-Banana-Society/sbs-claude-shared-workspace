import { type Abi, type Address, createPublicClient, defineChain, http } from 'viem';

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

export const DEFAULT_BBB4_CONTRACT_ADDRESS = '0x14065412b3A431a660e6E576A14b104F1b3E463b' as Address;

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
