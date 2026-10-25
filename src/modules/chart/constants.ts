import type { ChartConfig, ChartIndicatorType, ChartThemeColors, ChartType } from "./types";
import type { Theme } from "@/src/shared/theme";

export const AVAILABLE_CHART_TYPES: readonly ChartType[] = ["candlestick", "bars", "line"] as const;

export const AVAILABLE_INDICATORS: readonly ChartIndicatorType[] = [
  "volume",
  "sma",
  "ema",
] as const;

export const DEFAULT_CHART_CONFIG: ChartConfig = {
  timeframe: "1m",
  chartType: "candlestick",
  indicators: ["volume"],
} as const;

export const DEFAULT_INITIAL_CANDLE_COUNT = 80;

export const CHART_PALETTES: Record<Theme, ChartThemeColors> = {
  dark: {
    background: "#1a1a1a", // var(--surface)
    textColor: "#bdbdbd", // var(--text-secondary)
    gridColor: "#2b2b2b", // var(--grid)
    borderColor: "#393939", // var(--border)
    upColor: "#61d6ab", // var(--market-buy)
    downColor: "#ff8797", // var(--market-sell)
    volumeUpColor: "rgba(97, 214, 171, 0.35)",
    volumeDownColor: "rgba(255, 135, 151, 0.35)",
  },
  light: {
    background: "#f7f7f7", // var(--surface)
    textColor: "#555555", // var(--text-secondary)
    gridColor: "#e9e9e9", // var(--grid)
    borderColor: "#d8d8d8", // var(--border)
    upColor: "#146c51", // var(--market-buy)
    downColor: "#b33142", // var(--market-sell)
    volumeUpColor: "rgba(20, 108, 81, 0.35)",
    volumeDownColor: "rgba(179, 49, 66, 0.35)",
  },
} as const;
