/**
 * Direct messages.
 *
 * Schema (Firestore + RTDB hybrid):
 *
 *   Firestore:
 *     dm_threads/{threadId}
 *       participants: [walletA, walletB]   // sorted lowercase
 *       status: 'pending' | 'accepted'     // pending = recipient hasn't approved yet
 *       startedBy: string                  // wallet that sent the first message
 *       startedAt: number
 *       lastMessageAt: number
 *       lastMessagePreview: string         // first 80 chars, for inbox preview
 *       lastReadAt: {                      // per-participant cursor for unread counts
 *         [walletA]: number,
 *         [walletB]: number,
 *       }
 *
 *   RTDB:
 *     dm_messages/{threadId}/{messageId}
 *       walletAddress: string
 *       text: string
 *       timestamp: number
 *
 * Why hybrid: Firestore for the thread metadata + queries ("my threads"), RTDB
 * for the message firehose (fast appends, simple pagination). Mirrors the way
 * global chat & draft chat already work.
 *
 * Permissions:
 * - Anyone can SEND the first message to anyone — creates a thread with
 *   status='pending' from the sender's side.
 * - The recipient sees the thread under "Message Requests" and cannot REPLY
 *   until they approve. Approval flips status to 'accepted'.
 * - If the sender and recipient are friends, the thread is auto-accepted on
 *   creation (no request approval needed).
 * - Once accepted, both sides can send freely.
 */

import { getAdminDatabase, getAdminFirestore } from '@/lib/firebaseAdmin';
import { friendshipId, getFriendship } from '@/lib/friends';

const THREADS_COLLECTION = 'dm_threads';
const HISTORY_LIMIT = 200;
const PREVIEW_MAX = 80;

export type DmThreadStatus = 'pending' | 'accepted';

export interface DmThread {
  id: string;
  participants: [string, string];
  status: DmThreadStatus;
  startedBy: string;
  startedAt: number;
  lastMessageAt: number;
  lastMessagePreview: string;
  lastReadAt: Record<string, number>;
}

export interface DmMessage {
  id: string;
  walletAddress: string;
  text: string;
  timestamp: number;
}

export function threadId(walletA: string, walletB: string): string {
  const a = walletA.toLowerCase();
  const b = walletB.toLowerCase();
  return a < b ? `${a}__${b}` : `${b}__${a}`;
}

function threadDocRef(walletA: string, walletB: string) {
  return getAdminFirestore().collection(THREADS_COLLECTION).doc(threadId(walletA, walletB));
}

function messagesRef(tid: string) {
  return getAdminDatabase().ref(`/dm_messages/${tid}`);
}

// ─── Threads ────────────────────────────────────────────────────────────────

export async function getThread(walletA: string, walletB: string): Promise<DmThread | null> {
  const snap = await threadDocRef(walletA, walletB).get();
  if (!snap.exists) return null;
  const d = snap.data() as Partial<DmThread> | undefined;
  if (!d || !Array.isArray(d.participants) || d.participants.length !== 2) return null;
  return normalizeThread(snap.id, d);
}

function normalizeThread(id: string, d: Partial<DmThread>): DmThread {
  return {
    id,
    participants: [d.participants![0], d.participants![1]] as [string, string],
    status: d.status === 'accepted' ? 'accepted' : 'pending',
    startedBy: String(d.startedBy ?? ''),
    startedAt: typeof d.startedAt === 'number' ? d.startedAt : 0,
    lastMessageAt: typeof d.lastMessageAt === 'number' ? d.lastMessageAt : 0,
    lastMessagePreview: typeof d.lastMessagePreview === 'string' ? d.lastMessagePreview : '',
    lastReadAt: typeof d.lastReadAt === 'object' && d.lastReadAt !== null ? d.lastReadAt as Record<string, number> : {},
  };
}

export async function listThreadsForUser(walletAddress: string): Promise<DmThread[]> {
  const wallet = walletAddress.toLowerCase();
  const snap = await getAdminFirestore()
    .collection(THREADS_COLLECTION)
    .where('participants', 'array-contains', wallet)
    .get();
  const out: DmThread[] = [];
  snap.forEach((doc) => {
    const d = doc.data() as Partial<DmThread>;
    if (!Array.isArray(d.participants) || d.participants.length !== 2) return;
    out.push(normalizeThread(doc.id, d));
  });
  // Sort by lastMessageAt desc
  out.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  return out;
}

/**
 * Approve a pending thread (recipient action). Idempotent.
 */
export async function acceptThread(approverWallet: string, otherWallet: string): Promise<DmThread | null> {
  const approver = approverWallet.toLowerCase();
  const ref = threadDocRef(approver, otherWallet);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const d = snap.data() as Partial<DmThread>;
  if (d.status === 'accepted') return normalizeThread(snap.id, d);
  // Only the recipient (not the originator) can accept.
  if (d.startedBy === approver) throw new Error('only the recipient can accept');
  await ref.update({ status: 'accepted' });
  return getThread(approver, otherWallet);
}

/**
 * Mark a thread as read by `walletAddress` up to `Date.now()`. Used to clear
 * the unread badge once the user opens the thread.
 */
export async function markThreadRead(walletAddress: string, otherWallet: string): Promise<void> {
  const wallet = walletAddress.toLowerCase();
  const ref = threadDocRef(walletAddress, otherWallet);
  await ref.set({
    lastReadAt: { [wallet]: Date.now() },
  }, { merge: true });
}

// ─── Messages ───────────────────────────────────────────────────────────────

export async function listMessages(tid: string): Promise<DmMessage[]> {
  const snap = await messagesRef(tid).limitToLast(HISTORY_LIMIT).once('value');
  const out: DmMessage[] = [];
  snap.forEach((child) => {
    const v = child.val() as Partial<DmMessage> | null;
    if (v && typeof v.text === 'string' && typeof v.walletAddress === 'string') {
      out.push({
        id: child.key || `${v.timestamp ?? Date.now()}`,
        walletAddress: v.walletAddress,
        text: v.text,
        timestamp: typeof v.timestamp === 'number' ? v.timestamp : Date.now(),
      });
    }
  });
  return out;
}

/**
 * Send a message. Handles three cases:
 *  1. New thread, sender + recipient are friends → create thread as 'accepted'.
 *  2. New thread, not friends → create thread as 'pending'.
 *  3. Existing thread, pending, sender is the ORIGINATOR → reject (originator
 *     can't keep messaging until recipient accepts).
 *  4. Existing thread, pending, sender is the RECIPIENT → first reply implies
 *     acceptance — flip to 'accepted' and write the message.
 *  5. Existing thread, accepted → just write.
 */
export async function sendMessage(input: {
  senderWallet: string;
  recipientWallet: string;
  text: string;
}): Promise<{ thread: DmThread; message: DmMessage }> {
  const sender = input.senderWallet.toLowerCase();
  const recipient = input.recipientWallet.toLowerCase();
  if (sender === recipient) throw new Error('cannot DM self');
  if (!input.text.trim()) throw new Error('empty text');

  const tid = threadId(sender, recipient);
  const ref = getAdminFirestore().collection(THREADS_COLLECTION).doc(tid);
  const existing = await ref.get();

  const now = Date.now();
  const preview = input.text.trim().slice(0, PREVIEW_MAX);

  if (!existing.exists) {
    // Check if they're friends → auto-accept.
    const friendship = await getFriendship(sender, recipient);
    const status: DmThreadStatus = friendship?.status === 'accepted' ? 'accepted' : 'pending';
    const participants = sender < recipient ? [sender, recipient] : [recipient, sender];
    await ref.set({
      participants,
      status,
      startedBy: sender,
      startedAt: now,
      lastMessageAt: now,
      lastMessagePreview: preview,
      lastReadAt: { [sender]: now },
    });
  } else {
    const d = existing.data() as Partial<DmThread>;
    if (d.status === 'pending' && d.startedBy === sender) {
      // Sender already opened a pending thread — they can't pile on more
      // messages until the recipient accepts. Mirrors Discord's "Message
      // request limited to 1 message" behavior.
      throw new Error('message request already pending');
    }
    if (d.status === 'pending' && d.startedBy !== sender) {
      // Recipient replying = implicit accept.
      await ref.update({
        status: 'accepted',
        lastMessageAt: now,
        lastMessagePreview: preview,
        [`lastReadAt.${sender}`]: now,
      });
    } else {
      // Accepted — straight write.
      await ref.update({
        lastMessageAt: now,
        lastMessagePreview: preview,
        [`lastReadAt.${sender}`]: now,
      });
    }
  }

  const msgRef = await messagesRef(tid).push({
    walletAddress: sender,
    text: input.text.trim(),
    timestamp: now,
  });

  const finalThread = (await getThread(sender, recipient))!;
  const message: DmMessage = {
    id: msgRef.key || '',
    walletAddress: sender,
    text: input.text.trim(),
    timestamp: now,
  };
  return { thread: finalThread, message };
}

// ─── Permission helper ──────────────────────────────────────────────────────

/**
 * Return what `walletAddress` is allowed to do in a thread with `otherWallet`:
 *   - 'send'     → either accepted, or no thread yet AND they're friends
 *   - 'request'  → no thread yet, not friends — first message goes to inbox
 *   - 'wait'     → they sent a pending request; can't send more until accepted
 *   - 'reply'    → they received a pending request; reply implicitly accepts
 */
export async function permissionFor(walletAddress: string, otherWallet: string): Promise<'send' | 'request' | 'wait' | 'reply'> {
  const wallet = walletAddress.toLowerCase();
  const thread = await getThread(walletAddress, otherWallet);
  if (thread) {
    if (thread.status === 'accepted') return 'send';
    if (thread.startedBy === wallet) return 'wait';
    return 'reply';
  }
  const fid = friendshipId(walletAddress, otherWallet);
  const friendshipSnap = await getAdminFirestore().collection('friendships').doc(fid).get();
  if (friendshipSnap.exists) {
    const fd = friendshipSnap.data() as { status?: string } | undefined;
    if (fd?.status === 'accepted') return 'send';
  }
  return 'request';
}
