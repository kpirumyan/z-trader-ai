import type { IndicatorSourceKey } from "../types";
import type { Candle } from "@/src/shared/contracts";

export function extractPrice(candle: Candle, source: IndicatorSourceKey): number {
  switch (source) {
    case "open":
      return candle.open;

    case "high":
      return candle.high;

    case "low":
      return candle.low;

    case "close":
      return candle.close;

    case "hl2":
      return (candle.high + candle.low) / 2;

    case "hlc3":
      return (candle.high + candle.low + candle.close) / 3;

    case "ohlc4":
      return (candle.open + candle.high + candle.low + candle.close) / 4;

    default:
      return candle.close;
  }
}
