import type { EmaConfig, IndicatorDefinition, IndicatorType, SmaConfig } from "./types";

export const DEFAULT_SMA_CONFIG: Readonly<SmaConfig> = {
  period: 20,
  source: "close",
} as const;

export const DEFAULT_EMA_CONFIG: Readonly<EmaConfig> = {
  period: 20,
  source: "close",
} as const;

export const INDICATOR_DEFINITIONS: readonly IndicatorDefinition[] = [
  {
    id: "sma",
    name: "Simple Moving Average",
    shortName: "SMA",
    description: "Arithmetic mean of prices over a specified rolling window",
    overlayType: "overlay",
    defaultPeriod: 20,
    defaultSource: "close",
  },
  {
    id: "ema",
    name: "Exponential Moving Average",
    shortName: "EMA",
    description: "Exponentially weighted moving average giving higher weight to recent prices",
    overlayType: "overlay",
    defaultPeriod: 20,
    defaultSource: "close",
  },
] as const;

export const AVAILABLE_INDICATOR_TYPES: readonly IndicatorType[] = ["sma", "ema"] as const;
