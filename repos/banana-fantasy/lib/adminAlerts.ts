import { logger } from '@/lib/logger';

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
