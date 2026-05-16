/**
 * One-off: transfer ownership of BBB4BatchProofMerkle to the Go API's
 * signer wallet so requestRandomnessAndCommit / commitMerkleRoot /
 * revealSalt called from the Go API don't revert on onlyOwner.
 *
 *   node scripts/transfer-merkle-ownership.mjs <newOwner>
 *
 * Defaults to the staging Go API signer if no arg passed.
 */
import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, encodeFunctionData, isAddress, parseGwei } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DEFAULT_NEW_OWNER = '0xe0d0C8ad893aD6F5fa0a51A43260c169C87b67e3';
const newOwner = (process.argv[2] || DEFAULT_NEW_OWNER).trim();
if (!isAddress(newOwner)) {
  console.error(`Invalid newOwner address: ${newOwner}`);
  process.exit(1);
}

// Load env values from .env.production (base64-encoded SA + raw private key)
const envText = readFileSync('.env.production', 'utf8');
const saMatch = envText.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m);
if (!saMatch) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON not found in .env.production');
const sa = JSON.parse(Buffer.from(saMatch[1], 'base64').toString('utf8'));

const keyMatch = envText.match(/^BBB4_OWNER_PRIVATE_KEY=("?)([0-9a-fA-Fx]+)\1$/m);
if (!keyMatch) throw new Error('BBB4_OWNER_PRIVATE_KEY not found in .env.production');
let privateKey = keyMatch[2];
if (!privateKey.startsWith('0x')) privateKey = '0x' + privateKey;

initializeApp({ credential: cert(sa) });
const db = getFirestore();

const snap = await db.collection('system_config').doc('batchProofMerkle').get();
if (!snap.exists) {
  console.error('system_config/batchProofMerkle not found');
  process.exit(1);
}
const contractAddress = snap.data()?.contractAddress;
if (!contractAddress || !isAddress(contractAddress)) {
  console.error('No contractAddress in system_config/batchProofMerkle');
  process.exit(1);
}
console.log(`Merkle contract: ${contractAddress}`);

const BASE_CHAIN = { id: 8453, name: 'base', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['https://mainnet.base.org'] } } };
const account = privateKeyToAccount(privateKey);
const publicClient = createPublicClient({ chain: BASE_CHAIN, transport: http() });
const walletClient = createWalletClient({ account, chain: BASE_CHAIN, transport: http() });

console.log(`Signing wallet: ${account.address}`);

// Read current owner
const owner = await publicClient.readContract({
  address: contractAddress,
  abi: [{ inputs: [], name: 'owner', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' }],
  functionName: 'owner',
});
console.log(`Current owner: ${owner}`);

if (owner.toLowerCase() === newOwner.toLowerCase()) {
  console.log('Already owned by the target address — nothing to do.');
  process.exit(0);
}
if (owner.toLowerCase() !== account.address.toLowerCase()) {
  console.error(`Signer ${account.address} is not the current owner ${owner}. Cannot transfer.`);
  process.exit(1);
}

const data = encodeFunctionData({
  abi: [{ inputs: [{ name: 'newOwner', type: 'address' }], name: 'transferOwnership', outputs: [], stateMutability: 'nonpayable', type: 'function' }],
  functionName: 'transferOwnership',
  args: [newOwner],
});

const txHash = await walletClient.sendTransaction({
  to: contractAddress,
  data,
  value: 0n,
  maxFeePerGas: parseGwei('0.1'),
  maxPriorityFeePerGas: parseGwei('0.001'),
});
console.log(`Transfer tx: ${txHash}`);
const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
if (receipt.status !== 'success') {
  console.error('Transfer transaction reverted');
  process.exit(1);
}

const confirmedOwner = await publicClient.readContract({
  address: contractAddress,
  abi: [{ inputs: [], name: 'owner', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' }],
  functionName: 'owner',
});
console.log(`✓ Ownership transferred. New owner: ${confirmedOwner}`);
process.exit(0);
