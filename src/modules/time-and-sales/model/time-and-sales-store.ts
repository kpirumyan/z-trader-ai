import { create } from "zustand";

import { marketStreamService } from "@/src/modules/market-data";

import {
  DEFAULT_TRADE_BUFFER_LIMIT,
  DEFAULT_TRADE_SIZE_FILTER,
  LARGE_TRADE_THRESHOLD,
} from "../constants";

import type {
  TimeAndSalesRow,
  TimeAndSalesStore,
  TimeAndSalesWindowState,
  TradeBufferLimit,
  TradeSizeFilter,
} from "../types";
import type { Trade } from "@/src/shared/contracts";

function formatTradeTime(timeMs: number): string {
  const normalizedMs = timeMs < 1e11 ? timeMs * 1000 : timeMs;
  const date = new Date(normalizedMs);

  if (isNaN(date.getTime())) {
    return "00:00:00";
  }

  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");

  return `${hh}:${mm}:${ss}`;
}

function formatTradePrice(price: number): string {
  if (typeof price !== "number" || isNaN(price)) {
    return "0.00";
  }

  return price.toFixed(2);
}

function toTimeAndSalesRow(trade: Trade): TimeAndSalesRow {
  return {
    ...trade,
    formattedTime: formatTradeTime(trade.time),
    formattedPrice: formatTradePrice(trade.price),
    isLarge: trade.size >= LARGE_TRADE_THRESHOLD,
  };
}

function computeVisibleRows(
  trades: readonly Trade[],
  filter: TradeSizeFilter,
): readonly TimeAndSalesRow[] {
  const result: TimeAndSalesRow[] = [];

  for (const trade of trades) {
    if (trade.size >= filter.minSize && (filter.maxSize === null || trade.size <= filter.maxSize)) {
      result.push(toTimeAndSalesRow(trade));
    }
  }

  return result;
}

const subscriptions = new Map<string, () => void>();

export const useTimeAndSalesStore = create<TimeAndSalesStore>((set, get) => ({
  windows: {},

  initWindow: (
    windowId: string,
    symbol: string,
    bufferLimit?: TradeBufferLimit,
    sizeFilter?: Partial<TradeSizeFilter>,
  ) => {
    const existingUnsub = subscriptions.get(windowId);

    if (existingUnsub) {
      existingUnsub();
      subscriptions.delete(windowId);
    }

    const limit = bufferLimit ?? DEFAULT_TRADE_BUFFER_LIMIT;
    const initialFilter: TradeSizeFilter = {
      minSize: sizeFilter?.minSize ?? DEFAULT_TRADE_SIZE_FILTER.minSize,
      maxSize:
        sizeFilter?.maxSize !== undefined ? sizeFilter.maxSize : DEFAULT_TRADE_SIZE_FILTER.maxSize,
    };

    const initialWindowState: TimeAndSalesWindowState = {
      windowId,
      symbol,
      bufferLimit: limit,
      sizeFilter: initialFilter,
      trades: [],
      visibleRows: [],
      isLoading: true,
      error: null,
      lastUpdated: null,
    };

    set((state) => ({
      windows: {
        ...state.windows,
        [windowId]: initialWindowState,
      },
    }));

    if (typeof marketStreamService?.subscribeTrades === "function") {
      try {
        const unsubscribe = marketStreamService.subscribeTrades(
          symbol,
          (trade: Trade) => {
            get().addTrade(windowId, trade);
          },
          undefined,
          (error: Error) => {
            const errorMessage =
              typeof error === "string" ? error : (error?.message ?? "Stream error");

            get().setError(windowId, errorMessage);
          },
        );

        if (typeof unsubscribe === "function") {
          subscriptions.set(windowId, unsubscribe);
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Stream subscription failed";

        get().setError(windowId, errorMessage);
      }
    }
  },

  addTrade: (windowId: string, trade: Trade) => {
    set((state) => {
      const window = state.windows[windowId];

      if (!window) {
        return state;
      }

      const nextTrades = [trade, ...window.trades].slice(0, window.bufferLimit);
      const visibleRows = computeVisibleRows(nextTrades, window.sizeFilter);

      return {
        windows: {
          ...state.windows,
          [windowId]: {
            ...window,
            trades: nextTrades,
            visibleRows,
            isLoading: false,
            error: null,
            lastUpdated: trade.time,
          },
        },
      };
    });
  },

  setBufferLimit: (windowId: string, limit: TradeBufferLimit) => {
    set((state) => {
      const window = state.windows[windowId];

      if (!window) {
        return state;
      }

      const nextTrades = window.trades.slice(0, limit);
      const visibleRows = computeVisibleRows(nextTrades, window.sizeFilter);

      return {
        windows: {
          ...state.windows,
          [windowId]: {
            ...window,
            bufferLimit: limit,
            trades: nextTrades,
            visibleRows,
          },
        },
      };
    });
  },

  setSizeFilter: (windowId: string, filter: Partial<TradeSizeFilter>) => {
    set((state) => {
      const window = state.windows[windowId];

      if (!window) {
        return state;
      }

      const nextSizeFilter: TradeSizeFilter = {
        minSize: filter.minSize !== undefined ? filter.minSize : window.sizeFilter.minSize,
        maxSize: filter.maxSize !== undefined ? filter.maxSize : window.sizeFilter.maxSize,
      };

      const visibleRows = computeVisibleRows(window.trades, nextSizeFilter);

      return {
        windows: {
          ...state.windows,
          [windowId]: {
            ...window,
            sizeFilter: nextSizeFilter,
            visibleRows,
          },
        },
      };
    });
  },

  resetSizeFilter: (windowId: string) => {
    set((state) => {
      const window = state.windows[windowId];

      if (!window) {
        return state;
      }

      const visibleRows = computeVisibleRows(window.trades, DEFAULT_TRADE_SIZE_FILTER);

      return {
        windows: {
          ...state.windows,
          [windowId]: {
            ...window,
            sizeFilter: DEFAULT_TRADE_SIZE_FILTER,
            visibleRows,
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

  closeWindow: (windowId: string) => {
    const unsub = subscriptions.get(windowId);

    if (unsub) {
      unsub();
      subscriptions.delete(windowId);
    }

    set((state) => {
      if (!state.windows[windowId]) {
        return state;
      }

      const remainingWindows = { ...state.windows };

      delete remainingWindows[windowId];

      return {
        windows: remainingWindows,
      };
    });
  },
}));
