import { DEMO_INITIAL_PRICES } from "@/src/modules/market-data";

import { DEFAULT_INITIAL_CANDLE_COUNT } from "../constants";

import type { Candle, Timeframe } from "@/src/shared/contracts";

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "1d": 86400,
};

export function generateInitialCandles(
  symbol: string,
  timeframe: Timeframe,
  count: number = DEFAULT_INITIAL_CANDLE_COUNT,
  endTimeSeconds?: number,
): Candle[] {
  const step = TIMEFRAME_SECONDS[timeframe] ?? 60;
  const now = endTimeSeconds ?? Math.floor(Date.now() / 1000);
  const currentBucket = Math.floor(now / step) * step;
  const startTime = currentBucket - (count - 1) * step;

  const basePrice =
    (DEMO_INITIAL_PRICES as Record<string, number>)[symbol] ?? DEMO_INITIAL_PRICES.DEFAULT ?? 100;
  let price = basePrice;
  const candles: Candle[] = [];

  for (let i = 0; i < count; i++) {
    const time = startTime + i * step;
    const seed = ((symbol.charCodeAt(0) || 65) * 31 + i * 17) % 100;
    const delta = (seed - 48) * 0.002 * price;
    const open = Math.round(price * 100) / 100;
    const close = Math.round(Math.max(1, price + delta) * 100) / 100;
    const high = Math.round(Math.max(open, close) * 1.002 * 100) / 100;
    const low = Math.round(Math.min(open, close) * 0.998 * 100) / 100;
    const volume = 50 + ((seed * 13) % 200);

    candles.push({ time, open, high, low, close, volume });
    price = close;
  }

  return candles;
}
