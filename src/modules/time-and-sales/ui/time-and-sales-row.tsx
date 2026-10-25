import { cn } from "@/src/shared/lib";

import styles from "./time-and-sales-row.module.css";

import type { TimeAndSalesRow } from "../types";

export interface TimeAndSalesRowProps {
  readonly row: TimeAndSalesRow;
}

export function TimeAndSalesRowComponent({ row }: TimeAndSalesRowProps) {
  const isBuy = row.side === "buy";
  const sideClass = isBuy ? styles.buy : styles.sell;

  return (
    <tr
      className={cn(
        styles.row,
        isBuy ? styles.buyRow : styles.sellRow,
        row.isLarge && styles.largeRow,
      )}
      data-testid={`trade-row-${row.id}`}
      data-side={row.side}
      data-large={row.isLarge ? "true" : undefined}
    >
      <td className={cn(styles.cell, styles.time)}>{row.formattedTime}</td>
      <td className={cn(styles.cell, styles.price, sideClass)}>{row.formattedPrice}</td>
      <td className={cn(styles.cell, styles.size, row.isLarge && styles.largeSize)}>
        <span>{row.size}</span>
        {row.isLarge && <span className={styles.largeSizeBadge}>L</span>}
      </td>
      <td className={cn(styles.cell, styles.side, sideClass)}>{isBuy ? "Buy" : "Sell"}</td>
    </tr>
  );
}
