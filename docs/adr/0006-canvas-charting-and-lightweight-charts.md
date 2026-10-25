# ADR-0006: High-Performance Canvas Charting via Lightweight Charts & Theme Integration

- **Status:** Accepted
- **Date:** 2026-10-25
- **Deciders:** System Architect, Core Team

## Context

Financial market terminals require high-frequency, low-latency visual rendering of market price action (candlestick OHLCV bars, volume histograms, moving averages, and crosshairs).

The prototype implementation in `app/components/chart.tsx` used declarative SVG rendering (`<svg>` with `<rect>` and `<line>` elements) for a static set of demo candles. While adequate for mockups, SVG rendering has critical limitations for an active trading terminal:

1. **DOM Tree Bloat**: Each candle requires 3-5 DOM nodes (lines, rects, titles, groups). Displaying 500+ candles across 4 active terminal windows produces thousands of SVG DOM nodes, causing severe garbage collection pauses and frame rate drops below 30 FPS during real-time streaming updates.
2. **Interactive Charting Operations**: Smooth pan, zoom, scale dragging, crosshairs, and multi-indicator overlays require extensive custom geometry calculation when built from scratch in SVG or raw Canvas.
3. **Canvas Performance**: TradingView's `lightweight-charts` is an industry-standard, lightweight (~45KB), hardware-accelerated HTML5 Canvas library optimized specifically for high-performance financial time-series visualization.

## Decision

We adopt **Lightweight Charts (v5)** as the official charting engine for `src/modules/chart/` with strict encapsulation and out-of-React canvas lifecycle management:

### 1. Canvas Lifecycle & Ref Isolation

The chart canvas instance (`IChartApi`) is created and managed imperatively inside custom React hooks (`useChart`) via a stable `HTMLDivElement` container ref:

- The canvas instance is initialized on mount and cleanly destroyed via `chart.remove()` on unmount.
- Candle data updates (`series.setData()`, `series.update()`) flow directly to the Canvas engine without triggering React Virtual DOM diffing or subtree re-renders.
- Dynamic resizing is handled by an isolated `ResizeObserver` observing the chart window container, calling `chart.applyOptions({ width, height })`.

### 2. Design Token & Theme Synchronization

Lightweight Charts operates on explicit RGB/HEX color strings rather than CSS variables. To maintain complete consistency with [DESIGN.md](../../DESIGN.md) and [ADR-0003](./0003-css-architecture.md):

- `CHART_PALETTES` in `src/modules/chart/constants.ts` defines explicit color mapping for both `dark` and `light` themes referencing normalized values of `--surface`, `--grid`, `--text-secondary`, `--market-buy`, and `--market-sell`.
- The chart subscribes to theme changes via `useTheme()` from `@/src/shared/theme` and imperatively updates canvas styling via `chart.applyOptions(...)` without destroying or recreating the chart instance.

### 3. Multi-Window Store Isolation

To support multiple concurrent chart windows with independent instruments, timeframes, and indicators:

- The Zustand store (`chart-store.ts`) manages chart state keyed by `windowId`.
- Windows register upon mount and automatically release their state slice upon unmount.

### 4. Canonical Contracts & Ingress Validation

- The chart module consumes canonical `Candle` and `Timeframe` types exclusively from `@/src/shared/contracts`.
- Real-time updates subscribe to the out-of-React `MarketDataStreamService` ([ADR-0005](./0005-market-data-streaming-and-transport-separation.md)) via `subscribeCandles()`.

## Consequences

### Positive

- **Performance**: 60 FPS smooth zooming, panning, and high-frequency real-time bar updates via hardware-accelerated Canvas.
- **Maintainability**: Standardized charting API with built-in time-scale calculations, price-scale formatting, and crosshair coordination.
- **Encapsulation**: Clean separation between the React widget wrapper, Zustand state, and the imperative canvas lifecycle.
- **Theme Integrity**: Synchronized light/dark theme adaptation without chart reloads or loss of user pan/zoom viewport state.

### Negative

- Adds `lightweight-charts` npm dependency.
- JSDOM does not provide native HTML5 Canvas 2D context; unit tests require a mock/stub layer for `IChartApi`, complemented by Playwright E2E tests for real canvas verification.

## Rejected Alternatives

- **Retaining SVG Charting**: Unviable for production streaming; DOM overhead causes severe UI lag during high-frequency tick bursts.
- **Custom Raw 2D Canvas Engine**: Incurs massive engineering overhead for pan/zoom kinematics, coordinate projections, time scales, and crosshair interpolation.
- **Heavyweight Charting Libraries (Highcharts, Chart.js)**: Significantly larger bundle footprint and less tailored for financial candlestick mechanics.
