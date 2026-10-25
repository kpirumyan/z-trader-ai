import { TimeAndSalesRowComponent } from "./time-and-sales-row";
import styles from "./time-and-sales-table.module.css";

import type { TimeAndSalesRow } from "../types";

export interface TimeAndSalesTableProps {
  readonly rows: readonly TimeAndSalesRow[];
  readonly emptyMessage?: string;
}

export function TimeAndSalesTable({ rows, emptyMessage }: TimeAndSalesTableProps) {
  return (
    <div className={styles.tableContainer}>
      <table className={styles.table} aria-label="Time and sales tape">
        <thead className={styles.thead}>
          <tr className={styles.headerRow}>
            <th className={styles.timeHeader} scope="col">
              Time
            </th>
            <th className={styles.priceHeader} scope="col">
              Price
            </th>
            <th className={styles.sizeHeader} scope="col">
              Size
            </th>
            <th className={styles.sideHeader} scope="col">
              Side
            </th>
          </tr>
        </thead>
        <tbody className={styles.tbody}>
          {rows.length > 0 ? (
            rows.map((row) => <TimeAndSalesRowComponent key={row.id} row={row} />)
          ) : emptyMessage ? (
            <tr className={styles.emptyRow}>
              <td colSpan={4} className={styles.emptyCell}>
                {emptyMessage}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
