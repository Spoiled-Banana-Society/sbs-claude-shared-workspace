// Wallets allowed to use "Switch Wallet" in the profile dropdown.
// Regular users should not juggle multiple wallets, so this is gated to
// the team (admins) by default. Add more addresses via the
// SWITCH_WALLET_ADDRESSES (or NEXT_PUBLIC_SWITCH_WALLET_ADDRESSES) env var
// — comma-separated — to grant switching to a specific wallet without
// giving it admin access.
import { isProd } from './envGates';

const FALLBACK_SWITCH_WALLETS = [
  '0xc0f982492c323fcd314af56d6c1a35cc9b0fc31e',
  '0x27fe00a5a1212e9294b641ba860a383783016c67',
  '0x438bbe98eed1dd2df244b007dab0583cc9be72e0', // Boris (admin/drafting)
  '0x2e64db49fc597a731091471607f6cd0251d7eafb', // Richard
  // Boris's personal test wallets (the ones that have logged into staging) so
  // he can switch between them without each one needing admin access.
  '0x6718ab0fea9ca0334d97198d5a6d61e4df7e2608', // Boris (new-user test wallet)
  '0x9eba7944455f4bdb2d120369827ce7f1b0bda000', // Boris
  '0xeab34d772d0fc63cd89b58772de0c1cfaebdc7d4', // Boris
  '0xc7900ed9d6b3f252fe5cd151dce67db3ff349b2e', // Boris (BananaKing99)
  '0x6681d98e65e33522374a3876e29183eaab8aa711', // Boris (BananaKing99)
  '0x19b3cc05226775552b7dd4969743678affb0efdf', // Boris
  '0xc0d1c2e08294060ba4427c5df0cac1bc28e1a265', // Boris
  '0xe7259addf13489b4fc37ebde0d8fe523cd38bed1', // Boris (BananaKing99)
  '0xebc6103ef0cb4d0d6ef917cd6b8b9caa935cbfc7', // Boris
  '0x77aae124683a75013df8ab7f0fde5193b0034f42', // Boris (BananaKing99)
  '0x014a3bc94c1c753adf14b1ead8758a8bb55dc191', // Boris (BananaKing99)
  '0x7095fc9ff349559763b7abbaad7732baa7eca4e9', // Boris
  '0x9a74bc5c793f9d0197635f6d83ef0fdbf325e17b', // Boris
  '0xf3d51c38864324d59edb350cebf0bf698b6662db', // Boris
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

export function getSwitchWalletAllowlist(): string[] {
  const configured = parseEnvWallets(
    process.env.SWITCH_WALLET_ADDRESSES || process.env.NEXT_PUBLIC_SWITCH_WALLET_ADDRESSES,
  );
  if (configured.length > 0) return configured;
  // In PROD, never fall back to the dev/test wallet list — require
  // SWITCH_WALLET_ADDRESSES explicitly (else the feature is simply off, which
  // is safe). Staging keeps the fallback (isProd() false).
  if (isProd()) return [];
  return [...FALLBACK_SWITCH_WALLETS];
}

export function canSwitchWallet(walletAddress: string | null | undefined): boolean {
  if (!walletAddress) return false;
  const normalized = normalizeWallet(walletAddress);
  return getSwitchWalletAllowlist().includes(normalized);
}
