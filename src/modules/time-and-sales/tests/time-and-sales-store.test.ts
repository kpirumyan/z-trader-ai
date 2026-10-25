import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { marketStreamService } from "@/src/modules/market-data";
import {
  DEFAULT_TRADE_BUFFER_LIMIT,
  DEFAULT_TRADE_SIZE_FILTER,
  LARGE_TRADE_THRESHOLD,
  SIZE_FILTER_PRESETS,
  TIME_AND_SALES_WIDGET_KIND,
  TIME_AND_SALES_WIDGET_TITLE,
  TRADE_BUFFER_LIMIT_OPTIONS,
  tradeBufferLimitSchema,
  tradeSizeFilterSchema,
  useTimeAndSalesStore,
} from "@/src/modules/time-and-sales";

import type { ErrorHandler, SubscriptionOptions } from "@/src/modules/market-data";
import type {
  FilterPresetOption,
  TimeAndSalesRow,
  TimeAndSalesWindowState,
  TradeBufferLimit,
  TradeSizeFilter,
} from "@/src/modules/time-and-sales";
import type { Trade } from "@/src/shared/contracts";

const activeUnsubscribes: Array<ReturnType<typeof vi.fn>> = [];
let lastTradeCallback: ((trade: Trade) => void) | undefined;
let lastErrorCallback: ErrorHandler | undefined;

const mockTradeBuySmall: Trade = {
  id: "trade-1",
  time: 1700000000000,
  price: 150.25,
  size: 5,
  side: "buy",
};

const mockTradeSellMedium: Trade = {
  id: "trade-2",
  time: 1700000001000,
  price: 150.2,
  size: 15,
  side: "sell",
};

const mockTradeBuyLarge: Trade = {
  id: "trade-3",
  time: 1700000002000,
  price: 150.3,
  size: 50,
  side: "buy",
};

const mockTradeSellBlock: Trade = {
  id: "trade-4",
  time: 1700000003000,
  price: 150.35,
  size: 120,
  side: "sell",
};

beforeEach(() => {
  activeUnsubscribes.length = 0;
  lastTradeCallback = undefined;
  lastErrorCallback = undefined;

  vi.spyOn(marketStreamService, "subscribeTrades").mockImplementation(
    (
      _symbol: string,
      callback: (trade: Trade) => void,
      _options?: SubscriptionOptions,
      onError?: ErrorHandler,
    ) => {
      lastTradeCallback = callback;
      lastErrorCallback = onError;

      const unsub = vi.fn();

      activeUnsubscribes.push(unsub);

      return unsub;
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();

  if (typeof useTimeAndSalesStore?.getState === "function") {
    const currentWindows = Object.keys(useTimeAndSalesStore.getState().windows || {});

    for (const windowId of currentWindows) {
      useTimeAndSalesStore.getState().closeWindow(windowId);
    }
  }
});

describe("Time & Sales Store: Public Contract Perimeter & Schemas", () => {
  it("exports canonical constants conforming to design tokens and specs", () => {
    expect(DEFAULT_TRADE_BUFFER_LIMIT).toBe(100);
    expect(TRADE_BUFFER_LIMIT_OPTIONS).toEqual([50, 100, 250]);
    expect(DEFAULT_TRADE_SIZE_FILTER).toEqual({ minSize: 0, maxSize: null });
    expect(LARGE_TRADE_THRESHOLD).toBe(20);
    expect(TIME_AND_SALES_WIDGET_KIND).toBe("timeAndSales");
    expect(TIME_AND_SALES_WIDGET_TITLE).toBe("Time & Sales");
  });

  it("exports predefined size filter presets conforming to spec intervals", () => {
    expect(SIZE_FILTER_PRESETS).toHaveLength(4);

    const presetLabels = SIZE_FILTER_PRESETS.map((preset: FilterPresetOption) => preset.label);

    expect(presetLabels).toEqual(["All", "Small (<10)", "Medium (10–49)", "Large (≥50)"]);

    expect(SIZE_FILTER_PRESETS[0].filter).toEqual({ minSize: 0, maxSize: null });
    expect(SIZE_FILTER_PRESETS[1].filter).toEqual({ minSize: 0, maxSize: 9 });
    expect(SIZE_FILTER_PRESETS[2].filter).toEqual({ minSize: 10, maxSize: 49 });
    expect(SIZE_FILTER_PRESETS[3].filter).toEqual({ minSize: 50, maxSize: null });
  });

  it("validates trade buffer limits via tradeBufferLimitSchema", () => {
    const valid50: TradeBufferLimit = 50;
    const valid100: TradeBufferLimit = 100;
    const valid250: TradeBufferLimit = 250;

    const parse50 = tradeBufferLimitSchema.safeParse(valid50);
    const parse100 = tradeBufferLimitSchema.safeParse(valid100);
    const parse250 = tradeBufferLimitSchema.safeParse(valid250);

    expect(parse50.success).toBe(true);
    expect(parse100.success).toBe(true);
    expect(parse250.success).toBe(true);

    if (parse50.success) expect(parse50.data).toBe(50);
    if (parse100.success) expect(parse100.data).toBe(100);
    if (parse250.success) expect(parse250.data).toBe(250);

    const invalidCases = [0, 10, 20, 75, -50, "100", null, undefined, {}];

    for (const input of invalidCases) {
      expect(tradeBufferLimitSchema.safeParse(input).success).toBe(false);
    }
  });

  it("validates size filters via tradeSizeFilterSchema", () => {
    const validOpenRange: TradeSizeFilter = { minSize: 0, maxSize: null };
    const validBoundedRange: TradeSizeFilter = { minSize: 10, maxSize: 50 };
    const validEqualRange: TradeSizeFilter = { minSize: 25, maxSize: 25 };

    const parseOpen = tradeSizeFilterSchema.safeParse(validOpenRange);
    const parseBounded = tradeSizeFilterSchema.safeParse(validBoundedRange);
    const parseEqual = tradeSizeFilterSchema.safeParse(validEqualRange);

    expect(parseOpen.success).toBe(true);
    expect(parseBounded.success).toBe(true);
    expect(parseEqual.success).toBe(true);

    if (parseOpen.success) expect(parseOpen.data).toEqual(validOpenRange);
    if (parseBounded.success) expect(parseBounded.data).toEqual(validBoundedRange);
    if (parseEqual.success) expect(parseEqual.data).toEqual(validEqualRange);

    const invalidCases = [
      { minSize: -1, maxSize: 10 },
      { minSize: 50, maxSize: 10 },
      { minSize: -5, maxSize: null },
      { minSize: 0, maxSize: 0 },
      { minSize: 10, maxSize: -2 },
      { minSize: "0", maxSize: null },
      null,
      undefined,
      {},
    ];

    for (const input of invalidCases) {
      expect(tradeSizeFilterSchema.safeParse(input).success).toBe(false);
    }
  });
});

describe("Time & Sales Store: Core Logic & Behavioral Scenarios", () => {
  it("Scenario 1: initializes window state with default values and opens stream subscription", () => {
    act(() => {
      useTimeAndSalesStore.getState().initWindow("win-1", "AAPL");
    });

    const windowState: TimeAndSalesWindowState | undefined =
      useTimeAndSalesStore.getState().windows["win-1"];

    expect(windowState).toBeDefined();

    if (windowState) {
      expect(windowState.windowId).toBe("win-1");
      expect(windowState.symbol).toBe("AAPL");
      expect(windowState.bufferLimit).toBe(DEFAULT_TRADE_BUFFER_LIMIT);
      expect(windowState.sizeFilter).toEqual(DEFAULT_TRADE_SIZE_FILTER);
      expect(windowState.trades).toEqual([]);
      expect(windowState.visibleRows).toEqual([]);
      expect(windowState.isLoading).toBe(true);
      expect(windowState.error).toBeNull();
      expect(windowState.lastUpdated).toBeNull();
    }

    expect(marketStreamService.subscribeTrades).toHaveBeenCalledTimes(1);

    expect(marketStreamService.subscribeTrades).toHaveBeenCalledWith(
      "AAPL",
      expect.any(Function),
      undefined,
      expect.any(Function),
    );
  });

  it("Scenario 1 (custom options): respects custom bufferLimit and sizeFilter on initialization", () => {
    act(() => {
      useTimeAndSalesStore
        .getState()
        .initWindow("win-custom", "BTC/USD", 50, { minSize: 25, maxSize: 100 });
    });

    const windowState = useTimeAndSalesStore.getState().windows["win-custom"];

    expect(windowState).toBeDefined();
    expect(windowState.bufferLimit).toBe(50);
    expect(windowState.sizeFilter).toEqual({ minSize: 25, maxSize: 100 });
  });

  it("Scenario 2: prepends incoming trades Top-of-Tape and evicts oldest entries past bufferLimit", () => {
    act(() => {
      useTimeAndSalesStore.getState().initWindow("win-tape", "AAPL", 50);
    });

    // Add 4 trades sequentially
    act(() => {
      useTimeAndSalesStore.getState().addTrade("win-tape", mockTradeBuySmall);
      useTimeAndSalesStore.getState().addTrade("win-tape", mockTradeSellMedium);
      useTimeAndSalesStore.getState().addTrade("win-tape", mockTradeBuyLarge);
      useTimeAndSalesStore.getState().addTrade("win-tape", mockTradeSellBlock);
    });

    let state = useTimeAndSalesStore.getState().windows["win-tape"];

    // Top-of-Tape order: newest trade first
    expect(state.trades).toHaveLength(4);
    expect(state.trades[0]).toEqual(mockTradeSellBlock);
    expect(state.trades[1]).toEqual(mockTradeBuyLarge);
    expect(state.trades[2]).toEqual(mockTradeSellMedium);
    expect(state.trades[3]).toEqual(mockTradeBuySmall);

    expect(state.lastUpdated).toBe(mockTradeSellBlock.time);
    expect(state.isLoading).toBe(false);

    // Push 50 more trades to exceed the bufferLimit of 50
    act(() => {
      for (let index = 5; index <= 55; index += 1) {
        useTimeAndSalesStore.getState().addTrade("win-tape", {
          id: `trade-${index}`,
          time: 1700000000000 + index * 1000,
          price: 150 + index * 0.1,
          size: index,
          side: index % 2 === 0 ? "buy" : "sell",
        });
      }
    });

    state = useTimeAndSalesStore.getState().windows["win-tape"];

    // Buffer capped strictly at 50 trades
    expect(state.trades).toHaveLength(50);

    // Newest trade (index 55) is at top of tape
    expect(state.trades[0].id).toBe("trade-55");

    // Oldest retained trade (index 6) is at tail of buffer
    expect(state.trades[49].id).toBe("trade-6");

    // Original trades 1-5 have been evicted FIFO
    const retainedIds = state.trades.map((trade: Trade) => trade.id);

    expect(retainedIds).not.toContain("trade-1");
    expect(retainedIds).not.toContain("trade-2");
    expect(retainedIds).not.toContain("trade-3");
    expect(retainedIds).not.toContain("trade-4");
    expect(retainedIds).not.toContain("trade-5");
  });

  it("Scenario 2 (streaming callback): updates store when trades arrive via marketStreamService callback", () => {
    act(() => {
      useTimeAndSalesStore.getState().initWindow("win-stream", "AAPL", 100);
    });

    expect(lastTradeCallback).toBeDefined();

    act(() => {
      lastTradeCallback?.(mockTradeBuyLarge);
    });

    const state = useTimeAndSalesStore.getState().windows["win-stream"];

    expect(state.isLoading).toBe(false);
    expect(state.trades).toHaveLength(1);
    expect(state.trades[0]).toEqual(mockTradeBuyLarge);
    expect(state.lastUpdated).toBe(mockTradeBuyLarge.time);
  });

  it("Scenario 3: applies range size filtering and formats row properties accurately", () => {
    act(() => {
      useTimeAndSalesStore.getState().initWindow("win-filter", "AAPL", 100);
      useTimeAndSalesStore.getState().addTrade("win-filter", mockTradeBuySmall); // size: 5
      useTimeAndSalesStore.getState().addTrade("win-filter", mockTradeSellMedium); // size: 15
      useTimeAndSalesStore.getState().addTrade("win-filter", mockTradeBuyLarge); // size: 50
      useTimeAndSalesStore.getState().addTrade("win-filter", mockTradeSellBlock); // size: 120
    });

    // Filter range: [10, 50]
    act(() => {
      useTimeAndSalesStore.getState().setSizeFilter("win-filter", { minSize: 10, maxSize: 50 });
    });

    let state = useTimeAndSalesStore.getState().windows["win-filter"];

    expect(state.sizeFilter).toEqual({ minSize: 10, maxSize: 50 });

    // In visibleRows: only trade 3 (50) and trade 2 (15) survive
    expect(state.visibleRows).toHaveLength(2);
    expect(state.visibleRows[0].id).toBe("trade-3");
    expect(state.visibleRows[1].id).toBe("trade-2");

    // Formatting checks on TimeAndSalesRow
    const largeRow: TimeAndSalesRow = state.visibleRows[0];
    const mediumRow: TimeAndSalesRow = state.visibleRows[1];

    expect(largeRow.isLarge).toBe(true); // size 50 >= LARGE_TRADE_THRESHOLD (20)
    expect(largeRow.formattedPrice).toBe("150.30");
    expect(largeRow.formattedTime).toMatch(/^\d{2}:\d{2}:\d{2}$/);

    expect(mediumRow.isLarge).toBe(false); // size 15 < LARGE_TRADE_THRESHOLD (20)
    expect(mediumRow.formattedPrice).toBe("150.20");
    expect(mediumRow.formattedTime).toMatch(/^\d{2}:\d{2}:\d{2}$/);

    // Reset size filter: all 4 trades become visible again
    act(() => {
      useTimeAndSalesStore.getState().resetSizeFilter("win-filter");
    });

    state = useTimeAndSalesStore.getState().windows["win-filter"];

    expect(state.sizeFilter).toEqual(DEFAULT_TRADE_SIZE_FILTER);
    expect(state.visibleRows).toHaveLength(4);
  });

  it("Scenario 4: dynamically truncates buffer and recalculates visibleRows on bufferLimit change", () => {
    act(() => {
      useTimeAndSalesStore.getState().initWindow("win-reslice", "AAPL", 100);

      for (let index = 1; index <= 75; index += 1) {
        useTimeAndSalesStore.getState().addTrade("win-reslice", {
          id: `t-${index}`,
          time: 1700000000000 + index,
          price: 100 + index,
          size: 10,
          side: "buy",
        });
      }
    });

    let state = useTimeAndSalesStore.getState().windows["win-reslice"];

    expect(state.trades).toHaveLength(75);
    expect(state.visibleRows).toHaveLength(75);

    // Reduce bufferLimit to 50
    act(() => {
      useTimeAndSalesStore.getState().setBufferLimit("win-reslice", 50);
    });

    state = useTimeAndSalesStore.getState().windows["win-reslice"];

    expect(state.bufferLimit).toBe(50);
    expect(state.trades).toHaveLength(50);
    expect(state.visibleRows).toHaveLength(50);
    expect(state.trades[0].id).toBe("t-75");
    expect(state.trades[49].id).toBe("t-26");
  });

  it("Scenario 5: preserves complete state isolation between multiple windows", () => {
    act(() => {
      // win-1: filter >= 50
      useTimeAndSalesStore.getState().initWindow("win-1", "AAPL", 100, { minSize: 50 });
      // win-2: filter >= 0
      useTimeAndSalesStore.getState().initWindow("win-2", "AAPL", 100, { minSize: 0 });
    });

    // Add small tick (size 10) to both windows
    act(() => {
      useTimeAndSalesStore.getState().addTrade("win-1", mockTradeSellMedium);
      useTimeAndSalesStore.getState().addTrade("win-2", mockTradeSellMedium);
    });

    const state1 = useTimeAndSalesStore.getState().windows["win-1"];
    const state2 = useTimeAndSalesStore.getState().windows["win-2"];

    expect(state1.trades).toHaveLength(1);
    expect(state1.visibleRows).toHaveLength(0); // Filtered out by minSize: 50

    expect(state2.trades).toHaveLength(1);
    expect(state2.visibleRows).toHaveLength(1); // Visible because minSize: 0
  });

  it("Scenario 6: cleans up window state and unregisters stream subscription on closeWindow", () => {
    act(() => {
      useTimeAndSalesStore.getState().initWindow("win-closing", "AAPL");
    });

    expect(activeUnsubscribes).toHaveLength(1);

    const unsubMock = activeUnsubscribes[0];

    act(() => {
      useTimeAndSalesStore.getState().closeWindow("win-closing");
    });

    expect(unsubMock).toHaveBeenCalledTimes(1);
    expect(useTimeAndSalesStore.getState().windows["win-closing"]).toBeUndefined();
  });

  it("Scenario 7: handles subscription error states and subsequent recovery", () => {
    act(() => {
      useTimeAndSalesStore.getState().initWindow("win-err", "AAPL");
    });

    expect(lastErrorCallback).toBeDefined();

    act(() => {
      lastErrorCallback?.(new Error("Network connection dropped"));
    });

    let state = useTimeAndSalesStore.getState().windows["win-err"];

    expect(state.error).toBe("Network connection dropped");

    // Clear error
    act(() => {
      useTimeAndSalesStore.getState().setError("win-err", null);
    });

    state = useTimeAndSalesStore.getState().windows["win-err"];

    expect(state.error).toBeNull();
  });
});
