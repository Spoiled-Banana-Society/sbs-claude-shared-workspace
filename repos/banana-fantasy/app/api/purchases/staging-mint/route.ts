export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { createPurchase, verifyPurchase } from '@/lib/db';
import { getStagingApiUrl } from '@/lib/staging';

export async function POST(req: Request) {
  try {
    const body = await parseBody(req);
    const userId = requireString(body.userId, 'userId');

    const quantityRaw = body.quantity;
    const quantity = typeof quantityRaw === 'number' ? quantityRaw : Number(quantityRaw);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return jsonError('quantity must be a positive integer', 400);
    }

    // 1. Mint tokens via Go API
    const goApiUrl = getStagingApiUrl();
    const mintRes = await fetch(`${goApiUrl}/staging/mint-tokens/${userId}?count=${quantity}`, {
      method: 'POST',
    });
    if (!mintRes.ok) {
      const mintErr = await mintRes.text().catch(() => 'Unknown error');
      return jsonError(`Go API mint failed: ${mintErr}`, 502);
    }

    // 2. Create purchase record
    const { purchase } = await createPurchase(userId, quantity, 'usdc');

    // 3. Verify immediately to trigger promo update
    const txHash = `staging-${Date.now()}`;
    const result = await verifyPurchase(purchase.id, txHash);

    return json(result, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('staging-mint error:', err);
    return jsonError('Internal Server Error', 500);
  }
}
