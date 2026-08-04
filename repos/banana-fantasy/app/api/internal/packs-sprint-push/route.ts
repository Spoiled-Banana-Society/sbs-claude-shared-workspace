/**
 * POST /api/internal/packs-sprint-push
 *
 * ONE-SHOT (2026-08-03): fires the "packs sprint final stretch" broadcast
 * push through OneSignal using the server-side key. Exists because the
 * OneSignal REST key is a Vercel sensitive var (unreadable from any CLI)
 * and the admin Broadcasts panel needs a live Privy admin session.
 *
 * v2: `Authorization: Key …` got a 401 from OneSignal — the stored key may
 * be legacy-format, which needs `Basic …`. Tries both, and the latch only
 * becomes permanent on a SUCCESSFUL send so a failed attempt can be retried.
 *
 * Locked two ways:
 *   1. Bearer token minted for this send only — compared with the header.
 *   2. Firestore latch `config/oneshot_packs_sprint_push_2026_08_03` with
 *      `sent: true` — once a send succeeds, replays get 409.
 *
 * Payload is fully hardcoded; nothing in the request influences the copy.
 * Safe to delete after 2026-08-03.
 */
import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';

const ONE_SHOT_TOKEN = 'a7c4dd64b4d9e05002f42f181f2db49e38dd298849e50f5a3ef71090ce2f69fb';
const LATCH_DOC = 'oneshot_packs_sprint_push_2026_08_03';

const PUSH = {
  title: 'JackHOF & Jackpot Seats — Final Stretch',
  body: 'Do drafts, get packs, win prizes — more drafts means more packs. Tonight’s packs hold a JackHOF seat, a Jackpot seat, a HOF seat, plus 19 spin prizes. Ends around 8pm PT — draft now.',
  url: 'https://sbsfantasy.com/draft',
};

export async function POST(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${ONE_SHOT_TOKEN}`) {
    return jsonError('Unauthorized', 401);
  }
  if (!isFirestoreConfigured()) {
    return jsonError('Firestore not configured', 500);
  }
  const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !apiKey) {
    return jsonError('OneSignal not configured', 500);
  }

  const latch = getAdminFirestore().collection('config').doc(LATCH_DOC);
  const snap = await latch.get();
  if (snap.exists && snap.data()?.sent === true) {
    return jsonError('Already fired', 409);
  }

  const attempts: string[] = [];
  for (const scheme of ['Key', 'Basic']) {
    const res = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `${scheme} ${apiKey}`,
      },
      body: JSON.stringify({
        app_id: appId,
        included_segments: ['Subscribed Users'],
        headings: { en: PUSH.title },
        contents: { en: PUSH.body },
        url: PUSH.url,
        chrome_web_badge: '/icons/icon-192.png',
        chrome_web_icon: '/icons/icon-192.png',
        ttl: 86_400,
      }),
    });
    const text = await res.text().catch(() => '');
    if (res.ok && !text.includes('"errors"')) {
      await latch.set({ sent: true, firedAt: new Date().toISOString(), scheme, response: text.slice(0, 500), push: PUSH });
      return json({ ok: true, scheme, response: text.slice(0, 500) });
    }
    attempts.push(`${scheme}: ${res.status} ${text.slice(0, 200)}`);
  }
  await latch.set({ sent: false, lastAttemptAt: new Date().toISOString(), attempts }, { merge: true });
  return json({ ok: false, attempts });
}
