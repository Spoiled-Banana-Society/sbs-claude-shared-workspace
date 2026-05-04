import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = 'force-dynamic';

import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;
  try {
    await requireAdmin(req);
    const db = getAdminFirestore();

    const collections = ['promoCodes', 'promos', 'v2_promos'];
    let promos: Array<Record<string, unknown>> = [];

    for (const col of collections) {
      const snap = await db.collection(col).limit(200).get();
      if (!snap.empty) {
        promos = snap.docs.map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            code: data.code || doc.id,
            discountPercent: data.discountPercent || data.discount || 0,
            maxUses: data.maxUses || data.limit || null,
            currentUses: data.currentUses || data.uses || data.redemptions || 0,
            active: data.active !== false,
            expiresAt: data.expiresAt || null,
            createdAt: data.createdAt || null,
            collection: col,
          };
        });
        break;
      }
    }

    return json({ promos }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[admin/promos] GET failed:', err);
    return jsonError('Internal Server Error', 500);
  }
}

export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;
  try {
    await requireAdmin(req);
    const db = getAdminFirestore();

    const body = await parseBody<{
      code?: string;
      discountPercent?: number;
      maxUses?: number | null;
      expiresAt?: string | null;
    }>(req);

    if (!body.code || typeof body.code !== 'string') {
      return jsonError('Missing promo code', 400);
    }

    const code = body.code.toUpperCase().trim();
    const promoData = {
      code,
      discountPercent: body.discountPercent || 0,
      maxUses: body.maxUses || null,
      currentUses: 0,
      active: true,
      expiresAt: body.expiresAt || null,
      createdAt: new Date().toISOString(),
    };

    const ref = db.collection('promoCodes').doc(code);
    await ref.set(promoData);

    return json({ ...promoData, id: code }, 201);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[admin/promos] POST failed:', err);
    return jsonError('Internal Server Error', 500);
  }
}
