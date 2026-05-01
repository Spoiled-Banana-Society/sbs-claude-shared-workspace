import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { requireWalletAuth } from '@/lib/walletAuth';
import { createPurchase } from '@/lib/db';
import { logger } from '@/lib/logger';

export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.purchases);
  if (rateLimited) return rateLimited;
  try {
    // Server-derived wallet — purchase is always credited to the authed
    // caller. body.userId would let one user spawn purchases on another.
    const { walletAddress: userId } = await requireWalletAuth(req);
    const body = await parseBody(req);

    const quantityRaw = body.quantity;
    const quantity = typeof quantityRaw === 'number' ? quantityRaw : Number(quantityRaw);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return jsonError('quantity must be a positive integer', 400);
    }
    if (quantity > 100) {
      return jsonError('Maximum 100 passes per purchase', 400);
    }

    const paymentMethod = body.paymentMethod === 'card' ? 'card' : 'usdc';

    if (paymentMethod === 'card') {
      const cardToken = typeof body.cardToken === 'string' ? body.cardToken.trim() : '';
      if (!cardToken) {
        return jsonError('Payment required', 400);
      }
      // TODO: Replace this placeholder token check with real payment processor verification before production.
      // Require card tokens from the checkout flow (prefixed with test_)
      // This prevents direct API calls from auto-succeeding without going through payment
      if (!cardToken.startsWith('test_')) {
        return jsonError('Invalid payment token. Please complete checkout.', 402);
      }
    }

    // USDC payments must provide a transaction hash for on-chain verification
    if (paymentMethod === 'usdc') {
      const txHash = typeof body.txHash === 'string' ? body.txHash.trim() : '';
      if (!txHash) {
        return jsonError('Transaction hash required for USDC payments', 400);
      }
      // TODO: Verify the submitted txHash on-chain before crediting any USDC purchase.
    }

    const result = await createPurchase(userId, quantity, paymentMethod);
    return json(result, 201);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('purchases.create.unhandled', { route: '/api/purchases/create', err });
    return jsonError('Internal Server Error', 500);
  }
}
