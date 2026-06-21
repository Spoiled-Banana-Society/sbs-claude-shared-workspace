import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';

/**
 * Auth for the staging bot endpoints: accept EITHER an admin login OR a shared
 * secret header (`x-bot-secret` === `BOT_ADMIN_SECRET`). The admin path powers
 * the admin UI; the secret path lets the bot system be triggered programmatically
 * (a script, automation, or a teammate) WITHOUT an admin Privy session — so it's
 * not admin-UI-only. The endpoints are already `NEXT_PUBLIC_ENVIRONMENT==='staging'`
 * gated, so this never exposes anything in prod.
 */
export async function requireBotAuth(req: NextRequest): Promise<void> {
  const secret = process.env.BOT_ADMIN_SECRET;
  if (secret && req.headers.get('x-bot-secret') === secret) return; // secret path
  await requireAdmin(req); // admin-login path (throws if caller isn't an admin)
}
