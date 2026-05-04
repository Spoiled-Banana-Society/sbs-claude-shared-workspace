import { getAdminApp } from '@/lib/firebaseAdmin';
import { getStorage } from 'firebase-admin/storage';
import { json, jsonError } from '@/lib/api/routeUtils';
import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

const BUCKET_NAME = 'sbs-staging-env.firebasestorage.app';
const MAX_SIZE = 2 * 1024 * 1024; // 2MB

export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const wallet = formData.get('wallet') as string | null;

    if (!file || !wallet) {
      return jsonError('file and wallet are required', 400);
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
