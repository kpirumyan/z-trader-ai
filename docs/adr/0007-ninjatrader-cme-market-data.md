---
id: "ADR-0007"
title: "CME Futures Market Data via NinjaTrader 8 Dual-Workflow Architecture"
status: "accepted"
date: "2026-10-30"
decision-makers:
  - "Product Owner"
  - "Architect Agent"
area: "Market Data & Replay"
applies_to:
  - "src/modules/market-data"
  - "src/modules/instruments"
  - "src/modules/workspace"
enforced_by:
  - "src/modules/market-data/tests/market-stream.test.ts"
  - "src/modules/instruments/tests/instruments.test.tsx"
supersedes: null
superseded_by: null
---

# ADR-0007: CME Futures Market Data via NinjaTrader 8 Dual-Workflow Architecture

## Context and Problem Statement

Z-Trader requires free, authentic **CME Globex Futures** market data across all four canonical terminal channels ([ADR-0005](./0005-market-data-streaming-and-transport-separation.md)):

1. **Candles** (`candles` — OHLCV price & volume bars)
2. **Order Book** (`orderBook` — Level 2 market depth ladder)
3. **Time & Sales** (`trades` — Executed trade tape)
4. **Ticker Quotes** (`ticker` — Best bid/ask and session statistics)

Direct commercial CME feeds require costly monthly exchange licenses, while retail MetaTrader 5 (MT5) demo servers provide synthetic, non-exchange quotes. **NinjaTrader 8 Desktop** provides free access to real CME Globex exchange data across both historical Market Replay downloads (`.nrd` covering ~60–90 days of Level 1 + Level 2 history) and live/10-minute delayed streaming via a local C# NinjaScript AddOn.

How should Z-Trader integrate NinjaTrader 8 so traders can operate both offline (replaying saved historical data with NinjaTrader 8 closed) and live (streaming from a running NinjaTrader 8 instance)?

## Decision Drivers

- **Authentic CME Exchange Data at Zero Subscription Cost**: Support both 14-day real-time CME trial feeds and ongoing free 10-minute delayed CME Globex feeds, plus 60–90 day Level 1/Level 2 historical replay.
- **Offline Replay Independence**: Once `.nrd` replay archives are unpacked to disk via NinjaTrader 8 (`Tools -> NRD to CSV`), Z-Trader must replay them offline without requiring NinjaTrader 8 to remain open.
- **Transport Contract Compatibility**: Both Live and Replay feeds must plug directly into `MarketDataFeed` ([ADR-0005](./0005-market-data-streaming-and-transport-separation.md)) without altering widget subscription code.

## Decision Outcome

Chosen option: **NinjaTrader 8 Dual-Workflow Architecture (`Replay` Local Disk Reader + `Live` Localhost WebSocket Bridge) with TopBar `Connections` Control (`Live | Replay`)**.

### 1. Workflow A: Offline Local Files (`Replay` — `.nrd` Exported to Disk)

- `.nrd` Market Replay files (~60–90 days of downloadable CME history) are exported inside NinjaTrader 8 (`Tools -> NRD to CSV`) so unpacked tick and depth records are stored on disk.
- With NinjaTrader 8 closed, Z-Trader reads and replays those local files through a replay `MarketDataFeed` implementation.

### 2. Workflow B: NinjaTrader 8 WebSocket Bridge (`Live` — Real-Time Trial & 10-Minute Delayed Stream)

- While NinjaTrader 8 runs on Windows (streaming the 14-day real-time CME trial, free 10-minute delayed CME data after trial expiration, or NT8 Playback), a lightweight C# NinjaScript AddOn broadcasts market events over a local WebSocket (`ws://localhost`) to Z-Trader's WebSocket `MarketDataFeed`.

### 3. TopBar `Connections` Menu & Playback Controller (`src/modules/workspace/`)

- Z-Trader's `TopBar` exposes a `Connections` menu with strictly two modes (`Live | Replay`):
  - `Live`: Connects over local WebSocket to a running NinjaTrader 8 instance.
  - `Replay`: Streams from local unpacked replay files and reveals a Playback Controller (`Play/Pause`, `Speed`, and `Date/Time` controls).

### 4. Exact CME Contract Expiry Symbols (`src/modules/instruments/`)

- The Instrument Search catalog surfaces exact CME contract expiry symbols (e.g., `ES 12-26`, `NQ 12-26`) discovered from NinjaTrader 8 or local replay directories.

## Confirmation and Enforcement

- **Market Stream Contract Tests (`src/modules/market-data/tests/market-stream.test.ts`)**: Verifies that any `MarketDataFeed` transport implementation conforms to topic multiplexing and ingress Zod validation.
- **Instrument Catalog Tests (`src/modules/instruments/tests/instruments.test.tsx`)**: Verifies contract symbol search, selection, and catalog provider abstractions.

## Consequences

### Positive

- Delivers 100% authentic CME Globex Level 1 and Level 2 market data at zero recurring cost.
- Offline disk replay works standalone without NinjaTrader 8 running in the background.
- `MarketDataFeed` transport separation ([ADR-0005](./0005-market-data-streaming-and-transport-separation.md)) keeps `chart`, `order-book`, and `time-and-sales` widgets completely agnostic of whether data originates from `Live` or `Replay`.

### Negative

- Offline replay requires an initial export step inside NinjaTrader 8 (`Tools -> NRD to CSV`), and NinjaTrader servers retain only the trailing ~60–90 days of `.nrd` downloads.
- The `Live` WebSocket bridge requires NinjaTrader 8 running on a Windows host.

## Rejected Alternatives

- **MetaTrader 5 (MT5) Demo Feeds**: MT5 demo servers emit synthetic broker quotes rather than authentic CME Globex exchange depth and tape.
- **Public Crypto Exchange WebSockets (Binance, Bybit)**: Target trading domain requires regulated CME Futures contracts (`ES`, `NQ`, `CL`, `GC`).
- **Parsing Proprietary `.ncd` Binary Files Directly**: `.nrd` Market Replay exports + the live NT8 WebSocket bridge already cover full Level 1 and Level 2 requirements.
