/**
 * Sets up a draft with 4/10 players on staging for testing the filling flow.
 * Run: node scripts/setup-filling-draft.mjs
 */
const API_BASE = 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
const SITE_URL = 'https://banana-fantasy-sbs.vercel.app';

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  return res.json().catch(() => ({ _error: true, status: res.status }));
}

async function main() {
  const wallet = '0xtest1750_' + Date.now();
  const tokenRand = Math.floor(Math.random() * 900000) + 200000;

  // 1. Mint
  console.log('Minting for', wallet);
  const mint = await fetchJson(`${API_BASE}/owner/${wallet}/draftToken/mint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ minId: tokenRand, maxId: tokenRand }),
  });
  console.log('Mint:', mint?.tokens?.length, 'tokens');

  // 2. Join fast draft
  const join = await fetchJson(`${API_BASE}/league/fast/owner/${wallet}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ numLeaguesToJoin: 1 }),
  });
  const raw = Array.isArray(join) ? join[0] : join;
  const draftId = raw?._leagueId ?? raw?.draftId ?? raw?.leagueId ?? null;
  console.log('Joined draft:', draftId);

  if (!draftId) {
    console.log('ERROR: Join result:', JSON.stringify(join));
    return;
  }

  // 3. Add exactly 3 bots (total 4/10 = user + 3 bots)
  const fill = await fetchJson(
    `${API_BASE}/staging/fill-bots/fast?count=3&leagueId=${encodeURIComponent(draftId)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
  );
  console.log('Added 3 bots:', JSON.stringify(fill).slice(0, 200));

  // 4. Check state
  const info = await fetchJson(`${API_BASE}/draft/${draftId}/state/info`);
  const playerCount = info.draftOrder?.length || 4;
  console.log('Draft state: players =', playerCount, ', pickNumber =', info.pickNumber);

  // 5. Output URL
  const url = `${SITE_URL}/draft-room?id=${encodeURIComponent(draftId)}&name=${encodeURIComponent('BBB #1750')}&speed=fast&players=${playerCount}&mode=live&wallet=${encodeURIComponent(wallet)}`;
  console.log('\n=== DRAFT ROOM URL ===');
  console.log(url);
  console.log('\nWallet:', wallet);
  console.log('Draft ID:', draftId);
  console.log('Players:', playerCount);
  console.log('\nTo fill the rest (make it 10/10), run:');
  console.log(`curl -s -X POST "${API_BASE}/staging/fill-bots/fast?count=6&leagueId=${encodeURIComponent(draftId)}" -H "Content-Type: application/json" -d '{}' | head -c 200`);
}

main().catch(console.error);
