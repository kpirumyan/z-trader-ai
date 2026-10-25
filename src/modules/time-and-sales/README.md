# Module Passport: `time-and-sales`

## Purpose & Responsibilities

Provides the vertical Time & Sales (market tape / executed trades feed) domain module (`src/modules/time-and-sales/`).

- Renders a real-time chronological table of executed trades in Top-of-Tape order (newest trades prepended at the top).
- Table columns: `Time` (`HH:mm:ss`), `Price` (2 decimal places), `Size` (lots/volume), and `Side` (`Buy` / `Sell`).
- Color coding per design tokens: `--market-buy` for buys and `--market-sell` for sells.
- Accents large-volume trades (`size >= LARGE_TRADE_THRESHOLD`, default 20) with subtle translucent background tint and gold badge.
- Manages FIFO ring buffer with configurable capacity limits (50, 100, 250 trades, default 100) to ensure predictable memory usage and 60 FPS performance.
- Supports dynamic trade size filtering via quick presets (`All`, `Small (<10)`, `Medium (10–49)`, `Large (≥50)`) and manual numeric bounds (`[minSize, maxSize]`).
- Subscribes to real-time market trade streams via `marketStreamService.subscribeTrades` with deterministic unsubscription on window closure or unmount.
- Supports isolated multi-window state management keyed by `windowId` via `useTimeAndSalesStore`.
- Non-goals: order execution ticket, audio alerts, and CSV export.

## Public Contract

Exported via `@/src/modules/time-and-sales`:

- **Types**: `FilterPresetOption`, `TimeAndSalesRow`, `TimeAndSalesStore`, `TimeAndSalesStoreActions`, `TimeAndSalesStoreState`, `TimeAndSalesWidgetProps`, `TimeAndSalesWindowState`, `TradeBufferLimit`, `TradeSizeFilter`
- **Schemas**: `tradeBufferLimitSchema`, `tradeSizeFilterSchema`
- **Constants**: `DEFAULT_TRADE_BUFFER_LIMIT`, `DEFAULT_TRADE_SIZE_FILTER`, `LARGE_TRADE_THRESHOLD`, `SIZE_FILTER_PRESETS`, `TIME_AND_SALES_WIDGET_KIND`, `TIME_AND_SALES_WIDGET_TITLE`, `TRADE_BUFFER_LIMIT_OPTIONS`
- **Model / State**: `useTimeAndSalesStore`
- **Components / Entry Points**: `TimeAndSalesWidget`, `timeAndSalesWidgetDefinition`

## Allowed Dependencies

- `@/src/shared/contracts`
- `@/src/shared/lib`
- `@/src/modules/market-data`
- `zustand`
- `zod`
- Local internal files (`model/`, `ui/`, `schema.ts`, `constants.ts`, `types.ts`)

## Behavioral & Architectural Invariants

- Black-box perimeter: internal implementation files (`model/`, `ui/`, `schema.ts`, `constants.ts`, `types.ts`) are private and never directly imported externally.
- Multi-window isolation: independent state slices keyed by `windowId` with deterministic lifecycle cleanup on window close or component unmount.
- Stream resource safety: unmount guarantees unsubscription from quote streams to prevent memory leaks.
- Zero raw colors: styled strictly using tokens from [`DESIGN.md`](../../../DESIGN.md) (`--surface`, `--surface-raised`, `--border`, `--market-buy`, `--market-sell`, `--text-primary`, `--text-secondary`, `--brand-gold`, `--font-mono`, `--font-ui`).
- Numerics stability: time, prices, and sizes formatted with monospace tabular figures (`tabular-nums`) to prevent layout jittering during high-frequency market updates.

## Verification

- Behavior verified via black-box test suite in [`tests/`](./tests/).
