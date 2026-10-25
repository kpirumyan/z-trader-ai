import { create } from "zustand";

import { DEFAULT_CHART_CONFIG } from "../constants";

import type {
  ChartConfig,
  ChartIndicatorType,
  ChartStore,
  ChartType,
  ChartWindowState,
} from "../types";
import type { Candle, Timeframe } from "@/src/shared/contracts";

export const useChartStore = create<ChartStore>((set) => ({
  windows: {},

  initWindow: (windowId: string, symbol: string, initialConfig?: Partial<ChartConfig>) => {
    set((state) => {
      const existing = state.windows[windowId];

      if (existing) {
        if (existing.symbol !== symbol) {
          return {
            windows: {
              ...state.windows,
              [windowId]: {
                ...existing,
                symbol,
                candles: [],
                hoveredCandle: null,
                isLoading: true,
                error: null,
              },
            },
          };
        }

        return state;
      }

      const config: ChartConfig = {
        timeframe: initialConfig?.timeframe ?? DEFAULT_CHART_CONFIG.timeframe,
        chartType: initialConfig?.chartType ?? DEFAULT_CHART_CONFIG.chartType,
        indicators: initialConfig?.indicators ?? DEFAULT_CHART_CONFIG.indicators,
      };

      const newWindow: ChartWindowState = {
        windowId,
        symbol,
        timeframe: config.timeframe,
        chartType: config.chartType,
        indicators: config.indicators,
        candles: [],
        hoveredCandle: null,
        isLoading: true,
        error: null,
      };

      return {
        windows: {
          ...state.windows,
          [windowId]: newWindow,
        },
      };
    });
  },

  setTimeframe: (windowId: string, timeframe: Timeframe) => {
    set((state) => {
      const window = state.windows[windowId];

      if (!window || window.timeframe === timeframe) {
        return state;
      }

      return {
        windows: {
          ...state.windows,
          [windowId]: {
            ...window,
            timeframe,
            isLoading: true,
            error: null,
          },
        },
      };
    });
  },

  setChartType: (windowId: string, chartType: ChartType) => {
    set((state) => {
      const window = state.windows[windowId];

      if (!window || window.chartType === chartType) {
        return state;
      }

      return {
        windows: {
          ...state.windows,
          [windowId]: {
            ...window,
            chartType,
          },
        },
      };
    });
  },

  toggleIndicator: (windowId: string, indicator: ChartIndicatorType) => {
    set((state) => {
      const window = state.windows[windowId];

      if (!window) {
        return state;
      }

      const exists = window.indicators.includes(indicator);
      const nextIndicators = exists
        ? window.indicators.filter((item) => item !== indicator)
        : [...window.indicators, indicator];

      return {
        windows: {
          ...state.windows,
          [windowId]: {
            ...window,
            indicators: nextIndicators,
          },
        },
      };
    });
  },

  setCandles: (windowId: string, candles: readonly Candle[]) => {
    set((state) => {
      const window = state.windows[windowId];

      if (!window) {
        return state;
      }

      return {
        windows: {
          ...state.windows,
          [windowId]: {
            ...window,
            candles,
            isLoading: false,
            error: null,
          },
        },
      };
    });
  },

  appendOrUpdateCandle: (windowId: string, candle: Candle) => {
    set((state) => {
      const window = state.windows[windowId];

      if (!window) {
        return state;
      }

      const candles = window.candles;

      if (candles.length === 0) {
        return {
          windows: {
            ...state.windows,
            [windowId]: {
              ...window,
              candles: [candle],
            },
          },
        };
      }

      const last = candles[candles.length - 1];

      if (candle.time === last.time) {
        const nextCandles = [...candles.slice(0, -1), candle];

        return {
          windows: {
            ...state.windows,
            [windowId]: {
              ...window,
              candles: nextCandles,
            },
          },
        };
      }

      if (candle.time > last.time) {
        return {
          windows: {
            ...state.windows,
            [windowId]: {
              ...window,
              candles: [...candles, candle],
            },
          },
        };
      }

      return state;
    });
  },

  setHoveredCandle: (windowId: string, candle: Candle | null) => {
    set((state) => {
      const window = state.windows[windowId];

      if (!window) {
        return state;
      }

      return {
        windows: {
          ...state.windows,
          [windowId]: {
            ...window,
            hoveredCandle: candle,
          },
        },
      };
    });
  },

  setLoading: (windowId: string, isLoading: boolean) => {
    set((state) => {
      const window = state.windows[windowId];

      if (!window || window.isLoading === isLoading) {
        return state;
      }

      return {
        windows: {
          ...state.windows,
          [windowId]: {
            ...window,
            isLoading,
          },
        },
      };
    });
  },

  setError: (windowId: string, error: string | null) => {
    set((state) => {
      const window = state.windows[windowId];

      if (!window) {
        return state;
      }

      return {
        windows: {
          ...state.windows,
          [windowId]: {
            ...window,
            error,
            isLoading: false,
          },
        },
      };
    });
  },

  cleanupWindow: (windowId: string) => {
    set((state) => {
      if (!state.windows[windowId]) {
        return state;
      }

      const nextWindows = { ...state.windows };

      delete nextWindows[windowId];

      return {
        windows: nextWindows,
      };
    });
  },
}));
