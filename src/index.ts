import { getTicker, getFundingRate } from "./exchanges/binanceClient";

async function main() {
  try {
    const btc = await getTicker("BTC/USDT");
    const eth = await getTicker("ETH/USDT");

    const btcFunding = await getFundingRate("BTC/USDT:USDT");
    const ethFunding = await getFundingRate("ETH/USDT:USDT");

    console.log("\n=== MARKET SNAPSHOT ===");
    console.table([btc, eth]);

    console.log("\n=== FUNDING SNAPSHOT ===");
    console.table([btcFunding, ethFunding]);
  } catch (err) {
    console.error(err);
  }
}

main();
