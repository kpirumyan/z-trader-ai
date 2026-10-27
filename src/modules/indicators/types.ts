import type { Candle } from "@/src/shared/contracts";

export type IndicatorType = "sma" | "ema";

export type IndicatorSourceKey = "close" | "open" | "high" | "low" | "hl2" | "hlc3" | "ohlc4";

export type IndicatorOverlayType = "overlay" | "pane";

export interface IndicatorPoint {
  readonly time: number;
  readonly value: number;
}

export interface SmaConfig {
  readonly period: number;
  readonly source: IndicatorSourceKey;
}

export interface EmaConfig {
  readonly period: number;
  readonly source: IndicatorSourceKey;
}

export type IndicatorConfig = SmaConfig | EmaConfig;

export interface IndicatorDefinition {
  readonly id: IndicatorType;
  readonly name: string;
  readonly shortName: string;
  readonly description: string;
  readonly overlayType: IndicatorOverlayType;
  readonly defaultPeriod: number;
  readonly defaultSource: IndicatorSourceKey;
}

export type IndicatorCalculateFn = (
  candles: readonly Candle[],
  config?: Partial<IndicatorConfig>,
) => readonly IndicatorPoint[];
