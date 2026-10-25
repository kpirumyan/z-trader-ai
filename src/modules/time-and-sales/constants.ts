import type { FilterPresetOption, TradeBufferLimit, TradeSizeFilter } from "./types";

export const TIME_AND_SALES_WIDGET_KIND = "timeAndSales" as const;
export const TIME_AND_SALES_WIDGET_TITLE = "Time & Sales" as const;

export const DEFAULT_TRADE_BUFFER_LIMIT: TradeBufferLimit = 100;
export const TRADE_BUFFER_LIMIT_OPTIONS: readonly TradeBufferLimit[] = [50, 100, 250] as const;

export const DEFAULT_TRADE_SIZE_FILTER: TradeSizeFilter = {
  minSize: 0,
  maxSize: null,
};

export const LARGE_TRADE_THRESHOLD = 20;

export const SIZE_FILTER_PRESETS: readonly FilterPresetOption[] = [
  { label: "All", filter: { minSize: 0, maxSize: null } },
  { label: "Small (<10)", filter: { minSize: 0, maxSize: 9 } },
  { label: "Medium (10–49)", filter: { minSize: 10, maxSize: 49 } },
  { label: "Large (≥50)", filter: { minSize: 50, maxSize: null } },
] as const;
