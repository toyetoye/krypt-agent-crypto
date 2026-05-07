import { getSpotTicker, getFuturesTicker, getPremiumIndex } from "./exchanges/binanceClient";
import { PaperAccount, PositionSide } from "./portfolio/paperAccount";

type FundingRow = {
  symbol: string;
  fundingRate: number;
  annualizedFundingPct: number;
  basisPct: number;
  signal: string;
};

function toNum(value: string | number | undefined): number {
  return Number(value ?? 0);
}

function buildSignal(fundingRate: number): string {
  if (fundingRate > 0.00005) return "SHORT_PERP_LONG_SPOT";
  if (fundingRate < -0.00005) return "LONG_PERP_SHORT_SPOT";
  return "NONE";
}

async function scanSymbol(symbol: string): Promise<FundingRow> {
  const spot = await getSpotTicker(symbol);
  const futures = await getFuturesTicker(symbol);
  const premium = await getPremiumIndex(symbol);

  const spotLast = toNum(spot.lastPrice);
  const futuresLast = toNum(futures.lastPrice);
  const fundingRate = toNum(premium.lastFundingRate);

  return {
    symbol,
    fundingRate,
    annualizedFundingPct: fundingRate * 3 * 365 * 100,
    basisPct: ((futuresLast - spotLast) / spotLast) * 100,
    signal: buildSignal(fundingRate),
  };
}

async function main() {
  console.log("Krypt Agent Crypto P&L engine starting...\n");

  const account = new PaperAccount(10000);
  const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

  for (const symbol of symbols) {
    try {
      const row = await scanSymbol(symbol);

      console.table(row);

      // Open qualifying paper trade
      if (
        Math.abs(row.annualizedFundingPct) >= 8 &&
        row.signal !== "NONE" &&
        account.positions.length < 3 &&
        account.canOpen(2000)
      ) {
        account.open({
          symbol: row.symbol,
          side: row.signal as PositionSide,
          notionalUsd: 2000,
          entryFundingRate: row.fundingRate,
          entryBasisPct: row.basisPct,
          openedAt: new Date().toISOString(),
        });
      }

      // Mark existing position
      const mark = account.mark(
        row.symbol,
        row.fundingRate,
        row.basisPct
      );

      if (mark) {
        console.log("\nPOSITION MARK");
        console.table(mark);
      }
    } catch (err) {
      console.error(`Failed ${symbol}:`, err);
    }
  }

  account.summary();
}

main().catch(console.error);