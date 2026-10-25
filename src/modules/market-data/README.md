# Module Passport: `market-data`

## Purpose & Responsibilities

Provides the market data streaming domain module for financial quotes, L2 order books, trades, and candlestick bars (`src/modules/market-data/`).

- Supplies high-performance quotation distribution via `MarketStreamService` with reference counting and topic multiplexing.
- Provides native `AbortSignal` lifecycle integration and returned `Unsubscribe` callbacks.
- Enforces ingress boundary Zod validation on incoming packets with `Object.freeze` defensive immutability.
- Provides realistic quote simulation via `DemoMarketDataFeed` across 4 canonical channels (`candles`, `orderBook`, `trades`, `ticker`).
- Non-goals: UI widgets (handled by widget modules) and mathematical technical indicators (handled by `indicators-engine`).

## Public Contract

Exported via `@/src/modules/market-data`:

- **Types**: `CandleSubscriptionOptions`, `DemoMarketDataFeedOptions`, `ErrorHandler`, `FeedStatus`, `MarketDataFeed`, `MarketDataMessage`, `MarketStreamService`, `MarketTopic`, `MessageHandler`, `StatusHandler`, `SubscriptionOptions`, `Unsubscribe`
- **Schemas**: `marketChannelSchema`, `marketTopicSchema`
- **Constants**: `DEFAULT_TIMEFRAME`, `DEMO_FEED_INTERVALS`, `DEMO_INITIAL_PRICES`, `TIMEFRAMES`
- **Components / Entry Points**: `DemoMarketDataFeed`, `MarketDataStreamServiceImpl`, `createDemoMarketDataFeed`, `createMarketStreamService`, `marketStreamService`

## Allowed Dependencies

- `@/src/shared/contracts`
- Local internal files (`model/`, `schema`, `constants`, `types`)

## Behavioral & Architectural Invariants

- Black-box perimeter: internal implementation files (`model/`, `schema.ts`, `constants.ts`, `types.ts`) are strictly private.
- Public exports strictly through `index.ts`.
- **Key Guarantees**:
  - Reference Counting: duplicate subscriptions share a single transport stream; transport unsubscription occurs only when the last subscriber disconnects.
  - Ingress Boundary: malformed or corrupted packets are dropped safely with warnings without crashing the application.
  - Immutability: dispatched messages are frozen (`Object.freeze`) to prevent mutation across subscribers.
  - Resource Safety: `AbortSignal` listeners and topic timers are cleanly disposed on disconnect or unsubscription.

## Verification

- Behavior verified via black-box test suite in [`tests/`](./tests/).
