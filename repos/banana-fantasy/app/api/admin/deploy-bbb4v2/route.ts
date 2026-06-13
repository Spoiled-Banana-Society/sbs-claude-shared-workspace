export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { createPublicClient, createWalletClient, http, parseGwei, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { requireAdmin } from '@/lib/adminAuth';
import { BASE, BASE_RPC_URL } from '@/lib/contracts/bbb4';
import { getAdminPrivateKeyHex } from '@/lib/onchain/adminMint';
import { acquireAdminWalletLock } from '@/lib/onchain/adminWalletLock';
import { BBB4V2_ABI, BBB4V2_BYTECODE } from '@/lib/onchain/bbb4v2Artifacts';
import { logger } from '@/lib/logger';

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address;
const OPENSEA_CONDUIT = '0x1E0049783F008A0085193E00003D00cd54003c71' as Address;
const BASE_URI = 'https://banana-fantasy-sbs.vercel.app/api/nft/metadata/';
const COLLECTION_NAME = 'BBB4 Staging';
const COLLECTION_SYMBOL = 'SBSBBB4';

const fees = { maxFeePerGas: parseGwei('0.15'), maxPriorityFeePerGas: parseGwei('0.001') };

/**
 * ONE-TIME admin route: deploy + initialize SBSDraftPassBBB4V2 ("BBB4
 * Staging") from the server, where BBB4_OWNER_PRIVATE_KEY already lives —
 * the key is Sensitive in Vercel (unreadable) so no human can supply it.
 * Admin-allowlist gated. DELETE THIS ROUTE after the swap ships.
 *
 * POST { action: 'deploy' }            → deploys, returns { address }
 * POST { action: 'init', address }     → baseURI + mint active + smoke mint
 *                                        + conduit auto-approve verification
 */
export async function POST(req: Request) {
  if (process.env.NEXT_PUBLIC_ENVIRONMENT !== 'staging') {
    return jsonError('Not available in this environment', 403);
  }

  try {
    const { walletAddress } = await requireAdmin(req);
    const key = getAdminPrivateKeyHex();
    if (!key) return jsonError('Admin wallet not configured', 503);

    const account = privateKeyToAccount(key);
    const wallet = createWalletClient({ account, chain: BASE, transport: http(BASE_RPC_URL) });
    const client = createPublicClient({ chain: BASE, transport: http(BASE_RPC_URL) });

    const body = await parseBody(req);
    const action = requireString(body.action, 'action');

    const releaseLock = await acquireAdminWalletLock('deploy-bbb4v2');
    try {
      if (action === 'deploy') {
        const hash = await wallet.deployContract({
          abi: BBB4V2_ABI,
          bytecode: BBB4V2_BYTECODE as Hex,
          args: [COLLECTION_NAME, COLLECTION_SYMBOL, USDC_BASE],
          ...fees,
        });
        const rcpt = await client.waitForTransactionReceipt({ hash, timeout: 45_000 });
        if (rcpt.status !== 'success' || !rcpt.contractAddress) {
          return jsonError(`Deploy reverted (${hash})`, 502);
        }
        logger.info('deploy-bbb4v2.deployed', {
          address: rcpt.contractAddress, txHash: hash, by: walletAddress,
        });
        return json({ success: true, address: rcpt.contractAddress, txHash: hash });
      }

      if (action === 'init') {
        const address = requireString(body.address, 'address') as Address;
        const read = (functionName: string, args: unknown[] = []) =>
          client.readContract({ address, abi: BBB4V2_ABI, functionName, args } as Parameters<typeof client.readContract>[0]);
        const write = async (label: string, functionName: string, args: unknown[] = []) => {
          const hash = await wallet.writeContract({
            address, abi: BBB4V2_ABI, functionName, args, ...fees,
          } as Parameters<typeof wallet.writeContract>[0]);
          const rcpt = await client.waitForTransactionReceipt({ hash, timeout: 45_000 });
          if (rcpt.status !== 'success') throw new ApiError(502, `${label} reverted (${hash})`);
          return hash;
        };

        const txHashes: Record<string, string> = {};
        // Idempotent: skip steps that already ran (safe to re-call on timeout).
        if ((await read('tokenURI', [0n]).catch(() => null)) === null || !(await read('mintIsActive'))) {
          txHashes.setBaseURI = await write('setBaseURI', 'setBaseURI', [BASE_URI]);
          if (!(await read('mintIsActive'))) {
            txHashes.flipMintState = await write('flipMintState', 'flipMintState');
          }
        }
        if ((await read('totalSupply')) === 0n) {
          txHashes.smokeMint = await write('reserveTokens', 'reserveTokens', [account.address, 1n]);
        }

        const RANDO = '0x000000000000000000000000000000000000dEaD' as Address;
        const verification = {
          mintIsActive: await read('mintIsActive'),
          tokenPriceUsdc: String(await read('TOKEN_PRICE_USDC')),
          totalSupply: String(await read('totalSupply')),
          tokenURI0: await read('tokenURI', [0n]),
          conduitAutoApproved: await read('isApprovedForAll', [RANDO, OPENSEA_CONDUIT]),
          randomOperatorNotApproved: !(await read('isApprovedForAll', [RANDO, RANDO])),
          owner: await read('owner'),
          name: await read('name'),
        };
        logger.info('deploy-bbb4v2.initialized', { address, txHashes, verification, by: walletAddress });
        return json({ success: true, address, txHashes, verification });
      }

      return jsonError(`Unknown action: ${action}`, 400);
    } finally {
      await releaseLock();
    }
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('deploy-bbb4v2.unhandled', { err: (err as Error).message });
    return jsonError((err as Error).message || 'Internal Server Error', 500);
  }
}
