import fs from "fs";
import path from "path";

export type PositionSide = "LONG_PERP_SHORT_SPOT" | "SHORT_PERP_LONG_SPOT";

export type PaperPosition = {
  symbol: string;
  side: PositionSide;
  notionalUsd: number;
  entryFundingRate: number;
  entryBasisPct: number;
  openedAt: string;
};

export type PositionMark = {
  symbol: string;
  estimatedFundingPnlUsd: number;
  basisPnlUsd: number;
  netPnlUsd: number;
  hoursOpen: number;
};

const DATA_DIR = path.join(process.cwd(), "data");
const POSITIONS_FILE = path.join(DATA_DIR, "positions.json");

export class PaperAccount {
  cashUsd: number;
  positions: PaperPosition[];

  constructor(startingCash = 10000) {
    this.cashUsd = startingCash;
    this.positions = [];
    this.load();
  }

  load() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    if (!fs.existsSync(POSITIONS_FILE)) {
      this.save();
      return;
    }

    const raw = fs.readFileSync(POSITIONS_FILE, "utf-8");
    if (!raw.trim()) return;

    const data = JSON.parse(raw);
    this.cashUsd = data.cashUsd ?? this.cashUsd;
    this.positions = data.positions ?? [];
  }

  save() {
    fs.writeFileSync(
      POSITIONS_FILE,
      JSON.stringify(
        {
          cashUsd: this.cashUsd,
          positions: this.positions,
          updatedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );
  }

  hasOpenPosition(symbol: string) {
    return this.positions.some((p) => p.symbol === symbol);
  }

  canOpen(notionalUsd: number) {
    return this.cashUsd >= notionalUsd;
  }

  open(position: PaperPosition) {
    if (this.hasOpenPosition(position.symbol)) {
      console.log(`Position already open for ${position.symbol}; skipping.`);
      return;
    }

    if (!this.canOpen(position.notionalUsd)) {
      throw new Error("Insufficient paper cash");
    }

    this.cashUsd -= position.notionalUsd;
    this.positions.push(position);
    this.save();

    console.log("\nOPENED PAPER POSITION");
    console.table(position);
  }

  close(symbol: string, pnlUsd: number, reason: string) {
    const idx = this.positions.findIndex((p) => p.symbol === symbol);
    if (idx === -1) return;

    const position = this.positions[idx];

    this.cashUsd += position.notionalUsd + pnlUsd;
    this.positions.splice(idx, 1);
    this.save();

    console.log(`\nCLOSED ${symbol}`);
    console.table({
      pnlUsd,
      reason,
      newCashBalance: this.cashUsd,
    });
  }

  mark(symbol: string, currentFundingRate: number, currentBasisPct: number): PositionMark | null {
    const position = this.positions.find((p) => p.symbol === symbol);
    if (!position) return null;

    const hoursOpen =
      (Date.now() - new Date(position.openedAt).getTime()) / 1000 / 60 / 60;

    const fundingPeriods = hoursOpen / 8;

    const estimatedFundingPnlUsd =
      position.notionalUsd * Math.abs(position.entryFundingRate) * fundingPeriods;

    const basisMovePct = currentBasisPct - position.entryBasisPct;

    const basisPnlUsd =
      (basisMovePct / 100) * position.notionalUsd;

    const netPnlUsd =
      estimatedFundingPnlUsd + basisPnlUsd;

    return {
      symbol,
      estimatedFundingPnlUsd,
      basisPnlUsd,
      netPnlUsd,
      hoursOpen,
    };
  }

  summary() {
    console.log("\n=== PAPER ACCOUNT ===");
    console.table({
      cashUsd: this.cashUsd,
      openPositions: this.positions.length,
      deployedUsd: this.positions.reduce((a, p) => a + p.notionalUsd, 0),
    });
  }
}