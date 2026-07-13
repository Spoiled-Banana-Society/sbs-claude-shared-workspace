// Server-side ETH→USD spot price, cached in-module for 60s.
//
// Our marketplace lists in USDC, so OpenSea's collection stats are normally
// already USD-equivalent. But if the cheapest listing happens to be ETH-priced
// (e.g. someone listed directly on OpenSea), OpenSea reports floor/volume/avg in
// ETH. We convert those to USD so the UI can always show a real dollar figure.
//
// Source: Coinbase public spot endpoint (no API key). Falls back to the last
// cached value, then 0, on any failure — callers treat 0 as "couldn't convert,
// leave the native value as-is".

let cached: { usd: number; at: number } | null = null;
const TTL_MS = 60_000;

export async function getEthUsd(): Promise<number> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.usd;
  try {
    const res = await fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot', {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      const usd = Number(data?.data?.amount);
      if (Number.isFinite(usd) && usd > 0) {
        cached = { usd, at: Date.now() };
        return usd;
      }
    }
  } catch {
    // fall through to cached/0
  }
  return cached?.usd ?? 0;
}

/** True for native/wrapped ETH symbols OpenSea may return for a floor price. */
export function isEthSymbol(symbol: string | null | undefined): boolean {
  const s = (symbol ?? '').toUpperCase();
  return s === 'ETH' || s === 'WETH';
}
