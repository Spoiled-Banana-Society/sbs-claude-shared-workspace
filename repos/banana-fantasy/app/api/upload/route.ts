import { getAdminApp } from '@/lib/firebaseAdmin';
import { getStorage } from 'firebase-admin/storage';
import { json, jsonError } from '@/lib/api/routeUtils';
import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { getPrivyUser } from '@/lib/auth';
import { ApiError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';

// Env-driven so prod uses its own bucket; staging keeps this exact bucket when
// UPLOAD_BUCKET is unset (so staging uploads are unchanged).
const BUCKET_NAME = process.env.UPLOAD_BUCKET || 'sbs-staging-env.firebasestorage.app';
const MAX_SIZE = 2 * 1024 * 1024; // 2MB

export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  // The target wallet comes from the verified Privy token, NOT the form body —
  // otherwise anyone could overwrite any user's public profile picture.
  let wallet: string;
  try {
    const user = await getPrivyUser(req);
    if (!user.walletAddress) return jsonError('wallet required', 401);
    wallet = user.walletAddress;
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    return jsonError('auth failed', 401);
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return jsonError('file is required', 400);
    }

    if (file.size > MAX_SIZE) {
      return jsonError('File too large (max 2MB)', 400);
    }

    if (!file.type.startsWith('image/')) {
      return jsonError('Only image files allowed', 400);
    }

    const app = getAdminApp();
    const bucket = getStorage(app).bucket(BUCKET_NAME);

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Upload to Firebase Storage
    const ext = file.name.split('.').pop() || 'png';
    const filename = `pfp/${wallet.toLowerCase()}.${ext}`;
    const fileRef = bucket.file(filename);

    await fileRef.save(buffer, {
      metadata: {
        contentType: file.type,
        cacheControl: 'public, max-age=3600',
      },
    });

    // Make publicly accessible
    await fileRef.makePublic();

    // Get public URL
    const publicUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${filename}`;

    return json({ url: publicUrl }, 200);
  } catch (err) {
    console.error('[upload] Error:', err);
    return jsonError('Upload failed', 500);
  }
}
