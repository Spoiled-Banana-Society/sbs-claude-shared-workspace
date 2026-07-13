import { logger } from '@/lib/logger';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { getAdminBellWallets } from '@/lib/adminAllowlist';
import { createNotification } from '@/lib/queueNotifications';
import { LAUNCH_ISO } from '@/lib/sbsDay';

/**
 * Instant email alerts to the SBS team for operational events worth a
 * pocket buzz (first use: a NEW user taking a seat in a filling draft —
 * Boris 2026-07-03 "text us if a new user is in a lobby; if not text,
 * email"). SMS isn't wired anywhere in the stack (no Twilio account), so
 * email via the already-configured Resend is the instant channel.
 *
 * Recipients: ADMIN_ALERT_EMAILS env (comma-separated) when set — edit in
 * the Vercel dashboard, NOT via CLI automation (it saves empty values) —
 * otherwise the in-code team list below (same pattern as adminAllowlist).
 */

// Boris + Richard ONLY (Boris 2026-07-03: "we only want it to the two
// emails we give you").
const DEFAULT_ADMIN_ALERT_EMAILS = [
  'iamvagnerboris@gmail.com',
  'richardvagnermusic@gmail.com',
];

export function getAdminAlertEmails(): string[] {
  const raw = process.env.ADMIN_ALERT_EMAILS || '';
  const fromEnv = raw.split(',').map((s) => s.trim()).filter((s) => s.includes('@'));
  return fromEnv.length > 0 ? fromEnv : [...DEFAULT_ADMIN_ALERT_EMAILS];
}

/**
 * Send a short alert email to every admin. Best-effort: never throws into
 * the caller's path; skips silently when Resend isn't configured.
 */
export async function sendAdminAlertEmail(subject: string, line: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return;
  const to = getAdminAlertEmails();
  if (to.length === 0) return;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from,
        to,
        subject,
        text: line,
        html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:8px 0"><p style="font-size:16px;font-weight:600;line-height:1.5;color:#111;margin:0">${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p></div>`,
      }),
    });
    if (!res.ok) {
      logger.warn('admin_alert_email.failed', { status: res.status, body: await res.text().catch(() => '') });
    }
  } catch (err) {
    logger.warn('admin_alert_email.error', { err });
  }
}

/**
 * Admin-only heads-up when a genuinely NEW user (first-season account, not a
 * returning player, not admin-comped) JOINS or LEAVES a filling draft. Same
 * gate + fan-out for both events so the two never drift (Boris 2026-07-03
 * "bell if a new user is in a lobby"; 2026-07-05 "also ping if they leave").
 * Fire-and-forget: never throws into the caller's request path.
 *
 * `action`: 'joined' (seat taken via use-pass) or 'left' (leave via refund-pass).
 * `speed`: explicit fast/slow from the client (join — the leagueId isn't known
 * yet), else derived from `leagueId` (leave — leagueId IS the "…-fast-…"/"…-slow-…"
 * draft id). The dedupeKey is UNIQUE PER EVENT (the event time is appended), so
 * EVERY join and EVERY leave pings — a new user joining/leaving the SAME draft 5
 * times sends 5 bells + 5 emails (Boris 2026-07-07: "tell me every time, 100%").
 * The old per-user+draft+action key suppressed every re-entry after the first,
 * which is why pings went missing. Delivery is via runInBackground (waitUntil)
 * at the call sites so a lambda freeze can't drop the bell/email either.
 */
export async function alertAdminsNewUserDraftEvent(opts: {
  userId: string;
  action: 'joined' | 'left';
  speed?: 'fast' | 'slow' | null;
  leagueId?: string | null;
}): Promise<void> {
  const { userId, action } = opts;
  const speed = opts.speed ?? null;
  const leagueId = opts.leagueId ?? null;
  try {
    const db = getAdminFirestore();
    const userRef = db.collection('v2_users').doc(userId);
    const u = (await userRef.get()).data() as
      | { createdAt?: string; isReturningPlayer?: boolean; username?: string; bananaNumber?: number }
      | undefined;
    // SAME returning rule as the admin NEW/OLD chips: the doc flag OR the
    // past-season wallet snapshot (flag-only missed OLD-via-snapshot users).
    const { isReturningWalletSync } = await import('@/lib/returningUsers');
    const isReturning = u?.isReturningPlayer === true || isReturningWalletSync(userId);
    const isNew = !!u && typeof u.createdAt === 'string'
      && u.createdAt >= LAUNCH_ISO && !isReturning;
    if (!isNew) return;
    // Comped accounts don't count: if ANY pass was ever admin-granted to this
    // wallet, they're someone we invited — skip both bell and email.
    const granted = await db.collection('pass_origin')
      .where('ownerAtMint', '==', userId)
      .where('origin', '==', 'admin_grant')
      .limit(1).get();
    if (!granted.empty) return;
    const admins = getAdminBellWallets();
    if (admins.length === 0) return;

    // ALWAYS show the name Boris knows them by (Boris 2026-07-05: "it never
    // said the username's name"). Resolve to: their real chosen username →
    // else the server-assigned "Banana#####" default handle they actually
    // display as → and only fall back to a short wallet if neither exists.
    // Never surfaces the raw "User-0x…" placeholder or a bare wallet when a
    // real handle is available.
    const raw = (u?.username || '').trim();
    const realUsername = raw && !/^user-0x/i.test(raw) && !/^0x[0-9a-f]{6,}/i.test(raw) ? raw : null;
    const name = realUsername
      ?? (typeof u?.bananaNumber === 'number' ? `Banana${u.bananaNumber}` : `${userId.slice(0, 6)}…${userId.slice(-4)}`);
    const speedLabel = speed === 'slow' ? 'SLOW draft'
      : speed === 'fast' ? 'FAST draft'
      : leagueId?.includes('-slow-') ? 'SLOW draft'
      : leagueId?.includes('-fast-') ? 'FAST draft'
      : 'draft';
    const joined = action === 'joined';
    const suffix = leagueId ? ` (${leagueId})` : '';
    // Both events are pre-fill by definition (the alert only fires for a
    // filling lobby, and you can't leave once it's filled) — state it plainly.
    const title = joined
      ? `${name} joined a filling ${speedLabel}`
      : `${name} LEFT a ${speedLabel} before it filled`;
    const message = joined
      ? `${name} — a NEW account — just took a seat in a filling ${speedLabel}${suffix}.`
      : `${name} — a NEW account — just LEFT a ${speedLabel} lobby before it filled${suffix}.`;
    const icon = joined ? '🆕' : '👋';
    // UNIQUE PER EVENT (append the event time) so every join/leave pings — same
    // user + same draft, 5 times = 5 pings. NOT keyed per user+draft+action (that
    // suppressed re-entries). Same key drives the bell + the email for THIS event.
    const dedupeKey = `admin-new-user-${joined ? 'in' : 'left'}-draft-${userId}-${leagueId ?? 'unknown'}-${Date.now()}`;
    const emailSubject = joined
      ? `🆕 ${name} — new user in a filling ${speedLabel}`
      : `👋 ${name} — new user left a ${speedLabel} before it filled`;

    await Promise.allSettled([
      ...admins.map((w) => createNotification(w, {
        type: 'system',
        title,
        message,
        link: '/admin?tab=drafts',
        icon,
        dedupeKey,
      })),
      // Instant email (guarded by a create()-once doc so a retry can't double-send).
      (async () => {
        try {
          await db.collection('admin_alert_sent')
            .doc(dedupeKey.replace(/[/\\\s]+/g, '_'))
            .create({ at: new Date().toISOString() });
        } catch { return; } // already sent for this user+draft+action
        await sendAdminAlertEmail(emailSubject, message);
      })(),
    ]);
  } catch (err) {
    logger.warn('admin_new_user_draft_event.failed', { userId, action, leagueId, err });
  }
}
