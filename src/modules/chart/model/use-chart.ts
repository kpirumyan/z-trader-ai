import {
  type BarData,
  BarSeries,
  type CandlestickData,
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  LineSeries,
  type MouseEventParams,
  type SeriesType,
  type Time,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";

import { marketStreamService, type MarketStreamService } from "@/src/modules/market-data";
import { THEME_STORAGE_KEY, useTheme } from "@/src/shared/theme";

import { CHART_PALETTES } from "../constants";
import { generateInitialCandles } from "./candle-generator";
import { useChartStore } from "./chart-store";

import type { ChartIndicatorType, ChartType } from "../types";
import type { Candle, Timeframe } from "@/src/shared/contracts";
import type { Theme } from "@/src/shared/theme";

export interface UseChartOptions {
  readonly windowId: string;
  readonly symbol: string;
  readonly containerRef: React.RefObject<HTMLDivElement | null>;
  readonly streamService?: MarketStreamService;
}

interface ThemeHookValue {
  readonly theme?: Theme;
  readonly toggleTheme?: () => void;
}

const DEFAULT_INDICATORS: readonly ChartIndicatorType[] = ["volume"];

function getDomTheme(): Theme {
  if (typeof document === "undefined") {
    return "dark";
  }

  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function formatCandlesForSeries(
  candles: readonly Candle[],
  chartType: ChartType,
): (CandlestickData<Time> | BarData<Time> | LineData<Time>)[] {
  if (chartType === "line") {
    return candles.map((c) => ({
      time: c.time as Time,
      value: c.close,
    }));
  }

  return candles.map((c) => ({
    time: c.time as Time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));
}

function applyThemeToChart(
  chart: IChartApi,
  mainSeries: ISeriesApi<SeriesType> | null,
  theme: Theme,
) {
  const palette = CHART_PALETTES[theme];

  chart.applyOptions({
    layout: {
      background: { type: ColorType.Solid, color: palette.background },
      textColor: palette.textColor,
    },
    grid: {
      vertLines: { color: palette.gridColor },
      horzLines: { color: palette.gridColor },
    },
    timeScale: {
      borderColor: palette.borderColor,
    },
    rightPriceScale: {
      borderColor: palette.borderColor,
    },
  });

  if (mainSeries) {
    mainSeries.applyOptions({
      upColor: palette.upColor,
      downColor: palette.downColor,
      wickUpColor: palette.upColor,
      wickDownColor: palette.downColor,
      color: palette.upColor,
    });
  }
}

export function useChart({
  windowId,
  symbol,
  containerRef,
  streamService = marketStreamService,
}: UseChartOptions) {
  const chartRef = useRef<IChartApi | null>(null);
  const mainSeriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const currentCandlesRef = useRef<readonly Candle[]>([]);
  const isFirstMountRef = useRef(true);

  const themeHook = useTheme() as ThemeHookValue | undefined;
  const hookTheme = themeHook?.theme;
  const domTheme = getDomTheme();
  const currentTheme = hookTheme ?? domTheme;

  const [, setObserverTick] = useState(0);

  const windowState = useChartStore((state) => state.windows[windowId]);
  const initWindow = useChartStore((state) => state.initWindow);
  const setCandles = useChartStore((state) => state.setCandles);
  const appendOrUpdateCandle = useChartStore((state) => state.appendOrUpdateCandle);
  const setHoveredCandle = useChartStore((state) => state.setHoveredCandle);
  const cleanupWindow = useChartStore((state) => state.cleanupWindow);

  const timeframe: Timeframe = windowState?.timeframe ?? "1m";
  const chartType: ChartType = windowState?.chartType ?? "candlestick";
  const indicators: readonly ChartIndicatorType[] = useMemo(
    () => windowState?.indicators ?? DEFAULT_INDICATORS,
    [windowState?.indicators],
  );
  const candles: readonly Candle[] = useMemo(
    () => windowState?.candles ?? [],
    [windowState?.candles],
  );

  const chartTypeRef = useRef<ChartType>(chartType);

  useEffect(() => {
    chartTypeRef.current = chartType;
  }, [chartType]);

  const themeRef = useRef<Theme>(currentTheme);

  useEffect(() => {
    themeRef.current = currentTheme;
  }, [currentTheme]);

  // Keep ref up to date outside of render
  useEffect(() => {
    currentCandlesRef.current = candles;
  }, [candles]);

  // 1. Observe theme changes in DOM via clean local MutationObserver and window storage listener
  useEffect(() => {
    if (typeof document === "undefined") return;

    const root = document.documentElement;

    const handleDomThemeChange = () => {
      const nextTheme = getDomTheme();

      if (chartRef.current && themeRef.current !== nextTheme) {
        themeRef.current = nextTheme;
        applyThemeToChart(chartRef.current, mainSeriesRef.current, nextTheme);
      }

      setObserverTick((t) => t + 1);
    };

    const observer = new MutationObserver(handleDomThemeChange);

    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    const handleStorage = (event: Event) => {
      const storageEvent = event as Partial<StorageEvent>;
      const nextTheme =
        storageEvent.key === THEME_STORAGE_KEY &&
        (storageEvent.newValue === "light" || storageEvent.newValue === "dark")
          ? (storageEvent.newValue as Theme)
          : getDomTheme();

      if (chartRef.current && themeRef.current !== nextTheme) {
        themeRef.current = nextTheme;
        applyThemeToChart(chartRef.current, mainSeriesRef.current, nextTheme);
      }

      setObserverTick((t) => t + 1);
    };

    window.addEventListener("storage", handleStorage);

    return () => {
      observer.disconnect();
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  // 2. React to reactive theme changes without recreating chart or series
  useEffect(() => {
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;

      return;
    }

    if (chartRef.current) {
      applyThemeToChart(chartRef.current, mainSeriesRef.current, currentTheme);
    }
  }, [currentTheme]);

  // 3. Initialize chart instance and series on container mount
  useEffect(() => {
    const container = containerRef.current;

    if (!container) return;

    initWindow(windowId, symbol);

    const initialTheme = getDomTheme();
    const initialChartType = chartTypeRef.current;
    const palette = CHART_PALETTES[initialTheme];

    const chart = createChart(container, {
      width: container.clientWidth || 600,
      height: container.clientHeight || 400,
      layout: {
        background: { type: ColorType.Solid, color: palette.background },
        textColor: palette.textColor,
      },
      grid: {
        vertLines: { color: palette.gridColor },
        horzLines: { color: palette.gridColor },
      },
      timeScale: {
        borderColor: palette.borderColor,
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: palette.borderColor,
      },
    });

    chartRef.current = chart;

    let mainSeries: ISeriesApi<SeriesType>;

    if (initialChartType === "bars") {
      mainSeries = chart.addSeries(BarSeries, {
        upColor: palette.upColor,
        downColor: palette.downColor,
      });
    } else if (initialChartType === "line") {
      mainSeries = chart.addSeries(LineSeries, {
        color: palette.upColor,
        lineWidth: 2,
      });
    } else {
      mainSeries = chart.addSeries(CandlestickSeries, {
        upColor: palette.upColor,
        downColor: palette.downColor,
        borderVisible: false,
        wickUpColor: palette.upColor,
        wickDownColor: palette.downColor,
      });
    }

    mainSeriesRef.current = mainSeries;

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });

    chart.priceScale?.("volume")?.applyOptions?.({
      scaleMargins: {
        top: 0.8,
        bottom: 0,
      },
    });

    volumeSeriesRef.current = volumeSeries;

    if (typeof ResizeObserver !== "undefined") {
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.contentRect && chartRef.current) {
            chartRef.current.applyOptions({
              width: Math.floor(entry.contentRect.width),
              height: Math.floor(entry.contentRect.height),
            });
          }
        }
      });

      resizeObserver.observe(container);
      resizeObserverRef.current = resizeObserver;
    }

    const handleCrosshairMove = (param: MouseEventParams<Time>) => {
      if (!param.point || !param.time || !mainSeriesRef.current) {
        setHoveredCandle(windowId, null);

        return;
      }

      const seriesData = param.seriesData.get(mainSeriesRef.current);

      if (!seriesData) {
        setHoveredCandle(windowId, null);

        return;
      }

      const timeNum = typeof param.time === "number" ? param.time : Number(param.time);
      const matched = currentCandlesRef.current.find((c) => c.time === timeNum);

      if (matched) {
        setHoveredCandle(windowId, matched);
      } else if ("open" in seriesData && "close" in seriesData) {
        const volData = volumeSeriesRef.current
          ? param.seriesData.get(volumeSeriesRef.current)
          : null;
        const volumeVal = volData && "value" in volData ? (volData.value as number) : 0;

        setHoveredCandle(windowId, {
          time: timeNum,
          open: Number(seriesData.open),
          high: Number(seriesData.high),
          low: Number(seriesData.low),
          close: Number(seriesData.close),
          volume: volumeVal,
        });
      }
    };

    chart.subscribeCrosshairMove?.(handleCrosshairMove);

    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }

      chart.unsubscribeCrosshairMove?.(handleCrosshairMove);
      chart.remove();
      chartRef.current = null;
      mainSeriesRef.current = null;
      volumeSeriesRef.current = null;

      cleanupWindow(windowId);
    };
  }, [windowId, symbol, containerRef, initWindow, cleanupWindow, setHoveredCandle]);

  // 4. React to chartType changes: re-create main series without destroying chart
  useEffect(() => {
    const chart = chartRef.current;

    if (!chart) return;

    if (mainSeriesRef.current) {
      try {
        chart.removeSeries(mainSeriesRef.current);
      } catch {
        // Safe removal in mock environments
      }
    }

    const currentTheme = getDomTheme();
    const palette = CHART_PALETTES[currentTheme];
    let newSeries: ISeriesApi<SeriesType>;

    if (chartType === "bars") {
      newSeries = chart.addSeries(BarSeries, {
        upColor: palette.upColor,
        downColor: palette.downColor,
      });
    } else if (chartType === "line") {
      newSeries = chart.addSeries(LineSeries, {
        color: palette.upColor,
        lineWidth: 2,
      });
    } else {
      newSeries = chart.addSeries(CandlestickSeries, {
        upColor: palette.upColor,
        downColor: palette.downColor,
        borderVisible: false,
        wickUpColor: palette.upColor,
        wickDownColor: palette.downColor,
      });
    }

    mainSeriesRef.current = newSeries;

    const currentCandles = currentCandlesRef.current;

    if (currentCandles.length > 0) {
      newSeries.setData(formatCandlesForSeries(currentCandles, chartType));
    }
  }, [chartType]);

  // 5. React to indicator changes (volume visibility)
  useEffect(() => {
    if (!volumeSeriesRef.current) return;

    const showVolume = indicators.includes("volume");

    volumeSeriesRef.current.applyOptions({ visible: showVolume });
  }, [indicators]);

  // 6. Manage candles data fetching and live streaming subscription
  useEffect(() => {
    initWindow(windowId, symbol);

    const initial = generateInitialCandles(symbol, timeframe);

    setCandles(windowId, initial);

    const activeChartType = chartTypeRef.current;
    const activeTheme = themeRef.current;
    const palette = CHART_PALETTES[activeTheme];

    if (mainSeriesRef.current) {
      mainSeriesRef.current.setData(formatCandlesForSeries(initial, activeChartType));
    }

    if (volumeSeriesRef.current) {
      volumeSeriesRef.current.setData(
        initial.map((c) => ({
          time: c.time as Time,
          value: c.volume,
          color: c.close >= c.open ? palette.volumeUpColor : palette.volumeDownColor,
        })),
      );
    }

    const unsubscribe = streamService.subscribeCandles(
      symbol,
      (candle: Candle) => {
        appendOrUpdateCandle(windowId, candle);

        const currentType = chartTypeRef.current;

        if (mainSeriesRef.current) {
          if (currentType === "line") {
            mainSeriesRef.current.update({
              time: candle.time as Time,
              value: candle.close,
            });
          } else {
            mainSeriesRef.current.update({
              time: candle.time as Time,
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
            });
          }
        }

        if (volumeSeriesRef.current) {
          const currentPalette = CHART_PALETTES[themeRef.current];

          volumeSeriesRef.current.update({
            time: candle.time as Time,
            value: candle.volume,
            color:
              candle.close >= candle.open
                ? currentPalette.volumeUpColor
                : currentPalette.volumeDownColor,
          });
        }
      },
      { timeframe },
    );

    return () => {
      unsubscribe();
    };
  }, [windowId, symbol, timeframe, appendOrUpdateCandle, initWindow, setCandles, streamService]);

  return {
    windowState,
  };
}
