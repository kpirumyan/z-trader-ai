import type { Candle, Timeframe, WidgetDefinition, WidgetProps } from "@/src/shared/contracts";

export type ChartType = "candlestick" | "bars" | "line";

export type ChartIndicatorType = "volume" | "sma" | "ema";

export interface ChartConfig {
  readonly timeframe: Timeframe;
  readonly chartType: ChartType;
  readonly indicators: readonly ChartIndicatorType[];
}

export interface ChartThemeColors {
  readonly background: string;
  readonly textColor: string;
  readonly gridColor: string;
  readonly borderColor: string;
  readonly upColor: string;
  readonly downColor: string;
  readonly volumeUpColor: string;
  readonly volumeDownColor: string;
}

export interface ChartWindowState {
  readonly windowId: string;
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly chartType: ChartType;
  readonly indicators: readonly ChartIndicatorType[];
  readonly candles: readonly Candle[];
  readonly hoveredCandle: Candle | null;
  readonly isLoading: boolean;
  readonly error: string | null;
}

export interface ChartStoreState {
  readonly windows: Readonly<Record<string, ChartWindowState>>;
}

export interface ChartStoreActions {
  readonly initWindow: (
    windowId: string,
    symbol: string,
    initialConfig?: Partial<ChartConfig>,
  ) => void;
  readonly setTimeframe: (windowId: string, timeframe: Timeframe) => void;
  readonly setChartType: (windowId: string, chartType: ChartType) => void;
  readonly toggleIndicator: (windowId: string, indicator: ChartIndicatorType) => void;
  readonly setCandles: (windowId: string, candles: readonly Candle[]) => void;
  readonly appendOrUpdateCandle: (windowId: string, candle: Candle) => void;
  readonly setHoveredCandle: (windowId: string, candle: Candle | null) => void;
  readonly setLoading: (windowId: string, isLoading: boolean) => void;
  readonly setError: (windowId: string, error: string | null) => void;
  readonly cleanupWindow: (windowId: string) => void;
}

export type ChartStore = ChartStoreState & ChartStoreActions;

export type ChartWidgetProps = WidgetProps;

export type ChartWidgetDefinition = WidgetDefinition;
