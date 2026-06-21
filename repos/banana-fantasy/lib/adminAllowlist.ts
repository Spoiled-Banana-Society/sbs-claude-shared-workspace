import { isProd } from './envGates';

const FALLBACK_ADMIN_WALLETS = [
  '0xc0f982492c323fcd314af56d6c1a35cc9b0fc31e',
  '0x27fe00a5a1212e9294b641ba860a383783016c67',
  '0x438bbe98eed1dd2df244b007dab0583cc9be72e0', // Boris
  '0x2e64db49fc597a731091471607f6cd0251d7eafb', // Richard
  '0xbd2e09c009a7834cd32f9fa8a87073c5b3083f11', // Richard test wallet (MetaMask 'r8')
  '0xa13cfe7d8cab73feb372a3356fc13f9ad2d436ae', // Richard (active wallet)
];

function normalizeWallet(value: string): string {
  return value.trim().toLowerCase();
}

function parseEnvWallets(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => normalizeWallet(entry))
    .filter(Boolean);
}

export function getAdminWalletAllowlist(): string[] {
  const configured = parseEnvWallets(
    process.env.ADMIN_WALLET_ADDRESSES || process.env.NEXT_PUBLIC_ADMIN_WALLET_ADDRESSES,
  );
  if (configured.length > 0) return configured;
  // In PROD, never fall back to the dev/test wallet list — require
  // ADMIN_WALLET_ADDRESSES to be set explicitly. A forgotten var then fails
  // SAFE (no admins, caught instantly in QA) instead of silently granting prod
  // admin to test wallets (e.g. Richard's 'r8'). Staging keeps the fallback.
  if (isProd()) return [];
  return [...FALLBACK_ADMIN_WALLETS];
}

export function isWalletAdmin(walletAddress: string | null | undefined): boolean {
  if (!walletAddress) return false;
  const normalized = normalizeWallet(walletAddress);
  return getAdminWalletAllowlist().includes(normalized);
}
