import { cn } from "@/src/shared/lib";

import styles from "./order-book-row.module.css";

import type { OrderBookRow } from "../types";

export interface OrderBookRowProps {
  readonly row: OrderBookRow;
  readonly onSelectPrice?: (price: number) => void;
}

export function OrderBookRowComponent({ row, onSelectPrice }: OrderBookRowProps) {
  const handleClick = () => {
    onSelectPrice?.(row.price);
  };

  const isAsk = row.side === "sell";

  return (
    <div
      role="row"
      className={cn(styles.row, isAsk ? styles.rowAsk : styles.rowBid)}
      onClick={handleClick}
      data-price={row.price}
      data-side={row.side}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      <div
        className={cn(styles.depthBar, isAsk ? styles.depthBarAsk : styles.depthBarBid)}
        style={{ width: `${row.depthPercent}%` }}
        aria-hidden="true"
      />
      <span className={cn(styles.colPrice, isAsk ? styles.priceAsk : styles.priceBid)}>
        {row.price}
      </span>
      <span className={styles.colSize}>{row.size}</span>
      <span className={styles.colTotal}>{row.cumulativeSize}</span>
    </div>
  );
}
