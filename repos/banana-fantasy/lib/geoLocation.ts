/**
 * Request geolocation from Vercel's edge headers.
 *
 * Vercel injects `x-vercel-ip-*` headers on every request to a deployed
 * function (absent in local dev, so all fields come back null there). This is
 * the ONLY location signal we have — MoonPay's real NY gate is the user's KYC
 * residence, which runs inside Privy and we can't see. So IP is an approximation
 * of where they're connecting from, not their legal residence.
 *
 * Phase 0 of NY buy-support (2026-07-08): we OBSERVE this per user to decide
 * whether IP detection is accurate enough to route NY buyers to the Optimism
 * on-ramp path, or whether we need to ask them their state on the card screen.
 * Read-only signal — it does not gate or change any behavior on its own.
 */

export interface RequestGeo {
  /** ISO country code, e.g. "US". */
  country: string | null;
  /** Region/state code — for the US this is the 2-letter state, e.g. "NY". */
  region: string | null;
  /** City name (Vercel URL-encodes it), e.g. "New York". */
  city: string | null;
}

function clean(v: string | null): string | null {
  const s = (v ?? '').trim();
  return s.length > 0 ? s : null;
}

export function getRequestGeo(req: Request): RequestGeo {
  const h = req.headers;
  const rawCity = clean(h.get('x-vercel-ip-city'));
  let city: string | null = rawCity;
  if (rawCity) {
    try { city = decodeURIComponent(rawCity); } catch { city = rawCity; }
  }
  return {
    country: clean(h.get('x-vercel-ip-country')),
    region: clean(h.get('x-vercel-ip-country-region')),
    city,
  };
}

/** True when Vercel geolocates this request to New York state. */
export function isNewYorkRequest(req: Request): boolean {
  const g = getRequestGeo(req);
  return g.country === 'US' && g.region === 'NY';
}
