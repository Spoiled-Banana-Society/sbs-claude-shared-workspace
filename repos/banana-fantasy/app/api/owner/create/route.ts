import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { normalizeWalletAddress } from '@/lib/api/client';

const API_BASE = process.env.NEXT_PUBLIC_SBS_API_URL || '';

async function readErrorMessage(res: Response): Promise<string | null> {
  try {
    const data = (await res.json()) as Record<string, unknown>;
    if (typeof data.message === 'string') return data.message;
    if (typeof data.error === 'string') return data.error;
  } catch {
    // ignore JSON parsing errors
  }
  try {
    const text = await res.text();
    return text ? text : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  try {
    if (!API_BASE) {
      return jsonError('Missing NEXT_PUBLIC_SBS_API_URL', 500);
    }

    const body = await parseBody(req);
    const walletAddress = requireString(body.walletAddress, 'walletAddress');
    const displayName = requireString(body.displayName, 'displayName');
    const avatar =
      typeof body.avatar === 'string' && body.avatar.trim().length > 0 ? body.avatar.trim() : undefined;
    const onboardingComplete =
      typeof body.onboardingComplete === 'boolean' ? body.onboardingComplete : undefined;

    const payload = {
      walletAddress: normalizeWalletAddress(walletAddress),
      displayName,
      avatar,
      onboardingComplete,
    };

    const res = await fetch(`${API_BASE}/owner/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    if (!res.ok) {
      const message = await readErrorMessage(res);
      return jsonError(message || 'Owner create failed', res.status);
    }

    const data = (await res.json().catch(() => null)) ?? payload;
    return json(data, 201);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('Owner create failed:', err);
    return jsonError('Owner create failed', 500);
  }
}
