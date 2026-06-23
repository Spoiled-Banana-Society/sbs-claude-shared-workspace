import { getAdminApp } from '@/lib/firebaseAdmin';
import { getStorage } from 'firebase-admin/storage';
import { json, jsonError } from '@/lib/api/routeUtils';
import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { getPrivyUser } from '@/lib/auth';
import { ApiError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';

// Env-driven so prod can override; defaults to the REAL pfp bucket. The old
// default `sbs-staging-env.firebasestorage.app` does NOT exist — every upload
// 404'd and the client silently fell back to saving a giant base64 blob as the
// pfp (which then 500s the Go API and won't render in the draft room). The
// actual bucket is `sbs-staging-pfps` (public-read via IAM, uniform access).
const BUCKET_NAME = process.env.UPLOAD_BUCKET || 'sbs-staging-pfps';
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

    // Do NOT call fileRef.makePublic() here. The bucket uses uniform
    // bucket-level access, so per-object ACL writes (makePublic) THROW
    // ("Cannot use ACL API ... uniform bucket-level access is enabled") and
    // used to fail the entire upload. Objects are already public-read via the
    // bucket's IAM policy (allUsers → roles/storage.objectViewer), so the
    // public URL below works directly.
    const publicUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${filename}`;

    return json({ url: publicUrl }, 200);
  } catch (err) {
    console.error('[upload] Error:', err);
    return jsonError(`Upload failed: ${(err as Error)?.message ?? 'unknown'}`, 500);
  }
}
