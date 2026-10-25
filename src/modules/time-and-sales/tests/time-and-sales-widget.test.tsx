import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { marketStreamService } from "@/src/modules/market-data";
import {
  TIME_AND_SALES_WIDGET_KIND,
  TIME_AND_SALES_WIDGET_TITLE,
  TimeAndSalesWidget,
  timeAndSalesWidgetDefinition,
  useTimeAndSalesStore,
} from "@/src/modules/time-and-sales";

import type { ErrorHandler, SubscriptionOptions } from "@/src/modules/market-data";
import type { TimeAndSalesWidgetProps } from "@/src/modules/time-and-sales";
import type { Instrument, Trade, WidgetDefinition } from "@/src/shared/contracts";

const mockInstrumentApple: Instrument = {
  symbol: "AAPL",
  name: "Apple Inc.",
};

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

const activeUnsubscribes: Array<ReturnType<typeof vi.fn>> = [];
let lastTradeCallback: ((trade: Trade) => void) | undefined;
let lastErrorCallback: ErrorHandler | undefined;

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
  cleanup();
  vi.restoreAllMocks();

  if (typeof useTimeAndSalesStore?.getState === "function") {
    const currentWindows = Object.keys(useTimeAndSalesStore.getState().windows || {});

    for (const windowId of currentWindows) {
      useTimeAndSalesStore.getState().closeWindow(windowId);
    }
  }
});

describe("Time & Sales Widget: UI Component & Accessibility Tests", () => {
  it("Scenario 1: renders table, semantic columns (Time, Price, Size, Side) and trade rows", () => {
    const props: TimeAndSalesWidgetProps = {
      windowId: "win-ui-table",
      instrument: mockInstrumentApple,
    };

    render(<TimeAndSalesWidget {...props} />);

    // Feed 3 trades through the active stream callback
    act(() => {
      lastTradeCallback?.(mockTradeBuySmall);
      lastTradeCallback?.(mockTradeSellMedium);
      lastTradeCallback?.(mockTradeBuyLarge);
    });

    const table = screen.getByRole("table");

    expect(table).toBeDefined();

    // Headers check
    const columnHeaders = screen.getAllByRole("columnheader");

    expect(columnHeaders).toHaveLength(4);

    const headerTexts = columnHeaders.map((header) => header.textContent?.trim());

    expect(headerTexts).toEqual(["Time", "Price", "Size", "Side"]);

    // Data rows check (3 trades rendered)
    const rows = screen.getAllByRole("row");

    // 1 header row + 3 trade data rows
    expect(rows).toHaveLength(4);

    // Verify latest trade (mockTradeBuyLarge) is the first data row (index 1)
    const firstDataRow = rows[1];

    expect(firstDataRow.textContent).toContain("150.30");
    expect(firstDataRow.textContent).toContain("50");
    expect(firstDataRow.textContent).toMatch(/buy/i);
  });

  it("Scenario 2: applies semantic color coding for Buy and Sell order sides", () => {
    const props: TimeAndSalesWidgetProps = {
      windowId: "win-ui-sides",
      instrument: mockInstrumentApple,
    };

    render(<TimeAndSalesWidget {...props} />);

    act(() => {
      lastTradeCallback?.(mockTradeBuySmall);
      lastTradeCallback?.(mockTradeSellMedium);
    });

    // Rows: header + 2 trade rows. Index 1: sell (trade-2), Index 2: buy (trade-1)
    const rows = screen.getAllByRole("row");
    const sellRow = rows[1];
    const buyRow = rows[2];

    expect(sellRow.textContent).toMatch(/sell/i);
    expect(buyRow.textContent).toMatch(/buy/i);

    // Verify buy/sell classes or styles
    expect(buyRow.className.toLowerCase()).toMatch(/buy|up/);
    expect(sellRow.className.toLowerCase()).toMatch(/sell|down/);
  });

  it("Scenario 3: visually highlights large volume trades exceeding threshold", () => {
    const props: TimeAndSalesWidgetProps = {
      windowId: "win-ui-large",
      instrument: mockInstrumentApple,
    };

    render(<TimeAndSalesWidget {...props} />);

    act(() => {
      lastTradeCallback?.(mockTradeBuySmall); // size: 5 < 20
      lastTradeCallback?.(mockTradeBuyLarge); // size: 50 >= 20
    });

    const rows = screen.getAllByRole("row");
    const largeTradeRow = rows[1]; // newest: mockTradeBuyLarge
    const smallTradeRow = rows[2]; // older: mockTradeBuySmall

    // Large trade row or its cell has large modifier class or attribute
    const isLargeHighlighted =
      largeTradeRow.className.toLowerCase().includes("large") ||
      Boolean(largeTradeRow.querySelector('[data-large="true"], [class*="large"]'));

    expect(isLargeHighlighted).toBe(true);

    const isSmallHighlighted =
      smallTradeRow.className.toLowerCase().includes("large") ||
      Boolean(smallTradeRow.querySelector('[data-large="true"], [class*="large"]'));

    expect(isSmallHighlighted).toBe(false);
  });

  it("Scenario 4: opens filter popover, applies presets and filters rows dynamically", () => {
    const props: TimeAndSalesWidgetProps = {
      windowId: "win-ui-filter",
      instrument: mockInstrumentApple,
    };

    render(<TimeAndSalesWidget {...props} />);

    act(() => {
      lastTradeCallback?.(mockTradeBuySmall); // size 5
      lastTradeCallback?.(mockTradeSellMedium); // size 15
      lastTradeCallback?.(mockTradeBuyLarge); // size 50
    });

    // Initially 3 data rows
    expect(screen.getAllByRole("row")).toHaveLength(4);

    // Open filter popover via filter button in header
    const filterButton = screen.getByRole("button", { name: /filter/i });

    fireEvent.click(filterButton);

    // Click preset "Large (≥50)"
    const largePresetBtn = screen.getByRole("button", { name: /Large \(≥50\)/i });

    fireEvent.click(largePresetBtn);

    // Only trade 3 (size 50) is visible + 1 header row = 2 rows
    const filteredRows = screen.getAllByRole("row");

    expect(filteredRows).toHaveLength(2);
    expect(screen.getByTestId("trade-row-trade-3")).toBeDefined();
    expect(screen.queryByTestId("trade-row-trade-1")).toBeNull();
    expect(screen.queryByTestId("trade-row-trade-2")).toBeNull();

    // Click "All" or "Reset" to restore full view
    const allPresetBtn = screen.getByRole("button", { name: /^all$/i });

    fireEvent.click(allPresetBtn);

    expect(screen.getAllByRole("row")).toHaveLength(4);
  });

  it("Scenario 5: invokes onChangeInstrument callback when clicking instrument button", () => {
    const onChangeInstrumentMock = vi.fn();
    const props: TimeAndSalesWidgetProps = {
      windowId: "win-ui-inst",
      instrument: mockInstrumentApple,
      onChangeInstrument: onChangeInstrumentMock,
    };

    render(<TimeAndSalesWidget {...props} />);

    // Click ticker / change instrument button
    const changeBtn = screen.getByRole("button", { name: /change instrument|AAPL/i });

    fireEvent.click(changeBtn);

    expect(onChangeInstrumentMock).toHaveBeenCalledTimes(1);
  });

  it("Scenario 6: allows selecting trade buffer limit from header options", () => {
    const props: TimeAndSalesWidgetProps = {
      windowId: "win-ui-buffer",
      instrument: mockInstrumentApple,
    };

    render(<TimeAndSalesWidget {...props} />);

    // Buffer limit selector exists in header
    const bufferSelect = screen.getByRole("combobox", { name: /buffer limit|depth/i });

    expect(bufferSelect).toBeDefined();

    // Switch buffer limit to 50
    fireEvent.change(bufferSelect, { target: { value: "50" } });

    const state = useTimeAndSalesStore.getState().windows["win-ui-buffer"];

    expect(state.bufferLimit).toBe(50);
  });

  it("Scenario 7: renders waiting indicator in loading state before first trade arrives", () => {
    const props: TimeAndSalesWidgetProps = {
      windowId: "win-ui-loading",
      instrument: mockInstrumentApple,
    };

    render(<TimeAndSalesWidget {...props} />);

    // Loading message visible
    const loadingMessage = screen.getByText(/waiting for trades stream/i);

    expect(loadingMessage).toBeDefined();
  });

  it("Scenario 8: displays empty state message when all trades are filtered out", () => {
    const props: TimeAndSalesWidgetProps = {
      windowId: "win-ui-empty-filter",
      instrument: mockInstrumentApple,
    };

    render(<TimeAndSalesWidget {...props} />);

    act(() => {
      lastTradeCallback?.(mockTradeBuySmall); // size 5
    });

    // Set filter to minSize: 100
    act(() => {
      useTimeAndSalesStore.getState().setSizeFilter("win-ui-empty-filter", { minSize: 100 });
    });

    const emptyMessage = screen.getByText(/no trades matching filter/i);

    expect(emptyMessage).toBeDefined();
  });

  it("Scenario 9: displays error alert when subscription encounters an error", () => {
    const props: TimeAndSalesWidgetProps = {
      windowId: "win-ui-err",
      instrument: mockInstrumentApple,
    };

    render(<TimeAndSalesWidget {...props} />);

    act(() => {
      lastErrorCallback?.(new Error("Stream disconnected unexpectedly"));
    });

    const errorMessage = screen.getByText(/Stream disconnected unexpectedly/i);

    expect(errorMessage).toBeDefined();
  });

  it("Scenario 10: cleans up subscription and closes window on unmount", () => {
    const props: TimeAndSalesWidgetProps = {
      windowId: "win-ui-unmount",
      instrument: mockInstrumentApple,
    };

    const { unmount } = render(<TimeAndSalesWidget {...props} />);

    expect(activeUnsubscribes).toHaveLength(1);

    const unsubMock = activeUnsubscribes[0];

    unmount();

    expect(unsubMock).toHaveBeenCalledTimes(1);
    expect(useTimeAndSalesStore.getState().windows["win-ui-unmount"]).toBeUndefined();
  });

  it("Scenario 11: exports timeAndSalesWidgetDefinition conforming to WidgetDefinition contract", () => {
    const definition: WidgetDefinition = timeAndSalesWidgetDefinition;

    expect(definition.kind).toBe(TIME_AND_SALES_WIDGET_KIND);
    expect(definition.title).toBe(TIME_AND_SALES_WIDGET_TITLE);
    expect(definition.component).toBe(TimeAndSalesWidget);
  });
});
