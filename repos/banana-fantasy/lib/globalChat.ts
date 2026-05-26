/**
 * Global chat — Discord-style #general room.
 *
 * Storage:
 *  - Messages in RTDB at /global-chat/messages (same pattern as draft chat,
 *    so the existing Admin SDK proxy approach works without Firebase Auth).
 *  - Mutes in Firestore at chat_mutes/{walletLower} → { expiresAt, mutedBy, mutedAt }.
 *
 * Mutes are checked on every POST. Both the client and the server enforce the
 * check — the client refuses to render the input, the server refuses to accept
 * the write. A muted user who hand-crafts a POST gets a 403.
 */

import { getAdminDatabase, getAdminFirestore } from '@/lib/firebaseAdmin';

const MUTES_COLLECTION = 'chat_mutes';
const HISTORY_LIMIT = 200;

export interface GlobalChatMessage {
  id: string;
  walletAddress: string;
  username: string;
  pfpUrl?: string;
  text: string;
  timestamp: number;
}

export interface ChatMute {
  walletAddress: string;
  expiresAt: number;        // epoch ms — 0 means never (permanent)
  mutedBy: string;          // admin wallet
  mutedAt: number;
  reason?: string;
}

function messagesRef() {
  return getAdminDatabase().ref('/global-chat/messages');
}

function muteDocRef(walletAddress: string) {
  return getAdminFirestore().collection(MUTES_COLLECTION).doc(walletAddress.toLowerCase());
}

// ─── Reads ─────────────────────────────────────────────────────────────────

export async function listMessages(): Promise<GlobalChatMessage[]> {
  const snap = await messagesRef().limitToLast(HISTORY_LIMIT).once('value');
  const out: GlobalChatMessage[] = [];
  snap.forEach((child) => {
    const v = child.val() as Partial<GlobalChatMessage> | null;
    if (v && typeof v.text === 'string' && typeof v.walletAddress === 'string') {
      out.push({
        id: child.key || `${v.timestamp ?? Date.now()}`,
        walletAddress: v.walletAddress,
        username: typeof v.username === 'string' ? v.username : v.walletAddress,
        pfpUrl: typeof v.pfpUrl === 'string' ? v.pfpUrl : undefined,
        text: v.text,
        timestamp: typeof v.timestamp === 'number' ? v.timestamp : Date.now(),
      });
    }
  });
  return out;
}

/**
 * Returns the active mute for a wallet, or null if not muted. A mute with
 * expiresAt in the past is treated as inactive — we don't auto-delete the doc
 * here (cheap to leave; reads are O(1)).
 */
export async function getActiveMute(walletAddress: string): Promise<ChatMute | null> {
  const snap = await muteDocRef(walletAddress).get();
  if (!snap.exists) return null;
  const data = snap.data() as Partial<ChatMute> | undefined;
  if (!data) return null;
  const expiresAt = typeof data.expiresAt === 'number' ? data.expiresAt : 0;
  // expiresAt === 0 means permanent, > 0 with past timestamp means expired.
  if (expiresAt !== 0 && expiresAt < Date.now()) return null;
  return {
    walletAddress: walletAddress.toLowerCase(),
    expiresAt,
    mutedBy: String(data.mutedBy ?? ''),
    mutedAt: typeof data.mutedAt === 'number' ? data.mutedAt : 0,
    reason: typeof data.reason === 'string' ? data.reason : undefined,
  };
}

// ─── Writes ────────────────────────────────────────────────────────────────

export async function postMessage(input: {
  walletAddress: string;
  username: string;
  pfpUrl?: string;
  text: string;
}): Promise<{ id: string }> {
  const ref = await messagesRef().push({
    walletAddress: input.walletAddress.toLowerCase(),
    username: input.username,
    pfpUrl: input.pfpUrl || '',
    text: input.text,
    timestamp: Date.now(),
  });
  return { id: ref.key || '' };
}

export async function deleteMessage(messageId: string): Promise<void> {
  await messagesRef().child(messageId).remove();
}

/**
 * Delete every message from a wallet whose timestamp is within the last
 * `lookbackMs` milliseconds. Used by admin "delete recent messages from user"
 * action — mirrors Discord's "delete last X hours of messages" option.
 *
 * lookbackMs === 0 means delete ALL messages from this user (no time bound).
 *
 * Returns the count deleted.
 */
export async function deleteRecentMessagesFromUser(walletAddress: string, lookbackMs: number): Promise<number> {
  const wallet = walletAddress.toLowerCase();
  const cutoff = lookbackMs > 0 ? Date.now() - lookbackMs : 0;
  const snap = await messagesRef().once('value');
  const toDelete: string[] = [];
  snap.forEach((child) => {
    const v = child.val() as Partial<GlobalChatMessage> | null;
    if (!v || typeof v.walletAddress !== 'string') return;
    if (v.walletAddress.toLowerCase() !== wallet) return;
    const ts = typeof v.timestamp === 'number' ? v.timestamp : 0;
    if (cutoff > 0 && ts < cutoff) return;
    if (child.key) toDelete.push(child.key);
  });
  // Batch delete in one multi-path update.
  if (toDelete.length > 0) {
    const updates: Record<string, null> = {};
    for (const id of toDelete) updates[id] = null;
    await messagesRef().update(updates);
  }
  return toDelete.length;
}

// ─── Mutes ─────────────────────────────────────────────────────────────────

/**
 * Set a mute. durationMs === 0 means permanent.
 */
export async function setMute(input: {
  targetWallet: string;
  durationMs: number;
  mutedBy: string;
  reason?: string;
}): Promise<ChatMute> {
  const now = Date.now();
  const mute: ChatMute = {
    walletAddress: input.targetWallet.toLowerCase(),
    expiresAt: input.durationMs > 0 ? now + input.durationMs : 0,
    mutedBy: input.mutedBy.toLowerCase(),
    mutedAt: now,
    reason: input.reason,
  };
  await muteDocRef(input.targetWallet).set({
    expiresAt: mute.expiresAt,
    mutedBy: mute.mutedBy,
    mutedAt: mute.mutedAt,
    ...(mute.reason ? { reason: mute.reason } : {}),
  } as Partial<ChatMute> & { expiresAt: number; mutedBy: string; mutedAt: number; reason?: string });
  return mute;
}

export async function clearMute(walletAddress: string): Promise<void> {
  await muteDocRef(walletAddress).delete();
}

// ─── Audit ─────────────────────────────────────────────────────────────────

/**
 * Log an admin moderation action. Best-effort — failures don't block the
 * primary action since the moderation itself is the source of truth.
 */
export async function logModerationAction(input: {
  action: 'mute' | 'unmute' | 'delete_message' | 'delete_recent';
  adminWallet: string;
  targetWallet?: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    await getAdminFirestore().collection('admin_audit').add({
      type: `chat.${input.action}`,
      adminWallet: input.adminWallet.toLowerCase(),
      targetWallet: input.targetWallet?.toLowerCase(),
      meta: input.meta || {},
      timestamp: Date.now(),
    });
  } catch (err) {
    console.warn('[globalChat] audit log failed:', err);
  }
}

// ─── Duration presets ──────────────────────────────────────────────────────

/**
 * Mute durations exactly matching Discord's Timeout dropdown.
 * Values in milliseconds. 0 = permanent (not in Discord's list; admin-only escape).
 */
export const MUTE_DURATIONS: { label: string; ms: number }[] = [
  { label: '60 seconds', ms: 60 * 1000 },
  { label: '5 minutes', ms: 5 * 60 * 1000 },
  { label: '10 minutes', ms: 10 * 60 * 1000 },
  { label: '1 hour', ms: 60 * 60 * 1000 },
  { label: '1 day', ms: 24 * 60 * 60 * 1000 },
  { label: '1 week', ms: 7 * 24 * 60 * 60 * 1000 },
];

/**
 * Bulk-delete lookback windows matching Discord's "Delete Messages" dropdown
 * on Ban/Kick. `ms === 0` means "All messages from this user".
 */
export const DELETE_LOOKBACK_OPTIONS: { label: string; ms: number }[] = [
  { label: 'None', ms: -1 }, // sentinel — caller should skip if -1
  { label: 'Previous hour', ms: 60 * 60 * 1000 },
  { label: 'Previous 6 hours', ms: 6 * 60 * 60 * 1000 },
  { label: 'Previous 12 hours', ms: 12 * 60 * 60 * 1000 },
  { label: 'Previous 24 hours', ms: 24 * 60 * 60 * 1000 },
  { label: 'Previous 3 days', ms: 3 * 24 * 60 * 60 * 1000 },
  { label: 'Previous 7 days', ms: 7 * 24 * 60 * 60 * 1000 },
];

