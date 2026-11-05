---
id: "ADR-0005"
title: "Out-of-React Market Data Streaming & Transport Separation"
status: "accepted"
date: "2026-10-25"
decision-makers:
  - "Product Owner"
  - "Architect Agent"
area: "Market Data & Streaming"
applies_to:
  - "src/shared/contracts"
  - "src/modules/market-data"
  - "src/modules/chart"
  - "src/modules/order-book"
  - "src/modules/time-and-sales"
enforced_by:
  - ".dependency-cruiser.cjs"
  - "src/shared/contracts/tests/market-data-contracts.test.ts"
  - "src/modules/market-data/tests/market-stream.test.ts"
  - "src/modules/market-data/tests/demo-market-data-feed.test.ts"
supersedes: null
superseded_by: null
---

# ADR-0005: Out-of-React Market Data Streaming & Transport Separation

## Context and Problem Statement

Financial trading terminals require real-time delivery of market events across multiple concurrent widgets:

- Candlestick Chart (`candles` — OHLCV bars across configurable timeframes)
- Level 2 Order Book (`orderBook` — Bid/Ask depth snapshots)
- Time & Sales (`trades` — Chronological stream of executed trade ticks)
- Window Headers & Status Bar (`ticker` — Best bid/ask, spread, 24h delta)

Managing high-frequency quote streams (hundreds of updates per second during volatility bursts) directly inside React Context or component hooks creates critical bottlenecks:

1. Frequent React state transitions trigger full subtree reconciliation, dropping frame rates below 60 FPS.
2. Multiple windows viewing the same symbol (e.g., Chart and Order Book both observing `ES 12-26`) open duplicate transport subscriptions when managed per component.
3. Unvalidated feed payloads (`NaN`, negative volume, malformed timestamps) corrupt depth ladders and crash HTML5 Canvas charting engines.

How should we architect market data streaming to achieve 60 FPS UI responsiveness, zero duplicate network subscriptions, and strict ingress payload safety?

## Decision Drivers

- **Out-of-React Subscription Lifecycle**: Stream multiplexing and message dispatch must execute outside React's Virtual DOM reconciliation loop.
- **Reference-Counted Multiplexing**: Multiple widgets subscribing to the same `symbol:channel:timeframe` topic must share a single underlying transport subscription.
- **Transport Swappability**: The streaming orchestrator must be decoupled from the physical transport (`DemoMarketDataFeed`, local WebSocket bridges, or replay feeds).
- **Ingress Boundary Validation & Immutability**: Malformed packets must be rejected via Zod validation at ingress, and valid payloads must be frozen (`Object.freeze`) before reaching subscribers.

## Decision Outcome

Chosen option: **Two-Tier Out-of-React Streaming Architecture (`MarketStreamService` + `MarketDataFeed` Transport Abstraction) with Shared Contracts and Ingress Zod Validation**.

### 1. Out-of-React Subscription Lifecycle (`src/modules/market-data/`)

Market data streaming is managed by `MarketDataStreamServiceImpl` (`marketStreamService` in `src/modules/market-data/model/market-stream.ts`) executing outside React:

- Domain widgets and Zustand stores subscribe via topic-specific methods (`subscribeCandles`, `subscribeOrderBook`, `subscribeTrades`, `subscribeTicker`), supporting both `Unsubscribe` callbacks and `AbortSignal` teardown.
- Dispatched payloads flow directly to module Zustand stores or imperative canvas series without triggering parent React tree re-renders.

### 2. Two-Tier Separation: Transport vs. Multiplexing

- **`MarketDataFeed` (Transport Layer)**: Provider interface responsible for connection lifecycle (`connect()`, `disconnect()`), topic commands (`subscribeTopic()`, `unsubscribeTopic()`), and raw packet emission (`onMessage()`).
- **`MarketStreamService` (Orchestration Layer)**: Multiplexes client listeners with reference counting (subscribing on the transport when the first listener attaches and unsubscribing only when the last listener detaches), validates payloads at ingress, and freezes emitted objects.

### 3. Canonical Market Data Contracts (`src/shared/contracts/`)

Canonical market entities (`Candle`, `Trade`, `OrderBookLevel`, `OrderBookSnapshot`, `TickerQuote`, `Timeframe`) and their Zod schemas reside in `src/shared/contracts/`. Widgets import data shapes from `@/src/shared/contracts`, preserving widget isolation.

### 4. Ingress Boundary Validation

Every incoming transport message is parsed against its canonical Zod schema in `src/shared/contracts/` before dispatch. Invalid records (`NaN`, negative sizes, non-monotonic timestamps) are dropped safely without crashing downstream consumers.

## Confirmation and Enforcement

- **Service Isolation Gate (`.dependency-cruiser.cjs`)**: Rule `market-data-service-isolation` forbids `src/modules/market-data` from importing any UI widget or `workspace`.
- **Contract Schema Tests (`src/shared/contracts/tests/market-data-contracts.test.ts`)**: Verifies strict Zod rejection of malformed market payloads.
- **Stream Multiplexing & Feed Tests (`src/modules/market-data/tests/market-stream.test.ts`, `src/modules/market-data/tests/demo-market-data-feed.test.ts`)**: Verifies reference counting, `AbortSignal` cleanup, payload freezing, and ingress filtering.

## Consequences

### Positive

- Subscription management and high-frequency tick routing bypass React Virtual DOM reconciliation.
- Reference counting prevents duplicate transport subscriptions across multi-window layouts.
- `MarketDataFeed` allows seamless switching between `DemoMarketDataFeed` and external feeds ([ADR-0007](./0007-ninjatrader-cme-market-data.md)).
- Ingress Zod validation + `Object.freeze` guarantees downstream data integrity.

### Negative

- Consumers must deterministically invoke returned `Unsubscribe` callbacks or abort signals on unmount to prevent listener leaks.

## Rejected Alternatives

- **React Context / Custom Hook Transport**: Pushing high-frequency market ticks through React Context triggers cascading component re-renders.
- **Defining Market Entity Types Inside `src/modules/market-data`**: Widgets importing types from a concrete service module increases coupling compared to universal `src/shared/contracts/`.
- **Unvalidated Type Assertions (`as Candle`)**: Corrupted external feed packets crash Lightweight Charts and propagate `NaN` across financial calculations.
