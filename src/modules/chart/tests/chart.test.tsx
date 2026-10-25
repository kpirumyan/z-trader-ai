import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AVAILABLE_CHART_TYPES,
  AVAILABLE_INDICATORS,
  CHART_PALETTES,
  ChartWidget,
  chartConfigSchema,
  chartIndicatorTypeSchema,
  chartTypeSchema,
  chartWidgetDefinition,
  DEFAULT_CHART_CONFIG,
  DEFAULT_INITIAL_CANDLE_COUNT,
  useChartStore,
  type ChartConfig,
  type ChartThemeColors,
} from "@/src/modules/chart";
import { marketStreamService } from "@/src/modules/market-data";

import type { Candle, Instrument, WidgetDefinition } from "@/src/shared/contracts";

interface MockChartInstance {
  readonly container: HTMLElement;
  readonly options: unknown;
  readonly applyOptions: ReturnType<typeof vi.fn>;
  readonly resize: ReturnType<typeof vi.fn>;
  readonly remove: ReturnType<typeof vi.fn>;
  readonly addSeries: ReturnType<typeof vi.fn>;
  readonly addCandlestickSeries: ReturnType<typeof vi.fn>;
  readonly addHistogramSeries: ReturnType<typeof vi.fn>;
  readonly addLineSeries: ReturnType<typeof vi.fn>;
  readonly addBarSeries: ReturnType<typeof vi.fn>;
  readonly subscribeCrosshairMove: ReturnType<typeof vi.fn>;
  readonly unsubscribeCrosshairMove: ReturnType<typeof vi.fn>;
  readonly timeScale: ReturnType<typeof vi.fn>;
}

const mockChartInstances: MockChartInstance[] = [];

vi.mock("lightweight-charts", () => {
  return {
    createChart: vi.fn((container: HTMLElement, options?: unknown) => {
      const mockSeries = {
        setData: vi.fn(),
        update: vi.fn(),
        applyOptions: vi.fn(),
        seriesType: vi.fn().mockReturnValue("Candlestick"),
      };

      const canvas = document.createElement("canvas");

      canvas.width = 600;
      canvas.height = 400;
      container.appendChild(canvas);

      const instance: MockChartInstance = {
        container,
        options,
        applyOptions: vi.fn(),
        resize: vi.fn(),
        remove: vi.fn(() => {
          if (container.contains(canvas)) {
            container.removeChild(canvas);
          }
        }),
        addSeries: vi.fn().mockReturnValue(mockSeries),
        addCandlestickSeries: vi.fn().mockReturnValue(mockSeries),
        addHistogramSeries: vi.fn().mockReturnValue(mockSeries),
        addLineSeries: vi.fn().mockReturnValue(mockSeries),
        addBarSeries: vi.fn().mockReturnValue(mockSeries),
        subscribeCrosshairMove: vi.fn(),
        unsubscribeCrosshairMove: vi.fn(),
        timeScale: vi.fn().mockReturnValue({
          fitContent: vi.fn(),
          scrollToRealtime: vi.fn(),
        }),
      };

      mockChartInstances.push(instance);

      return instance;
    }),
    CandlestickSeries: "CandlestickSeries",
    HistogramSeries: "HistogramSeries",
    LineSeries: "LineSeries",
    BarSeries: "BarSeries",
    ColorType: { Solid: "solid", VerticalGradient: "gradient" },
    CrosshairMode: { Normal: 0, Magnet: 1 },
  };
});

interface MockResizeObserverInstance {
  readonly observe: ReturnType<typeof vi.fn>;
  readonly unobserve: ReturnType<typeof vi.fn>;
  readonly disconnect: ReturnType<typeof vi.fn>;
}

const mockResizeObserverInstances: MockResizeObserverInstance[] = [];

class MockResizeObserver implements ResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();

  constructor() {
    mockResizeObserverInstances.push(this);
  }
}

const originalResizeObserver = global.ResizeObserver;
const activeUnsubscribes: Array<ReturnType<typeof vi.fn>> = [];

beforeAll(() => {
  global.ResizeObserver = MockResizeObserver;
});

afterAll(() => {
  global.ResizeObserver = originalResizeObserver;
});

beforeEach(() => {
  mockChartInstances.length = 0;
  mockResizeObserverInstances.length = 0;
  activeUnsubscribes.length = 0;
  document.documentElement.dataset.theme = "dark";

  vi.spyOn(marketStreamService, "subscribeCandles").mockImplementation(() => {
    const unsub = vi.fn();

    activeUnsubscribes.push(unsub);

    return unsub;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete document.documentElement.dataset.theme;

  const currentWindows = Object.keys(useChartStore.getState().windows);

  for (const windowId of currentWindows) {
    useChartStore.getState().cleanupWindow(windowId);
  }
});

const mockInstrumentApple: Instrument = {
  symbol: "AAPL",
  name: "Apple Inc.",
};

const mockInstrumentBitcoin: Instrument = {
  symbol: "BTC/USD",
  name: "Bitcoin",
};

describe("Chart Module: Public Contract Perimeter & Schemas", () => {
  it("validates chart types via chartTypeSchema", () => {
    const validCandlestick = chartTypeSchema.safeParse("candlestick");
    const validBars = chartTypeSchema.safeParse("bars");
    const validLine = chartTypeSchema.safeParse("line");

    expect(validCandlestick.success).toBe(true);
    expect(validBars.success).toBe(true);
    expect(validLine.success).toBe(true);

    if (validCandlestick.success) expect(validCandlestick.data).toBe("candlestick");
    if (validBars.success) expect(validBars.data).toBe("bars");
    if (validLine.success) expect(validLine.data).toBe("line");

    const invalidCases = ["area", "mountain", "heikin-ashi", "", 123, null, undefined, {}];

    for (const input of invalidCases) {
      expect(chartTypeSchema.safeParse(input).success).toBe(false);
    }
  });

  it("validates indicator types via chartIndicatorTypeSchema", () => {
    const validVolume = chartIndicatorTypeSchema.safeParse("volume");
    const validSma = chartIndicatorTypeSchema.safeParse("sma");
    const validEma = chartIndicatorTypeSchema.safeParse("ema");

    expect(validVolume.success).toBe(true);
    expect(validSma.success).toBe(true);
    expect(validEma.success).toBe(true);

    if (validVolume.success) expect(validVolume.data).toBe("volume");
    if (validSma.success) expect(validSma.data).toBe("sma");
    if (validEma.success) expect(validEma.data).toBe("ema");

    const invalidCases = ["rsi", "macd", "bollinger", "", 456, null, undefined];

    for (const input of invalidCases) {
      expect(chartIndicatorTypeSchema.safeParse(input).success).toBe(false);
    }
  });

  it("validates full chart configuration via chartConfigSchema", () => {
    const validConfig: ChartConfig = {
      timeframe: "1m",
      chartType: "candlestick",
      indicators: ["volume", "sma"],
    };

    const parsed = chartConfigSchema.safeParse(validConfig);

    expect(parsed.success).toBe(true);

    if (parsed.success) {
      expect(parsed.data.timeframe).toBe("1m");
      expect(parsed.data.chartType).toBe("candlestick");
      expect(parsed.data.indicators).toEqual(["volume", "sma"]);
    }

    const invalidConfigs = [
      {},
      { timeframe: "2m", chartType: "candlestick", indicators: [] },
      { timeframe: "1m", chartType: "unsupported", indicators: [] },
      { timeframe: "1m", chartType: "candlestick", indicators: ["unknown"] },
      null,
      undefined,
    ];

    for (const config of invalidConfigs) {
      expect(chartConfigSchema.safeParse(config).success).toBe(false);
    }
  });

  it("exports expected static constants with design-token-compliant palettes", () => {
    expect(AVAILABLE_CHART_TYPES).toEqual(["candlestick", "bars", "line"]);
    expect(AVAILABLE_INDICATORS).toEqual(["volume", "sma", "ema"]);
    expect(DEFAULT_INITIAL_CANDLE_COUNT).toBe(80);

    expect(DEFAULT_CHART_CONFIG).toEqual({
      timeframe: "1m",
      chartType: "candlestick",
      indicators: ["volume"],
    });

    const darkPalette: ChartThemeColors = CHART_PALETTES.dark;
    const lightPalette: ChartThemeColors = CHART_PALETTES.light;

    expect(darkPalette.background).toBe("#1a1a1a");
    expect(darkPalette.textColor).toBe("#bdbdbd");
    expect(darkPalette.gridColor).toBe("#2b2b2b");
    expect(darkPalette.borderColor).toBe("#393939");
    expect(darkPalette.upColor).toBe("#61d6ab");
    expect(darkPalette.downColor).toBe("#ff8797");

    expect(lightPalette.background).toBe("#f7f7f7");
    expect(lightPalette.textColor).toBe("#555555");
    expect(lightPalette.gridColor).toBe("#e9e9e9");
    expect(lightPalette.borderColor).toBe("#d8d8d8");
    expect(lightPalette.upColor).toBe("#146c51");
    expect(lightPalette.downColor).toBe("#b33142");
  });

  it("exports a compliant widget definition for composition registry", () => {
    const definition: WidgetDefinition = chartWidgetDefinition;

    expect(definition.kind).toBe("chart");
    expect(definition.title).toBe("Chart");
    expect(definition.component).toBe(ChartWidget);
  });
});

describe("Chart Module: Core State Management (useChartStore)", () => {
  it("Scenario 3: handles real-time candle stream append and in-bar replacement", () => {
    const store = useChartStore.getState();

    store.initWindow("win-state", "AAPL");

    const initialCandle: Candle = {
      time: 1700000000,
      open: 150,
      high: 151,
      low: 149,
      close: 150,
      volume: 1000,
    };

    store.setCandles("win-state", [initialCandle]);

    const stateAfterSet = useChartStore.getState().windows["win-state"];

    expect(stateAfterSet.candles).toHaveLength(1);
    expect(stateAfterSet.candles[0].close).toBe(150);

    // 1. In-bar update with same timestamp replaces last candle
    const inBarUpdate: Candle = {
      time: 1700000000,
      open: 150,
      high: 153,
      low: 149,
      close: 151,
      volume: 1100,
    };

    store.appendOrUpdateCandle("win-state", inBarUpdate);

    const stateAfterInBar = useChartStore.getState().windows["win-state"];

    expect(stateAfterInBar.candles).toHaveLength(1);
    expect(stateAfterInBar.candles[0].close).toBe(151);
    expect(stateAfterInBar.candles[0].high).toBe(153);
    expect(stateAfterInBar.candles[0].volume).toBe(1100);

    // 2. Next bar with subsequent timestamp is appended
    const nextBar: Candle = {
      time: 1700000060,
      open: 151,
      high: 154,
      low: 150,
      close: 152,
      volume: 800,
    };

    store.appendOrUpdateCandle("win-state", nextBar);

    const stateAfterAppend = useChartStore.getState().windows["win-state"];

    expect(stateAfterAppend.candles).toHaveLength(2);
    expect(stateAfterAppend.candles[0].time).toBe(1700000000);
    expect(stateAfterAppend.candles[1].time).toBe(1700000060);
    expect(stateAfterAppend.candles[1].close).toBe(152);

    // 3. Stale bar with previous timestamp is safely ignored
    const staleBar: Candle = {
      time: 1699999940,
      open: 148,
      high: 149,
      low: 147,
      close: 148,
      volume: 500,
    };

    store.appendOrUpdateCandle("win-state", staleBar);

    const stateAfterStale = useChartStore.getState().windows["win-state"];

    expect(stateAfterStale.candles).toHaveLength(2);
    expect(stateAfterStale.candles[1].time).toBe(1700000060);
  });

  it("Scenario 5 (Store): maintains multi-window state isolation across independent windows", () => {
    const store = useChartStore.getState();

    store.initWindow("win-1", "AAPL");
    store.initWindow("win-2", "BTC/USD");

    expect(useChartStore.getState().windows["win-1"].symbol).toBe("AAPL");
    expect(useChartStore.getState().windows["win-1"].timeframe).toBe("1m");
    expect(useChartStore.getState().windows["win-2"].symbol).toBe("BTC/USD");
    expect(useChartStore.getState().windows["win-2"].timeframe).toBe("1m");

    store.setTimeframe("win-1", "1h");

    expect(useChartStore.getState().windows["win-1"].timeframe).toBe("1h");
    expect(useChartStore.getState().windows["win-2"].timeframe).toBe("1m");

    store.toggleIndicator("win-2", "ema");

    expect(useChartStore.getState().windows["win-1"].indicators).toEqual(["volume"]);
    expect(useChartStore.getState().windows["win-2"].indicators).toEqual(["volume", "ema"]);
  });

  it("toggles indicators and updates visual chart types correctly", () => {
    const store = useChartStore.getState();

    store.initWindow("win-options", "AAPL");

    expect(useChartStore.getState().windows["win-options"].indicators).toEqual(["volume"]);
    expect(useChartStore.getState().windows["win-options"].chartType).toBe("candlestick");

    store.toggleIndicator("win-options", "sma");
    expect(useChartStore.getState().windows["win-options"].indicators).toEqual(["volume", "sma"]);

    store.toggleIndicator("win-options", "volume");
    expect(useChartStore.getState().windows["win-options"].indicators).toEqual(["sma"]);

    store.toggleIndicator("win-options", "sma");
    expect(useChartStore.getState().windows["win-options"].indicators).toEqual([]);

    store.setChartType("win-options", "line");
    expect(useChartStore.getState().windows["win-options"].chartType).toBe("line");

    store.setChartType("win-options", "bars");
    expect(useChartStore.getState().windows["win-options"].chartType).toBe("bars");
  });

  it("manages hovered candle, loading, error, and cleanup lifecycle", () => {
    const store = useChartStore.getState();

    store.initWindow("win-lifecycle", "AAPL");

    const hoveredCandle: Candle = {
      time: 1700000000,
      open: 150,
      high: 155,
      low: 148,
      close: 153,
      volume: 4500,
    };

    store.setHoveredCandle("win-lifecycle", hoveredCandle);
    expect(useChartStore.getState().windows["win-lifecycle"].hoveredCandle).toEqual(hoveredCandle);

    store.setHoveredCandle("win-lifecycle", null);
    expect(useChartStore.getState().windows["win-lifecycle"].hoveredCandle).toBeNull();

    store.setLoading("win-lifecycle", true);
    expect(useChartStore.getState().windows["win-lifecycle"].isLoading).toBe(true);

    store.setError("win-lifecycle", "Data transport disconnected");

    expect(useChartStore.getState().windows["win-lifecycle"].error).toBe(
      "Data transport disconnected",
    );

    store.cleanupWindow("win-lifecycle");
    expect(useChartStore.getState().windows["win-lifecycle"]).toBeUndefined();
  });
});

describe("Chart Module: Behavioral Component Scenarios (ChartWidget)", () => {
  it("Scenario 1: mounts widget with default toolbar configuration, canvas container, and store registration", () => {
    const { container } = render(<ChartWidget windowId="win-1" instrument={mockInstrumentApple} />);

    // Toolbar with timeframes rendered and 1m is active by default
    const btn1m = screen.getByRole("button", { name: "1m" });
    const btn5m = screen.getByRole("button", { name: "5m" });
    const btn15m = screen.getByRole("button", { name: "15m" });
    const btn1h = screen.getByRole("button", { name: "1h" });
    const btn1d = screen.getByRole("button", { name: "1d" });

    expect(btn1m).toBeDefined();
    expect(btn5m).toBeDefined();
    expect(btn15m).toBeDefined();
    expect(btn1h).toBeDefined();
    expect(btn1d).toBeDefined();

    expect(btn1m.getAttribute("aria-pressed")).toBe("true");
    expect(btn5m.getAttribute("aria-pressed")).toBe("false");

    // Canvas container is rendered
    const canvasElement = container.querySelector("canvas");

    expect(canvasElement).not.toBeNull();

    // Store state created with AAPL, 1m timeframe, and volume indicator
    const windowState = useChartStore.getState().windows["win-1"];

    expect(windowState).toBeDefined();
    expect(windowState.symbol).toBe("AAPL");
    expect(windowState.timeframe).toBe("1m");
    expect(windowState.indicators).toEqual(["volume"]);
  });

  it("Scenario 2: switches timeframe on button click, updates store, and resubscribes stream", () => {
    render(<ChartWidget windowId="win-1" instrument={mockInstrumentApple} />);

    const subscribeSpy = vi.mocked(marketStreamService.subscribeCandles);

    expect(subscribeSpy).toHaveBeenCalledWith("AAPL", expect.any(Function), { timeframe: "1m" });
    expect(activeUnsubscribes).toHaveLength(1);

    const firstUnsubscribe = activeUnsubscribes[0];
    const btn5m = screen.getByRole("button", { name: "5m" });
    const btn1m = screen.getByRole("button", { name: "1m" });

    act(() => {
      fireEvent.click(btn5m);
    });

    // 5m button becomes active; 1m becomes inactive
    expect(btn5m.getAttribute("aria-pressed")).toBe("true");
    expect(btn1m.getAttribute("aria-pressed")).toBe("false");

    // Store timeframe updated to 5m
    expect(useChartStore.getState().windows["win-1"].timeframe).toBe("5m");

    // Previous subscription unsubscribed and new subscription called with 5m
    expect(firstUnsubscribe).toHaveBeenCalledTimes(1);

    expect(subscribeSpy).toHaveBeenLastCalledWith("AAPL", expect.any(Function), {
      timeframe: "5m",
    });
  });

  it("Scenario 4: updates chart styling dynamically via applyOptions on theme change without remounting canvas", () => {
    document.documentElement.dataset.theme = "dark";

    const { container } = render(<ChartWidget windowId="win-1" instrument={mockInstrumentApple} />);

    expect(mockChartInstances).toHaveLength(1);

    const chartInstance = mockChartInstances[0];
    const canvasBeforeThemeChange = container.querySelector("canvas");

    expect(canvasBeforeThemeChange).not.toBeNull();

    act(() => {
      document.documentElement.dataset.theme = "light";
      window.dispatchEvent(new Event("storage"));
    });

    // applyOptions called with light theme palette from CHART_PALETTES.light
    expect(chartInstance.applyOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        layout: expect.objectContaining({
          background: expect.objectContaining({
            color: CHART_PALETTES.light.background,
          }),
          textColor: CHART_PALETTES.light.textColor,
        }),
      }),
    );

    // Canvas DOM element is preserved (not remounted or replaced)
    const canvasAfterThemeChange = container.querySelector("canvas");

    expect(canvasAfterThemeChange).toBe(canvasBeforeThemeChange);
  });

  it("Scenario 5: isolates state between multiple rendered chart windows", () => {
    render(
      <div>
        <ChartWidget windowId="win-1" instrument={mockInstrumentApple} />
        <ChartWidget windowId="win-2" instrument={mockInstrumentBitcoin} />
      </div>,
    );

    expect(useChartStore.getState().windows["win-1"].symbol).toBe("AAPL");
    expect(useChartStore.getState().windows["win-2"].symbol).toBe("BTC/USD");

    const buttons1h = screen.getAllByRole("button", { name: "1h" });

    expect(buttons1h).toHaveLength(2);

    act(() => {
      fireEvent.click(buttons1h[0]);
    });

    // win-1 timeframe updated to 1h
    expect(useChartStore.getState().windows["win-1"].timeframe).toBe("1h");

    // win-2 retained default 1m
    expect(useChartStore.getState().windows["win-2"].timeframe).toBe("1m");
  });

  it("Scenario 6: performs teardown and resource cleanup on unmount", () => {
    const { unmount } = render(<ChartWidget windowId="win-1" instrument={mockInstrumentApple} />);

    expect(mockChartInstances).toHaveLength(1);

    const chartInstance = mockChartInstances[0];

    expect(mockResizeObserverInstances.length).toBeGreaterThan(0);

    const resizeObserverInstance = mockResizeObserverInstances[0];

    expect(activeUnsubscribes).toHaveLength(1);

    const unsubscribeSpy = activeUnsubscribes[0];

    expect(useChartStore.getState().windows["win-1"]).toBeDefined();

    unmount();

    // Stream unsubscribed
    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);

    // ResizeObserver disconnected
    expect(resizeObserverInstance.disconnect).toHaveBeenCalledTimes(1);

    // Chart instance removed
    expect(chartInstance.remove).toHaveBeenCalledTimes(1);

    // Window cleaned up from store
    expect(useChartStore.getState().windows["win-1"]).toBeUndefined();
  });

  it("displays loading indicator when window is in loading state", () => {
    render(<ChartWidget windowId="win-loading" instrument={mockInstrumentApple} />);

    act(() => {
      useChartStore.getState().setLoading("win-loading", true);
    });

    expect(screen.getByText(/loading chart data/i)).toBeDefined();
  });

  it("displays error banner when an error is present", () => {
    render(<ChartWidget windowId="win-err" instrument={mockInstrumentApple} />);

    act(() => {
      useChartStore.getState().setError("win-err", "Failed to connect to market stream");
    });

    expect(screen.getByText("Failed to connect to market stream")).toBeDefined();
  });

  it("displays empty state message when there are no candles available", () => {
    render(<ChartWidget windowId="win-empty" instrument={mockInstrumentApple} />);

    act(() => {
      const store = useChartStore.getState();

      store.setLoading("win-empty", false);
      store.setError("win-empty", null);
      store.setCandles("win-empty", []);
    });

    expect(screen.getByText(/no market data available for AAPL/i)).toBeDefined();
  });
});
