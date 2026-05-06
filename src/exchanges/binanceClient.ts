import ccxt from "ccxt";

export const exchange = new ccxt.binance({
  enableRateLimit: true,
  options: {
    defaultType: "future",
  },
});

export async function getTicker(symbol: string) {
  const ticker = await exchange.fetchTicker(symbol);
  return {
    symbol,
    bid: ticker.bid,
    ask: ticker.ask,
    last: ticker.last,
    percentage: ticker.percentage,
    quoteVolume: ticker.quoteVolume,
    timestamp: ticker.timestamp,
  };
}

export async function getFundingRate(symbol: string) {
  const funding = await exchange.fetchFundingRate(symbol);
  return {
    symbol,
    fundingRate: funding.fundingRate,
    nextFundingRate: funding.nextFundingRate,
    timestamp: funding.timestamp,
  };
}
