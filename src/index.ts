import { getSpotTicker, getFuturesTicker, getPremiumIndex } from "./exchanges/binanceClient";

type FundingRow = {
  symbol: string;
  spotLast: number;
  futuresLast: number;
  markPrice: number;
  indexPrice: number;
  fundingRate: number;
  fundingPct: number;
  annualizedFundingPct: number;
  basisPct: number;
  signal: string;
  nextFundingTime: string;
};

function toNum(value: string | number | undefined): number {
  return Number(value ?? 0);
}

function buildSignal(fundingRate: number): string {
  if (fundingRate > 0.00005) return "Short perp + long spot may collect funding";
  if (fundingRate < -0.00005) return "Long perp + short spot may collect funding";
  return "No strong funding edge";
}

async function scanSymbol(symbol: string): Promise<FundingRow> {
  const spot = await getSpotTicker(symbol);
  const futures = await getFuturesTicker(symbol);
  const premium = await getPremiumIndex(symbol);

  const spotLast = toNum(spot.lastPrice);
  const futuresLast = toNum(futures.lastPrice);
  const markPrice = toNum(premium.markPrice);
  const indexPrice = toNum(premium.indexPrice);
  const fundingRate = toNum(premium.lastFundingRate);

  return {
    symbol,
    spotLast,
    futuresLast,
    markPrice,
    indexPrice,
    fundingRate,
    fundingPct: fundingRate * 100,
    annualizedFundingPct: fundingRate * 3 * 365 * 100,
    basisPct: ((futuresLast - spotLast) / spotLast) * 100,
    signal: buildSignal(fundingRate),
    nextFundingTime: new Date(Number(premium.nextFundingTime)).toISOString(),
  };
}

async function main() {
  console.log("Krypt Agent Crypto funding scanner starting...");

  const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"];
  const rows: FundingRow[] = [];

  for (const symbol of symbols) {
    try {
      rows.push(await scanSymbol(symbol));
    } catch (err) {
      console.error(`Failed to scan ${symbol}:`, err);
    }
  }

  rows.sort((a, b) => Math.abs(b.annualizedFundingPct) - Math.abs(a.annualizedFundingPct));

  console.table(
    rows.map((row) => ({
      symbol: row.symbol,
      spot: row.spotLast.toFixed(4),
      futures: row.futuresLast.toFixed(4),
      fundingPct: row.fundingPct.toFixed(5),
      annualizedPct: row.annualizedFundingPct.toFixed(2),
      basisPct: row.basisPct.toFixed(4),
      signal: row.signal,
      nextFunding: row.nextFundingTime,
    }))
  );
}

main().catch((err) => console.error("Fatal:", err));