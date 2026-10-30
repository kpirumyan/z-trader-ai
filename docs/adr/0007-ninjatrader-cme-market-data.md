# ADR-0007: CME Futures Market Data via NinjaTrader 8

- **Status:** Accepted
- **Date:** 2026-10-30
- **Deciders:** System Architect, Core Team

## Context

Z-Trader requires free, real, and accurate **CME Futures** market data across all four terminal data types:

1. **Prices & Volume** (Candles)
2. **Order Book** (Level 2 Market Depth)
3. **Time & Sales** (Executed trades)
4. **Ticker Quotes**

Commercial CME feeds require paid monthly subscriptions, while free retail MetaTrader 5 (MT5) demo feeds use synthetic, non-exchange data.

**NinjaTrader 8 Desktop** provides free access to real CME Globex exchange data across both historical replay and ongoing streaming:

- **Market Replay Downloads (`.nrd`)**: Free downloads inside NinjaTrader 8 (`Tools -> Historical Data -> Download -> Market Replay data`) covering the recent ~60–90 days of real CME Level 1 and Level 2 market replay history. Because `.nrd` uses a proprietary binary format, it cannot be decoded directly by Node.js without first exporting it inside NinjaTrader 8 (`Tools -> NRD to CSV`) or streaming it from a running NinjaTrader 8 instance.
- **Live CME Demo Trial & 10-Minute Delayed Data After Trial Expiration**: NinjaTrader 8 provides a free 14-day real-time CME Globex trial and automatically switches to free 10-minute delayed CME data once the trial expires, both streamable via a local C# NinjaScript AddOn without API subscription fees.

## Decision

We adopt **NinjaTrader 8** as our CME Futures market data source, supporting two data-receiving workflows:

### 1. Workflow A: Offline Local Files (`Replay` — `.nrd` Exported to Disk)

- `.nrd` Market Replay files (~60–90 days of downloadable history; `.ncd` historical files are not needed) are exported inside NinjaTrader 8 (`Tools -> NRD to CSV`) so the unpacked files are permanently saved on disk.
- Once saved to disk, NinjaTrader 8 can be closed and Z-Trader reads and replays those local files directly.

### 2. Workflow B: NinjaTrader 8 WebSocket Bridge (`Live` — Real-Time Trial & 10-Minute Delayed Stream)

- While NinjaTrader 8 is running in the background (streaming either the 14-day real-time CME trial, 10-minute delayed CME data after trial expiration, or NT8's Playback Connection), a C# NinjaScript AddOn streams market data over a local WebSocket (`ws://localhost`) to Z-Trader.

### 3. NinjaTrader-Style `Connections` Menu & Playback Controller

- Z-Trader's `TopBar` includes a `Connections` menu with strictly two options (`Live | Replay`):
  - `Live` (WebSocket connection to running NinjaTrader 8 for real-time trial or 10-minute delayed data)
  - `Replay` (offline playback from saved local files, revealing a Playback Controller with `Play/Pause`, `Speed`, and `Date/Time` controls)

### 4. Exact CME Contract Expiry Symbols

- The Instrument Search dialog displays exact CME contract expiries (e.g. `ES 12-26`, `NQ 12-26`) dynamically discovered from NinjaTrader 8 or the local `db` folders.

## Consequences

### Positive

- Provides 100% free and authentic CME Globex market data, continuing to work with free 10-minute delayed data after the 14-day live trial expires.
- Supports both offline replay from saved disk files (with NinjaTrader 8 closed) and live/delayed streaming (when NinjaTrader 8 is open).

### Negative

- Offline playback requires exporting downloaded `.nrd` files inside NinjaTrader 8 first, and NinjaTrader's servers only keep the last ~60–90 days of `.nrd` files available for download.
- Live/delayed streaming requires NinjaTrader 8 running on Windows.

## Rejected Alternatives

- **MetaTrader 5 (MT5) Demo Feeds**: Rejected because MT5 uses non-real, synthetic data.
- **Crypto Exchange Public APIs**: Rejected because CME Futures are required.
- **Reading `.ncd` Files**: Rejected because `.nrd` Market Replay exports + the NT8 stream already cover the required data and 60–90 day history window.
