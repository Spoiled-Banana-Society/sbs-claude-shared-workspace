import { createHash, timingSafeEqual } from 'node:crypto';
import { ApiError } from '@/lib/api/errors';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import type { PrivateLeagueConfigDoc } from '@/lib/privateLeagueAdmin';

/**
 * Partner (commissioner-site) auth for a private league's automation
 * endpoints — ticket-3338: KFFL sells its entries on dgendao.com and wants
 * each sale to grant an entry on our side without a human clicking +1.
 *
 * One API key per league, stored ONLY as sha256 hex in the league config
 * (`ApiKeyHash`); the plaintext is generated once by
 * scripts/set-private-league-api-key.mjs and handed to the commissioner.
 * The key is SERVER-TO-SERVER: it must never ship in browser code (anyone
 * with it can grant entries to that one league — nothing else).
 *
 * Scope: a key unlocks exactly ONE league id — the config doc it lives in.
 */

const LEAGUE_ID_RE = /^[a-z0-9-]{2,30}$/;
const WALLET_RE = /^0x[0-9a-f]{40}$/;

export interface PartnerCtx {
  leagueId: string;
  cfg: PrivateLeagueConfigDoc & { ApiKeyHash?: string; Name?: string };
  cfgRef: FirebaseFirestore.DocumentReference;
}

function bearerOf(req: Request): string {
  const auth = req.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  return (req.headers.get('x-api-key') || '').trim();
}

export async function requirePartnerKey(req: Request, rawLeagueId: string): Promise<PartnerCtx> {
  const leagueId = String(rawLeagueId || '').toLowerCase();
  if (!LEAGUE_ID_RE.test(leagueId)) throw new ApiError(400, 'Bad league id');
  const presented = bearerOf(req);
  if (!presented || presented.length < 16 || presented.length > 200) throw new ApiError(401, 'Missing API key');

  const db = getAdminFirestore();
  const cfgRef = db.collection('private_leagues').doc(leagueId);
  const snap = await cfgRef.get();
  if (!snap.exists) throw new ApiError(404, 'League not found');
  const cfg = (snap.data() ?? {}) as PartnerCtx['cfg'];
  const stored = String(cfg.ApiKeyHash || '');
  if (!stored) throw new ApiError(403, 'API access is not enabled for this league');

  const presentedHash = createHash('sha256').update(presented).digest('hex');
  const a = Buffer.from(presentedHash, 'hex');
  const b = Buffer.from(stored, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ApiError(403, 'Invalid API key');

  return { leagueId, cfg, cfgRef };
}

export interface ResolvedMember {
  wallet: string;
  /** Canonical SBS username, or null if the account has none yet. */
  username: string | null;
  matchedBy: 'username' | 'wallet';
}

/**
 * SBS username → account. Exact match on the lowercase username (the same
 * uniqueness key the site enforces), so "DGENDAO" and "dgendao" both hit —
 * but a typo never silently lands on the wrong account.
 */
export async function resolveMemberByUsername(rawUsername: string): Promise<ResolvedMember | null> {
  const name = String(rawUsername || '').trim();
  if (name.length < 2 || name.length > 40) return null;
  const db = getAdminFirestore();
  const q = await db.collection('v2_users').where('username_lower', '==', name.toLowerCase()).limit(1).get();
  if (q.empty) return null;
  const doc = q.docs[0];
  const data = doc.data() as { walletAddress?: string; username?: string };
  const wallet = String(data.walletAddress || doc.id).toLowerCase();
  if (!WALLET_RE.test(wallet)) return null;
  return { wallet, username: data.username ? String(data.username) : name, matchedBy: 'username' };
}

/**
 * Wallet → account. Only counts if that wallet IS an SBS account (a v2_users
 * doc exists) — a random address that has never logged in gets null, since
 * granting entries to it would strand them.
 */
export async function resolveMemberByWallet(rawWallet: string): Promise<ResolvedMember | null> {
  const wallet = String(rawWallet || '').trim().toLowerCase();
  if (!WALLET_RE.test(wallet)) return null;
  const db = getAdminFirestore();
  const snap = await db.collection('v2_users').doc(wallet).get();
  if (!snap.exists) return null;
  const data = snap.data() as { username?: string };
  return { wallet, username: data.username ? String(data.username) : null, matchedBy: 'wallet' };
}

/**
 * Username first, wallet as the fallback. If BOTH are given and they point at
 * different accounts, that's a mismatch worth surfacing rather than guessing.
 */
export async function resolveMember(input: { username?: unknown; wallet?: unknown }): Promise<
  | { ok: true; member: ResolvedMember }
  | { ok: false; reason: 'not_found' | 'mismatch' | 'missing'; detail: string }
> {
  const username = typeof input.username === 'string' ? input.username.trim() : '';
  const wallet = typeof input.wallet === 'string' ? input.wallet.trim().toLowerCase() : '';
  if (!username && !wallet) return { ok: false, reason: 'missing', detail: 'Provide username or wallet' };

  const byName = username ? await resolveMemberByUsername(username) : null;
  const byWallet = wallet ? await resolveMemberByWallet(wallet) : null;

  if (byName && byWallet && byName.wallet !== byWallet.wallet) {
    return {
      ok: false,
      reason: 'mismatch',
      detail: `Username "${byName.username}" and wallet ${wallet} are different SBS accounts`,
    };
  }
  if (byName) return { ok: true, member: byName };
  if (byWallet) return { ok: true, member: byWallet };
  const what = username ? `username "${username}"` : `wallet ${wallet}`;
  return { ok: false, reason: 'not_found', detail: `No SBS account for ${what}` };
}
