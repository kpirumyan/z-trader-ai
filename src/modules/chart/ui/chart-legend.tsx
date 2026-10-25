import { cn } from "@/src/shared/lib";

import styles from "./chart-legend.module.css";

import type { Candle } from "@/src/shared/contracts";

export interface ChartLegendProps {
  readonly symbol: string;
  readonly candle: Candle | null;
}

export function ChartLegend({ symbol, candle }: ChartLegendProps) {
  if (!candle) {
    return (
      <div className={styles.legend} data-testid="chart-legend">
        <span className={styles.symbol}>{symbol}</span>
      </div>
    );
  }

  const change = candle.close - candle.open;
  const changePct = candle.open > 0 ? (change / candle.open) * 100 : 0;
  const isUp = change >= 0;

  return (
    <div className={styles.legend} data-testid="chart-legend">
      <span className={styles.symbol}>{symbol}</span>

      <span className={styles.item}>
        <span className={styles.label}>O:</span>
        <span className={styles.value}>{candle.open.toFixed(2)}</span>
      </span>

      <span className={styles.item}>
        <span className={styles.label}>H:</span>
        <span className={styles.value}>{candle.high.toFixed(2)}</span>
      </span>

      <span className={styles.item}>
        <span className={styles.label}>L:</span>
        <span className={styles.value}>{candle.low.toFixed(2)}</span>
      </span>

      <span className={styles.item}>
        <span className={styles.label}>C:</span>
        <span className={styles.value}>{candle.close.toFixed(2)}</span>
      </span>

      <span className={styles.item}>
        <span className={styles.label}>V:</span>
        <span className={styles.value}>{candle.volume.toLocaleString()}</span>
      </span>

      <span className={cn(styles.item, isUp ? styles.up : styles.down)}>
        <span className={styles.value}>
          {isUp ? `+${change.toFixed(2)}` : change.toFixed(2)} (
          {isUp ? `+${changePct.toFixed(2)}%` : `${changePct.toFixed(2)}%`})
        </span>
      </span>
    </div>
  );
}
