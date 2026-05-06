// Centralised block-rule logic for SBS withdrawals.
// Run after Didit returns "Approved" to apply SBS-specific restrictions
// that Didit doesn't know about (best ball ban in AZ, parish ban in LA, etc).
//
// All inputs are the verified identity Didit returned — country/state/dob.
// Output is a structured rejection reason or null (allowed).

import type { VerifiedIdentity } from '@/lib/db-firestore';

export type BlockReasonCode =
  | 'COUNTRY_NOT_SUPPORTED'
  | 'STATE_DFS_BANNED'
  | 'STATE_BEST_BALL_BANNED'
  | 'PARISH_DFS_BANNED'
  | 'AGE_BELOW_STATE_MINIMUM'
  | 'AGE_BELOW_DEFAULT_MINIMUM'
  | 'MISSING_VERIFICATION_DATA'
  | 'PROVINCE_REQUIRES_LICENSE';

export interface BlockResult {
  blocked: boolean;
  code?: BlockReasonCode;
  message?: string;
  detail?: string;
}

// Outright DFS bans — state law forbids ALL fantasy sports formats.
// No license can fix this; only state legislation can change it.
const DFS_BANNED_STATES = new Set(['HI', 'ID', 'MT', 'NV', 'WA']);

// Best-ball specifically banned even though pick'em / others are allowed.
// SBS is best-ball draft format, so this is a hard block for our product.
const BEST_BALL_BANNED_STATES = new Set(['AZ']);

// Louisiana parishes that voted NO on the 2018 DFS legalisation referendum.
// 17 parishes total. All are in northern/central LA.
const LA_BANNED_PARISHES = new Set([
  'Allen',
  'Avoyelles',
  'Beauregard',
  'Caldwell',
  'Catahoula',
  'Franklin',
  'Grant',
  'Jackson',
  'Jefferson Davis',
  'LaSalle',
  'Morehouse',
  'Richland',
  'Sabine',
  'Union',
  'Vernon',
  'West Carroll',
  'Winn',
]);

// State-specific minimum age requirements above the default 18+.
const STATE_AGE_OVERRIDES: Record<string, number> = {
  AL: 19,
  NE: 19,
  IA: 21,
  LA: 21,
  MA: 21,
  VA: 21,
};

// Canadian provinces with their own DFS regulatory regime that requires a
// per-province license SBS doesn't hold. Currently only Ontario (AGCO).
// Per Boris (2026-05-06) we're keeping Ontario allowed for now and revisit
// once we have legal review — set this to a non-empty set to gate later.
const CA_LICENSE_REQUIRED_PROVINCES = new Set<string>([]);

const DEFAULT_MIN_AGE = 18;
const SUPPORTED_COUNTRIES = new Set(['US', 'USA', 'CA', 'CAN']);

function normaliseState(input: string | undefined): string {
  if (!input) return '';
  const s = input.trim().toUpperCase();
  // Accept full names too in case Didit sends "California" instead of "CA".
  // Common ones first; fall back to as-typed (likely already 2-letter).
  const FULL_TO_CODE: Record<string, string> = {
    HAWAII: 'HI',
    IDAHO: 'ID',
    MONTANA: 'MT',
    NEVADA: 'NV',
    WASHINGTON: 'WA',
    ARIZONA: 'AZ',
    LOUISIANA: 'LA',
    ALABAMA: 'AL',
    NEBRASKA: 'NE',
    IOWA: 'IA',
    MASSACHUSETTS: 'MA',
    VIRGINIA: 'VA',
    ONTARIO: 'ON',
  };
  return FULL_TO_CODE[s] ?? s;
}

function normaliseCountry(input: string | undefined): string {
  if (!input) return '';
  const s = input.trim().toUpperCase();
  if (s === 'UNITED STATES' || s === 'UNITED STATES OF AMERICA') return 'US';
  if (s === 'CANADA') return 'CA';
  return s;
}

function normaliseParish(input: string | undefined): string {
  if (!input) return '';
  // Strip "Parish" suffix and normalise capitalisation. LA parishes are
  // sometimes returned as "Allen Parish" or "ALLEN".
  return input
    .replace(/\bParish\b/gi, '')
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function calculateAge(dob: string | undefined, asOf = new Date()): number | null {
  if (!dob) return null;
  // Accept ISO date or YYYY-MM-DD
  const parsed = new Date(dob);
  if (Number.isNaN(parsed.getTime())) return null;
  let age = asOf.getFullYear() - parsed.getFullYear();
  const monthDelta = asOf.getMonth() - parsed.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && asOf.getDate() < parsed.getDate())) {
    age--;
  }
  return age;
}

export function checkBlockRules(identity: VerifiedIdentity | undefined): BlockResult {
  if (!identity || !identity.address) {
    return {
      blocked: true,
      code: 'MISSING_VERIFICATION_DATA',
      message: 'Identity verification incomplete. Please re-verify.',
    };
  }

  const country = normaliseCountry(identity.address.country);
  const state = normaliseState(identity.address.state);
  const parish = normaliseParish(identity.address.parish);

  // 1. Country gate — US + Canada only
  if (!SUPPORTED_COUNTRIES.has(country)) {
    return {
      blocked: true,
      code: 'COUNTRY_NOT_SUPPORTED',
      message: 'Withdrawals are currently available in the US and Canada only.',
      detail: `Detected country: ${identity.address.country || 'unknown'}`,
    };
  }

  // 2. US-specific state bans
  if (country === 'US' || country === 'USA') {
    if (DFS_BANNED_STATES.has(state)) {
      return {
        blocked: true,
        code: 'STATE_DFS_BANNED',
        message: `Daily fantasy sports are not permitted under ${state} state law.`,
        detail: state,
      };
    }
    if (BEST_BALL_BANNED_STATES.has(state)) {
      return {
        blocked: true,
        code: 'STATE_BEST_BALL_BANNED',
        message: `${state} does not permit best-ball fantasy contests. SBS uses the best-ball draft format.`,
        detail: state,
      };
    }
    if (state === 'LA' && parish && LA_BANNED_PARISHES.has(parish)) {
      return {
        blocked: true,
        code: 'PARISH_DFS_BANNED',
        message: `Your parish (${parish}) does not permit fantasy sports contests.`,
        detail: parish,
      };
    }
  }

  // 3. Canadian provinces requiring license SBS doesn't hold
  if (country === 'CA' || country === 'CAN') {
    if (CA_LICENSE_REQUIRED_PROVINCES.has(state)) {
      return {
        blocked: true,
        code: 'PROVINCE_REQUIRES_LICENSE',
        message: `${state} requires a separate operator license. SBS is not currently licensed there.`,
        detail: state,
      };
    }
  }

  // 4. Age check — state minimum where higher than 18, else default 18+
  const age = calculateAge(identity.dateOfBirth);
  if (age === null) {
    return {
      blocked: true,
      code: 'MISSING_VERIFICATION_DATA',
      message: 'Date of birth missing from verification. Please re-verify.',
    };
  }
  const minAge = STATE_AGE_OVERRIDES[state] ?? DEFAULT_MIN_AGE;
  if (age < minAge) {
    return {
      blocked: true,
      code:
        minAge > DEFAULT_MIN_AGE ? 'AGE_BELOW_STATE_MINIMUM' : 'AGE_BELOW_DEFAULT_MINIMUM',
      message:
        minAge > DEFAULT_MIN_AGE
          ? `You must be ${minAge}+ to withdraw in ${state}.`
          : `You must be ${minAge}+ to withdraw.`,
      detail: `Age ${age} below required ${minAge}`,
    };
  }

  return { blocked: false };
}
