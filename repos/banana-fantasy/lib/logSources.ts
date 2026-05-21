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
  'admin',
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
    WS_TOKEN_FETCH_FAILED: 'draft.ws.token_fetch_failed',
    WS_MESSAGE_PARSE_FAILED: 'draft.ws.message_parse_failed',
    WS_RECONNECT_FAILED: 'draft.ws.reconnect_failed',
    JOIN_FAILED: 'draft.join_failed',
    LIVE_LOAD_EXHAUSTED: 'draft.live_load_exhausted_retries',
    PICK_SUBMIT_UNHANDLED: 'draft.pick_submit_unhandled_error',
    AUTOPICK_SUBMIT_FAILED: 'draft.autopick_submit_failed',
    AUTOPICK_TOGGLE_FAILED: 'draft.autopick_toggle_failed',
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
  },
  promo: {
    CLAIM_BATCH_PARTIAL_FAILED: 'promo.claim.batch_partial_failed',
    CLAIM_FAILED: 'promo.claim.failed',
    JP_REVEAL_FAILED: 'promo.jp_reveal_failed',
    TWEET_VERIFY_FAILED: 'promo.tweet_verify_failed',
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
  },
  profile: {
    ACTIVITY_FETCH_FAILED: 'profile.activity_fetch_failed',
  },
  global: {
    UNCAUGHT_ERROR: 'global.uncaught.error',
    UNHANDLED_REJECTION: 'global.unhandled.rejection',
    REACT_BOUNDARY: 'global.react.boundary',
  },
} as const;

/* ── Severity ──────────────────────────────────────────────────── */

export type LogSeverity = 'critical' | 'warning';

// Critical = fix right away: money flows, app crashes, draft-blocking
// failures, broken login. Everything else is a warning — something
// failed but the app limps on.
const CRITICAL_PATTERNS: RegExp[] = [
  /^global\./i,                       // uncaught crashes + React boundary
  /unhandled/i,
  /^payment\./i,
  /^card-mint\./i,
  /mint_failed/i,
  /transferFrom_failed/i,
  /^auth\./i,                         // login broken
  /^prizes\.withdrawal/i,
  /admin_wallet/i,
  /^draft\.join_failed/i,
  /^draft\.live_load_exhausted/i,
  /^draft\.ws\.token_fetch_failed/i,
  /^draft\.pick_submit/i,
  /^draft\.autopick_submit/i,
];

/** Triage tier for an error source — drives the admin Logs sections. */
export function logSeverity(source: string | undefined | null): LogSeverity {
  if (!source) return 'warning';
  return CRITICAL_PATTERNS.some((p) => p.test(source)) ? 'critical' : 'warning';
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
