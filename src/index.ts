import { getSpotTicker, getFuturesTicker, getPremiumIndex } from "./exchanges/binanceClient";
import { PaperAccount, PositionSide } from "./portfolio/paperAccount";
import { writeSnapshot, appendTrade, appendMark } from "./data/logger";

const WATCH_INTERVAL_MS = 30_000;
const DECISION_EVERY_TICKS = 1;

const POSITION_SIZE_USD = 2000;

const ENTRY_THRESHOLD_ANNUALIZED = 4;
const EXIT_FUNDING_COLLAPSE_ANNUALIZED = 3;

const TAKE_PROFIT_USD = 20;
const STOP_LOSS_USD = -(TAKE_PROFIT_USD / 2);
const BASIS_STOP_LOSS_USD = -(TAKE_PROFIT_USD / 4);

const MAX_ENTRY_BASIS_ABS_PCT = 0.12;
const MAX_HOLD_HOURS = 8;

type BotState =
  | "WAITING_FOR_SETUP"
  | "IN_POSITION"
  | "OPENING_POSITION"
  | "EXIT_TRIGGERED"
  | "ERROR";

type FundingRow = {
  symbol: string;
  spotLast: number;
  futuresLast: number;
  fundingRate: number;
  annualizedFundingPct: number;
  basisPct: number;
  signal: string;
  state: BotState;
  stateReason: string;
  mark?: {
    id: string;
    symbol: string;
    estimatedFundingPnlUsd: number;
    basisPnlUsd: number;
    netPnlUsd: number;
    hoursOpen: number;
  };
};

const account = new PaperAccount(10000);

function toNum(value: string | number | undefined): number {
  return Number(value ?? 0);
}

function buildSignal(annualizedFundingPct: number): string {
  if (annualizedFundingPct > 0) return "SHORT_PERP_LONG_SPOT";
  if (annualizedFundingPct < 0) return "LONG_PERP_SHORT_SPOT";
  return "NONE";
}

function setupReason(row: Pick<FundingRow, "annualizedFundingPct" | "basisPct" | "signal">): string {
  if (Math.abs(row.annualizedFundingPct) < ENTRY_THRESHOLD_ANNUALIZED) {
    return `Funding below entry threshold: ${row.annualizedFundingPct.toFixed(2)}% < ${ENTRY_THRESHOLD_ANNUALIZED}%`;
  }

  if (Math.abs(row.basisPct) > MAX_ENTRY_BASIS_ABS_PCT) {
    return `Basis too stretched: ${row.basisPct.toFixed(4)}% > ${MAX_ENTRY_BASIS_ABS_PCT}%`;
  }

  if (row.signal === "NONE") {
    return "No directional funding signal";
  }

  return "Setup valid";
}

async function scanSymbol(symbol: string): Promise<FundingRow> {
  const spot = await getSpotTicker(symbol);
  const futures = await getFuturesTicker(symbol);
  const premium = await getPremiumIndex(symbol);

  const spotLast = toNum(spot.lastPrice);
  const futuresLast = toNum(futures.lastPrice);
  const fundingRate = toNum(premium.lastFundingRate);
  const annualizedFundingPct = fundingRate * 3 * 365 * 100;
  const basisPct = ((futuresLast - spotLast) / spotLast) * 100;
  const signal = buildSignal(annualizedFundingPct);

  const baseRow = {
    symbol,
    spotLast,
    futuresLast,
    fundingRate,
    annualizedFundingPct,
    basisPct,
    signal,
  };

  return {
    ...baseRow,
    state: "WAITING_FOR_SETUP",
    stateReason: setupReason(baseRow),
  };
}

function exitReason(row: FundingRow, mark: FundingRow["mark"]): string | null {
  if (!mark) return null;

  if (mark.netPnlUsd >= TAKE_PROFIT_USD) return "TAKE_PROFIT";
  if (mark.basisPnlUsd <= BASIS_STOP_LOSS_USD) return "BASIS_STOP_LOSS";
  if (mark.netPnlUsd <= STOP_LOSS_USD) return "STOP_LOSS_HALF_TP";
  if (mark.hoursOpen >= MAX_HOLD_HOURS) return "MAX_HOLD_TIME";

  if (Math.abs(row.annualizedFundingPct) < EXIT_FUNDING_COLLAPSE_ANNUALIZED) {
    return "FUNDING_COLLAPSE";
  }

  return null;
}

async function tick(tickNo: number) {
  const isDecisionTick = tickNo % DECISION_EVERY_TICKS === 0;
  const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

  console.log(`\n=== Tick ${tickNo} | ${new Date().toISOString()} | decision=${isDecisionTick} ===`);

  const snapshot: FundingRow[] = [];

  for (const symbol of symbols) {
    try {
      const row = await scanSymbol(symbol);

      const mark = account.mark(row.symbol, row.fundingRate, row.basisPct);

      if (mark) {
        row.mark = mark;
        row.state = "IN_POSITION";
        row.stateReason = "Position open; marking live P&L";

        appendMark({
          id: mark.id,
          symbol: row.symbol,
          spotLast: row.spotLast,
          futuresLast: row.futuresLast,
          fundingRate: row.fundingRate,
          annualizedFundingPct: row.annualizedFundingPct,
          basisPct: row.basisPct,
          estimatedFundingPnlUsd: mark.estimatedFundingPnlUsd,
          basisPnlUsd: mark.basisPnlUsd,
          netPnlUsd: mark.netPnlUsd,
          hoursOpen: mark.hoursOpen,
        });
      }

      snapshot.push(row);

      if (isDecisionTick && mark) {
        const reason = exitReason(row, mark);

        if (reason) {
          row.state = "EXIT_TRIGGERED";
          row.stateReason = reason;

          const closed = account.close(row.symbol, mark, reason);

          if (closed) {
            appendTrade({
              type: "CLOSE",
              id: closed.id,
              symbol: row.symbol,
              side: closed.side,
              pnlUsd: mark.netPnlUsd,
              fundingPnlUsd: mark.estimatedFundingPnlUsd,
              basisPnlUsd: mark.basisPnlUsd,
              reason,
            });
          }

          continue;
        }
      }

      const entryValid =
        isDecisionTick &&
        Math.abs(row.annualizedFundingPct) >= ENTRY_THRESHOLD_ANNUALIZED &&
        Math.abs(row.basisPct) <= MAX_ENTRY_BASIS_ABS_PCT &&
        row.signal !== "NONE" &&
        account.positions.length < 3 &&
        account.canOpen(POSITION_SIZE_USD);

      if (entryValid) {
        row.state = "OPENING_POSITION";
        row.stateReason = "Entry threshold and basis filter met";

        const opened = account.open({
          symbol: row.symbol,
          side: row.signal as PositionSide,
          notionalUsd: Math.min(account.cashUsd * 0.35, 2500),
          entryFundingRate: row.fundingRate,
          entryBasisPct: row.basisPct,
          openedAt: new Date().toISOString(),
        });

        if (opened) {
          appendTrade({
            type: "OPEN",
            id: opened.id,
            symbol: row.symbol,
            side: opened.side,
            notionalUsd: opened.notionalUsd,
            entryFundingRate: opened.entryFundingRate,
            entryBasisPct: opened.entryBasisPct,
          });
        }
      }
    } catch (err) {
      console.error(`Failed ${symbol}:`, err);

      snapshot.push({
        symbol,
        spotLast: 0,
        futuresLast: 0,
        fundingRate: 0,
        annualizedFundingPct: 0,
        basisPct: 0,
        signal: "NONE",
        state: "ERROR",
        stateReason: String(err),
      });
    }
  }

  writeSnapshot(snapshot);

  console.table(
    snapshot.map((r) => ({
      symbol: r.symbol,
      state: r.state,
      reason: r.stateReason,
      spot: r.spotLast.toFixed(4),
      futures: r.futuresLast.toFixed(4),
      annualizedPct: r.annualizedFundingPct.toFixed(2),
      basisPct: r.basisPct.toFixed(4),
      signal: r.signal,
      netPnl: r.mark ? r.mark.netPnlUsd.toFixed(4) : "-",
      fundingPnl: r.mark ? r.mark.estimatedFundingPnlUsd.toFixed(4) : "-",
      basisPnl: r.mark ? r.mark.basisPnlUsd.toFixed(4) : "-",
    }))
  );

  account.summary();
}

async function main() {
  console.log("Krypt Agent Crypto daemon starting...");
  console.log(`Risk: TP=${TAKE_PROFIT_USD}, SL=${STOP_LOSS_USD}, Basis SL=${BASIS_STOP_LOSS_USD}`);
  console.log(
    `Entry threshold=${ENTRY_THRESHOLD_ANNUALIZED}% | Exit funding collapse=${EXIT_FUNDING_COLLAPSE_ANNUALIZED}% | Max entry basis=${MAX_ENTRY_BASIS_ABS_PCT}%`
  );

  let tickNo = 0;

  await tick(tickNo);

  setInterval(async () => {
    tickNo += 1;
    await tick(tickNo);
  }, WATCH_INTERVAL_MS);
}

main().catch(console.error);