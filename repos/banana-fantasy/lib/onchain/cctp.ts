import type { Address, Chain } from 'viem';
import { optimism, arbitrum } from 'viem/chains';

/**
 * Circle CCTP V2 constants for the NY on-ramp bridge (Optimism → Base).
 *
 * ⚠️ REAL MONEY, MAINNET. Every address below was verified on-chain (eth_getCode
 * shows deployed contracts; USDC symbol() returns "USDC") on 2026-07-08 before
 * being committed. Do NOT edit without re-verifying — a wrong address burns real
 * user funds into the void.
 *
 * Flow: a NY buyer's USDC lands on Optimism → we `depositForBurn` on Optimism's
 * TokenMessengerV2 (burns the USDC, emits a message) → Circle's attestation
 * service signs it (~seconds on V2 Fast) → we `receiveMessage` on Base's
 * MessageTransmitterV2 (mints native USDC to the recipient on Base).
 *
 * CCTP V2 uses the SAME contract address on every chain (deterministic deploy),
 * so TokenMessengerV2 / MessageTransmitterV2 are single constants, not per-chain.
 */

// ── CCTP V2 contracts (identical address on Optimism + Base, verified on both) ──
export const CCTP_TOKEN_MESSENGER_V2: Address = '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d';
export const CCTP_MESSAGE_TRANSMITTER_V2: Address = '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64';

// ── CCTP domain IDs (Circle's chain identifiers — NOT EVM chain IDs) ──
export const CCTP_DOMAIN_OPTIMISM = 2;
export const CCTP_DOMAIN_ARBITRUM = 3;
export const CCTP_DOMAIN_BASE = 6;

// ── EVM chain IDs ──
export const CHAIN_ID_OPTIMISM = 10;
export const CHAIN_ID_ARBITRUM = 42161;
export const CHAIN_ID_BASE = 8453;

// ── Native USDC (Circle-issued), verified symbol()="USDC" on each chain ──
// Arbitrum native USDC (0xaf88…) — NOT the bridged USDC.e (0xff97…). CCTP only
// burns/mints native USDC; USDC.e would revert. Same Circle FiatTokenV2_2, so the
// EIP-2612 permit domain is identical (name "USD Coin", version "2").
export const USDC_OPTIMISM: Address = '0x0b2c639c533813f4aa9d7837caf62653d097ff85';
export const USDC_ARBITRUM: Address = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
export const USDC_BASE: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// ── RPCs ──
export const OPTIMISM_RPC_URL = process.env.NEXT_PUBLIC_ALCHEMY_OP_RPC_URL || 'https://mainnet.optimism.io';
export const ARBITRUM_RPC_URL = process.env.NEXT_PUBLIC_ALCHEMY_ARB_RPC_URL || 'https://arb1.arbitrum.io/rpc';
export const BASE_MAINNET_RPC_URL = process.env.NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL || 'https://mainnet.base.org';

// ── NY source chain resolver (env-switchable for A/B speed testing) ──────────
// MoonPay delivers USDC to this chain for NY buyers; we sweep + CCTP-bridge it to
// Base. Optimism and Arbitrum are BOTH clean (ETH gas, CCTP Fast Transfer, native
// USDC with EIP-2612 permit) — a pure constants swap. Flip via env
// NEXT_PUBLIC_NY_SOURCE_CHAIN=arbitrum (default optimism), redeploy, test.
export type NySourceChain = 'optimism' | 'arbitrum';
export interface NySourceConfig {
  key: NySourceChain;
  viemChain: Chain;
  chainId: number;
  caip2: `${string}:${string}`;
  usdc: Address;
  rpcUrl: string;
  cctpDomain: number;
}
export function getNySourceChainKey(): NySourceChain {
  return (process.env.NEXT_PUBLIC_NY_SOURCE_CHAIN ?? '').trim().toLowerCase() === 'arbitrum' ? 'arbitrum' : 'optimism';
}
export function getNySource(): NySourceConfig {
  if (getNySourceChainKey() === 'arbitrum') {
    return { key: 'arbitrum', viemChain: arbitrum, chainId: CHAIN_ID_ARBITRUM, caip2: `eip155:${CHAIN_ID_ARBITRUM}`, usdc: USDC_ARBITRUM, rpcUrl: ARBITRUM_RPC_URL, cctpDomain: CCTP_DOMAIN_ARBITRUM };
  }
  return { key: 'optimism', viemChain: optimism, chainId: CHAIN_ID_OPTIMISM, caip2: `eip155:${CHAIN_ID_OPTIMISM}`, usdc: USDC_OPTIMISM, rpcUrl: OPTIMISM_RPC_URL, cctpDomain: CCTP_DOMAIN_OPTIMISM };
}

// ── Circle attestation service (public, no key) — poll for the signed message ──
export const CIRCLE_IRIS_API = 'https://iris-api.circle.com';

/** Left-pad a 20-byte EVM address into the bytes32 form CCTP's mintRecipient /
 *  destinationCaller fields expect. */
export function addressToBytes32(addr: Address): `0x${string}` {
  return `0x${addr.toLowerCase().replace(/^0x/, '').padStart(64, '0')}` as `0x${string}`;
}
