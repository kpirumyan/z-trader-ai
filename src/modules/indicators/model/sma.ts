import { DEFAULT_SMA_CONFIG } from "../constants";
import { extractPrice } from "./sources";

import type { IndicatorPoint, SmaConfig } from "../types";
import type { Candle } from "@/src/shared/contracts";

export function calculateSma(
  candles: readonly Candle[],
  config?: Partial<SmaConfig>,
): readonly IndicatorPoint[] {
  const period = config?.period ?? DEFAULT_SMA_CONFIG.period;
  const source = config?.source ?? DEFAULT_SMA_CONFIG.source;

  if (!candles || !Number.isInteger(period) || period < 1 || candles.length < period) {
    return [];
  }

  const points: IndicatorPoint[] = [];

  let sum = 0;

  for (let i = 0; i < period; i++) {
    sum += extractPrice(candles[i], source);
  }

  points.push({
    time: candles[period - 1].time,
    value: sum / period,
  });

  for (let i = period; i < candles.length; i++) {
    sum += extractPrice(candles[i], source) - extractPrice(candles[i - period], source);

    points.push({
      time: candles[i].time,
      value: sum / period,
    });
  }

  return points;
}
