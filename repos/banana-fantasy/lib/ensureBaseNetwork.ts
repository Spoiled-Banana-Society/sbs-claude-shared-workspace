/**
 * Make sure a wallet is on the Base network before an on-chain action
 * (minting a pass, a marketplace tx). Handles all three cases:
 *   1. Already on Base                → ok, zero friction
 *   2. On another network             → switch them to Base
 *   3. Wallet doesn't have Base at all → add it (wallet prompts the user)
 *
 * Returns a result — never throws — so the caller decides how to surface
 * a failure. On `!ok`, `message` is plain user-facing copy.
 *
 * Fail-open: if the wallet's network can't even be read, returns ok so
 * the caller proceeds and the real action surfaces a clearer error —
 * better than blocking a legitimate user on a bad guess.
 */

const BASE_CHAIN_ID = 8453;
const BASE_CHAIN_HEX = '0x2105';

// Standard EIP-3085 params for adding Base mainnet to a wallet.
const BASE_NETWORK_PARAMS = {
  chainId: BASE_CHAIN_HEX,
  chainName: 'Base',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://mainnet.base.org'],
  blockExplorerUrls: ['https://basescan.org'],
};

// EIP-1193 error codes.
const USER_REJECTED = 4001;
const CHAIN_NOT_ADDED = 4902;

interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

export interface EnsureNetworkResult {
  ok: boolean;
  message?: string;
}

function errorCode(err: unknown): number | undefined {
  if (err && typeof err === 'object') {
    const c = (err as { code?: unknown }).code;
    if (typeof c === 'number') return c;
    // Some wallets nest the code under `.data` or stringify it.
    const dc = (err as { data?: { originalError?: { code?: unknown } } }).data?.originalError?.code;
    if (typeof dc === 'number') return dc;
  }
  return undefined;
}

export async function ensureBaseNetwork(provider: Eip1193Provider): Promise<EnsureNetworkResult> {
  // 1. Already on Base? (true for all Privy embedded wallets — no-op)
  try {
    const currentHex = await provider.request({ method: 'eth_chainId' });
    if (parseInt(String(currentHex), 16) === BASE_CHAIN_ID) {
      return { ok: true };
    }
  } catch {
    // Can't read the chain — proceed; the action itself will surface a
    // clearer error than us guessing wrong and blocking the user.
    return { ok: true };
  }

  // 2. Not on Base — ask the wallet to switch.
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: BASE_CHAIN_HEX }],
    });
    return { ok: true };
  } catch (switchErr) {
    const code = errorCode(switchErr);

    // 3. Wallet doesn't have Base — add it (this also switches on success).
    if (code === CHAIN_NOT_ADDED) {
      try {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [BASE_NETWORK_PARAMS],
        });
        return { ok: true };
      } catch (addErr) {
        if (errorCode(addErr) === USER_REJECTED) {
          return { ok: false, message: 'Please add the Base network in your wallet to continue.' };
        }
        return {
          ok: false,
          message: 'Couldn’t add the Base network. Add it in your wallet, then try again.',
        };
      }
    }

    if (code === USER_REJECTED) {
      return { ok: false, message: 'Please switch your wallet to the Base network to continue.' };
    }
    return { ok: false, message: 'Please switch your wallet to the Base network to continue.' };
  }
}
