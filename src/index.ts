import { getSpotTicker, getFuturesTicker, getPremiumIndex } from "./exchanges/binanceClient";
import { PaperAccount, PositionSide } from "./portfolio/paperAccount";

const ENTRY_THRESHOLD_ANNUALIZED = 7;
const EXIT_FUNDING_COLLAPSE_ANNUALIZED = 4;
const TAKE_PROFIT_USD = 20;
const STOP_LOSS_USD = -30;
const MAX_HOLD_HOURS = 72;
const POSITION_SIZE_USD = 2000;

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

function exitReason(row: FundingRow, mark: any): string | null {
  if (mark.netPnlUsd >= TAKE_PROFIT_USD) return "TAKE_PROFIT";
  if (mark.netPnlUsd <= STOP_LOSS_USD) return "STOP_LOSS";
  if (mark.hoursOpen >= MAX_HOLD_HOURS) return "MAX_HOLD_TIME";
  if (Math.abs(row.annualizedFundingPct) < EXIT_FUNDING_COLLAPSE_ANNUALIZED) {
    return "FUNDING_COLLAPSE";
  }
  return null;
}

async function main() {
  console.log("Krypt Agent Crypto exit engine starting...\n");

  const account = new PaperAccount(10000);
  const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

  for (const symbol of symbols) {
    try {
      const row = await scanSymbol(symbol);
      console.table(row);

      const mark = account.mark(row.symbol, row.fundingRate, row.basisPct);

      if (mark) {
        console.log("\nPOSITION MARK");
        console.table(mark);

        const reason = exitReason(row, mark);
        if (reason) {
          account.close(row.symbol, mark.netPnlUsd, reason);
          continue;
        }
      }

      if (
        Math.abs(row.annualizedFundingPct) >= ENTRY_THRESHOLD_ANNUALIZED &&
        row.signal !== "NONE" &&
        account.positions.length < 3 &&
        account.canOpen(POSITION_SIZE_USD)
      ) {
        account.open({
          symbol: row.symbol,
          side: row.signal as PositionSide,
          notionalUsd: POSITION_SIZE_USD,
          entryFundingRate: row.fundingRate,
          entryBasisPct: row.basisPct,
          openedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error(`Failed ${symbol}:`, err);
    }
  }

  account.summary();
}

main().catch(console.error);