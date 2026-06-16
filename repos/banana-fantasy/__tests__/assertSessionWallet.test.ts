import { describe, it, expect } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { assertSessionWallet, walletFromSession } from '@/lib/assertSessionWallet';

const WALLET = '0xAbCdEf0123456789AbCdEf0123456789AbCdEf01';
const WALLET_LOWER = WALLET.toLowerCase();
const OTHER_WALLET = '0x1111111111111111111111111111111111111111';

describe('assertSessionWallet', () => {
  it('returns lowercased wallet when session matches requested (case-insensitive)', () => {
    const result = assertSessionWallet(
      { userId: 'did:privy:abc', walletAddress: WALLET },
      WALLET_LOWER,
    );
    expect(result).toBe(WALLET_LOWER);
  });

  it('returns wallet when requested address differs only by case', () => {
    const result = assertSessionWallet(
      { userId: 'did:privy:abc', walletAddress: WALLET_LOWER },
      WALLET,
    );
    expect(result).toBe(WALLET_LOWER);
  });

  it('throws 403 when session wallet does not match requested wallet', () => {
    expect(() =>
      assertSessionWallet(
        { userId: 'did:privy:abc', walletAddress: WALLET },
        OTHER_WALLET,
      ),
    ).toThrow(ApiError);

    try {
      assertSessionWallet(
        { userId: 'did:privy:abc', walletAddress: WALLET },
        OTHER_WALLET,
      );
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(403);
      expect((err as ApiError).message).toBe('Forbidden');
    }
  });

  it('throws 403 when session has no wallet', () => {
    try {
      assertSessionWallet({ userId: 'did:privy:abc', walletAddress: null }, WALLET);
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(403);
      expect((err as ApiError).message).toBe('Wallet required — link a wallet to your account');
    }
  });

  it('throws 400 for invalid wallet format', () => {
    try {
      assertSessionWallet(
        { userId: 'did:privy:abc', walletAddress: WALLET },
        'not-a-wallet',
      );
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(400);
      expect((err as ApiError).message).toBe('Invalid wallet address');
    }
  });
});

describe('walletFromSession', () => {
  it('returns lowercased wallet from session', () => {
    expect(walletFromSession({ userId: 'did:privy:abc', walletAddress: WALLET })).toBe(
      WALLET_LOWER,
    );
  });

  it('throws 403 when session has no wallet', () => {
    try {
      walletFromSession({ userId: 'did:privy:abc', walletAddress: null });
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(403);
    }
  });
});
