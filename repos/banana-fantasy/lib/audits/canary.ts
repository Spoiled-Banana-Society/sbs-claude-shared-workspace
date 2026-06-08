/**
 * LIVE endpoint canaries — the "is the pipeline working RIGHT NOW" layer.
 *
 * State audits (checks.ts) catch data that has silently DRIFTED. Canaries catch
 * the other invisible failure mode: a critical route's CONTRACT silently breaks
 * and nothing throws. The #12 incident is the archetype — the promo routes
 * started 401'ing every (tokenless) in-app call, so ALL promo recording stopped
 * for everyone, yet nothing in the feed showed it for days (a 401 looks like a
 * normal auth rejection, not a failure).
 *
 * Each canary asserts a route's contract with a SAFE, NON-MUTATING probe:
 *
 *  - Promo routes MUST ACCEPT a tokenless call (the in-app client sends no
 *    Authorization header). We POST tokenless with NO draftId, so the route
 *    fails at input-validation (400) BEFORE the gate or any write. A 401/403
 *    means the caller-auth regression is back → promos silently broken.
 *
 *  - Withdraw routes MUST REJECT a tokenless call (only the authenticated wallet
 *    may withdraw — bug #2). We POST tokenless and require exactly 401. Anything
 *    else means the auth guard regressed → a request could act on another wallet
 *    without being logged in. Money path exposed.
 *
 * Cheap (a handful of HTTP calls) so it runs every few minutes via
 * /api/crons/health-canary — blast radius is minutes, not days. Findings flow
 * into the SAME Logs feed as everything else (critical-tiered by `source`).
 *
 * Add a new contract by appending a Probe — that's the whole extension point.
 */
import type { AuditFinding } from './checks';

// Obvious non-real marker address so any stray data/log is clearly the canary.
const CANARY_USER = '0x000000000000000000000000000000000000ca11';

type Contract = 'must-accept-tokenless' | 'must-reject-tokenless';

interface Probe {
  route: string;
  body: Record<string, unknown>;
  contract: Contract;
  source: string;   // drives severity + area via logSeverity()/logAreaForSource()
  label: string;    // human label for the message
}

const PROBES: Probe[] = [
  // Promo recording must accept tokenless calls (client fires them with no token).
  { route: '/api/promos/draft-complete', body: { userId: CANARY_USER }, contract: 'must-accept-tokenless', source: 'audit.promo.recording_down', label: 'daily-drafts' },
  { route: '/api/promos/pick10',         body: { userId: CANARY_USER }, contract: 'must-accept-tokenless', source: 'audit.promo.recording_down', label: 'pick-10' },
  { route: '/api/promos/jackpot-hit',    body: { userId: CANARY_USER }, contract: 'must-accept-tokenless', source: 'audit.promo.recording_down', label: 'jackpot' },
  // Withdrawals must reject tokenless calls (#2 — only the authed wallet may withdraw).
  { route: '/api/prizes/withdraw',     body: { userId: CANARY_USER, draftId: 'canary', amount: 1, method: 'usdc' }, contract: 'must-reject-tokenless', source: 'audit.security.withdraw_auth_open', label: 'withdraw' },
  { route: '/api/prizes/withdraw-all', body: { userId: CANARY_USER },                                               contract: 'must-reject-tokenless', source: 'audit.security.withdraw_auth_open', label: 'withdraw-all' },
];

export async function runEndpointCanaries(baseUrl: string): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const base = baseUrl.replace(/\/$/, '');

  for (const p of PROBES) {
    let status = 0;
    try {
      const res = await fetch(`${base}${p.route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p.body),
        signal: AbortSignal.timeout(8000),
      });
      status = res.status;
    } catch (err) {
      // Couldn't reach it — transient/network; warn (don't cry wolf as critical).
      findings.push({
        source: 'audit.canary.unreachable',
        severity: 'warning',
        message: `Health canary could not reach ${p.route}: ${(err as Error).message}`,
        context: { route: p.route },
      });
      continue;
    }

    if (status === 429) continue; // rate-limited probe — inconclusive, skip.
    const rejected = status === 401 || status === 403;

    if (p.contract === 'must-accept-tokenless' && rejected) {
      findings.push({
        source: p.source,
        severity: 'critical',
        actor: CANARY_USER,
        message: `${p.route} rejected a NORMAL tokenless call with HTTP ${status} — ${p.label} recording is SILENTLY BROKEN for all users right now. The in-app client sends no auth token; every call is being ${status}'d (the #12 regression). Fix: the route's caller-auth must be token-OPTIONAL.`,
        context: { route: p.route, status, expected: '400 (not 401/403)', promo: p.label },
      });
    } else if (p.contract === 'must-reject-tokenless' && status !== 401) {
      findings.push({
        source: p.source,
        severity: 'critical',
        actor: CANARY_USER,
        message: `${p.route} did NOT reject a tokenless call (HTTP ${status}, expected 401) — the withdrawal auth guard (#2) has regressed: a request could act on another wallet WITHOUT being authenticated. Money path exposed.`,
        context: { route: p.route, status, expected: '401', endpoint: p.label },
      });
    }
  }

  return findings;
}
