# Module Passport: `order-book`

## Purpose & Responsibilities

Provides the vertical Level 2 Order Book (Depth of Market / DOM ladder) domain module (`src/modules/order-book/`).

- Renders a dual-sided split order book displaying asks (sales) on top and bids (buys) on bottom with tabular monospace numeric formatting.
- Computes cumulative volume and proportional horizontal depth bars for market liquidity visualization.
- Computes real-time best bid, best ask, absolute spread, and relative spread percentage in the central spread indicator row.
- Delivers interactive depth limit switching (10, 20, 50 levels) with dynamic reslicing of visible levels.
- Supports interactive quote selection (`onSelectPrice`) on row click and keyboard navigation for trade execution integration.
- Subscribes to real-time market quotation streams via `marketStreamService.subscribeOrderBook` with deterministic unsubscription on window closure or unmount.
- Supports isolated multi-window state management keyed by `windowId` via `useOrderBookStore`.
- Non-goals: trade execution/order entry ticket (delegated to trading module) and custom price tick grouping (deferred to future versions).

## Public Contract

Exported via `@/src/modules/order-book`:

- **Types**: `OrderBookDepthLimit`, `OrderBookRow`, `OrderBookStore`, `OrderBookStoreActions`, `OrderBookStoreState`, `OrderBookWidgetProps`, `OrderBookWindowState`
- **Schemas**: `orderBookDepthLimitSchema`, `orderBookRowSchema`
- **Constants**: `DEFAULT_DEPTH_LIMIT`, `DEPTH_LIMIT_OPTIONS`, `ORDER_BOOK_WIDGET_KIND`, `ORDER_BOOK_WIDGET_TITLE`
- **Model / State**: `useOrderBookStore`
- **Components / Entry Points**: `OrderBookWidget`, `orderBookWidgetDefinition`

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
- Zero raw colors: styled strictly using tokens from [`DESIGN.md`](../../../DESIGN.md) (`--surface`, `--surface-raised`, `--border`, `--market-buy`, `--market-sell`, `--text-primary`, `--text-secondary`, `--font-mono`, `--font-ui`).
- Numerics stability: prices, sizes, and spread formatted with monospace tabular figures (`tabular-nums`) to prevent layout jittering during rapid market data updates.

## Verification

- Behavior verified via black-box test suite in [`tests/`](./tests/).
