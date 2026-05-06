import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from '@/lib/logger';
import { EMPTY_SCHEDULE, type FounderSchedule } from '@/lib/founderDraft';

// Founder Draft schedule. Singleton doc at founderSchedule/next.
//
// GET — public read so the homepage banner + draft-room founder pill
// can determine eligibility without admin auth.
//
// POST — admin-only via requireAdmin. Body: partial FounderSchedule.

const COLLECTION = 'founderSchedule';
const DOC_ID = 'next';

export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  try {
    if (!isFirestoreConfigured()) {
      return json({ schedule: EMPTY_SCHEDULE });
    }
    const db = getAdminFirestore();
    const snap = await db.collection(COLLECTION).doc(DOC_ID).get();
    if (!snap.exists) {
      return json({ schedule: EMPTY_SCHEDULE });
    }
    const data = snap.data() as Partial<FounderSchedule> | undefined;
    const schedule: FounderSchedule = {
      at: typeof data?.at === 'string' ? data.at : '',
      dayLabel: typeof data?.dayLabel === 'string' ? data.dayLabel : '',
      founderWallet: typeof data?.founderWallet === 'string' ? data.founderWallet.toLowerCase() : '',
      windowMinutes: Number.isFinite(data?.windowMinutes) ? Number(data!.windowMinutes) : 10,
      active: data?.active === true,
      updatedAt: typeof data?.updatedAt === 'string' ? data.updatedAt : undefined,
    };
    return json({ schedule });
  } catch (err) {
    logger.error('founder-schedule.get.failed', { err });
    return jsonError('Internal Server Error', 500);
  }
}

export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;
  try {
    await requireAdmin(req);
    if (!isFirestoreConfigured()) throw new ApiError(503, 'Firestore not configured');

    const body = await parseBody(req);
    const at = typeof body.at === 'string' ? body.at.trim() : '';
    const dayLabel = typeof body.dayLabel === 'string' ? body.dayLabel.trim() : '';
    const founderWallet = typeof body.founderWallet === 'string' ? body.founderWallet.trim().toLowerCase() : '';
    const windowMinutes = Number.isFinite(body.windowMinutes) ? Number(body.windowMinutes) : 10;
    const active = body.active === true;

    // at must parse to a valid date if provided
    if (at && !Number.isFinite(Date.parse(at))) {
      throw new ApiError(400, 'at must be a valid ISO timestamp');
    }
    if (windowMinutes < 0 || windowMinutes > 240) {
      throw new ApiError(400, 'windowMinutes must be between 0 and 240');
    }

    const db = getAdminFirestore();
    await db.collection(COLLECTION).doc(DOC_ID).set(
      {
        at,
        dayLabel,
        founderWallet,
        windowMinutes,
        active,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    const schedule: FounderSchedule = {
      at, dayLabel, founderWallet, windowMinutes, active,
    };
    return json({ ok: true, schedule });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('founder-schedule.post.failed', { err });
    return jsonError('Internal Server Error', 500);
  }
}
