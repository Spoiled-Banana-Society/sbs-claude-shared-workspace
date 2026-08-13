import { ApiError } from '@/lib/api/errors';
import { getPrivyUser } from '@/lib/auth';
import { requireAdmin } from '@/lib/adminAuth';
import { fetchPrivyUser, linkedWalletsOf } from '@/lib/privyServer';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

/**
 * Commissioner auth for the private-league admin surface (ticket-3338).
 *
 * A commissioner (e.g. KFFL's) gets access to EXACTLY ONE league's roster +
 * entry bumps: the league whose config doc lists one of their wallets in
 * AdminWallets. They are NOT site admins — the endpoints gated by this helper
 * must never return anything beyond that league's own drafts/members.
 *
 * SBS site admins (Richard/Boris, via the normal requireAdmin gate including
 * its DID allowlist) always pass, so the team can review a league's admin view
 * before its commissioner is granted access.
 */

export interface PrivateLeagueConfigDoc {
  Name?: string;
  DraftType?: string;
  CurrentDraftId?: string;
  DefaultEntries?: number;
  Entries?: Record<string, number>;
  AdminWallets?: string[];
}

export interface PrivateLeagueAdminCtx {
  leagueId: string;
  actorWallet: string;
  siteAdmin: boolean;
  cfg: PrivateLeagueConfigDoc;
  cfgRef: FirebaseFirestore.DocumentReference;
}

const LEAGUE_ID_RE = /^[a-z0-9-]{2,30}$/;

export function allowedEntriesFor(cfg: PrivateLeagueConfigDoc, wallet: string): number {
  const w = wallet.toLowerCase();
  const explicit = cfg.Entries?.[w];
  if (typeof explicit === 'number') return explicit; // explicit 0 = blocked
  return cfg.DefaultEntries && cfg.DefaultEntries > 0 ? cfg.DefaultEntries : 1;
}

export async function requirePrivateLeagueAdmin(
  req: Request,
  rawLeagueId: string,
): Promise<PrivateLeagueAdminCtx> {
  const leagueId = String(rawLeagueId || '').toLowerCase();
  if (!LEAGUE_ID_RE.test(leagueId)) throw new ApiError(400, 'Bad league id');

  const db = getAdminFirestore();
  const cfgRef = db.collection('private_leagues').doc(leagueId);
  const snap = await cfgRef.get();
  if (!snap.exists) throw new ApiError(404, 'League not found');
  const cfg = (snap.data() ?? {}) as PrivateLeagueConfigDoc;

  const adminList = (cfg.AdminWallets ?? []).map((w) => w.trim().toLowerCase()).filter(Boolean);

  // Commissioner path: any of the caller's verified wallets on the league's
  // AdminWallets list. JWT wallet first (free); Privy User API only if needed
  // (embedded-wallet logins often carry no wallet claim in the JWT).
  const user = await getPrivyUser(req);
  const wallets = new Set<string>();
  if (user.walletAddress) wallets.add(user.walletAddress.toLowerCase());
  if (adminList.length > 0 && ![...wallets].some((w) => adminList.includes(w))) {
    const privyUser = await fetchPrivyUser(user.userId);
    if (privyUser) for (const w of linkedWalletsOf(privyUser)) wallets.add(w);
  }
  const commissionerWallet = [...wallets].find((w) => adminList.includes(w));
  if (commissionerWallet) {
    return { leagueId, actorWallet: commissionerWallet, siteAdmin: false, cfg, cfgRef };
  }

  // Site-admin fallback — full requireAdmin gate (wallet allowlist + DID
  // allowlist). Throws ApiError(403) when the caller is neither.
  const admin = await requireAdmin(req);
  return {
    leagueId,
    actorWallet: (admin.walletAddress ?? admin.userId).toLowerCase(),
    siteAdmin: true,
    cfg,
    cfgRef,
  };
}
