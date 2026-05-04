export const dynamic = 'force-dynamic';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { getPrivyUser } from '@/lib/auth';

const DIDIT_API_KEY = process.env.DIDIT_API_KEY || '';
const DIDIT_WORKFLOW_ID = process.env.DIDIT_WORKFLOW_ID || 'c49a0700-b18e-4a7f-aa55-06061fda42b5';
const DIDIT_BASE_URL = 'https://verification.didit.me';

export async function POST(req: Request) {
  try {
    const privyUser = await getPrivyUser(req);
    const body = await parseBody(req);

    const vendorData = privyUser.userId;
    const callback = typeof body.callback === 'string' ? body.callback : `${process.env.NEXT_PUBLIC_APP_URL || 'https://banana-fantasy-sbs.vercel.app'}/prizes`;

    const res = await fetch(`${DIDIT_BASE_URL}/v3/session/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': DIDIT_API_KEY,
      },
      body: JSON.stringify({
        workflow_id: DIDIT_WORKFLOW_ID,
        vendor_data: vendorData,
        callback,
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error('[Didit] Session creation failed:', res.status, errorText);
      return jsonError('Failed to create verification session', 500);
    }

    const data = await res.json();
    const sessionUrl = data?.url;
    const sessionId = data?.session_id;

    if (!sessionUrl) {
      return jsonError('Invalid Didit response', 500);
    }

    return json({ sessionUrl, sessionId }, 200);
  } catch (err) {
    console.error('[Didit] Error:', err);
    return jsonError(err instanceof Error ? err.message : 'Failed to create session', 500);
  }
}
