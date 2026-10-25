# ADR-0005: Out-of-React Market Data Streaming & Transport Separation

- **Status:** Accepted
- **Date:** 2026-10-25
- **Deciders:** System Architect, Core Team

## Context

Financial trading terminals require real-time market data delivery across multiple concurrent widgets:

- Candlestick Chart (OHLCV candles across configurable timeframes)
- Level 2 Order Book (Bid / Ask market depth ladder)
- Time & Sales (Live stream of executed trade ticks)
- Window Headers & Status Bar (Ticker quotes, bid/ask spread, 24h delta)

Quotes arrive at high frequencies (up to hundreds or thousands of ticks per second during high market volatility).
Handling streaming data directly inside React component trees or React hooks introduces severe bottlenecks:

1. Frequent React state updates trigger expensive subtree reconciliation, degrading frame rates below 60 FPS and freezing UI interactions.
2. Multiple windows displaying the same ticker (e.g. Chart and Order Book both monitoring `AAPL`) open redundant network subscriptions if streams are managed at component level.
3. Ingress of malformed data (such as strings instead of numbers, `NaN`, negative sizes, or non-monotonic timestamps) crashes canvas charting engines (e.g. Lightweight Charts) and corrupts depth calculations.

## Decision

We establish an out-of-React streaming architecture with transport abstraction and boundary validation:

### 1. Out-of-React Subscription Lifecycle

Market data streaming is managed by a standalone TypeScript service (`MarketDataStreamService` in `src/modules/market-data/model/market-stream.ts`) executing entirely outside the React lifecycle.

- Domain widgets and their respective Zustand stores subscribe to specific topics via lightweight callbacks (`subscribeCandles`, `subscribeOrderBook`, `subscribeTrades`, `subscribeTicker`).
- Zustand stores batch or apply state changes selectively, protecting React rendering from excessive thrashing.

### 2. Two-Tier Separation: Transport vs Multiplexing

We decouple physical data transport from subscription orchestration:

- **`MarketDataFeed` (Transport Layer)**: An abstract provider interface responsible for network connection lifecycle (`connect()`, `disconnect()`), topic subscription commands (`subscribeTopic()`, `unsubscribeTopic()`), and raw message emission (`onMessage()`). In Phase 3, implemented via `DemoMarketDataFeed` (simulating realistic quotes via timers); in future phases, swappable with WebSocket connectors (e.g. Binance, Bybit, Interactive Brokers).
- **`MarketDataStreamService` (Orchestration Layer)**: Multiplexes client subscriptions using reference counting (only one transport subscription per unique `symbol:channel:timeframe` tuple), performs ingress validation, and dispatches updates to subscribers.

### 3. Canonical Market Data Contracts in `src/shared/contracts/`

Canonical market entity interfaces (`Candle`, `Trade`, `OrderBookLevel`, `OrderBookSnapshot`, `TickerQuote`) and their corresponding Zod schemas reside in `src/shared/contracts/`.

- Terminal widgets (`chart`, `order-book`, `time-and-sales`) import standardized data types from `@/src/shared/contracts`, preventing direct inter-module coupling and satisfying widget isolation invariants.

### 4. Ingress Boundary Zod Validation

All incoming feed events are validated against strict Zod schemas at the ingress boundary before publication to subscribers.

- Malformed, corrupt, or out-of-spec payloads (e.g. `NaN`, negative price or volume, invalid sides) are safely rejected and logged, guaranteeing that downstream stores and visual canvas renderers receive 100% sanitized data.

## Consequences

### Positive

- **Performance**: Zero React re-renders on subscription management; updates flow straight to stores or canvas engines.
- **Resource Efficiency**: Reference counting multiplexing eliminates duplicate network feeds when multiple widgets monitor the same instrument.
- **Swappability**: Mock feeds and live WebSocket transports share an identical interface (`MarketDataFeed`).
- **Data Integrity**: Ingress Zod validation guarantees no corrupted records reach charting or depth calculations.

### Negative

- Requires explicit unsubscribe calls during component unmounting or store teardown to avoid memory leaks (enforced via `Unsubscribe` callback convention).

## Rejected Alternatives

- **React Context / Hook-driven stream**: Pushing raw quote streams through React Context causes whole-tree re-rendering and severe lag under market bursts.
- **Widgets importing contracts directly from `market-data`**: Couples widget domain boundaries to a specific service module instead of relying on universal shared contracts.
- **Permissive type casting without ingress validation**: While marginally faster, malformed feed payloads crash canvas charting and cause silent NaN propagation in financial arithmetic.
