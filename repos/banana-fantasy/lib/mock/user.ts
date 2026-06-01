import { User } from '@/types';

export const mockUser: User = {
  id: '1',
  username: 'BananaKing99',
  walletAddress: '0x1234567890abcdef1234567890abcdef12345678', // Mock test wallet address
  loginMethod: 'social' as const,
  profilePicture: undefined,
  nflTeam: 'Chiefs',
  xHandle: '@BananaKing99',
  draftPasses: 0,
  usdcBalance: 0,
  freeDrafts: 0,
  wheelSpins: 0,
  jackpotEntries: 0,
  hofEntries: 0,
  cardPurchaseCount: 0,
  cardFeeCreditCents: 0,
  isVerified: true,
  createdAt: '2025-09-01',
};
