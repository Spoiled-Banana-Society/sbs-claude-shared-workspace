# Claude-authored changes — code handoff

All commits authored under "Richard:" on `richard` branch since 2026-04-19, merged to `main`. This doc is the code; notes are kept only where the code alone doesn't explain the decision.

---

## 1. Slow-draft `pickLength` — `sbs-drafts-api/models/draft-state.go:529`

```go
var pickLength int64
if strings.ToLower(leagueInfo.DraftType) == "fast" {
    pickLength = 30
} else {
    pickLength = 3600 * 8   // was 60 * 8 (480s = 8 min). 3600 * 8 = 28800s = 8h.
}
```

Deployed on staging as revision `sbs-drafts-api-staging-00052-pp8`.

---

## 2. `JoinLeagues` partial-routing — `sbs-drafts-api/models/leagues.go`

```go
// NEW helper
func scanForPartialLeague(startFrom int, draftType string, ownerId string) int {
    const maxLookback = 30
    lowest := 0
    for n := startFrom; n > 0 && n > startFrom-maxLookback; n-- {
        var l League
        draftId := fmt.Sprintf("2024-%s-draft-%d", draftType, n)
        if err := utils.Db.ReadDocument("drafts", draftId, &l); err != nil {
            continue
        }
        if l.NumPlayers <= 0 || l.NumPlayers >= 10 {
            continue
        }
        alreadyIn := false
        for _, u := range l.CurrentUsers {
            if u.OwnerId == ownerId {
                alreadyIn = true
                break
            }
        }
        if alreadyIn {
            continue
        }
        lowest = n
    }
    return lowest
}

// AddCardToLeague prelude
currentDraftNum := expectedDraftNum
if partial := scanForPartialLeague(expectedDraftNum, draftType, token.OwnerId); partial > 0 {
    currentDraftNum = partial
}
// ... existing for-loop unchanged (dup-join check inside the tx is unchanged) ...

// Return floor
if currentDraftNum < expectedDraftNum {
    return expectedDraftNum, nil
}
return currentDraftNum, nil
```

**Why the floor matters:** `JoinLeagues` threads `currentDraft = AddCardToLeague(...)` between tokens when a single caller joins multiple leagues. Returning a backfilled (lower) number would make subsequent tokens start their own scan from a lower point and skip newer partials between that point and the true counter.

**Performance:** up to 30 Firestore reads per join. If this shows up in latency, swap the walk for `.Where("NumPlayers", ">", 0).Where("NumPlayers", "<", 10)` — requires a composite index.

**Deploy:** `gcloud run deploy sbs-drafts-api-staging --source . --region us-central1 --project sbs-staging-env`.

---

## 3. Drafting page — `banana-fantasy/hooks/useDraftingPageState.ts`

### 3a. API → Draft mapping (no more hardcodes)

```ts
// For each active token, fetch real player count + drafting-state in parallel.
const stateResults = await Promise.all(
  activeTokens.map(async (t): Promise<{ players: number; isDrafting: boolean }> => {
    try {
      const res = await fetch(`/api/drafts/league-players?draftId=${encodeURIComponent(t.leagueId)}`);
      if (!res.ok) return { players: 1, isDrafting: false };
      const data = await res.json();
      const numPlayers = Number(data.numPlayers) || 0;
      return { players: Math.max(1, numPlayers), isDrafting: numPlayers >= 10 };
    } catch {
      return { players: 1, isDrafting: false };
    }
  }),
);

const mapped: Draft[] = activeTokens.map((t, i) => {
  const { players, isDrafting } = stateResults[i];
  const draftSpeed: 'fast' | 'slow' = t.leagueId.includes('-slow-') ? 'slow' : 'fast';
  // Until the draft fills and the backend classifies it, the token returns
  // level: "Pro" by default. null here = UI renders "Unrevealed" pill.
  let type: Draft['type'];
  if (t.level === 'Jackpot') type = 'jackpot';
  else if (t.level === 'Hall of Fame') type = 'hof';
  else type = isDrafting ? 'pro' : null;
  return {
    id: t.leagueId || t.cardId,
    contestName: t.leagueDisplayName || `League #${t.leagueId || t.cardId}`,
    status: isDrafting ? 'drafting' : 'filling',
    type,
    draftSpeed,
    players,
    maxPlayers: 10,
    lastUpdated: Date.now(),
  };
});
```

### 3b. Heal stale localStorage from pre-fix deploys

```ts
for (const d of mapped) {
  if (hiddenDraftIds.has(d.id)) continue;
  const existing = draftStore.getDraft(d.id);
  if (!existing) {
    draftStore.addDraft({
      ...d,
      liveWalletAddress: user!.walletAddress!,
      phase: d.status === 'drafting' ? 'drafting' : 'filling',
    });
    continue;
  }
  const isConfirmedDrafting = existing.phase === 'drafting' || existing.status === 'drafting';
  if (!isConfirmedDrafting) {
    // type/draftSpeed/status don't depend on slot-machine animation state
    // — safe to refresh on filling rows even if preSpinStartedAt / randomizingStartedAt linger.
    draftStore.updateDraft(d.id, {
      status: d.status, type: d.type, draftSpeed: d.draftSpeed,
      players: d.players, draftType: d.type,
    });
  } else {
    const patch: Partial<typeof existing> = {};
    if (!existing.draftSpeed || existing.draftSpeed !== d.draftSpeed) patch.draftSpeed = d.draftSpeed;
    if (existing.type == null && d.type != null) patch.type = d.type;
    if (Object.keys(patch).length > 0) draftStore.updateDraft(d.id, patch);
  }
}
```

### 3c. Wallet-scoped `activeDrafts`

```ts
const activeDrafts = useMemo(() => {
  if (!user?.walletAddress) return [] as Draft[];  // logged out → empty
  const currentWallet = user.walletAddress.toLowerCase();
  const ownedLocalDrafts = localDrafts.filter(d => {
    if (!d.liveWalletAddress) return true;  // legacy unstamped rows — allowed here for display only
    return d.liveWalletAddress.toLowerCase() === currentWallet;
  });
  let base: Draft[];
  if (!isLive) {
    base = ownedLocalDrafts;
  } else {
    const localIds = new Set(ownedLocalDrafts.map(d => d.id));
    const apiOnly = liveDrafts.filter(d => !localIds.has(d.id));
    base = [...ownedLocalDrafts, ...apiOnly];
  }
  // ... rest unchanged (queue merge, hidden filter) ...
}, [hiddenDraftIds, isLive, liveDrafts, localDrafts, queueDrafts, user?.walletAddress]);
```

### 3d. Wallet-scoped background loops (cross-wallet promo misattribution fix)

```ts
// Filling-draft poller — now wallet-scoped.
const fillingLiveDraftIds = useMemo(() => {
  const currentWallet = user?.walletAddress?.toLowerCase();
  if (!currentWallet) return [] as string[];
  return localDrafts
    .filter(d =>
      (d.phase === 'filling' || d.status === 'filling')
      && d.liveWalletAddress
      && d.liveWalletAddress.toLowerCase() === currentWallet,
    )
    .map(d => d.id);
}, [localDrafts, user?.walletAddress]);

// syncLiveDrafts — filter at the top, explicit ownership guard on promo fires.
const syncLiveDrafts = async () => {
  const currentWallet = user?.walletAddress?.toLowerCase();
  if (!currentWallet) return;
  const allDrafts = draftStore.getActiveDrafts();
  const liveDraftsToSync = allDrafts.filter(
    d => d.liveWalletAddress
      && d.liveWalletAddress.toLowerCase() === currentWallet
      && (d.status === 'filling' || d.status === 'drafting' || d.phase === 'drafting'),
  );
  for (const draft of liveDraftsToSync) {
    // ... poll /state/info ...
    const draftOwnedByUser = draft.liveWalletAddress
      && draft.liveWalletAddress.toLowerCase() === currentWallet;
    if (isFull && user?.id && isPaid && draftOwnedByUser) {
      // fire /api/promos/draft-complete + /api/promos/pick10
    }
  }
};

// WS connection manager — filter by the wallet the effect opened under.
const syncConnections = () => {
  const draftingDrafts = allDrafts.filter(
    d => d.liveWalletAddress
      && d.liveWalletAddress.toLowerCase() === wallet
      && d.phase === 'drafting' && d.status === 'drafting',
  );
  // ... close conns not in activeIds, open new ones ...
};
```

**Why:** WS connections are opened with the current wallet as the `address` query param. Without these guards, switching wallets in the same tab would (a) fire promo-tracking requests keyed to the new `user.id` against drafts that belong to the previous wallet's `liveWalletAddress`, and (b) leak WS events opened under wallet A into React state owned by wallet B. Legacy rows with no `liveWalletAddress` are skipped in background loops (recoverable on next mount) but allowed in the UI list (so display doesn't regress for pre-stamp drafts).

### 3e. "Clear All" no longer hides by NFT cardId

```ts
// clearAllDrafts() — only collect leagueIds
for (const t of tokens) {
  if (t.leagueId) liveTokenIds.push(t.leagueId);
  // (previously: also liveTokenIds.push(t.cardId) — removed)
}
```

`cardId` is the persistent NFT token identifier; it gets reassigned to future drafts. Hiding by cardId silently suppressed every subsequent draft that reused the same NFT.

---

## 4. Draft-room sync — `banana-fantasy/hooks/useDraftLiveSync.ts`

### 4a. Removed the 8hr slow-draft client workaround

Deleted function `correctSlowDraftTimestamp` and all its call sites. The Go API returns `pickLength: 28800` directly now (see §1), so the client no longer forces 28800 when it sees `pickLength < 3600 && speed === 'slow'`.

### 4b. Cross-tab heartbeat (contract: numeric timestamp)

```ts
useEffect(() => {
  if (!isLiveMode || !draftId) return;
  const key = `draft-room-ws:${draftId}`;
  const writeHeartbeat = () => localStorage.setItem(key, String(Date.now()));
  writeHeartbeat();
  const interval = setInterval(writeHeartbeat, 3_000);
  return () => {
    clearInterval(interval);
    localStorage.removeItem(key);
  };
}, [isLiveMode, draftId]);
```

**Before:** wrote `Math.random().toString(36)` as an "ownership token." Consumers in `useDraftingPageState.ts` parse it with `Number(...)` and compare to `Date.now()`, so the 10s-freshness guard always failed — the drafting page ran duplicate sync/WS work whenever a draft room was open. Last-writer-wins gives us the freshness signal without needing ownership tracking.

### 4c. Client-side pick-up push trigger — removed

No longer fires `/api/notifications/pick-up` from the browser. Reasoning: proving "this caller is a logged-in user" does not prove "this push target is legitimate" — the route became an authenticated-spam vector. The Firebase Cloud Function (§7) calls `/pick-up` server-to-server with a shared secret; that covers the case that mattered (user with tab closed).

---

## 5. Notification endpoints

### 5a. `banana-fantasy/app/api/notifications/subscribe/route.ts` — Privy-auth + wallet-match

```ts
export async function POST(req: NextRequest) {
  try {
    let authenticatedWallet: string;
    try {
      const user = await getPrivyUser(req);
      authenticatedWallet = (user.walletAddress || '').toLowerCase();
      if (!authenticatedWallet) throw new Error('no wallet on user');
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const body = await req.json();
    const walletAddress = typeof body.walletAddress === 'string' ? body.walletAddress.trim().toLowerCase() : '';
    const playerId = typeof body.playerId === 'string' ? body.playerId.trim() : '';
    if (!walletAddress) return NextResponse.json({ error: 'walletAddress required' }, { status: 400 });
    if (!playerId) return NextResponse.json({ error: 'playerId required' }, { status: 400 });
    if (walletAddress !== authenticatedWallet) return NextResponse.json({ error: 'Wallet mismatch' }, { status: 403 });
    if (!isFirestoreConfigured()) return NextResponse.json({ ok: true, persisted: false });
    const db = getAdminFirestore();
    await db.collection('notificationSubscriptions').doc(walletAddress).set(
      { walletAddress, playerId, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    return NextResponse.json({ ok: true, persisted: true });
  } catch (err) {
    console.error('[notifications/subscribe] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
// DELETE has the same auth + wallet-match contract.
```

**Note:** the Firestore record is currently a write-only audit — `/pick-up` targets by OneSignal tag, doesn't read from `notificationSubscriptions`. Either delete the persistence, or switch `/pick-up` to resolve playerId from Firestore and target by ID. Your call on direction.

### 5b. `banana-fantasy/app/api/notifications/pick-up/route.ts` — internal-only, atomic dedup

```ts
// Auth: shared-secret only. No Privy path.
if (!INTERNAL_SECRET) {
  return NextResponse.json({ error: 'NOTIFICATIONS_INTERNAL_SECRET not configured' }, { status: 503 });
}
const secretHeader = req.headers.get('x-internal-secret');
if (!secretHeader || secretHeader !== INTERNAL_SECRET) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

// Atomic dedup — try create(), inspect stored status on AlreadyExists.
let dedupRef: FirebaseFirestore.DocumentReference | null = null;
if (isFirestoreConfigured() && pickNumber != null) {
  const db = getAdminFirestore();
  const dedupId = `${walletAddress}__${draftId}__${pickNumber}`;
  dedupRef = db.collection(SENT_COLLECTION).doc(dedupId);
  try {
    await dedupRef.create({
      walletAddress, draftId, pickNumber,
      status: 'pending',
      startedAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    const code = (err as { code?: number | string } | undefined)?.code;
    const isAlreadyExists = code === 6 || code === 'already-exists';
    if (!isAlreadyExists) {
      console.error('[pick-up] Firestore create() error (non-dedup):', err);
      return NextResponse.json({ error: 'Dedup store unavailable' }, { status: 502 });
    }
    try {
      const snap = await dedupRef.get();
      const status = snap.exists ? snap.get('status') : null;
      if (status === 'sent') {
        return NextResponse.json({ ok: true, deduped: true });
      }
      if (status === 'failed') {
        // Prior send failed — reopen slot and retry.
        await dedupRef.set(
          { status: 'pending', retriedAt: FieldValue.serverTimestamp() },
          { merge: true },
        );
      } else {
        // 'pending' or missing: another worker may be in flight.
        return NextResponse.json({ ok: true, deduped: true });
      }
    } catch (readErr) {
      console.error('[pick-up] Firestore read after AlreadyExists failed:', readErr);
      return NextResponse.json({ error: 'Dedup store unavailable' }, { status: 502 });
    }
  }
}

// ... OneSignal REST call with filter by tag walletAddress (lowercased) ...
// After: dedupRef.set({status: 'sent', sentAt: ..., recipients: ...}) on 2xx,
//        dedupRef.set({status: 'failed', failedAt: ...}) on non-2xx or throw.
```

**Contract:** body = `{ walletAddress, draftId, draftName?, pickNumber?, pickLengthSeconds? }`. Push URL: `${NEXT_PUBLIC_APP_URL}/draft-room?id=${draftId}`. Badge/icon: `/icons/icon-192.png`. TTL = pickLength or 600s default.

**Required envs on Vercel:** `NEXT_PUBLIC_ONESIGNAL_APP_ID`, `ONESIGNAL_REST_API_KEY`, `NOTIFICATIONS_INTERNAL_SECRET` (same secret the Cloud Function sends).

### 5c. `banana-fantasy/hooks/useNotificationOptIn.ts` — lowercase + bearer token

```ts
const { getAccessToken } = usePrivy();
// ...
if (walletAddress) {
  const normalized = walletAddress.toLowerCase();
  await OneSignal.User.addTag('walletAddress', normalized);
  try {
    const playerId = await OneSignal.User.onesignalId;
    if (playerId) {
      const token = await getAccessToken();
      await fetch('/api/notifications/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ walletAddress: normalized, playerId }),
      });
    }
  } catch (err) {
    console.warn('Failed to register notification subscription:', err);
  }
}
```

---

## 6. League-players proxy — `banana-fantasy/app/api/drafts/league-players/route.ts`

```ts
export async function GET(req: NextRequest) {
  const draftId = req.nextUrl.searchParams.get('draftId');
  if (!draftId) return NextResponse.json({ error: 'Missing draftId' }, { status: 400 });

  // Step 1 — RTDB, isolated so a read failure doesn't skip Go fallback.
  let rtdbPlayers = 0;
  let rtdbOk = false;
  try {
    const app = getAdminApp();
    const token = await app.options.credential?.getAccessToken();
    const rtdbUrl = `https://sbs-staging-env-default-rtdb.firebaseio.com/drafts/${encodeURIComponent(draftId)}/numPlayers.json`;
    const res = await fetch(`${rtdbUrl}?access_token=${token?.access_token}`, { cache: 'no-store' });
    if (res.ok) {
      const val = await res.json();
      if (typeof val === 'number') { rtdbPlayers = val; rtdbOk = true; }
      else if (val === null) { rtdbOk = true; } // key absent = normal pre-first-join
    }
  } catch (rtdbErr) {
    console.warn('[league-players] RTDB read failed, will try Go fallback:', rtdbErr);
  }

  let numPlayers = rtdbPlayers;

  // Step 2 — Go /state/info fallback. Runs when <10 (or RTDB was silent).
  let goOk = false;
  if (numPlayers < 10) {
    try {
      const infoRes = await fetch(
        `${DRAFTS_API_URL}/draft/${encodeURIComponent(draftId)}/state/info`,
        { cache: 'no-store' },
      );
      if (infoRes.ok) {
        const info = await infoRes.json();
        const orderLen = Array.isArray(info?.draftOrder) ? info.draftOrder.length : 0;
        if (orderLen >= 10 && Number(info?.draftStartTime) > 0) {
          numPlayers = 10;
        } else if (orderLen > numPlayers) {
          numPlayers = orderLen;
        }
        goOk = true;
      } else if (infoRes.status === 404) {
        goOk = true;  // draft-state doc not created yet — normal during filling
      }
    } catch (goErr) {
      console.warn('[league-players] Go /state/info fallback failed:', goErr);
    }
  }

  if (!rtdbOk && !goOk) {
    return NextResponse.json({ error: 'Failed to read draft state' }, { status: 502 });
  }
  return NextResponse.json({ numPlayers, players: [] });
}
```

**Why Go fallback exists at all:** the staging `fill-bots` handler doesn't update RTDB `numPlayers` when it brings a league to 10/10. `/state/info` exists only after `CreateLeagueDraftStateUponFilling`, so its presence with `draftOrder.length >= 10 && draftStartTime > 0` is a reliable "draft is running" signal even when RTDB lags.

**`DRAFTS_API_URL` default is hardcoded to staging:** `'https://sbs-drafts-api-staging-652484219017.us-central1.run.app'`. Fine today; swap to env-required (no fallback) once a prod Vercel deploy exists.

---

## 7. Cloud Function — `functions-for-boris/onPickAdvance.js`

```js
const functions = require('firebase-functions');
const fetch = require('node-fetch');

function getConfig() {
  let cfg = {};
  try { cfg = functions.config().pickup || {}; } catch { /* not configured via CLI */ }
  return {
    endpoint: cfg.endpoint || process.env.PICK_UP_ENDPOINT
      || 'https://banana-fantasy-sbs.vercel.app/api/notifications/pick-up',
    secret: cfg.secret || process.env.NOTIFICATIONS_INTERNAL_SECRET || '',
  };
}

const SLOW_PICK_THRESHOLD_SECONDS = 3600;

exports.onPickAdvance = functions
  .region('us-central1')
  .database.ref('drafts/{draftId}/realTimeDraftInfo')
  .onUpdate(async (change, ctx) => {
    const before = change.before.val();
    const after = change.after.val();
    const { draftId } = ctx.params;

    if (!after) return null;
    if (after.isDraftComplete || after.isDraftClosed) return null;
    if (!before || before.currentDrafter === after.currentDrafter) return null;  // real transition only

    const pickLength = Number(after.pickLength ?? 0);
    if (!pickLength || pickLength <= SLOW_PICK_THRESHOLD_SECONDS) return null;  // slow only

    const walletAddress = String(after.currentDrafter || '').toLowerCase();
    if (!walletAddress || walletAddress.startsWith('bot-')) return null;

    const { endpoint, secret } = getConfig();
    if (!secret) {
      console.warn('[onPickAdvance] NOTIFICATIONS_INTERNAL_SECRET not configured — skipping push');
      return null;
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
        body: JSON.stringify({
          walletAddress, draftId,
          pickNumber: after.currentPickNumber,
          pickLengthSeconds: pickLength,
        }),
      });
      if (!res.ok) {
        console.warn('[onPickAdvance] pick-up endpoint', res.status, await res.text().catch(() => ''));
      }
    } catch (err) {
      console.error('[onPickAdvance] fetch failed', err);
    }
    return null;
  });
```

**Deploy:**
```bash
cp functions-for-boris/onPickAdvance.js ~/sbs-staging-functions/functions/
firebase functions:config:set pickup.secret=<secret> pickup.endpoint=https://banana-fantasy-sbs.vercel.app/api/notifications/pick-up --project=sbs-staging-env
firebase deploy --only functions:onPickAdvance --project=sbs-staging-env
```

Vercel env `NOTIFICATIONS_INTERNAL_SECRET` must equal `pickup.secret`.

---

## 8. Sidebar queue drag-and-drop — `banana-fantasy/components/drafting/DraftRoomDrafting.tsx`

```tsx
<DragDropContext onDragEnd={(result: DropResult) => {
  if (!result.destination) return;
  const items = [...activeQueue];
  const [reordered] = items.splice(result.source.index, 1);
  items.splice(result.destination.index, 0, reordered);
  engine.reorderQueue(items);
  if (phase === 'drafting') onQueueSync(items);
}}>
  <Droppable droppableId="sidebar-queue">
    {(provided) => (
      <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-1">
        {activeQueue.map((player, i) => (
          <Draggable key={player.playerId} draggableId={`sq-${player.playerId}`} index={i}>
            {(provided, snapshot) => (
              <div
                ref={provided.innerRef}
                {...provided.draggableProps}
                {...provided.dragHandleProps}
                className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-xs transition-colors cursor-grab active:cursor-grabbing select-none ${
                  snapshot.isDragging ? 'bg-white/10 shadow-lg' : 'bg-white/[0.03] hover:bg-white/[0.06]'
                }`}
              >
                {/* ... content ... */}
              </div>
            )}
          </Draggable>
        ))}
        {provided.placeholder}
      </div>
    )}
  </Droppable>
</DragDropContext>
```

**`select-none` is load-bearing:** without it, mousedown on the text inside a row starts a native text selection before `@hello-pangea/dnd`'s 5px drag threshold fires, so drag never initiates.

**Draggable id prefixed `sq-`** to avoid colliding with the main Queue tab's `DragDropContext` which uses the raw `playerId` as the draggableId.

---

## 9. History page — `banana-fantasy/hooks/useHistory.ts`

```ts
const draftSpeed: 'fast' | 'slow' = leagueId.includes('-slow-') ? 'slow' : 'fast';
// was: draftSpeed: 'fast' (hardcoded)
```

---

## Dependencies on ops / deploy

Must ship alongside the code above:

1. `gcloud run deploy sbs-drafts-api-staging` to land §1 + §2 on Go.
2. Firebase Cloud Function deploy (§7) + `functions.config().pickup.secret` set.
3. Vercel env vars: `NEXT_PUBLIC_ONESIGNAL_APP_ID`, `ONESIGNAL_REST_API_KEY`, `NOTIFICATIONS_INTERNAL_SECRET` (= `pickup.secret`), `NEXT_PUBLIC_ENVIRONMENT=staging` (unrelated — unblocks the staging-mint button whose route gates on this var).

## Not addressed (dev decision)

- `/api/notifications/subscribe` writes to Firestore but `/api/notifications/pick-up` targets by OneSignal tag — the Firestore record is currently a write-only audit, not the source of truth for delivery. Pick: delete the persistence, or switch `/pick-up` to resolve playerId from Firestore and target by ID.
- No unsubscribe flow calling the `DELETE` path on `subscribe` — browser-permission revoke leaves the Firestore record behind. Low priority.
- Two `draft-reminder` + `pwa-raffle-notify` routes reference `/banana-icon-192.png` which doesn't exist (only `/icons/icon-192.png` does). Pre-existing, not mine, but broken push icons on those paths too. Fix is the same one-line swap I made in `pick-up`.

## Contract assumptions

- `leagueId` format: `2024-{fast|slow}-draft-{N}`. Used by §3a (speed parse), §2 (Go draftId formatter), and the `-slow-` / `-fast-` checks throughout.
- RTDB `drafts/{id}/realTimeDraftInfo` fields used by §7: `currentDrafter`, `currentPickNumber`, `pickLength`, `isDraftComplete`, `isDraftClosed`.
- OneSignal tag `walletAddress` is lowercased at opt-in write (§5c) and at send filter (§5b). Historical mixed-case tags from earlier deploys would miss — backfill if there are existing subscribers from before the fix.
- Privy `getPrivyUser(req)` requires `Authorization: Bearer <jwt>` and returns `{ userId, walletAddress: string | null }`.
