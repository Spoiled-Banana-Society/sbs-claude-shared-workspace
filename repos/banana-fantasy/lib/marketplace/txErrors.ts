/**
 * Turn raw wallet/RPC errors into a short, friendly message for the UI.
 *
 * Wallet libraries (ethers/viem/Privy) throw verbose blobs like
 * "could not coalesce error (error={ "message": "Wallet timeout" }, payload=…)"
 * — never show those to a user. The raw error is still logged separately for
 * debugging; this is purely for what the person sees.
 */
export function friendlyTxError(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const lower = raw.toLowerCase();

  // Specific signals FIRST — ethers wraps RPC errors in "could not coalesce
  // error (…)" blobs that ALSO contain the real cause, so the generic
  // timeout/coalesce match must come last or it shadows everything.
  if (lower.includes('user rejected') || lower.includes('user denied') || lower.includes('rejected the request')) {
    return 'You cancelled the request in your wallet.';
  }
  if (lower.includes('insufficient funds') || lower.includes('insufficient balance for gas') || lower.includes('gas required exceeds')) {
    return 'Your wallet needs a little ETH on Base for the network fee. Add a small amount and try again.';
  }
  if (lower.includes('replacement') || lower.includes('nonce too low') || lower.includes('already known')) {
    return 'A previous transaction is still pending. Wait a moment, then try again.';
  }
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('could not coalesce')) {
    return 'Your wallet timed out before confirming. Try again — and approve the request when your wallet pops up.';
  }
  return fallback;
}
