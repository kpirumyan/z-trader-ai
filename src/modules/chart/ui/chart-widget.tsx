"use client";

import { useRef } from "react";

import { cn } from "@/src/shared/lib";

import { ChartCanvas } from "./chart-canvas";
import { ChartLegend } from "./chart-legend";
import { ChartToolbar } from "./chart-toolbar";
import styles from "./chart-widget.module.css";
import { useChartStore } from "../model/chart-store";
import { useChart } from "../model/use-chart";

import type {
  ChartIndicatorType,
  ChartType,
  ChartWidgetDefinition,
  ChartWidgetProps,
} from "../types";
import type { Timeframe } from "@/src/shared/contracts";

export function ChartWidget({ windowId, instrument, isFocused = false }: ChartWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useChart({
    windowId,
    symbol: instrument.symbol,
    containerRef,
  });

  const windowState = useChartStore((state) => state.windows[windowId]);
  const setTimeframe = useChartStore((state) => state.setTimeframe);
  const setChartType = useChartStore((state) => state.setChartType);
  const toggleIndicator = useChartStore((state) => state.toggleIndicator);

  const timeframe: Timeframe = windowState?.timeframe ?? "1m";
  const chartType: ChartType = windowState?.chartType ?? "candlestick";
  const indicators: readonly ChartIndicatorType[] = windowState?.indicators ?? ["volume"];
  const candles = windowState?.candles ?? [];
  const lastCandle = candles.length > 0 ? candles[candles.length - 1] : null;
  const currentCandle = windowState?.hoveredCandle ?? lastCandle;

  return (
    <div
      className={cn(styles.root, isFocused && styles.focused)}
      data-window-id={windowId}
      data-testid={`chart-widget-${windowId}`}
    >
      <ChartToolbar
        timeframe={timeframe}
        chartType={chartType}
        indicators={indicators}
        onSelectTimeframe={(tf) => setTimeframe(windowId, tf)}
        onSelectChartType={(ct) => setChartType(windowId, ct)}
        onToggleIndicator={(ind) => toggleIndicator(windowId, ind)}
      />

      <div className={styles.chartArea}>
        <ChartLegend symbol={instrument.symbol} candle={currentCandle} />

        <ChartCanvas
          containerRef={containerRef}
          isLoading={windowState?.isLoading ?? false}
          error={windowState?.error ?? null}
          symbol={instrument.symbol}
          candlesCount={candles.length}
        />
      </div>
    </div>
  );
}

export const chartWidgetDefinition: ChartWidgetDefinition = {
  kind: "chart",
  title: "Chart",
  component: ChartWidget,
};
