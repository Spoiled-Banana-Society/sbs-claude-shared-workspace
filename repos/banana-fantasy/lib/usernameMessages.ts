/**
 * Human-readable messages for username validation failures. Kept separate from
 * lib/usernames.ts (which is server-only — it imports the Firestore admin SDK)
 * so client components can import the copy without pulling in server code.
 */
export const USERNAME_ERROR_TEXT: Record<string, string> = {
  too_short: 'Username must be at least 3 characters.',
  too_long: 'Username must be 20 characters or fewer.',
  invalid_chars: 'Use only letters, numbers, and _ . -',
  looks_like_wallet: 'That looks like a wallet address — pick a name.',
  reserved: 'That name is reserved — pick another.',
  taken: 'Username taken — try another.',
};

export function usernameErrorText(reason: string | undefined): string {
  return USERNAME_ERROR_TEXT[reason || 'taken'] || 'Username unavailable.';
}
