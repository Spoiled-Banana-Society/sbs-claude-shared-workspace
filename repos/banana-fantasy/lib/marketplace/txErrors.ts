/**
 * Turn raw wallet/RPC errors into a short, friendly message for the UI.
 *
 * Wallet libraries (ethers/viem/Privy) throw verbose blobs like
 * "could not coalesce error (error={ "message": "Wallet timeout" }, payload=…)"
 * — never show those to a user. The raw error is still logged separately for
 * debugging; this is purely for what the person sees.
 */

/**
 * Wrap a message that is ALREADY user-facing copy (our own API's 403 reasons,
 * "OpenSea error: …" details) so friendlyTxError shows it verbatim instead of
 * collapsing it into the generic fallback. Without this, every server-side
 * rejection — wheel-pass lock, free-pass block, OpenSea refusal — read as
 * "Couldn't create the listing. Please try again." and was undiagnosable from
 * a user screenshot (AceJohn, ticket-2681).
 */
export function userFacingTxError(message: string): Error {
  const err = new Error(message);
  (err as Error & { userFacing?: boolean }).userFacing = true;
  return err;
}

export function friendlyTxError(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  if (error instanceof Error && (error as Error & { userFacing?: boolean }).userFacing && raw.trim()) {
    return raw.slice(0, 240);
  }
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
