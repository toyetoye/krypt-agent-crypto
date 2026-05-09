import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const SNAPSHOT_FILE = path.join(DATA_DIR, "latestSnapshot.json");
const TRADES_FILE = path.join(DATA_DIR, "trades.jsonl");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function writeSnapshot(data: any) {
  ensureDir();

  fs.writeFileSync(
    SNAPSHOT_FILE,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        rows: data,
      },
      null,
      2
    )
  );
}

export function appendTrade(trade: any) {
  ensureDir();

  fs.appendFileSync(
    TRADES_FILE,
    JSON.stringify({
      time: new Date().toISOString(),
      ...trade,
    }) + "\n"
  );
}
const MARKS_FILE = path.join(DATA_DIR, "marks.jsonl");

export function appendMark(mark: any) {
  ensureDir();

  fs.appendFileSync(
    MARKS_FILE,
    JSON.stringify({
      time: new Date().toISOString(),
      ...mark,
    }) + "\n"
  );
}