import { logger } from '@/lib/logger';

const CRISP_BASE = 'https://api.crisp.chat/v1';
const CRISP_WEBSITE_ID = 'ed386428-a6f2-435a-a3e1-043f0a078093';

export interface CrispConversation {
  session_id: string;
  website_id: string;
  nickname: string | null;
  email: string | null;
  phone: string | null;
  avatar: string | null;
  state: 'pending' | 'unresolved' | 'resolved';
  unread: { operator?: number; visitor?: number } | number;
  last_message: string | null;
  updated_at: number; // ms epoch
  created_at: number;
  waiting_since?: number;
  meta?: Record<string, unknown>;
}

export interface CrispCredentials {
  identifier: string;
  key: string;
}

export function getCrispCredentials(): CrispCredentials | null {
  const identifier = process.env.CRISP_IDENTIFIER?.trim();
  const key = process.env.CRISP_KEY?.trim();
  if (!identifier || !key) return null;
  return { identifier, key };
}

function authHeader(creds: CrispCredentials): string {
  return `Basic ${Buffer.from(`${creds.identifier}:${creds.key}`).toString('base64')}`;
}

export async function listConversations(opts: {
  page?: number;
  filterUnread?: boolean;
  filterResolved?: boolean;
} = {}): Promise<{ conversations: CrispConversation[]; configured: boolean; authFailed?: boolean }> {
  const creds = getCrispCredentials();
  if (!creds) {
    return { conversations: [], configured: false };
  }

  const page = opts.page ?? 1;
  const params = new URLSearchParams();
  if (opts.filterUnread) params.set('filter_unread', '1');
  if (opts.filterResolved === false) params.set('filter_resolved', '0');
  const url = `${CRISP_BASE}/website/${CRISP_WEBSITE_ID}/conversations/${page}${params.toString() ? `?${params}` : ''}`;

  // Tier can be overridden via env so you can switch between a User
  // Token (default — generated in Profile → Settings → User Tokens)
  // and a Plugin Token (Marketplace) without redeploying code.
  const tier = (process.env.CRISP_TIER ?? 'user').trim();

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: authHeader(creds),
        'X-Crisp-Tier': tier,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.error('crisp.list_conversations.http_error', { status: res.status, body: body.slice(0, 200), tier });
      // 401 invalid_session = the token was revoked/expired — surface it
      // loudly in the admin Support tab instead of a silent empty inbox.
      return { conversations: [], configured: true, authFailed: res.status === 401 };
    }
    const data = await res.json();
    const conversations = (data.data ?? []) as CrispConversation[];
    // Quiet diagnostic — surfaces in admin error log if zero results
    // come back so we can tell the difference between "API rejected"
    // and "API returned empty."
    if (conversations.length === 0) {
      logger.warn('crisp.list_conversations.empty', { tier, dataKeys: Object.keys(data || {}).join(',') });
    }
    return { conversations, configured: true };
  } catch (err) {
    logger.error('crisp.list_conversations.failed', { err });
    return { conversations: [], configured: true };
  }
}

/** Deep link to the Crisp dashboard for a specific conversation. */
export function crispConversationUrl(sessionId: string): string {
  return `https://app.crisp.chat/website/${CRISP_WEBSITE_ID}/inbox/${sessionId}/`;
}

/** Inbox landing in Crisp dashboard. */
export function crispInboxUrl(): string {
  return `https://app.crisp.chat/website/${CRISP_WEBSITE_ID}/inbox/`;
}

/**
 * Conversation meta — nickname + the session data map we stamp from the
 * widget (wallet, userId). Used by the webhook to route "team replied"
 * bell notis to the right wallet.
 */
export async function getConversationMeta(sessionId: string): Promise<{ nickname: string | null; data: Record<string, string> } | null> {
  const creds = getCrispCredentials();
  if (!creds) return null;
  const tier = (process.env.CRISP_TIER ?? 'user').trim();
  try {
    const res = await fetch(`${CRISP_BASE}/website/${CRISP_WEBSITE_ID}/conversation/${encodeURIComponent(sessionId)}/meta`, {
      headers: { Authorization: authHeader(creds), 'X-Crisp-Tier': tier },
    });
    if (!res.ok) {
      logger.warn('crisp.conversation_meta.http_error', { status: res.status });
      return null;
    }
    const body = await res.json();
    const meta = (body?.data ?? {}) as { nickname?: string; data?: Record<string, string> };
    return { nickname: meta.nickname ?? null, data: meta.data ?? {} };
  } catch (err) {
    logger.warn('crisp.conversation_meta.failed', { err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
