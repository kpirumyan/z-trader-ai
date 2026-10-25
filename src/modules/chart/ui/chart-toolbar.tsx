import { cn } from "@/src/shared/lib";

import { AVAILABLE_CHART_TYPES, AVAILABLE_INDICATORS } from "../constants";
import styles from "./chart-toolbar.module.css";

import type { ChartIndicatorType, ChartType } from "../types";
import type { Timeframe } from "@/src/shared/contracts";

export interface ChartToolbarProps {
  readonly windowId?: string;
  readonly symbol?: string;
  readonly timeframe: Timeframe;
  readonly chartType: ChartType;
  readonly indicators: readonly ChartIndicatorType[];
  readonly onSelectTimeframe: (timeframe: Timeframe) => void;
  readonly onSelectChartType: (chartType: ChartType) => void;
  readonly onToggleIndicator: (indicator: ChartIndicatorType) => void;
}

const TIMEFRAMES: readonly Timeframe[] = ["1m", "5m", "15m", "1h", "1d"];

const CHART_TYPE_LABELS: Record<ChartType, string> = {
  candlestick: "Candles",
  bars: "Bars",
  line: "Line",
};

const INDICATOR_LABELS: Record<ChartIndicatorType, string> = {
  volume: "VOL",
  sma: "SMA",
  ema: "EMA",
};

export function ChartToolbar({
  timeframe,
  chartType,
  indicators,
  onSelectTimeframe,
  onSelectChartType,
  onToggleIndicator,
}: ChartToolbarProps) {
  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Chart toolbar">
      <div className={styles.group}>
        {TIMEFRAMES.map((tf) => {
          const isActive = tf === timeframe;

          return (
            <button
              key={tf}
              type="button"
              className={cn(styles.button, isActive && styles.active)}
              data-timeframe={tf}
              data-active={isActive ? "true" : undefined}
              aria-pressed={isActive}
              onClick={() => onSelectTimeframe(tf)}
            >
              {tf}
            </button>
          );
        })}
      </div>

      <div className={styles.group}>
        <div className={styles.divider} />

        {AVAILABLE_CHART_TYPES.map((type) => {
          const isActive = type === chartType;

          return (
            <button
              key={type}
              type="button"
              className={cn(styles.button, isActive && styles.active)}
              data-chart-type={type}
              data-active={isActive ? "true" : undefined}
              aria-pressed={isActive}
              onClick={() => onSelectChartType(type)}
            >
              {CHART_TYPE_LABELS[type]}
            </button>
          );
        })}

        <div className={styles.divider} />

        {AVAILABLE_INDICATORS.map((ind) => {
          const isActive = indicators.includes(ind);

          return (
            <button
              key={ind}
              type="button"
              className={cn(styles.button, styles.indicatorButton, isActive && styles.active)}
              data-indicator={ind}
              data-active={isActive ? "true" : undefined}
              aria-pressed={isActive}
              onClick={() => onToggleIndicator(ind)}
            >
              {INDICATOR_LABELS[ind]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
