import type { Timeframe } from "@/src/shared/contracts";

export const DEFAULT_TIMEFRAME: Timeframe = "1m";

export const TIMEFRAMES: readonly Timeframe[] = ["1m", "5m", "15m", "1h", "1d"] as const;

export const DEMO_FEED_INTERVALS = {
  tickerMs: 500,
  tradeMs: 300,
  orderBookMs: 400,
  candleMs: 1000,
} as const;

export const DEMO_INITIAL_PRICES: Readonly<Record<string, number>> = {
  ES: 5000.0,
  NQ: 18000.0,
  AAPL: 175.5,
  MSFT: 420.0,
  NVDA: 880.0,
  DEFAULT: 100.0,
} as const;
