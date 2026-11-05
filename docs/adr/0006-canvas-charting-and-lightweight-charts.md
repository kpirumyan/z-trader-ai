---
id: "ADR-0006"
title: "High-Performance Canvas Charting via Lightweight Charts & Theme Integration"
status: "accepted"
date: "2026-10-25"
decision-makers:
  - "Product Owner"
  - "Architect Agent"
area: "Charting & Performance"
applies_to:
  - "src/modules/chart"
  - "src/shared/theme"
  - "src/shared/contracts"
enforced_by:
  - "src/modules/chart/tests/chart.test.tsx"
supersedes: null
superseded_by: null
---

# ADR-0006: High-Performance Canvas Charting via Lightweight Charts & Theme Integration

## Context and Problem Statement

Financial trading terminals require 60 FPS interactive rendering of historical and real-time OHLCV candlestick series, volume histograms, indicator overlays, and crosshair price inspections across multiple simultaneous chart windows.

Declarative SVG rendering (`<svg>` with per-candle `<rect>` and `<line>` nodes) cannot scale to production trading workloads:

1. **DOM Node Bloat**: Rendering 500+ candles across 4 concurrent chart windows creates thousands of DOM elements, causing layout thrashing and frame drops below 30 FPS during real-time streaming.
2. **Viewport Kinematics**: Smooth pan, kinetic zoom, price/time axis auto-scaling, and crosshair synchronization require dedicated 2D canvas coordinate engines.

Which charting engine and lifecycle architecture should `src/modules/chart/` adopt to guarantee 60 FPS performance, multi-window state isolation, and seamless dark/light theme synchronization?

## Decision Drivers

- **60 FPS Hardware-Accelerated Rendering**: Real-time bar updates (`series.update()`) and pan/zoom interactions must execute on HTML5 2D Canvas outside React's Virtual DOM.
- **Non-Destructive Theme Synchronization**: Switching between dark and light themes must update canvas colors in-place (`chart.applyOptions()`) without destroying the chart or losing the trader's zoom/scroll viewport.
- **Multi-Window State Isolation**: Multiple concurrent chart windows must maintain independent symbol, timeframe, chart style, and indicator selections keyed by `windowId`.

## Decision Outcome

Chosen option: **TradingView Lightweight Charts (v5) Managed Imperatively Out-of-React (`useChart`) + Keyed Multi-Window Zustand Store (`useChartStore`)**.

### 1. Imperative Canvas Lifecycle & Ref Isolation (`src/modules/chart/model/use-chart.ts`)

- The `IChartApi` instance is instantiated on a stable `HTMLDivElement` ref on mount and disposed via `chart.remove()` on unmount.
- Real-time candle ticks from `marketStreamService.subscribeCandles()` ([ADR-0005](./0005-market-data-streaming-and-transport-separation.md)) update canvas series imperatively without triggering React component re-renders.
- Container resizing is tracked via a dedicated `ResizeObserver` invoking `chart.applyOptions({ width, height })`.

### 2. Design Token & Theme Synchronization (`CHART_PALETTES`)

Because HTML5 Canvas APIs require resolved color strings rather than CSS `var(--*)` references, `CHART_PALETTES` in `src/modules/chart/constants.ts` maps normalized token values from [`DESIGN.md`](../../DESIGN.md) (`--surface`, `--grid`, `--text-secondary`, `--market-buy`, `--market-sell`) for both `dark` and `light` themes:

- `useChart` subscribes to `useTheme()` from `@/src/shared/theme` ([ADR-0003](./0003-css-architecture.md)) and applies updated palette options via `chart.applyOptions(...)` without recreating the canvas instance.

### 3. Multi-Window Store Isolation (`src/modules/chart/model/chart-store.ts`)

- `useChartStore` partitions state slices by `windowId`, isolating timeframe (`1m`, `5m`, `15m`, `1h`, `1d`), chart type (`candlestick`, `bars`, `line`), and active overlays per window and cleaning up state on window closure.

## Confirmation and Enforcement

- **Chart Module Behavioral Tests (`src/modules/chart/tests/chart.test.tsx`)**: Verifies multi-window store isolation, timeframe/style switching, theme palette synchronization, stream subscription lifecycle, and deterministic `chart.remove()` cleanup on unmount.

## Consequences

### Positive

- HTML5 Canvas rendering sustains 60 FPS panning, zooming, and tick updates with minimal memory footprint (~45KB bundle).
- Imperative `applyOptions` theme updates preserve the user's panned/zoomed time range across theme toggles.
- Multi-window Zustand keying allows unlimited concurrent chart windows without state collision.

### Negative

- JSDOM lacks a native HTML5 2D Canvas implementation, requiring canvas boundary stubs in unit tests paired with Playwright E2E tests (`tests/e2e/widget-chart.spec.ts`) for real browser rendering verification.

## Rejected Alternatives

- **Declarative SVG Charting**: DOM node scaling degrades frame rates during high-frequency market streaming.
- **Custom Raw HTML5 2D Canvas Engine**: Prohibitive engineering cost for time-scale kinematics, logarithmic/percentage price scales, and crosshair interpolation.
- **General-Purpose Chart Libraries (Chart.js, Highcharts, ECharts)**: Larger bundle sizes and weaker native ergonomics for financial OHLCV candlesticks and market depth overlays.
