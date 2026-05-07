const SPOT_BASE = "https://api.binance.com";
const FUTURES_BASE = "https://fapi.binance.com";

export async function getSpotTicker(symbol: string) {
  const res = await fetch(`${SPOT_BASE}/api/v3/ticker/24hr?symbol=${symbol}`);
  if (!res.ok) throw new Error(`Spot ticker failed: ${res.status}`);
  return res.json();
}

export async function getFuturesTicker(symbol: string) {
  const res = await fetch(`${FUTURES_BASE}/fapi/v1/ticker/24hr?symbol=${symbol}`);
  if (!res.ok) throw new Error(`Futures ticker failed: ${res.status}`);
  return res.json();
}

export async function getPremiumIndex(symbol: string) {
  const res = await fetch(`${FUTURES_BASE}/fapi/v1/premiumIndex?symbol=${symbol}`);
  if (!res.ok) throw new Error(`Premium index failed: ${res.status}`);
  return res.json();
}