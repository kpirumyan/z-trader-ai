# Module Passport: `chart`

## Purpose & Responsibilities

Provides the vertical candlestick and volume charting domain module powered by TradingView Lightweight Charts (v5) (`src/modules/chart/`).

- Renders real-time hardware-accelerated candlestick (OHLC) and volume histogram series with 60 FPS performance.
- Supports interactive chart toolbars with timeframe switching (`1m`, `5m`, `15m`, `1h`, `1d`), visual styles (`candlestick`, `bars`, `line`), and technical overlays (`volume`).
- Delivers hover crosshair inspections displaying open, high, low, close, volume, and percentage price movement.
- Integrates with `MarketDataStreamService` for real-time quotation streams and tick updates.
- Synchronizes dynamically with design tokens and dark/light themes via `useTheme()` and `CHART_PALETTES`.
- Supports isolated multi-window state management keyed by `windowId` via `useChartStore`.
- Non-goals: complex canvas drawing tools (e.g. Fibonacci, trendlines) and custom oscillator calculation engines (delegated to `indicators-engine`).

## Public Contract

Exported via `@/src/modules/chart`:

- **Types**: `ChartConfig`, `ChartIndicatorType`, `ChartStore`, `ChartThemeColors`, `ChartType`, `ChartWidgetDefinition`, `ChartWidgetProps`, `ChartWindowState`
- **Schemas**: `chartConfigSchema`, `chartIndicatorTypeSchema`, `chartTypeSchema`
- **Constants**: `AVAILABLE_CHART_TYPES`, `AVAILABLE_INDICATORS`, `CHART_PALETTES`, `DEFAULT_CHART_CONFIG`, `DEFAULT_INITIAL_CANDLE_COUNT`
- **Model / State**: `useChartStore`
- **Components / Entry Points**: `ChartWidget`, `chartWidgetDefinition`

## Allowed Dependencies

- `@/src/shared/contracts`
- `@/src/shared/theme`
- `@/src/shared/lib`
- `@/src/modules/market-data`
- `lightweight-charts`
- `zustand`
- `zod`
- Local internal files (`model/`, `ui/`, `schema.ts`, `constants.ts`, `types.ts`)

## Behavioral & Architectural Invariants

- Black-box perimeter: internal implementation files (`model/`, `ui/`, `schema.ts`, `constants.ts`, `types.ts`) are private and never directly imported externally.
- Canvas lifecycle out of React: imperative chart instantiation and direct canvas updates (`series.update()`, `series.setData()`) without virtual DOM overhead.
- Multi-window isolation: independent state slices keyed by `windowId` with deterministic lifecycle cleanup on unmount.
- Theme synchronization: dynamic adaptation via `applyOptions` without canvas destruction, retaining pan and zoom viewport state.
- Resource cleanup: unmount guarantees unsubscription from quote streams, `ResizeObserver` disconnection, and `chart.remove()`.
- Theme & Design: styled strictly using tokens from [`DESIGN.md`](../../../DESIGN.md).

## Verification

- Behavior verified via black-box test suite in [`tests/`](./tests/).
