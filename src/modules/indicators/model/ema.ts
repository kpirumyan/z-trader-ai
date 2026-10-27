import { DEFAULT_EMA_CONFIG } from "../constants";
import { extractPrice } from "./sources";

import type { EmaConfig, IndicatorPoint } from "../types";
import type { Candle } from "@/src/shared/contracts";

export function calculateEma(
  candles: readonly Candle[],
  config?: Partial<EmaConfig>,
): readonly IndicatorPoint[] {
  const period = config?.period ?? DEFAULT_EMA_CONFIG.period;
  const source = config?.source ?? DEFAULT_EMA_CONFIG.source;

  if (!candles || !Number.isInteger(period) || period < 1 || candles.length < period) {
    return [];
  }

  const k = 2 / (period + 1);
  const points: IndicatorPoint[] = [];

  let sum = 0;

  for (let i = 0; i < period; i++) {
    sum += extractPrice(candles[i], source);
  }

  let currentEma = sum / period;

  points.push({
    time: candles[period - 1].time,
    value: currentEma,
  });

  for (let i = period; i < candles.length; i++) {
    const price = extractPrice(candles[i], source);

    currentEma = price * k + currentEma * (1 - k);

    points.push({
      time: candles[i].time,
      value: currentEma,
    });
  }

  return points;
}
