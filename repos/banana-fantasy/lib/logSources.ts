/**
 * Log-source registry — the naming standard for every error `source`.
 *
 * Convention: `area.feature.outcome`, lowercase, dot-separated.
 *   e.g. 'draft.join_failed', 'payment.usdc.permit_failed'
 *
 * This file is additive documentation. `reportClientError` / `logger`
 * still accept any string, so nothing breaks if a source isn't listed
 * here — but new code should use a LOG_SOURCES constant so the admin
 * Logs tab filter and the CLI stay consistent.
 *
 * When you wire up a new logging call, add its source here.
 */

export const LOG_AREAS = [
  'draft',
  'payment',
  'promo',
  'marketplace',
  'wheel',
  'auth',
  'kyc',
  'onramp',
  'offramp',
  'referral',
  'profile',
  'prizes',
  'notifications',
  'admin',
  'audit',
  'backend',
  'global',
  'other',
] as const;

export type LogArea = (typeof LOG_AREAS)[number];

/**
 * Canonical source strings grouped by area. Keep in sync with the
 * IMPORTANT_ERROR_PATTERNS list in app/api/admin/notification-counts/route.ts
 * — sources that should raise the admin badge must match a pattern there.
 */
export const LOG_SOURCES = {
  draft: {
    // A live draft's pick clock expired minutes ago and the pick never
    // advanced — the engine's auto-pick chain died (e.g. the 2026-06-10
    // freeze: transient Firestore DeadlineExceeded mid-pick, no retry, no
    // watchdog). Fired by the health-canary stall watchdog. CRITICAL: a
    // frozen draft strands 10 paying players.
    STALLED_NO_ADVANCE: 'draft.stalled_no_advance',
    JOIN_FAILED: 'draft.join_failed',
    LIVE_LOAD_EXHAUSTED: 'draft.live_load_exhausted_retries',
    // Money paths: a draft pass was spent but the refund (on join-fail or leave)
    // didn't land → user is down a pass with no trace. Critical.
    LEAVE_REFUND_FAILED: 'draft.leave_refund_failed',
    JOIN_REFUND_FAILED: 'draft.join_refund_failed',
    // Leaving a draft failed server-side (Go still has the user in the league).
    LEAVE_FAILED: 'draft.leave_failed',
    // Queue / special-draft (jackpot/HOF) creation + fill pipeline.
    QUEUE_CREATE_FAILED: 'draft.queue.create_draft_failed',
    QUEUE_FILL_BOTS_FAILED: 'draft.queue.fill_bots_failed',
    QUEUE_MINT_FAILED: 'draft.queue.mint_failed',
    QUEUE_STATE_NOT_READY: 'draft.queue.state_not_ready',
    QUEUE_POLL_FAILED: 'draft.queue_poll_failed',
    // The "Joining lobby" overlay → draft-room hand-off took abnormally long
    // (blank/flash between leaving /drafting and the lobby painting). Warning
    // severity (not critical) — cosmetic, recoverable — but visible in admin so
    // we can actually SEE the join glitch when it happens instead of guessing.
    JOIN_HANDOFF_SLOW: 'draft.join_handoff_slow',
    // The filling lobby was skipped/left right after a fresh join — the
    // "saw 'Joining lobby' for a second then wasn't in the filling draft"
    // glitch. Fires regardless of hand-off speed (the SLOW threshold above
    // misses the fast-flash case). Context captures WHICH cause it was:
    // fellToLocal (live join dropped to local), or left filling early with
    // playerCount<10 (a real skip) vs ==10 (legit fast fill). Warning.
    JOIN_LOBBY_GLITCH: 'draft.join_lobby_glitch',
    PICK_SUBMIT_UNHANDLED: 'draft.pick_submit_unhandled_error',
    AUTOPICK_SUBMIT_FAILED: 'draft.autopick_submit_failed',
    AUTOPICK_TOGGLE_FAILED: 'draft.autopick_toggle_failed',
    AIRPLANE_TRACE: 'draft.airplane.trace',
    // Post-draft generating screen — timing trace (was the card ready instantly?
    // how long was the animation shown before routing to the roster?).
    COMPLETE_TRACE: 'draft.complete.trace',
    PREFERENCES_LOAD_FAILED: 'draft.preferences_load_failed',
    SORT_PERSIST_FAILED: 'draft.sort_preference_persist_failed',
    RANKINGS_REFRESH_FAILED: 'draft.rankings_refresh_failed',
    QUEUE_UPDATE_FAILED: 'draft.queue_update_failed',
    TOKEN_LEVEL_LOOKUP_FAILED: 'draft.token_level_lookup_failed',
    FIREBASE_RTDB_TIMEOUT: 'draft.firebase_rtdb_timeout',
    FIREBASE_RTDB_PERMISSION_DENIED: 'draft.firebase_rtdb_permission_denied',
    PHASE_CHECK_FAILED: 'draft.phase_check_failed',
    WATCHDOG_RESYNC_FAILED: 'draft.watchdog_resync_failed',
    PROMO_FOUNDER_POST_FAILED: 'draft.promo_founder_post_failed',
    PROMO_JACKPOT_HIT_FAILED: 'draft.promo_jackpot_hit_failed',
    PROMO_PICK10_FAILED: 'draft.promo_pick10_failed',
    PROMO_TRACK_FAILED: 'draft.promo_track_failed',
  },
  payment: {
    CARD_PURCHASE_TRACKING_FAILED: 'payment.card.purchase_tracking_failed',
    USDC_PERMIT_FAILED: 'payment.usdc.permit_failed',
    USDC_SIGNATURE_REJECTED: 'payment.usdc.signature_rejected',
    ADMIN_WALLET_UNAVAILABLE: 'payment.admin_wallet_unavailable',
    MINT_FAILED: 'card-mint.mint_failed',
    WRONG_NETWORK: 'payment.wrong_network',
    // Best-effort analytics beacon (MoonPay popup) + the post-purchase USDC
    // balance poll. Warning, not notify — recoverable / informational.
    MOONPAY_SESSION_BEACON_FAILED: 'payment.moonpay.session_beacon_failed',
    USDC_BALANCE_POLL_FAILED: 'payment.usdc.balance_poll_failed',
    // Card-fee credit → free draft. Successes are logger.info (console/structured
    // only — NOT the critical feed, which is error-level). REWARD_GRANT_FAILED is
    // logger.error → critical via the ^payment\. pattern (user is owed a draft).
    PURCHASE_COMPLETED: 'payment.card.purchase_completed',
    FEE_CREDITED: 'payment.card.fee_credited',
    REWARD_GRANTED: 'payment.card.reward_granted',
    REWARD_GRANT_FAILED: 'payment.card.reward_grant_failed',
    REWARD_DUPLICATE_SKIPPED: 'payment.card.reward_duplicate_skipped',
    CHECKOUT_CANCELLED: 'payment.card.checkout_cancelled',
    // Gasless marketplace relay (external wallets). Successes are info-level;
    // RELAY_REFUND_FAILED means a buyer is owed USDC → error → critical feed.
    RELAY_BUY_COMPLETED: 'payment.marketplace.relay_buy_completed',
    RELAY_REFUND_FAILED: 'payment.marketplace.relay_refund_failed',
    GAS_TOPUP_SENT: 'payment.marketplace.gas_topup_sent',
  },
  promo: {
    CLAIM_BATCH_PARTIAL_FAILED: 'promo.claim.batch_partial_failed',
    CLAIM_FAILED: 'promo.claim.failed',
    JP_REVEAL_FAILED: 'promo.jp_reveal_failed',
    TWEET_VERIFY_FAILED: 'promo.tweet_verify_failed',
    // Promo credit at risk — founder-draft join not recorded. Critical.
    FOUNDER_DRAFT_FAILED: 'promo.founder_draft.failed',
    // PWA raffle: a draw/award lost (critical) or a notify send failed (warn).
    RAFFLE_RESULT_FAILED: 'promo.raffle.result_failed',
    RAFFLE_NOTIFY_FAILED: 'promo.raffle.notify_failed',
    // Draft-complete promo crediting + the exposure recompute it triggers.
    DRAFT_COMPLETE_FAILED: 'promo.draft_complete.failed',
    EXPOSURE_RECOMPUTE_FAILED: 'promo.exposure_recompute_failed',
    // Promo credit REFUSED: no pass stamp for this draft AND the caller is not in
    // the draft's authoritative roster → a forged/unowned draftId. Anti-abuse
    // signal; expected ~0 for real users (a real player is always in the roster).
    PARTICIPATION_DENIED: 'promo.participation_denied',
    // Promo participation couldn't be verified (roster read failed) — credited on
    // the client value rather than punish a real user. Watch for spikes.
    PARTICIPATION_UNVERIFIED: 'promo.participation_unverified',
  },
  marketplace: {
    BUY_EXECUTION_FAILED: 'marketplace.buy_execution_failed',
    BUY_CARD_FUNDING_FAILED: 'marketplace.buy_card_funding_failed',
    BUY_BALANCE_POLL_TIMEOUT: 'marketplace.buy_balance_poll_timeout',
    LIST_APPROVAL_TX_FAILED: 'marketplace.list_approval_tx_failed',
    CANCEL_TX_FAILED: 'marketplace.cancel_tx_failed',
    SWEEP_TEAM_BUY_FAILED: 'marketplace.sweep_team_buy_failed',
    OFFER_ACCEPT_FAILED: 'marketplace.offer_accept_failed',
    OFFER_CREATE_FAILED: 'marketplace.offer_create_failed',
    // Sweep (multi-buy): card-funding failure = money in flight (critical);
    // balance-check failure is recoverable (warn). Cancel-offer on detail page.
    SWEEP_FUND_FAILED: 'marketplace.sweep_fund_failed',
    SWEEP_BALANCE_CHECK_FAILED: 'marketplace.sweep_balance_check_failed',
    CANCEL_OFFER_FAILED: 'marketplace.cancel_offer_failed',
    // Post-draft: push an OpenSea metadata refresh for all 10 freshly-drafted
    // teams so the revealed roster/card art shows on OpenSea + the marketplace.
    REFRESH_DRAFT_FAILED: 'marketplace.refresh_draft_failed',
    // Saving the team-card image to the user's device failed (roster page /
    // league modal download button).
    CARD_SAVE_FAILED: 'marketplace.card_save_failed',
  },
  wheel: {
    SPIN_FAILED: 'wheel.spin_failed',
    QUEUE_FETCH_FAILED: 'wheel.queue_fetch_failed',
    SPIN_REVEAL_CONFIRM_FAILED: 'wheel.spin_reveal_confirm_failed',
    BALANCE_REFRESH_TIMEOUT: 'wheel.balance_refresh_timeout',
    RAFFLE_FETCH_TIMEOUT: 'wheel.raffle_fetch_timeout',
  },
  auth: {
    JWKS_FETCH_FAILED: 'auth.jwks_fetch_failed',
    JWT_SIGNATURE_INVALID: 'auth.jwt_signature_invalid',
    WALLET_CONNECT_TIMEOUT: 'auth.wallet_connect_timeout',
    WALLET_CONNECT_FAILED: 'auth.wallet_connect_failed',
    WALLET_CONNECT_ABANDONED: 'auth.wallet_connect_abandoned',
    // Social-login wallet resolution via the Privy User API. When this fails,
    // social-login users lose their wallet downstream (the May incident).
    // Already notify-matched by /privy\.fetch_user\.error/i.
    PRIVY_USER_API_FAILED: 'auth.privy.fetch_user.error',
    // Twitter/X verify Firestore write + username claim + client login.
    TWITTER_VERIFY_FAILED: 'auth.twitter.verify_write_failed',
    USERNAME_CLAIM_FAILED: 'auth.username.claim_failed',
    LOGIN_FAILED: 'auth.login_failed',
    LINK_TWITTER_FAILED: 'auth.link_twitter_failed',
    // Quiet, signal-only alarm for the "login modal pops while you're actually
    // logged in" blink. Fires ONLY when the login prompt triggers while Privy
    // still reports authenticated (the contradiction = the bug) — replaces the
    // chatty `authblink` diagnostic. Badges so a recurrence is visible.
    SPURIOUS_LOGIN_MODAL: 'auth.spurious_login_modal',
  },
  kyc: {
    DIDIT_API_FAILED: 'kyc.didit_api_failed',
    WEBHOOK_INVALID_SIGNATURE: 'kyc.webhook_invalid_signature',
  },
  referral: {
    CODE_GENERATION_FAILED: 'referral.code_generation_failed',
    DATA_FETCH_FAILED: 'referral.data_fetch_failed',
  },
  prizes: {
    WITHDRAWAL_API_FAILED: 'prizes.withdrawal_api_failed',
    ELIGIBILITY_FETCH_FAILED: 'prizes.eligibility_fetch_failed',
    // Withdraw-all side effects: KYC cumulative total + offramp audit trail.
    // Warn (the withdrawal itself succeeded; these are bookkeeping) but notify.
    CUMULATIVE_INCREMENT_FAILED: 'prizes.cumulative_increment_failed',
    OFFRAMP_AUDIT_FAILED: 'prizes.offramp_audit_failed',
    FETCH_FAILED: 'prizes.fetch_failed',
    // Withdraw-all could not commit the 'processing' lock on the selected
    // prizes. Critical: the double-withdrawal guard relies on this lock.
    MARK_PROCESSING_FAILED: 'prizes.mark_processing_failed',
    // Admin pay route refused to settle a withdrawal whose prizes were
    // already paid by a DIFFERENT withdrawal — a blocked double-payout.
    DOUBLE_PAYOUT_BLOCKED: 'prizes.double_payout_blocked',
  },
  profile: {
    ACTIVITY_FETCH_FAILED: 'profile.activity_fetch_failed',
  },
  notifications: {
    PUSH_SEND_FAILED: 'notifications.push.send_failed',
    // OneSignal accepted the push but matched 0 subscribed devices —
    // the user has push toggled on but no device is actually listening
    // (iOS revoked permission, browser DND, subscription rotated, etc.).
    // Logged loud as an error so the admin can DM the user proactively
    // before they file a "I'm not getting alerts" ticket.
    PUSH_ZERO_RECIPIENTS: 'notifications.push.zero_recipients',
    EMAIL_SEND_FAILED: 'notifications.email.send_failed',
    TELEGRAM_SEND_FAILED: 'notifications.telegram.send_failed',
    DISCORD_SEND_FAILED: 'notifications.discord.send_failed',
    DEDUP_STORE_UNAVAILABLE: 'notifications.dedup.store_unavailable',
    // Settings page (Profile → Notifications): preference reads/writes
    // and channel connect flows the user themselves triggered.
    SETTINGS_READ_FAILED: 'notifications.settings.read_failed',
    SETTINGS_SAVE_FAILED: 'notifications.settings.save_failed',
    CHANNEL_CONNECT_FAILED: 'notifications.settings.connect_failed',
    // The server-to-server secret is unset/blank — the dispatch routes
    // can't run, so every draft alert silently fails. Loud on purpose.
    SECRET_MISSING: 'notifications.config.secret_missing',
    // Emitted by the Firebase Cloud Functions in ~/sbs-staging-functions
    // (onPickAdvance / onDraftFilled). They previously only console.warn'd
    // on POST failure, so a broken trigger looked identical to "no events
    // happened" in the admin Logs tab. These surface trigger-side failures
    // (HTTP non-OK, fetch threw, roster lookup failed, no human wallets
    // in the roster) keyed to the affected wallet/draft.
    FUNCTION_PICK_UP_FETCH_FAILED: 'notifications.functions.pick_up.fetch_failed',
    FUNCTION_PICK_UP_ENDPOINT_ERROR: 'notifications.functions.pick_up.endpoint_error',
    FUNCTION_DRAFT_FILLED_FETCH_FAILED: 'notifications.functions.draft_filled.fetch_failed',
    FUNCTION_DRAFT_FILLED_ENDPOINT_ERROR: 'notifications.functions.draft_filled.endpoint_error',
    FUNCTION_DRAFT_FILLED_ROSTER_FAILED: 'notifications.functions.draft_filled.roster_lookup_failed',
    FUNCTION_DRAFT_FILLED_NO_WALLETS: 'notifications.functions.draft_filled.no_human_wallets',
  },
  // Admin-side operational sources. Added Phase 6 of the admin overhaul
  // (May 2026) so the new broadcast / bulk-grant / digest / runbook
  // routes log under a consistent namespace. Failures here are admin-
  // facing, not user-facing — they don't gate any user happy path, but
  // we still want them visible in the Logs tab so a broken broadcast
  // doesn't silently never deliver.
  admin: {
    BROADCAST_FAILED: 'admin.broadcast.failed',
    BROADCAST_SENT: 'admin.broadcast.sent',
    BULK_GRANT_FAILED: 'admin.bulk_grant.failed',
    BULK_GRANT_COMPLETED: 'admin.bulk_grant.completed',
    DIGEST_FAILED: 'admin.digest.failed',
    DIGEST_SENT: 'admin.digest.sent',
    DIGEST_CRON_FAILED: 'admin.digest.cron_failed',
    ERROR_RUNBOOK_SAVE_FAILED: 'admin.error_runbooks.save_failed',
    ERROR_RUNBOOK_LIST_FAILED: 'admin.error_runbooks.list_failed',
    USER_NOTES_CREATE_FAILED: 'admin.user_notes.create_failed',
    USER_NOTES_LIST_FAILED: 'admin.user_notes.list_failed',
    USER_LOOKUP_PARTIAL_FAILURE: 'admin.user_lookup.partial_failure',
    AUDIT_WRITE_FAILED: 'admin.audit.write_failed',
  },
  global: {
    UNCAUGHT_ERROR: 'global.uncaught.error',
    UNHANDLED_REJECTION: 'global.unhandled.rejection',
    REACT_BOUNDARY: 'global.react.boundary',
  },
} as const;

/* ── Severity ──────────────────────────────────────────────────── */

export type LogSeverity = 'critical' | 'warning' | 'low';

// Critical = "wake me up, fix it NOW." Reserved for failures that
// stop a user cold or touch money/security:
//   • drafts freezing or failing to start/advance
//   • promos not paying out
//   • payments, mints, prize withdrawals, marketplace funds
//   • auth/security integrity (forged tokens, bad webhook sigs, the
//     admin wallet, a missing server secret)
//   • a page that actually crashed to the error screen
// Everything else is a warning by default — something failed but the
// app limps on. Generic uncaught JS errors and React hydration
// mismatches are intentionally NOT critical: they're usually cosmetic
// (a flicker, a recoverable re-render) and were drowning out the real
// fires. They still show up in the Warnings section. LOW is a small
// subset that fires on fallback paths users never see.
const CRITICAL_PATTERNS: RegExp[] = [
  // ── Drafts freezing / not starting / not advancing ──
  /^draft\.join_failed/i,
  /^draft\.live_load_exhausted/i,
  /^draft\.pick_submit/i,
  /^draft\.autopick_submit/i,
  /^draft\.phase_check_failed/i,
  /^draft\.leave_refund_failed/i,
  /^draft\.join_refund_failed/i,
  /^draft\.queue\.create_draft_failed/i,
  /^promo\.founder_draft\.failed/i,
  /^promo\.raffle\.result_failed/i,
  /^marketplace\.sweep_fund_failed/i,
  // ── Money: payments, mints, prizes, marketplace funds ──
  /^payment\./i,
  /^card-mint\./i,
  /mint_failed/i,
  /transferFrom_failed/i,
  /admin_wallet/i,
  /^prizes\.withdrawal/i,
  /^marketplace\.buy_execution_failed/i,
  /^marketplace\.buy_card_funding_failed/i,
  // ── Promos not working / not paying out ──
  /^promo\.claim/i,
  /^promo\.jp_reveal_failed/i,
  /^draft\.promo_jackpot/i,
  // ── Security / auth integrity (not user-side connect hiccups) ──
  /^auth\.jwt_signature_invalid/i,
  /^auth\.jwks_fetch_failed/i,
  /^kyc\.webhook_invalid_signature/i,
  /^notifications\.config\.secret_missing/i,
  // ── A page genuinely crashed to the error screen for the user ──
  /^global\.react\.boundary/i,
  // ── State-integrity audits (proactive): a money/fairness invariant is
  //    violated in the data BEFORE a user trips on it. See lib/audits/. ──
  /^audit\.passes\.over/i,      // counter > real spendable tokens → user blocked at join
  /^audit\.passes\.duplicate/i, // two ledger records for ONE on-chain token → inflated pass count
  /^audit\.passes\.drafted_still_spendable/i, // a drafted/used pass still counted/usable → "pass came back"
  /^audit\.balance\.negative/i, // negative money/pass counter → corruption
  /^prizes\.double_payout_blocked/i, // admin pay refused — a prize was already paid by another withdrawal
  /^prizes\.mark_processing_failed/i, // withdraw-all couldn't set the processing lock → double-withdraw window open
  // ── LIVE endpoint canaries (lib/audits/canary.ts): a critical route's contract
  //    silently broke. These catch the #12-class silent regression in minutes. ──
  /^audit\.promo\.recording_down/i,       // promo routes 401'ing tokenless calls → ALL promo recording broken NOW
  /^audit\.security\.withdraw_auth_open/i, // withdraw route accepted a tokenless call → auth guard regressed (money path)
  /^audit\.cron\.stopped/i,               // a critical cron went dark → the safety net it powers is down
];

// "Low" = fallback/transient/cosmetic errors that don't cause a
// user-visible failure on the happy path. Keeps the warning section
// uncluttered. Add a pattern here only after confirming the failure
// path has a working primary recovery (so the error is genuinely
// non-impacting).
const LOW_PATTERNS: RegExp[] = [
  /^draft\.watchdog_resync_failed/i,         // fallback path; RTDB primary still serves the user
  /^draft\.firebase_rtdb_timeout/i,          // transient; reconnect logic handles it
  /^draft\.firebase_rtdb_permission_denied/i,// usually a stale ruleset hit on a since-removed field
  /^draft\.sort_preference_persist_failed/i, // user prefs; reverts on next reload
  /^draft\.preferences_load_failed/i,        // defaults apply if load fails
  // audit "under" = wallet has MORE real tokens than the counter shows — the
  // SAFE direction (user can't be blocked by it). Informational, not a fire.
  // The DANGEROUS direction (audit.passes.over) stays CRITICAL above.
  /^audit\.passes\.under/i,
  // Background "last active" telemetry write occasionally times out
  // (DEADLINE_EXCEEDED). Non-user-facing; the next heartbeat retries. Visible
  // in Low if it ever becomes a pattern, but it shouldn't page anyone.
  /^user\.activity\.touch_failed/i,
];

/** Triage tier for an error source — drives the admin Logs sections. */
export function logSeverity(source: string | undefined | null): LogSeverity {
  if (!source) return 'warning';
  if (CRITICAL_PATTERNS.some((p) => p.test(source))) return 'critical';
  if (LOW_PATTERNS.some((p) => p.test(source))) return 'low';
  return 'warning';
}

/* ── Cost-smart policy (never drops a real fire) ───────────────────
 * Tunes how aggressively each tier is throttled (client) and sampled
 * (ingest), so a noisy LOW source can't become a Firestore/Sentry
 * write-storm — while CRITICAL is never throttled or sampled.
 *   - throttleMs: client per-source dedupe window in reportClientError
 *   - ingestSampleRate: fraction of events the ingest route keeps (1 = all)
 */
export const SEVERITY_POLICY: Record<LogSeverity, { throttleMs: number; ingestSampleRate: number }> = {
  critical: { throttleMs: 0,        ingestSampleRate: 1 },    // every distinct critical, always
  warning:  { throttleMs: 120_000,  ingestSampleRate: 1 },    // 2-min dedupe, keep all
  low:      { throttleMs: 600_000,  ingestSampleRate: 0.1 },  // 10-min dedupe, keep 1 in 10
};

/** Cost-smart throttle window for a source's tier (client-side dedupe). */
export function throttleMsForSource(source: string | undefined | null): number {
  return SEVERITY_POLICY[logSeverity(source)].throttleMs;
}

/* ── Test-traffic detection ────────────────────────────────────── */

// Staging is hammered by the Playwright e2e suite, which hits the
// backend with fake draft ids / wallets (test-reentry-draft-123,
// 0xTestWallet123, …). Those are real 500s but not user-facing — keep
// them out of the admin feed + badge so genuine issues stand out.
const TEST_MARKERS =
  /0x[0-9a-z]{0,6}testwall|testwallet|\/draft[\w-]*\/test-|\btest-(reentry|no-randomize|fast-draft|slow-draft|draft)|test-draft/i;

export function isTestNoiseError(e: {
  source?: string;
  route?: string;
  message?: string;
  actor?: string;
  context?: Record<string, unknown>;
}): boolean {
  const hay = [
    e.source ?? '',
    e.route ?? '',
    e.message ?? '',
    e.actor ?? '',
    e.context ? JSON.stringify(e.context) : '',
  ].join(' ');
  return TEST_MARKERS.test(hay);
}

// Source dot-prefixes that don't equal their area name.
const PREFIX_TO_AREA: Record<string, LogArea> = {
  ws: 'draft',
  'card-mint': 'payment',
  go: 'backend',
  server: 'backend',
  api: 'backend',
  client: 'other',
};

/**
 * Derive the log area from a source string via its dot-prefix.
 * Reused by the admin Logs tab filter and scripts/logs.mjs so the
 * UI, CLI, and registry never drift.
 */
export function logAreaForSource(source: string | undefined | null): LogArea {
  if (!source) return 'other';
  // Legacy Go-bridge format is colon-separated, e.g. 'go:service/rev'.
  if (source.toLowerCase().startsWith('go:')) return 'backend';
  const prefix = source.split('.')[0]?.toLowerCase() ?? '';
  if (prefix in PREFIX_TO_AREA) return PREFIX_TO_AREA[prefix];
  if ((LOG_AREAS as readonly string[]).includes(prefix)) return prefix as LogArea;
  return 'other';
}

/* ── Plain-English explanations ────────────────────────────────── */

// Maps technical error text → a human sentence a non-dev can act on.
// First match wins. Matched against the error's source + message (or a
// Sentry issue title). Add a row here whenever a cryptic error shows up.
const EXPLANATIONS: { pattern: RegExp; text: string }[] = [
  { pattern: /aes\/gcm|ghash|invalid auth tag|bad decrypt|decryption failed/i,
    text: 'A secure connection failed to decrypt — usually a stale login session or a wallet connection that got interrupted.' },
  { pattern: /session expired|missing privy|access token/i,
    text: 'The login session expired — the user needs to log out and log back in.' },
  { pattern: /wallet_connect_timeout/i,
    text: 'A wallet connection hung and never finished.' },
  { pattern: /wallet_connect_abandoned/i,
    text: 'The user gave up on a wallet connection that was stuck.' },
  { pattern: /wallet_connect_failed/i,
    text: 'A wallet connection failed before completing.' },
  { pattern: /owed_pass_unfulfilled/i,
    text: 'URGENT: auto-recovery for an owed pass GAVE UP after 8 retries — the user PAID but never got their pass and the cron has stopped trying. Act now: 1) check the admin wallet (BBB4 owner) has enough ETH on Base for gas — out-of-gas is the usual cause; 2) re-grant via admin grant-drafts; 3) the record is in failed_mints with needsManual=true (look up by failedMintId / userId in the log context).' },
  { pattern: /reward_grant_failed/i,
    text: 'A card-fee reward draft failed to mint after the user crossed $25 in card fees — their credit was already consumed, so they are owed a free draft. Re-grant it via admin grant-drafts and see the failed_mints record (source: card_reward).' },
  { pattern: /mint_failed|card-mint/i,
    text: 'A pass mint failed — the user may have been charged. Worth checking.' },
  { pattern: /permit|signature|personal_sign|user rejected|user denied/i,
    text: 'A wallet signature failed or was declined by the user.' },
  { pattern: /global\.(uncaught|unhandled)|unhandledrejection/i,
    text: 'An unexpected crash — the code hit an error nothing was catching.' },
  { pattern: /react\.boundary|error boundary/i,
    text: 'A page crashed and showed the error screen to the user.' },
  { pattern: /\b5\d\d\b|internal server error/i,
    text: 'A server request failed (server-side error).' },
  { pattern: /\b40[13]\b|unauthorized|forbidden/i,
    text: 'A request was rejected for auth / permission reasons.' },
  { pattern: /timeout|timed out|etimedout/i,
    text: 'Something took too long and timed out — often a slow network or backend.' },
  { pattern: /failed to fetch|networkerror|load failed|err_network/i,
    text: 'A network request could not reach the server.' },
  { pattern: /firestore|rtdb|firebase/i,
    text: 'A database read or write failed.' },
  { pattern: /notifications\.push\.zero_recipients/i,
    text: 'Push notification fired but reached 0 of the user\'s devices — they need to re-enable notifications on each device (iOS often silently revokes PWA notification permission).' },
  { pattern: /notifications\.push\.send_failed/i,
    text: 'OneSignal push API call failed — check the OneSignal status page and the error reason for details.' },
  { pattern: /notifications\.email\.send_failed/i,
    text: 'Postmark email send failed — check Postmark dashboard for the rejection reason.' },
  { pattern: /notifications\.telegram\.send_failed/i,
    text: 'Telegram bot DM failed — usually because the user blocked the bot or the chat id is stale.' },
  { pattern: /notifications\.discord\.send_failed/i,
    text: 'Discord bot DM failed — the user may have changed accounts, the bot may have been kicked from the SBS server, or DMs are disabled on the user\'s account.' },
  // Admin ops — Phase 5/6 of the admin overhaul. Plain-English helps
  // an admin investigating their own broken broadcast quickly find the
  // root cause without reading our source.
  { pattern: /admin\.broadcast\.failed/i,
    text: 'A broadcast send failed before completing — check the reason field in context for which channel + provider error.' },
  { pattern: /admin\.bulk_grant\.failed/i,
    text: 'A bulk grant aborted before issuing all mints — partial result may have already landed; see audit log for per-wallet outcomes.' },
  { pattern: /admin\.digest\.failed/i,
    text: 'The daily digest failed to render or send. Cron will retry tomorrow; manual trigger is available in admin Tools.' },
  { pattern: /admin\.digest\.cron_failed/i,
    text: 'Cron-triggered digest send failed authentication or sending. Check CRON_SECRET env var first.' },
  { pattern: /admin\.error_runbooks\.(save|list)_failed/i,
    text: 'Runbook read/save against Firestore failed. The editor falls back to localStorage so notes aren\'t lost.' },
  { pattern: /admin\.user_notes\.(create|list)_failed/i,
    text: 'Per-user admin note read/write against Firestore failed. Surface the error to the admin who tried to add the note.' },
  { pattern: /admin\.audit\.write_failed/i,
    text: 'An admin action ran successfully but the audit log write failed. The parent action did not fail because of this.' },
];

/**
 * Plain-English explanation for an error, or null if nothing matches.
 * Pass any combination of source / message / title — they're all searched.
 */
export function explainError(...parts: (string | undefined | null)[]): string | null {
  const hay = parts.filter(Boolean).join(' ');
  if (!hay) return null;
  for (const e of EXPLANATIONS) {
    if (e.pattern.test(hay)) return e.text;
  }
  return null;
}
