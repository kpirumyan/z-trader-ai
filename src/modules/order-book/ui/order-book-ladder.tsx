import styles from "./order-book-ladder.module.css";
import { OrderBookRowComponent } from "./order-book-row";

import type { OrderBookRow } from "../types";

interface SpreadRowProps {
  readonly bestBid: number | null;
  readonly bestAsk: number | null;
  readonly spread: number | null;
  readonly spreadPct: number | null;
}

function SpreadRow({ bestBid, bestAsk, spread, spreadPct }: SpreadRowProps) {
  const formattedSpread = spread !== null ? Number(spread.toFixed(4)) : "-";
  const formattedSpreadPct = spreadPct !== null ? `${Number(spreadPct.toFixed(2))}%` : null;

  return (
    <div className={styles.spreadRow} data-testid="order-book-spread">
      <div className={styles.spreadBid}>
        <span className={styles.spreadLabel}>Bid</span>
        <span className={styles.bidPrice}>{bestBid !== null ? bestBid : "-"}</span>
      </div>

      <div className={styles.spreadMiddle}>
        <span className={styles.spreadLabel}>Spread</span>
        <span className={styles.spreadValue}>
          {formattedSpread}
          {formattedSpreadPct && <span className={styles.spreadPct}> ({formattedSpreadPct})</span>}
        </span>
      </div>

      <div className={styles.spreadAsk}>
        <span className={styles.spreadLabel}>Ask</span>
        <span className={styles.askPrice}>{bestAsk !== null ? bestAsk : "-"}</span>
      </div>
    </div>
  );
}

export interface OrderBookLadderProps {
  readonly bids: readonly OrderBookRow[];
  readonly asks: readonly OrderBookRow[];
  readonly bestBid: number | null;
  readonly bestAsk: number | null;
  readonly spread: number | null;
  readonly spreadPct: number | null;
  readonly onSelectPrice?: (price: number) => void;
}

export function OrderBookLadder({
  bids,
  asks,
  bestBid,
  bestAsk,
  spread,
  spreadPct,
  onSelectPrice,
}: OrderBookLadderProps) {
  // Asks are displayed above the spread row, with the lowest ask closest to the spread.
  // In state, asks are ordered ascending (bestAsk at index 0).
  // Reversing puts the highest ask at the top and bestAsk at the bottom of the section.
  const displayAsks = [...asks].reverse();

  return (
    <div className={styles.ladder} role="table" aria-label="Order book ladder">
      <div className={styles.tableHeader} role="row">
        <span className={styles.colPrice} role="columnheader">
          Price
        </span>
        <span className={styles.colSize} role="columnheader">
          Size
        </span>
        <span className={styles.colTotal} role="columnheader">
          Total
        </span>
      </div>

      <div className={styles.ladderBody}>
        <div className={styles.asksSection} role="rowgroup" aria-label="Asks">
          {displayAsks.map((row) => (
            <OrderBookRowComponent
              key={`ask-${row.price}`}
              row={row}
              onSelectPrice={onSelectPrice}
            />
          ))}
        </div>

        <SpreadRow bestBid={bestBid} bestAsk={bestAsk} spread={spread} spreadPct={spreadPct} />

        <div className={styles.bidsSection} role="rowgroup" aria-label="Bids">
          {bids.map((row) => (
            <OrderBookRowComponent
              key={`bid-${row.price}`}
              row={row}
              onSelectPrice={onSelectPrice}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
