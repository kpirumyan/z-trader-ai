import { create } from "zustand";

import { marketStreamService } from "@/src/modules/market-data";

import { DEFAULT_DEPTH_LIMIT } from "../constants";

import type {
  OrderBookDepthLimit,
  OrderBookRow,
  OrderBookStore,
  OrderBookWindowState,
} from "../types";
import type { OrderBookSnapshot } from "@/src/shared/contracts";

export interface ProcessedOrderBook {
  readonly bids: readonly OrderBookRow[];
  readonly asks: readonly OrderBookRow[];
  readonly bestBid: number | null;
  readonly bestAsk: number | null;
  readonly spread: number | null;
  readonly spreadPct: number | null;
  readonly maxCumulativeSize: number;
}

export function processOrderBookSnapshot(
  snapshot: OrderBookSnapshot,
  depthLimit: OrderBookDepthLimit,
): ProcessedOrderBook {
  const sortedAsks = [...snapshot.asks].sort((a, b) => a.price - b.price).slice(0, depthLimit);

  const sortedBids = [...snapshot.bids].sort((a, b) => b.price - a.price).slice(0, depthLimit);

  let askCum = 0;
  const asksWithCum: { price: number; size: number; side: "sell"; cumulativeSize: number }[] = [];

  for (const ask of sortedAsks) {
    askCum += ask.size;

    asksWithCum.push({
      price: ask.price,
      size: ask.size,
      side: "sell",
      cumulativeSize: askCum,
    });
  }

  let bidCum = 0;
  const bidsWithCum: { price: number; size: number; side: "buy"; cumulativeSize: number }[] = [];

  for (const bid of sortedBids) {
    bidCum += bid.size;

    bidsWithCum.push({
      price: bid.price,
      size: bid.size,
      side: "buy",
      cumulativeSize: bidCum,
    });
  }

  const maxCumulativeSize = Math.max(askCum, bidCum);

  const asks: readonly OrderBookRow[] = asksWithCum.map((a) => ({
    ...a,
    depthPercent:
      maxCumulativeSize > 0
        ? Math.min(100, Math.max(0, (a.cumulativeSize / maxCumulativeSize) * 100))
        : 0,
  }));

  const bids: readonly OrderBookRow[] = bidsWithCum.map((b) => ({
    ...b,
    depthPercent:
      maxCumulativeSize > 0
        ? Math.min(100, Math.max(0, (b.cumulativeSize / maxCumulativeSize) * 100))
        : 0,
  }));

  const bestBid = bids.length > 0 ? bids[0].price : null;
  const bestAsk = asks.length > 0 ? asks[0].price : null;

  let spread: number | null = null;
  let spreadPct: number | null = null;

  if (bestBid !== null && bestAsk !== null) {
    spread = bestAsk - bestBid;

    const midPrice = (bestAsk + bestBid) / 2;

    if (midPrice !== 0) {
      spreadPct = ((bestAsk - bestBid) / midPrice) * 100;
    }
  }

  return {
    bids,
    asks,
    bestBid,
    bestAsk,
    spread,
    spreadPct,
    maxCumulativeSize,
  };
}

const subscriptions = new Map<string, () => void>();
const rawSnapshots = new Map<string, OrderBookSnapshot>();

export const useOrderBookStore = create<OrderBookStore>((set, get) => ({
  windows: {},

  initWindow: (windowId: string, symbol: string, depthLimit?: OrderBookDepthLimit) => {
    const existingUnsub = subscriptions.get(windowId);

    if (existingUnsub) {
      existingUnsub();
      subscriptions.delete(windowId);
    }

    const limit = depthLimit ?? DEFAULT_DEPTH_LIMIT;

    const initialWindowState: OrderBookWindowState = {
      windowId,
      symbol,
      depthLimit: limit,
      bids: [],
      asks: [],
      bestBid: null,
      bestAsk: null,
      spread: null,
      spreadPct: null,
      maxCumulativeSize: 0,
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

    const unsubscribe = marketStreamService.subscribeOrderBook(
      symbol,
      (snapshot: OrderBookSnapshot) => {
        get().updateSnapshot(windowId, snapshot);
      },
      undefined,
      (error: Error) => {
        const errorMessage = typeof error === "string" ? error : (error?.message ?? "Stream error");

        get().setError(windowId, errorMessage);
      },
    );

    if (typeof unsubscribe === "function") {
      subscriptions.set(windowId, unsubscribe);
    }
  },

  updateSnapshot: (windowId: string, snapshot: OrderBookSnapshot) => {
    set((state) => {
      const window = state.windows[windowId];

      if (!window) {
        return state;
      }

      rawSnapshots.set(windowId, snapshot);

      const processed = processOrderBookSnapshot(snapshot, window.depthLimit);

      return {
        windows: {
          ...state.windows,
          [windowId]: {
            ...window,
            ...processed,
            isLoading: false,
            error: null,
            lastUpdated: snapshot.timestamp ?? Date.now(),
          },
        },
      };
    });
  },

  setDepthLimit: (windowId: string, limit: OrderBookDepthLimit) => {
    set((state) => {
      const window = state.windows[windowId];

      if (!window) {
        return state;
      }

      const raw = rawSnapshots.get(windowId);
      const processed = raw ? processOrderBookSnapshot(raw, limit) : {};

      return {
        windows: {
          ...state.windows,
          [windowId]: {
            ...window,
            depthLimit: limit,
            ...processed,
          },
        },
      };
    });
  },

  setError: (windowId: string, error: string) => {
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

    rawSnapshots.delete(windowId);

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
