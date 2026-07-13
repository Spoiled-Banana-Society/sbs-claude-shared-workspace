import { isProd } from './envGates';

const FALLBACK_ADMIN_WALLETS = [
  '0xc0f982492c323fcd314af56d6c1a35cc9b0fc31e',
  '0x27fe00a5a1212e9294b641ba860a383783016c67',
  '0x438bbe98eed1dd2df244b007dab0583cc9be72e0', // Boris
  '0x2e64db49fc597a731091471607f6cd0251d7eafb', // Richard
  '0xbd2e09c009a7834cd32f9fa8a87073c5b3083f11', // Richard test wallet (MetaMask 'r8')
  '0xa13cfe7d8cab73feb372a3356fc13f9ad2d436ae', // Richard (active wallet)
  '0x93e2dc5642722688b2c5431cd7b3584cd97ee175', // Boris (heyooo / "Vag Bros")
];

// CURATED prod admin list — the real founder/team wallets ONLY (no test wallets
// like 'r8'). Used in prod when ADMIN_WALLET_ADDRESSES isn't set. Added 2026-06-22
// because the Vercel CLI can't write env values from automation (it kept saving an
// empty string → empty allowlist → Boris/Richard lost admin on the launch env).
// These are public addresses; access still requires signing with the private key,
// so listing them in code is no weaker than the env var. The env var still
// OVERRIDES this list when set.
const PROD_ADMIN_WALLETS = [
  '0xc0f982492c323fcd314af56d6c1a35cc9b0fc31e',
  '0x27fe00a5a1212e9294b641ba860a383783016c67',
  '0x438bbe98eed1dd2df244b007dab0583cc9be72e0', // Boris
  '0x2e64db49fc597a731091471607f6cd0251d7eafb', // Richard
  '0xa13cfe7d8cab73feb372a3356fc13f9ad2d436ae', // Richard (active wallet)
  '0xb65a135785eb4c375c2b540a6484e6eb60657fe6', // Boris (b65a13)
  '0x93e2dc5642722688b2c5431cd7b3584cd97ee175', // Boris (heyooo / "Vag Bros" — added 2026-07-01, MetaMask admin wallet locked out)
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
  // In PROD, use the CURATED prod list (real team wallets, no test wallets) — NOT
  // the dev fallback (which includes test wallets like 'r8'). Previously returned
  // [] to force ADMIN_WALLET_ADDRESSES, but that var can't be written via the
  // Vercel CLI from automation (saves empty) → locked the team out of admin. The
  // curated list is safe (no test wallets) and the env var still overrides above.
  if (isProd()) return [...PROD_ADMIN_WALLETS];
  return [...FALLBACK_ADMIN_WALLETS];
}

/**
 * Recipients for admin-only BELL notifications: the UNION of the env list and
 * the curated in-code list. The env var (set before 0x93e2 was added on
 * 2026-07-01) silently dropped Boris's SBS Admin wallet from the new-user
 * bells — access gating stays env-first, but a bell must reach every known
 * team wallet regardless of which list is stale.
 */
export function getAdminBellWallets(): string[] {
  const union = new Set([
    ...getAdminWalletAllowlist(),
    ...(isProd() ? PROD_ADMIN_WALLETS : FALLBACK_ADMIN_WALLETS),
  ]);
  return [...union];
}

export function isWalletAdmin(walletAddress: string | null | undefined): boolean {
  if (!walletAddress) return false;
  const normalized = normalizeWallet(walletAddress);
  return getAdminWalletAllowlist().includes(normalized);
}
