/**
 * Chat identity enrichment.
 *
 * Chat messages (global #general, draft-room, league) historically stored the
 * sender's username + profile picture *at send time*. That's brittle: if the
 * sender's profile hadn't loaded yet, or they had no picture, the message is
 * frozen forever showing a wallet fragment (e.g. "0xab12cd") and no avatar.
 *
 * Instead we resolve the *live* profile (name + picture) at READ time, using
 * the same authoritative resolver DMs and friends use (`getPublicUsers` →
 * Firestore v2_users, with a Go-API fallback for legacy wallets). So a message
 * always shows the sender's current profile name + banana avatar, never their
 * raw wallet address.
 *
 * Caching: chat GETs are polled every ~2s. To avoid hammering the Go API
 * fallback on every poll across every viewer, resolved profiles are cached in
 * memory for a short TTL. The cache is per server instance and intentionally
 * tiny — chat sender sets are small and turn over slowly.
 */

import { getPublicUsers, type PublicUser } from '@/lib/friends';

const TTL_MS = 60_000;

interface CacheEntry {
  user: PublicUser;
  expires: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Resolve live public profiles for a set of wallets, keyed by lowercased
 * wallet. Cache hits skip the lookup; misses are batch-resolved and cached.
 */
async function resolveProfiles(wallets: string[]): Promise<Map<string, PublicUser>> {
  const now = Date.now();
  const unique = Array.from(new Set(wallets.map((w) => w.toLowerCase()).filter(Boolean)));
  const out = new Map<string, PublicUser>();
  const missing: string[] = [];

  for (const w of unique) {
    const hit = cache.get(w);
    if (hit && hit.expires > now) {
      out.set(w, hit.user);
    } else {
      missing.push(w);
    }
  }

  if (missing.length > 0) {
    const fresh = await getPublicUsers(missing);
    for (const w of missing) {
      const user = fresh.get(w) ?? { walletAddress: w, username: w.slice(0, 8) };
      cache.set(w, { user, expires: now + TTL_MS });
      out.set(w, user);
    }
  }

  return out;
}

/**
 * Overlay live profile name + picture onto a list of chat messages. Each
 * message must carry a `walletAddress`; `username`/`pfpUrl` are replaced with
 * the live profile values (falling back to whatever the message already had,
 * then to a wallet slice — handled by getPublicUsers — as a last resort).
 */
export async function enrichChatIdentities<
  T extends { walletAddress: string; username?: string; pfpUrl?: string },
>(messages: T[]): Promise<T[]> {
  if (messages.length === 0) return messages;
  const profiles = await resolveProfiles(messages.map((m) => m.walletAddress));
  return messages.map((m) => {
    const p = profiles.get(m.walletAddress.toLowerCase());
    if (!p) return m;
    return {
      ...m,
      username: p.username || m.username || m.walletAddress.slice(0, 8),
      pfpUrl: p.profilePicture || m.pfpUrl,
    };
  });
}
