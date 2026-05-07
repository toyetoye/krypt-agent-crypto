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

export class PaperAccount {
  cashUsd: number;
  positions: PaperPosition[];

  constructor(startingCash = 10000) {
    this.cashUsd = startingCash;
    this.positions = [];
  }

  canOpen(notionalUsd: number) {
    return this.cashUsd >= notionalUsd;
  }

  open(position: PaperPosition) {
    if (!this.canOpen(position.notionalUsd)) {
      throw new Error("Insufficient paper cash");
    }

    this.cashUsd -= position.notionalUsd;
    this.positions.push(position);

    console.log("\nOPENED PAPER POSITION");
    console.table(position);
    console.log("Remaining cash:", this.cashUsd.toFixed(2));
  }

  mark(symbol: string, currentFundingRate: number, currentBasisPct: number): PositionMark | null {
    const position = this.positions.find((p) => p.symbol === symbol);
    if (!position) return null;

    const hoursOpen =
      (Date.now() - new Date(position.openedAt).getTime()) / 1000 / 60 / 60;

    // Funding every 8h
    const fundingPeriods = hoursOpen / 8;

    const estimatedFundingPnlUsd =
      position.notionalUsd *
      Math.abs(position.entryFundingRate) *
      fundingPeriods;

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