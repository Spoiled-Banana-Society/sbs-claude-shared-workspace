// Shared admin-only Crisp support helpers. SINGLE source of truth for the
// "needs reply" signal so the Support list (app/api/admin/support) and the
// sidebar badge counter (app/api/admin/notification-counts) can never diverge.
//
// Why not Crisp's own unread counter: `unread.operator` is keyed to the API
// token's operator identity, not the human who reads/replies in the Crisp
// dashboard — so it never clears for us and the badge sticks. Instead we use
// OUR webhook log (crisp_webhook_events, written by /api/crisp/webhook) to know
// who spoke last: user spoke last → still needs our reply.

import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { crispConversationUrl, type CrispConversation } from '@/lib/crispApi';

export interface LastMessageRec {
  from: string | null;       // 'user' | 'operator'
  nickname: string | null;
}

/** sessionId -> latest webhook event {from, nickname}. One Firestore read. */
export async function lastMessageBySession(): Promise<Map<string, LastMessageRec>> {
  const map = new Map<string, LastMessageRec>();
  try {
    const db = getAdminFirestore();
    // Newest first; the first time we see a sessionId is its latest event.
    const snap = await db.collection('crisp_webhook_events').orderBy('at', 'desc').limit(500).get();
    for (const doc of snap.docs) {
      const d = doc.data();
      const sid = typeof d.sessionId === 'string' ? d.sessionId : '';
      if (!sid || map.has(sid)) continue;
      map.set(sid, {
        from: typeof d.from === 'string' ? d.from : null,
        nickname: typeof d.nickname === 'string' && d.nickname ? d.nickname : null,
      });
    }
  } catch {
    // Non-fatal — callers fall back to Crisp's unread counter.
  }
  return map;
}

function unreadOperatorCount(u: CrispConversation['unread']): number {
  if (typeof u === 'number') return u;
  return u?.operator ?? 0;
}

/**
 * Does this conversation still need our reply? Ground truth = the user spoke
 * last (from our webhook log). When we have no record for the conversation
 * (e.g. older than the log), fall back to Crisp's unread counter so behaviour
 * is never worse than before.
 */
export function conversationNeedsReply(c: CrispConversation, rec: LastMessageRec | undefined): boolean {
  return rec?.from ? rec.from === 'user' : unreadOperatorCount(c.unread) > 0;
}

/** Enrich a conversation with the resolved display name + needsReply flag. */
export function enrichSupportConversation(c: CrispConversation, rec: LastMessageRec | undefined) {
  return {
    ...c,
    url: crispConversationUrl(c.session_id),
    displayName: c.nickname || c.email || rec?.nickname || 'Anonymous',
    needsReply: conversationNeedsReply(c, rec),
  };
}
