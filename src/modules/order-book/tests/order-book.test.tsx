import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { marketStreamService } from "@/src/modules/market-data";
import {
  DEFAULT_DEPTH_LIMIT,
  DEPTH_LIMIT_OPTIONS,
  ORDER_BOOK_WIDGET_KIND,
  ORDER_BOOK_WIDGET_TITLE,
  OrderBookWidget,
  orderBookDepthLimitSchema,
  orderBookRowSchema,
  orderBookWidgetDefinition,
  useOrderBookStore,
  type OrderBookDepthLimit,
  type OrderBookRow,
  type OrderBookStore,
  type OrderBookWidgetProps,
  type OrderBookWindowState,
} from "@/src/modules/order-book";

import type { ErrorHandler, SubscriptionOptions } from "@/src/modules/market-data";
import type { Instrument, OrderBookSnapshot, WidgetDefinition } from "@/src/shared/contracts";

const mockInstrumentApple: Instrument = {
  symbol: "AAPL",
  name: "Apple Inc.",
};

const mockInstrumentBitcoin: Instrument = {
  symbol: "BTC/USD",
  name: "Bitcoin",
};

const mockSnapshot: OrderBookSnapshot = {
  symbol: "AAPL",
  timestamp: 1700000000000,
  bids: [
    { price: 100.0, size: 10 },
    { price: 99.5, size: 20 },
  ],
  asks: [
    { price: 100.5, size: 15 },
    { price: 101.0, size: 25 },
  ],
};

const activeUnsubscribes: Array<ReturnType<typeof vi.fn>> = [];
let lastSnapshotCallback: ((snapshot: OrderBookSnapshot) => void) | undefined;
let lastErrorCallback: ErrorHandler | undefined;

beforeEach(() => {
  activeUnsubscribes.length = 0;
  lastSnapshotCallback = undefined;
  lastErrorCallback = undefined;

  vi.spyOn(marketStreamService, "subscribeOrderBook").mockImplementation(
    (
      _symbol: string,
      callback: (snapshot: OrderBookSnapshot) => void,
      _options?: SubscriptionOptions,
      onError?: ErrorHandler,
    ) => {
      lastSnapshotCallback = callback;
      lastErrorCallback = onError;

      const unsub = vi.fn();

      activeUnsubscribes.push(unsub);

      return unsub;
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();

  if (typeof useOrderBookStore?.getState === "function") {
    const currentWindows = Object.keys(useOrderBookStore.getState().windows || {});

    for (const windowId of currentWindows) {
      useOrderBookStore.getState().closeWindow(windowId);
    }
  }
});

describe("Order Book Module: Public Contract Perimeter & Schemas", () => {
  it("exports canonical constants conforming to design tokens and specs", () => {
    expect(DEFAULT_DEPTH_LIMIT).toBe(20);
    expect(DEPTH_LIMIT_OPTIONS).toEqual([10, 20, 50]);
    expect(ORDER_BOOK_WIDGET_KIND).toBe("orderBook");
    expect(ORDER_BOOK_WIDGET_TITLE).toBe("Order Book");
  });

  it("validates depth limits via orderBookDepthLimitSchema", () => {
    const testDepthLimit: OrderBookDepthLimit = 10;
    const valid10 = orderBookDepthLimitSchema.safeParse(testDepthLimit);
    const valid20 = orderBookDepthLimitSchema.safeParse(20);
    const valid50 = orderBookDepthLimitSchema.safeParse(50);

    expect(valid10.success).toBe(true);
    expect(valid20.success).toBe(true);
    expect(valid50.success).toBe(true);

    if (valid10.success) expect(valid10.data).toBe(10);
    if (valid20.success) expect(valid20.data).toBe(20);
    if (valid50.success) expect(valid50.data).toBe(50);

    const invalidCases = [5, 15, 25, 100, 0, -10, "10", "20", null, undefined, {}];

    for (const input of invalidCases) {
      expect(orderBookDepthLimitSchema.safeParse(input).success).toBe(false);
    }
  });

  it("validates order book rows via orderBookRowSchema", () => {
    const validBuyRow: OrderBookRow = {
      price: 100.5,
      size: 10,
      side: "buy",
      cumulativeSize: 10,
      depthPercent: 25,
    };

    const validSellRow: OrderBookRow = {
      price: 101.0,
      size: 25,
      side: "sell",
      cumulativeSize: 40,
      depthPercent: 100,
    };

    const parsedBuy = orderBookRowSchema.safeParse(validBuyRow);
    const parsedSell = orderBookRowSchema.safeParse(validSellRow);

    expect(parsedBuy.success).toBe(true);
    expect(parsedSell.success).toBe(true);

    if (parsedBuy.success) {
      expect(parsedBuy.data).toEqual(validBuyRow);
    }

    if (parsedSell.success) {
      expect(parsedSell.data).toEqual(validSellRow);
    }

    const invalidCases = [
      { price: 0, size: 10, side: "buy", cumulativeSize: 10, depthPercent: 25 },
      { price: -100, size: 10, side: "buy", cumulativeSize: 10, depthPercent: 25 },
      { price: 100, size: -1, side: "buy", cumulativeSize: 10, depthPercent: 25 },
      { price: 100, size: 10, side: "hold", cumulativeSize: 10, depthPercent: 25 },
      { price: 100, size: 10, side: "buy", cumulativeSize: -5, depthPercent: 25 },
      { price: 100, size: 10, side: "buy", cumulativeSize: 10, depthPercent: -1 },
      { price: 100, size: 10, side: "buy", cumulativeSize: 10, depthPercent: 100.1 },
      {},
      null,
      undefined,
    ];

    for (const invalid of invalidCases) {
      expect(orderBookRowSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("exports orderBookWidgetDefinition satisfying WidgetDefinition contract", () => {
    const definition: WidgetDefinition = orderBookWidgetDefinition;

    expect(definition.kind).toBe("orderBook");
    expect(definition.title).toBe("Order Book");
    expect(definition.component).toBe(OrderBookWidget);
  });
});

describe("Order Book Store: Scenarios 1-5 & Behavioral State Management", () => {
  it("Scenario 1: initializes window state and subscribes to market stream", () => {
    const store: OrderBookStore = useOrderBookStore.getState();

    store.initWindow("win-ob-1", "AAPL", 20);

    const windowState: OrderBookWindowState | undefined =
      useOrderBookStore.getState().windows["win-ob-1"];

    expect(windowState).toBeDefined();
    expect(windowState?.windowId).toBe("win-ob-1");
    expect(windowState?.symbol).toBe("AAPL");
    expect(windowState?.depthLimit).toBe(20);
    expect(windowState?.isLoading).toBe(true);
    expect(windowState?.error).toBeNull();
    expect(windowState?.bids).toEqual([]);
    expect(windowState?.asks).toEqual([]);
    expect(windowState?.bestBid).toBeNull();
    expect(windowState?.bestAsk).toBeNull();
    expect(windowState?.spread).toBeNull();
    expect(windowState?.spreadPct).toBeNull();
    expect(windowState?.maxCumulativeSize).toBe(0);
    expect(windowState?.lastUpdated).toBeNull();

    expect(marketStreamService.subscribeOrderBook).toHaveBeenCalledTimes(1);

    expect(marketStreamService.subscribeOrderBook).toHaveBeenCalledWith(
      "AAPL",
      expect.any(Function),
      undefined,
      expect.any(Function),
    );
  });

  it("Scenario 1 (default depth): defaults depth limit to DEFAULT_DEPTH_LIMIT if omitted", () => {
    useOrderBookStore.getState().initWindow("win-ob-default", "AAPL");

    const windowState = useOrderBookStore.getState().windows["win-ob-default"];

    expect(windowState?.depthLimit).toBe(DEFAULT_DEPTH_LIMIT);
  });

  it("Scenario 2: processes snapshot ingestion, depth aggregation, and spread calculation", () => {
    useOrderBookStore.getState().initWindow("win-ob-1", "AAPL", 20);

    act(() => {
      useOrderBookStore.getState().updateSnapshot("win-ob-1", mockSnapshot);
    });

    const windowState = useOrderBookStore.getState().windows["win-ob-1"];

    expect(windowState).toBeDefined();
    expect(windowState.isLoading).toBe(false);
    expect(windowState.error).toBeNull();
    expect(windowState.lastUpdated).toBe(1700000000000);

    expect(windowState.bestBid).toBe(100.0);
    expect(windowState.bestAsk).toBe(100.5);
    expect(windowState.spread).toBeCloseTo(0.5, 4);

    // spreadPct = (0.5 / ((100.5 + 100.0) / 2)) * 100 = 0.5 / 100.25 * 100 ~= 0.49875%
    expect(windowState.spreadPct).toBeCloseTo(0.4988, 3);
    expect(windowState.maxCumulativeSize).toBe(40);

    // Bids verification (ordered descending from best bid down)
    expect(windowState.bids).toHaveLength(2);

    expect(windowState.bids[0]).toEqual({
      price: 100.0,
      size: 10,
      side: "buy",
      cumulativeSize: 10,
      depthPercent: 25,
    });

    expect(windowState.bids[1]).toEqual({
      price: 99.5,
      size: 20,
      side: "buy",
      cumulativeSize: 30,
      depthPercent: 75,
    });

    // Asks verification (ordered ascending from best ask up)
    expect(windowState.asks).toHaveLength(2);

    expect(windowState.asks[0]).toEqual({
      price: 100.5,
      size: 15,
      side: "sell",
      cumulativeSize: 15,
      depthPercent: 37.5,
    });

    expect(windowState.asks[1]).toEqual({
      price: 101.0,
      size: 25,
      side: "sell",
      cumulativeSize: 40,
      depthPercent: 100,
    });
  });

  it("Scenario 2 (stream callback): updates store when snapshot is received via marketStreamService callback", () => {
    useOrderBookStore.getState().initWindow("win-ob-stream", "AAPL", 20);

    expect(lastSnapshotCallback).toBeDefined();

    act(() => {
      lastSnapshotCallback?.(mockSnapshot);
    });

    const windowState = useOrderBookStore.getState().windows["win-ob-stream"];

    expect(windowState.isLoading).toBe(false);
    expect(windowState.bestBid).toBe(100.0);
    expect(windowState.bestAsk).toBe(100.5);
    expect(windowState.maxCumulativeSize).toBe(40);
  });

  it("Scenario 2 (sorting): sorts unsorted snapshot bids descending and asks ascending", () => {
    useOrderBookStore.getState().initWindow("win-ob-sort", "AAPL", 20);

    const unsortedSnapshot: OrderBookSnapshot = {
      symbol: "AAPL",
      timestamp: 1700000005000,
      bids: [
        { price: 98.0, size: 5 },
        { price: 100.0, size: 10 },
        { price: 99.0, size: 15 },
      ],
      asks: [
        { price: 102.0, size: 20 },
        { price: 100.5, size: 10 },
        { price: 101.0, size: 15 },
      ],
    };

    act(() => {
      useOrderBookStore.getState().updateSnapshot("win-ob-sort", unsortedSnapshot);
    });

    const state = useOrderBookStore.getState().windows["win-ob-sort"];

    expect(state.bids[0].price).toBe(100.0);
    expect(state.bids[1].price).toBe(99.0);
    expect(state.bids[2].price).toBe(98.0);

    expect(state.asks[0].price).toBe(100.5);
    expect(state.asks[1].price).toBe(101.0);
    expect(state.asks[2].price).toBe(102.0);

    expect(state.bestBid).toBe(100.0);
    expect(state.bestAsk).toBe(100.5);
    expect(state.maxCumulativeSize).toBe(45);
  });

  it("Scenario 3: dynamically reslices depth limit and recalculates depth percentages", () => {
    useOrderBookStore.getState().initWindow("win-ob-reslice", "AAPL", 20);

    const bids25 = Array.from({ length: 25 }, (_, i) => ({
      price: 100 - i,
      size: 10,
    }));
    const asks25 = Array.from({ length: 25 }, (_, i) => ({
      price: 101 + i,
      size: 10,
    }));

    const snapshot25: OrderBookSnapshot = {
      symbol: "AAPL",
      timestamp: 1700000010000,
      bids: bids25,
      asks: asks25,
    };

    act(() => {
      useOrderBookStore.getState().updateSnapshot("win-ob-reslice", snapshot25);
    });

    const initialWindow = useOrderBookStore.getState().windows["win-ob-reslice"];

    expect(initialWindow.bids).toHaveLength(20);
    expect(initialWindow.asks).toHaveLength(20);
    expect(initialWindow.maxCumulativeSize).toBe(200);

    act(() => {
      useOrderBookStore.getState().setDepthLimit("win-ob-reslice", 10);
    });

    const reslicedWindow = useOrderBookStore.getState().windows["win-ob-reslice"];

    expect(reslicedWindow.depthLimit).toBe(10);
    expect(reslicedWindow.bids).toHaveLength(10);
    expect(reslicedWindow.asks).toHaveLength(10);
    expect(reslicedWindow.maxCumulativeSize).toBe(100);

    expect(reslicedWindow.bids[0].cumulativeSize).toBe(10);
    expect(reslicedWindow.bids[0].depthPercent).toBe(10);
    expect(reslicedWindow.bids[9].cumulativeSize).toBe(100);
    expect(reslicedWindow.bids[9].depthPercent).toBe(100);

    expect(reslicedWindow.asks[0].cumulativeSize).toBe(10);
    expect(reslicedWindow.asks[0].depthPercent).toBe(10);
    expect(reslicedWindow.asks[9].cumulativeSize).toBe(100);
    expect(reslicedWindow.asks[9].depthPercent).toBe(100);
  });

  it("Scenario 4: handles stream errors via error callback and store action", () => {
    useOrderBookStore.getState().initWindow("win-ob-err", "AAPL", 20);

    expect(useOrderBookStore.getState().windows["win-ob-err"].isLoading).toBe(true);
    expect(useOrderBookStore.getState().windows["win-ob-err"].error).toBeNull();

    act(() => {
      lastErrorCallback?.(new Error("Connection lost"));
    });

    const stateAfterCallback = useOrderBookStore.getState().windows["win-ob-err"];

    expect(stateAfterCallback.error).toBe("Connection lost");
    expect(stateAfterCallback.isLoading).toBe(false);

    act(() => {
      useOrderBookStore.getState().setError("win-ob-err", "Manual stream timeout");
    });

    expect(useOrderBookStore.getState().windows["win-ob-err"].error).toBe("Manual stream timeout");
  });

  it("Scenario 5: teardown invokes unsubscribe and deletes window from store", () => {
    useOrderBookStore.getState().initWindow("win-ob-teardown", "AAPL", 20);

    expect(useOrderBookStore.getState().windows["win-ob-teardown"]).toBeDefined();
    expect(activeUnsubscribes).toHaveLength(1);

    const unsubSpy = activeUnsubscribes[0];

    act(() => {
      useOrderBookStore.getState().closeWindow("win-ob-teardown");
    });

    expect(unsubSpy).toHaveBeenCalledTimes(1);
    expect(useOrderBookStore.getState().windows["win-ob-teardown"]).toBeUndefined();
  });

  it("isolates state between multiple independent order book windows", () => {
    render(
      <div>
        <OrderBookWidget windowId="win-1" instrument={mockInstrumentApple} />
        <OrderBookWidget windowId="win-2" instrument={mockInstrumentBitcoin} />
      </div>,
    );

    expect(useOrderBookStore.getState().windows["win-1"].symbol).toBe("AAPL");
    expect(useOrderBookStore.getState().windows["win-2"].symbol).toBe("BTC/USD");

    act(() => {
      useOrderBookStore.getState().updateSnapshot("win-1", mockSnapshot);
    });

    expect(useOrderBookStore.getState().windows["win-1"].bids).toHaveLength(2);
    expect(useOrderBookStore.getState().windows["win-2"].bids).toHaveLength(0);

    act(() => {
      useOrderBookStore.getState().setDepthLimit("win-1", 10);
    });

    expect(useOrderBookStore.getState().windows["win-1"].depthLimit).toBe(10);
    expect(useOrderBookStore.getState().windows["win-2"].depthLimit).toBe(20);

    act(() => {
      useOrderBookStore.getState().closeWindow("win-1");
    });

    expect(useOrderBookStore.getState().windows["win-1"]).toBeUndefined();
    expect(useOrderBookStore.getState().windows["win-2"]).toBeDefined();
  });
});

describe("Order Book Widget Component: UI Presentation & Interaction", () => {
  it("Scenario 6: renders ladder and triggers onSelectPrice on row click", () => {
    const onSelectPrice = vi.fn();
    const props: OrderBookWidgetProps = {
      windowId: "win-ui-select",
      instrument: mockInstrumentApple,
      onSelectPrice,
    };

    render(<OrderBookWidget {...props} />);

    act(() => {
      useOrderBookStore.getState().updateSnapshot("win-ui-select", mockSnapshot);
    });

    // Verify instrument symbol or title is displayed
    expect(screen.getByText(/AAPL/)).toBeTruthy();

    // Verify spread row is displayed
    expect(within(screen.getByTestId("order-book-spread")).getAllByText(/0\.5/)[0]).toBeTruthy();

    // Locate ask price 100.5 and click it
    const asksSection = screen.getByRole("rowgroup", { name: "Asks" });
    const askPriceElement = within(asksSection).getByText("100.5");

    expect(askPriceElement).toBeTruthy();
    fireEvent.click(askPriceElement);

    expect(onSelectPrice).toHaveBeenCalledTimes(1);
    expect(onSelectPrice).toHaveBeenCalledWith(100.5);

    // Locate bid price 100 and click it
    const bidsSection = screen.getByRole("rowgroup", { name: "Bids" });
    const bidPriceElement = within(bidsSection).getByText("100");

    expect(bidPriceElement).toBeTruthy();
    fireEvent.click(bidPriceElement);

    expect(onSelectPrice).toHaveBeenCalledTimes(2);
    expect(onSelectPrice).toHaveBeenCalledWith(100.0);
  });

  it("Scenario 6 (depth selector): clicking depth limit buttons updates store depthLimit", () => {
    render(<OrderBookWidget windowId="win-ui-depth" instrument={mockInstrumentApple} />);

    act(() => {
      useOrderBookStore.getState().updateSnapshot("win-ui-depth", mockSnapshot);
    });

    const button10 = screen.getByRole("button", { name: "10" });
    const button50 = screen.getByRole("button", { name: "50" });

    expect(button10).toBeTruthy();
    expect(button50).toBeTruthy();

    fireEvent.click(button10);
    expect(useOrderBookStore.getState().windows["win-ui-depth"].depthLimit).toBe(10);

    fireEvent.click(button50);
    expect(useOrderBookStore.getState().windows["win-ui-depth"].depthLimit).toBe(50);
  });

  it("Scenario A: OrderBookHeader renders symbol and name without redundant Change button", () => {
    const onChangeInstrument = vi.fn();

    render(
      <OrderBookWidget
        windowId="win-ui-header"
        instrument={mockInstrumentApple}
        onChangeInstrument={onChangeInstrument}
      />,
    );

    expect(screen.getByText("AAPL")).toBeDefined();
    expect(screen.getByText("Apple Inc.")).toBeDefined();
    expect(screen.queryByRole("button", { name: /change/i })).toBeNull();
  });

  it("Scenario B: switching depth limit dynamically changes row count using 50-level snapshot", () => {
    const snapshot50: OrderBookSnapshot = {
      symbol: "AAPL",
      timestamp: 1700000020000,
      bids: Array.from({ length: 50 }, (_, i) => ({
        price: Number((100 - (i + 1) * 0.1).toFixed(2)),
        size: 10 + i,
      })),
      asks: Array.from({ length: 50 }, (_, i) => ({
        price: Number((100 + (i + 1) * 0.1).toFixed(2)),
        size: 10 + i,
      })),
    };

    render(<OrderBookWidget windowId="win-ui-depth-switch" instrument={mockInstrumentApple} />);

    act(() => {
      useOrderBookStore.getState().updateSnapshot("win-ui-depth-switch", snapshot50);
    });

    const asksSection = screen.getByRole("rowgroup", { name: "Asks" });
    const bidsSection = screen.getByRole("rowgroup", { name: "Bids" });
    const button10 = screen.getByRole("button", { name: "10" });
    const button20 = screen.getByRole("button", { name: "20" });
    const button50 = screen.getByRole("button", { name: "50" });

    // Initial default depth limit is 20
    expect(within(asksSection).getAllByRole("row")).toHaveLength(20);
    expect(within(bidsSection).getAllByRole("row")).toHaveLength(20);
    expect(button20.getAttribute("data-active")).toBe("true");
    expect(button20.getAttribute("aria-pressed")).toBe("true");

    // Click depth 10
    fireEvent.click(button10);
    expect(within(asksSection).getAllByRole("row")).toHaveLength(10);
    expect(within(bidsSection).getAllByRole("row")).toHaveLength(10);
    expect(button10.getAttribute("data-active")).toBe("true");
    expect(button10.getAttribute("aria-pressed")).toBe("true");

    // Click depth 50
    fireEvent.click(button50);
    expect(within(asksSection).getAllByRole("row")).toHaveLength(50);
    expect(within(bidsSection).getAllByRole("row")).toHaveLength(50);
    expect(button50.getAttribute("data-active")).toBe("true");
    expect(button50.getAttribute("aria-pressed")).toBe("true");
  });

  it("Scenario 7: renders loading presentation state without NaN or crashes", () => {
    const { container } = render(
      <OrderBookWidget windowId="win-loading" instrument={mockInstrumentApple} />,
    );

    expect(useOrderBookStore.getState().windows["win-loading"]?.isLoading).toBe(true);

    const loadingIndicator = screen.getByText(/connecting|loading/i);

    expect(loadingIndicator).toBeTruthy();
    expect(container.textContent).not.toContain("NaN");
    expect(container.textContent).not.toContain("undefined");
  });

  it("Scenario 7: renders empty presentation state when bids and asks are empty", () => {
    const { container } = render(
      <OrderBookWidget windowId="win-empty" instrument={mockInstrumentApple} />,
    );

    act(() => {
      useOrderBookStore.getState().updateSnapshot("win-empty", {
        symbol: "AAPL",
        timestamp: 1700000000000,
        bids: [],
        asks: [],
      });
    });

    const emptyMessage = screen.getByText(/no depth data|no data/i);

    expect(emptyMessage).toBeTruthy();
    expect(container.textContent).not.toContain("NaN");
  });

  it("Scenario 7: renders error presentation state when error occurs", () => {
    render(<OrderBookWidget windowId="win-err-ui" instrument={mockInstrumentApple} />);

    act(() => {
      useOrderBookStore.getState().setError("win-err-ui", "Network stream error");
    });

    expect(screen.getByText(/network stream error/i)).toBeTruthy();
  });

  it("manages React lifecycle by subscribing on mount and unsubscribing on unmount", () => {
    const { unmount } = render(
      <OrderBookWidget windowId="win-lifecycle" instrument={mockInstrumentApple} />,
    );

    expect(useOrderBookStore.getState().windows["win-lifecycle"]).toBeDefined();
    expect(activeUnsubscribes).toHaveLength(1);

    const unsubSpy = activeUnsubscribes[0];

    unmount();

    expect(unsubSpy).toHaveBeenCalledTimes(1);
    expect(useOrderBookStore.getState().windows["win-lifecycle"]).toBeUndefined();
  });
});
